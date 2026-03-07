import path from 'path';
import fs from 'fs-extra';
import { bundle } from '@remotion/bundler';
import { selectComposition, renderMedia } from '@remotion/renderer';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { validateConfig, validateEnv } from '../utils/validate.js';
import { AssetLoader } from './assets.js';
import { generateVoiceover } from './elevenlabs.js';
import { transcribeAudio } from './whisper.js';
import { generateFalClip } from './fal.js';
import { packageFinalVideo } from './export.js';
import { AirtableLogger } from './airtable.js';
import { runDirector } from './director.js';
import { generateStoryboardFrame } from './storyboard.js';
import { getFormatMeta } from '../remotion/helpers/timing.js';
import type { VideoConfig, VideoGenOptions, CaptionWord } from '../types/index.js';

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
 * @returns Absolute path to the final rendered MP4
 */
export async function runPipeline(projectName: string, runOpts?: { storyboardOnly?: boolean }): Promise<string> {
  const projectDir = path.join(PROJECTS_ROOT, projectName);

  // ── Environment validation ──────────────────────────────────────────────
  validateEnv(['FAL_KEY', 'ELEVENLABS_API_KEY', 'OPENAI_API_KEY']);

  // ── Airtable run tracking ───────────────────────────────────────────────
  const airtable = new AirtableLogger();
  let airtableRecordId: string | null = null;
  const startTime = Date.now();

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

  const formatMeta = getFormatMeta(config.format);
  if (runOpts?.storyboardOnly !== true) {
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
    `└────────────────────────────────────────────────────┘`,
  );

  // ── Director step ────────────────────────────────────────────────────────
  const directorPlan = await runDirector(config, assets, PROJECTS_ROOT, projectName);

  // Apply Director suggestions for missing hookText / CTA (never overrides explicit config values)
  if (directorPlan?.suggestedHookText !== undefined && config.hookText === undefined) {
    config = { ...config, hookText: directorPlan.suggestedHookText };
    logger.info(`Director: applying suggested hookText: "${directorPlan.suggestedHookText}"`);
  }
  if (directorPlan?.suggestedCta !== undefined && config.cta === undefined) {
    config = { ...config, cta: directorPlan.suggestedCta };
    logger.info(`Director: applying suggested CTA: "${directorPlan.suggestedCta.text}"`);
  }

  // ── Step 1: Generate voiceover ──────────────────────────────────────────
  // Director enriches the script with SSML pause tags and sets optimal voice settings.
  // Note: generateVoiceover skips if voiceover.mp3 already exists — delete it to regenerate
  // with Director enrichment if you previously ran without the Director.
  let voiceoverPath: string | undefined;
  if (config.script && config.script.trim().length > 0 && config.voiceId) {
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
  } else {
    logger.skip('No script or voiceId in config — skipping voiceover generation.');
  }

  // ── Step 2: Transcribe voiceover ────────────────────────────────────────
  let captions: CaptionWord[] = [];
  const shouldCaption = config.captions ?? formatMeta.defaultCaptions;

  if (shouldCaption && voiceoverPath !== undefined) {
    const whisperResult = await transcribeAudio(voiceoverPath, PROJECTS_ROOT, projectName);
    captions = whisperResult.words;
  } else if (shouldCaption) {
    logger.skip('Captions enabled but no voiceover — captions will be empty.');
  }

  // ── Step 3: Generate video clips ─────────────────────────────────────────
  const clipPaths: string[] = [];
  let previousLastFramePath: string | undefined = undefined;

  for (let i = 0; i < config.clips.length; i++) {
    const clip = config.clips[i];
    if (!clip) continue;

    // Use pre-generated clip URL if provided — download and skip fal.ai API
    if (clip.url !== undefined) {
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
      continue;
    }

    // Use Director-enriched prompt if available, fall back to raw config prompt
    const enrichedClipPlan = directorPlan?.clips.find((c) => c.sceneIndex === i + 1);
    const prompt = enrichedClipPlan?.enrichedPrompt ?? clip.prompt ?? '';

    // Generate storyboard frame via Gemini if not already present.
    // Scene 1: text-only prompt. Scene N+1: includes previous clip's last frame for continuity.
    const generatedFrame = await generateStoryboardFrame({
      sceneIndex: i + 1,
      prompt,
      format: config.format,
      ...(directorPlan?.visualStyleSummary !== undefined && { visualStyleSummary: directorPlan.visualStyleSummary }),
      ...(previousLastFramePath !== undefined && { previousLastFramePath }),
      projectsRoot: PROJECTS_ROOT,
      projectName,
    });

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

    const clipPath = await generateFalClip(prompt, options, PROJECTS_ROOT, imageRef);
    clipPaths.push(clipPath);

    // Capture last frame for next scene's Gemini generation
    const lastFramePath = path.join(
      PROJECTS_ROOT, projectName, 'assets', 'storyboard', `scene-${i + 1}-lastframe.png`,
    );
    if (await fs.pathExists(lastFramePath)) {
      previousLastFramePath = lastFramePath;
    }
  }

  // Early exit: storyboard-only mode — all Gemini frames generated, no Kling calls made
  if (runOpts?.storyboardOnly === true) {
    const storyboardDir = path.join(PROJECTS_ROOT, projectName, 'assets', 'storyboard');
    logger.success('\nStoryboard generation complete!');
    logger.info(`Review your frames at: ${storyboardDir}`);
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

  const inputProps = {
    config,
    assets,
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

  const elapsedSeconds = (Date.now() - startTime) / 1000;
  await airtable.completeRun(airtableRecordId, finalPath, elapsedSeconds);

  return finalPath;
  } catch (err) {
    if (airtableRecordId !== null) {
      await airtable.failRun(airtableRecordId, err instanceof Error ? err.message : String(err));
    }
    throw err;
  }
}
