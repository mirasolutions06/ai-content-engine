import path from 'path';
import fs from 'fs-extra';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { validateConfig, validateEnv } from '../utils/validate.js';
import { validatePrompts } from '../utils/prompt-validator.js';
import { CostTracker } from '../utils/cost-tracker.js';
import { AssetLoader } from './assets.js';
import { generateVoiceover } from './elevenlabs.js';
import { transcribeAudio } from './whisper.js';
import { generateFalClip } from './fal.js';
import { packageFinalVideo } from './export.js';
import { AirtableLogger } from './airtable.js';
import { runDirector } from './director.js';
import { generateStoryboardFrame } from './storyboard.js';
import { getFormatMeta } from '../remotion/helpers/timing.js';
import { generateBrandImages } from './brand-images.js';
import { sourceAssets } from './asset-sourcer.js';
import type { VideoConfig, VideoGenOptions, CaptionWord, RunOptions, PipelineResult } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECTS_ROOT = path.resolve(process.cwd(), 'projects');
// Path to Remotion entry point
const REMOTION_ENTRY = path.resolve(__dirname, '../remotion/Root.tsx');

/**
 * Maps VideoFormat to Remotion composition ID.
 * The composition IDs must match what is registered in Root.tsx.
 */
const FORMAT_TO_COMPOSITION: Record<string, string> = {
  'youtube-short': 'YoutubeShort',
  'tiktok': 'TikTok',
  'ad-16x9': 'Ad',
  'ad-1x1': 'Ad',
  'web-hero': 'WebHero',
};

/**
 * Main pipeline orchestrator. Runs all steps in order, skipping completed ones.
 * All steps are idempotent — re-running never duplicates API calls or renders.
 *
 * Steps:
 * 1. Validate environment and config
 * 2. Load project assets
 * 3. Generate voiceover (ElevenLabs) — skip if exists
 * 4. Transcribe voiceover (Whisper) — skip if cached
 * 5. Generate video clips via fal.ai — skip if cached
 * 6. Bundle and render with Remotion
 * 7. Package final video with timestamp
 *
 * @param projectName - Folder name under projects/
 * @returns Absolute path to the final rendered MP4, or PipelineResult for --json-output
 */
export async function runPipeline(projectName: string, runOpts?: RunOptions): Promise<string | PipelineResult> {
  const projectDir = path.join(PROJECTS_ROOT, projectName);
  const dryRun = runOpts?.dryRun === true;

  // ── Config loading ──────────────────────────────────────────────────────
  const configPath = path.join(projectDir, 'config.json');
  if (!(await fs.pathExists(configPath))) {
    throw new Error(
      `No config.json found at ${configPath}.\n` +
      `Create one by running: npm run new-project -- --name ${projectName} --format youtube-short`,
    );
  }

  let config = (await fs.readJson(configPath)) as VideoConfig;
  validateConfig(config);

  const mode = config.mode ?? 'video';
  const costTracker = new CostTracker(projectName, PROJECTS_ROOT);
  const resultAssets: PipelineResult['assets'] = { images: [], clips: [] };

  // ── Prompt validation ─────────────────────────────────────────────────
  validatePrompts(config);

  // ── Asset sourcing (before Director so auto-sourced files are available) ──
  await sourceAssets(projectName, config, projectDir, costTracker, dryRun);

  // ── Brand-images mode: generate multi-format images only ──────────────
  if (mode === 'brand-images') {
    if (dryRun) {
      const formats = config.imageFormats ?? ['story', 'square', 'landscape'];
      const imageCount = config.clips.length * formats.length;
      logger.info(`[DRY RUN] Would generate ${imageCount} brand images (${config.clips.length} scenes × ${formats.length} formats)`);
      for (let i = 0; i < config.clips.length; i++) {
        const clip = config.clips[i];
        if (!clip?.prompt) continue;
        for (const fmt of formats) {
          logger.info(`[DRY RUN]   scene-${i + 1}-${fmt}: ${clip.prompt.slice(0, 80)}...`);
          costTracker.logStep('gemini-brand-image', false);
        }
      }
      const totalCost = costTracker.estimateRun(config);
      logger.success(`\n[DRY RUN] Estimated total cost: $${totalCost.toFixed(2)}`);
      await costTracker.save();

      if (runOpts?.jsonOutput === true) {
        return {
          success: true,
          outputPath: path.join(projectDir, 'output', 'images'),
          projectDir,
          mode,
          assets: resultAssets,
          estimatedCost: totalCost,
          cachedSteps: [],
        };
      }
      return projectDir;
    }

    const imagesDir = await generateBrandImages(config, PROJECTS_ROOT, projectName);
    return imagesDir;
  }

  // ── Full mode: generate brand images first, then fall through to video ─
  if (mode === 'full') {
    if (dryRun) {
      const formats = config.imageFormats ?? ['story', 'square', 'landscape'];
      const imageCount = config.clips.length * formats.length;
      logger.info(`[DRY RUN] Would generate ${imageCount} brand images first`);
      for (let i = 0; i < config.clips.length; i++) {
        for (const fmt of formats) {
          costTracker.logStep('gemini-brand-image', false);
          void fmt; // logged in cost tracker
        }
      }
    } else {
      await generateBrandImages(config, PROJECTS_ROOT, projectName);
    }
  }

  // ── Environment validation (video modes need all API keys) ────────────
  if (!dryRun) {
    validateEnv(['FAL_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_API_KEY']);
  }

  // ── Airtable run tracking ───────────────────────────────────────────────
  const airtable = new AirtableLogger();
  let airtableRecordId: string | null = null;
  const startTime = Date.now();

  const formatMeta = getFormatMeta(config.format);
  if (runOpts?.storyboardOnly !== true && !dryRun) {
    airtableRecordId = await airtable.createRun(projectName, config.format, config);
  }

  try {
  // ── Asset loading ───────────────────────────────────────────────────────
  const loader = new AssetLoader(PROJECTS_ROOT, projectName);
  const assets = await loader.load();

  logger.info(
    `\n┌────────────────────────────────────────────────────┐\n` +
    `│  Project: ${projectName.padEnd(43)}│\n` +
    `│  Format:  ${config.format.padEnd(43)}│\n` +
    `│  Clips:   ${String(config.clips.length).padEnd(43)}│\n` +
    `│  Script:  ${(config.script ? 'Yes' : 'No').padEnd(43)}│\n` +
    `│  Music:   ${(assets.backgroundMusic ? 'Yes' : 'No').padEnd(43)}│\n` +
    `│  Mode:    ${(dryRun ? 'DRY RUN' : mode).padEnd(43)}│\n` +
    `└────────────────────────────────────────────────────┘`,
  );

  // ── Director step (runs even in dry-run — cheap and cached) ────────────
  const directorPlan = await runDirector(config, assets, PROJECTS_ROOT, projectName);
  costTracker.logStep('director', directorPlan !== null);

  // Apply Director suggestions for missing hookText / CTA (never overrides explicit config values)
  if (directorPlan?.suggestedHookText !== undefined && config.hookText === undefined) {
    config = { ...config, hookText: directorPlan.suggestedHookText };
    logger.info(`Director: applying suggested hookText: "${directorPlan.suggestedHookText}"`);
  }
  if (directorPlan?.suggestedCta !== undefined && config.cta === undefined) {
    config = { ...config, cta: directorPlan.suggestedCta };
    logger.info(`Director: applying suggested CTA: "${directorPlan.suggestedCta.text}"`);
  }
  if (directorPlan?.suggestedCaptionTheme !== undefined && config.captionTheme === undefined) {
    config = { ...config, captionTheme: directorPlan.suggestedCaptionTheme };
    logger.info(`Director: applying suggested captionTheme: "${directorPlan.suggestedCaptionTheme}"`);
  }

  // ── Step 1: Generate voiceover ──────────────────────────────────────────
  // Director enriches the script with SSML pause tags and sets optimal voice settings.
  // Note: generateVoiceover skips if voiceover.mp3 already exists — delete it to regenerate
  // with Director enrichment if you previously ran without the Director.
  let voiceoverPath: string | undefined;
  if (config.script && config.script.trim().length > 0 && config.voiceId) {
    if (dryRun) {
      const script = directorPlan?.voice.enrichedScript ?? config.script;
      logger.info(`[DRY RUN] Would generate voiceover: voice=${config.voiceId}, script="${script.slice(0, 80)}..."`);
      costTracker.logStep('elevenlabs', false);
    } else {
      const script = directorPlan?.voice.enrichedScript ?? config.script;
      const voiceOptions = directorPlan
        ? {
            voiceId: config.voiceId,
            stability: directorPlan.voice.stability,
            similarityBoost: directorPlan.voice.similarityBoost,
            style: directorPlan.voice.style,
          }
        : { voiceId: config.voiceId };

      voiceoverPath = await generateVoiceover(script, voiceOptions, PROJECTS_ROOT, projectName);
      resultAssets.voiceover = voiceoverPath;
    }
  } else {
    logger.skip('No script or voiceId in config — skipping voiceover generation.');
  }

  // ── Step 2: Transcribe voiceover ────────────────────────────────────────
  let captions: CaptionWord[] = [];
  const shouldCaption = config.captions ?? formatMeta.defaultCaptions;

  if (shouldCaption && voiceoverPath !== undefined && !dryRun) {
    const whisperResult = await transcribeAudio(voiceoverPath, PROJECTS_ROOT, projectName);
    captions = whisperResult.words;
    costTracker.logStep('whisper', false);
  } else if (dryRun && shouldCaption && config.script && config.voiceId) {
    logger.info('[DRY RUN] Would transcribe voiceover with Whisper');
    costTracker.logStep('whisper', false);
  } else if (shouldCaption) {
    logger.skip('Captions enabled but no voiceover — captions will be empty.');
  }

  // ── Step 3: Generate video clips ─────────────────────────────────────────
  const clipPaths: string[] = [];
  let previousLastFramePath: string | undefined = undefined;
  let scene1AnchorPath: string | undefined = undefined;

  for (let i = 0; i < config.clips.length; i++) {
    const clip = config.clips[i];
    if (!clip) continue;

    // Use pre-generated clip URL if provided — download and skip fal.ai API
    if (clip.url !== undefined) {
      if (!dryRun) {
        const prebuiltPath = path.join(
          PROJECTS_ROOT,
          projectName,
          'output/clips',
          `scene-${i + 1}.mp4`,
        );
        if (!(await fs.pathExists(prebuiltPath))) {
          logger.step(`Downloading pre-built clip for scene ${i + 1}...`);
          const res = await fetch(clip.url);
          if (!res.ok) {
            throw new Error(
              `Failed to download pre-built clip for scene ${i + 1}: HTTP ${res.status}`,
            );
          }
          const buf = await res.arrayBuffer();
          await fs.ensureDir(path.dirname(prebuiltPath));
          await fs.writeFile(prebuiltPath, Buffer.from(buf));
        }
        clipPaths.push(prebuiltPath);
        resultAssets.clips.push(prebuiltPath);
      }
      continue;
    }

    // Use Director-enriched prompt if available, fall back to raw config prompt
    const enrichedClipPlan = directorPlan?.clips.find((c) => c.sceneIndex === i + 1);
    const prompt = enrichedClipPlan?.enrichedPrompt ?? clip.prompt ?? '';

    if (dryRun) {
      logger.info(`[DRY RUN] Would generate storyboard frame for scene ${i + 1}: "${prompt.slice(0, 100)}..."`);
      costTracker.logStep('gemini-frame', false);

      const isV3 = config.klingVersion === 'v3';
      const dur = (clip.duration ?? 5) > 5 ? '10s' : '5s';
      const klingKey = isV3 ? `kling-v3-${dur}` : `kling-${dur}`;
      logger.info(`[DRY RUN] Would generate Kling ${isV3 ? 'v3' : 'v2.1'} ${dur} clip for scene ${i + 1}`);
      costTracker.logStep(klingKey, false);
      continue;
    }

    // Generate storyboard frame via Gemini if not already present.
    // Scene 1: text-only prompt. Scene N+1: includes previous clip's last frame for continuity.
    const generatedFrame = await generateStoryboardFrame({
      sceneIndex: i + 1,
      prompt,
      format: config.format,
      ...(directorPlan?.visualStyleSummary !== undefined && { visualStyleSummary: directorPlan.visualStyleSummary }),
      ...(directorPlan?.lightingSetup !== undefined && { lightingSetup: directorPlan.lightingSetup }),
      ...(directorPlan?.backgroundDescription !== undefined && { backgroundDescription: directorPlan.backgroundDescription }),
      ...(directorPlan?.colorPalette !== undefined && { colorPalette: directorPlan.colorPalette }),
      ...(enrichedClipPlan?.lighting !== undefined && { lighting: enrichedClipPlan.lighting }),
      ...(enrichedClipPlan?.colorGrade !== undefined && { colorGrade: enrichedClipPlan.colorGrade }),
      ...(enrichedClipPlan?.cameraMove !== undefined && { cameraMove: enrichedClipPlan.cameraMove }),
      ...(previousLastFramePath !== undefined && { previousLastFramePath }),
      ...(assets.subjectReference !== undefined && { subjectReferencePath: assets.subjectReference }),
      ...(scene1AnchorPath !== undefined && { scene1AnchorPath }),
      projectsRoot: PROJECTS_ROOT,
      projectName,
    });
    costTracker.logStep('gemini-frame', generatedFrame === null);

    // Scene 1's generated frame becomes the style anchor for all subsequent scenes
    if (i === 0 && generatedFrame !== null) {
      scene1AnchorPath = generatedFrame;
    }

    // Storyboard-only mode: skip video generation for this clip
    if (runOpts?.storyboardOnly === true) {
      previousLastFramePath = undefined; // no lastframe without a generated clip
      continue;
    }

    // Match storyboard frame for this scene (1-based sceneIndex)
    const storyboardFrame = assets.storyboardFrames.find((f) => f.sceneIndex === i + 1);

    const options: VideoGenOptions = {
      aspectRatio: formatMeta.aspectRatio,
      duration: clip.duration ?? 5,
      projectName,
      sceneIndex: i + 1,
    };

    // Priority: Gemini-generated frame > pre-existing storyboard > config imageReference
    const imageRef = generatedFrame ?? storyboardFrame?.imagePath ?? clip.imageReference;

    // Build Kling prompt: in image-to-video mode, Kling already HAS the scene as an image.
    // Sending a long scene description causes morphing/confusion. Instead, send a SHORT
    // motion-focused prompt built from the Director's cameraMove field.
    // In text-to-video mode (no image), send the full enriched scene description.
    let klingPrompt: string;
    if (imageRef !== undefined && enrichedClipPlan?.cameraMove) {
      // Image-to-video: motion-only prompt (what moves, not what the scene looks like)
      klingPrompt = `${enrichedClipPlan.cameraMove}. Smooth subtle motion, photorealistic, cinematic.`;
    } else {
      // Text-to-video fallback: needs the full scene description
      klingPrompt = enrichedClipPlan?.continuityNote
        ? `${prompt}. ${enrichedClipPlan.continuityNote}`
        : prompt;
    }

    // Pass previous clip's last frame as tail_image_url for seamless transitions
    const clipPath = await generateFalClip(klingPrompt, options, PROJECTS_ROOT, imageRef, previousLastFramePath, config.klingVersion);
    clipPaths.push(clipPath);
    resultAssets.clips.push(clipPath);
    const isV3Clip = config.klingVersion === 'v3';
    const clipDur = (clip.duration ?? 5) > 5 ? '10s' : '5s';
    costTracker.logStep(isV3Clip ? `kling-v3-${clipDur}` : `kling-${clipDur}`, false);

    // Capture last frame for next scene's Gemini generation
    const lastFramePath = path.join(
      PROJECTS_ROOT, projectName, 'assets', 'storyboard', `scene-${i + 1}-lastframe.png`,
    );
    if (await fs.pathExists(lastFramePath)) {
      previousLastFramePath = lastFramePath;
    }
  }

  // ── Dry-run exit ──────────────────────────────────────────────────────────
  if (dryRun) {
    const totalCost = costTracker.estimateRun(config);
    logger.success(`\n[DRY RUN] Estimated total cost: $${totalCost.toFixed(2)}`);
    logger.info('Run without --dry-run to execute. Consider --storyboard-only first.');
    await costTracker.save();

    if (runOpts?.jsonOutput === true) {
      const summary = costTracker.getSummary();
      return {
        success: true,
        outputPath: projectDir,
        projectDir,
        mode,
        assets: resultAssets,
        estimatedCost: summary.totalEstimated,
        cachedSteps: summary.entries.filter((e) => e.cached).map((e) => e.step),
      };
    }
    return projectDir;
  }

  // Early exit: storyboard-only mode — all Gemini frames generated, no Kling calls made
  if (runOpts?.storyboardOnly === true) {
    const storyboardDir = path.join(PROJECTS_ROOT, projectName, 'assets', 'storyboard');
    logger.success('\nStoryboard generation complete!');
    logger.info(`Review your frames at: ${storyboardDir}`);
    await costTracker.save();
    return storyboardDir;
  }

  if (clipPaths.length === 0) {
    throw new Error(
      `No clips were generated or downloaded. ` +
      `Check your config.json clips array and API keys.`,
    );
  }

  // ── Step 4: Render with Remotion ─────────────────────────────────────────
  const compositionId = FORMAT_TO_COMPOSITION[config.format];
  if (!compositionId) {
    throw new Error(`Unknown format: ${config.format}`);
  }

  logger.step(`Bundling Remotion project...`);

  // Remotion's renderer only serves files via its local HTTP server (no file:// support).
  // publicDir makes the project folder available at the bundle root, so clips and
  // voiceover can be referenced with staticFile() as relative paths.
  const publicDir = path.join(PROJECTS_ROOT, projectName);

  const bundleLocation = await bundle({
    entryPoint: REMOTION_ENTRY,
    publicDir,
    onProgress: (progress: number) => {
      if (progress % 20 === 0) {
        logger.info(`  Bundle progress: ${progress}%`);
      }
    },
    webpackOverride: (config) => ({
      ...config,
      resolve: {
        ...config.resolve,
        extensionAlias: {
          '.js': ['.tsx', '.ts', '.js'],
        },
      },
    }),
  });

  const totalSeconds = config.clips.reduce((sum, c) => sum + (c.duration ?? 5), 0);
  const totalFrames = Math.round(totalSeconds * formatMeta.fps);

  // Paths must be relative to publicDir so staticFile() can serve them
  const relativeClipPaths = clipPaths.map((p) => path.relative(publicDir, p));
  const relativeVoiceoverPath =
    voiceoverPath !== undefined ? path.relative(publicDir, voiceoverPath) : undefined;

  // Relativize asset paths too (logo, fonts, music)
  const rel = (p: string | undefined) => p !== undefined ? path.relative(publicDir, p) : undefined;
  const relativeAssets = { ...assets } as typeof assets;
  if (relativeAssets.logo !== undefined) relativeAssets.logo = rel(relativeAssets.logo)!;
  if (relativeAssets.fontBold !== undefined) relativeAssets.fontBold = rel(relativeAssets.fontBold)!;
  if (relativeAssets.fontRegular !== undefined) relativeAssets.fontRegular = rel(relativeAssets.fontRegular)!;
  if (relativeAssets.backgroundMusic !== undefined) relativeAssets.backgroundMusic = rel(relativeAssets.backgroundMusic)!;

  const inputProps = {
    config,
    assets: relativeAssets,
    captions,
    clipPaths: relativeClipPaths,
    voiceoverPath: relativeVoiceoverPath,
  };

  logger.step(`Selecting composition: ${compositionId}...`);

  const composition = await selectComposition({
    serveUrl: bundleLocation,
    id: compositionId,
    inputProps,
  });

  const tempOutputPath = path.join(PROJECTS_ROOT, projectName, 'output', '_render-temp.mp4');
  await fs.ensureDir(path.dirname(tempOutputPath));

  logger.step(`Rendering ${totalFrames} frames (${totalSeconds}s at ${formatMeta.fps}fps)...`);

  await renderMedia({
    composition: { ...composition, durationInFrames: totalFrames },
    serveUrl: bundleLocation,
    codec: 'h264',
    outputLocation: tempOutputPath,
    inputProps,
    // Move moov atom to the front of the MP4 so web players and Airtable can preview without
    // downloading the full file first (progressive streaming / faststart).
    ffmpegOverride: ({ type, args }) => {
      if (type === 'stitcher') {
        return [...args.slice(0, -1), '-movflags', '+faststart', args[args.length - 1]!];
      }
      return args;
    },
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct % 10 === 0) {
        logger.info(`  Render progress: ${pct}%`);
      }
    },
  });

  logger.success('Remotion render complete.');

  // ── Step 5: Package final video ──────────────────────────────────────────
  const finalPath = await packageFinalVideo(
    tempOutputPath,
    PROJECTS_ROOT,
    projectName,
    config.title,
    config.format,
  );

  await fs.remove(tempOutputPath);
  resultAssets.video = finalPath;

  const elapsedSeconds = (Date.now() - startTime) / 1000;
  await airtable.completeRun(airtableRecordId, finalPath, elapsedSeconds);
  await costTracker.save();

  // ── Return result ────────────────────────────────────────────────────────
  if (runOpts?.jsonOutput === true) {
    const summary = costTracker.getSummary();
    return {
      success: true,
      outputPath: finalPath,
      projectDir,
      mode,
      assets: resultAssets,
      estimatedCost: summary.totalEstimated,
      cachedSteps: summary.entries.filter((e) => e.cached).map((e) => e.step),
    };
  }

  return finalPath;
  } catch (err) {
    if (airtableRecordId !== null) {
      await airtable.failRun(airtableRecordId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}
