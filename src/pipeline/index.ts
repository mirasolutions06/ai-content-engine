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
import { generateFalClip, generateV3MultiShot, generateSoraClip } from './fal.js';
import type { MultiShotPrompt } from './fal.js';
import { generateVeoClip } from './veo.js';
import { packageFinalVideo } from './export.js';
import { AirtableLogger, AirtableReviewer } from './airtable.js';
import { runDirector } from './director.js';
import { generateImage } from './image-router.js';
import { editImage, resolveSourceImage } from './image-editor.js';
import { compositeOverlay } from './image-compositor.js';
import { analyzeReferenceVideos } from './video-analyzer.js';
import { processVideoRef } from './video-ref.js';
import { getFormatMeta } from '../remotion/helpers/timing.js';
import { generateBrandImages } from './brand-images.js';
import { evaluateImage, saveQAResults } from '../utils/image-qa.js';
import { parallelWithLimit } from '../utils/concurrency.js';
import { sourceAssets } from './asset-sourcer.js';
import { diffConfig, saveConfigSnapshot } from '../utils/config-diff.js';
import { recordBrandRun } from '../utils/brand-memory.js';
import { recordSkillRun } from '../utils/skill-memory.js';
import { loadCheckpoint, saveCheckpoint, clearCheckpoint, createCheckpoint, type PipelineCheckpoint } from '../utils/checkpoint.js';
import { AssetManifest } from '../utils/asset-manifest.js';
import type {
  VideoConfig, VideoProvider, ImageProvider, ClipOutputType,
  VideoGenOptions, CaptionWord, RunOptions, PipelineResult, PipelineMode,
  DirectorClipPlan, VideoClip, ImageQAResult, KlingVersion,
} from '../types/index.js';

/** Resolve the effective video provider from config, with backward compat for klingVersion. */
function resolveVideoProvider(config: VideoConfig): VideoProvider {
  if (config.videoProvider !== undefined) return config.videoProvider;
  if (config.klingVersion === 'v3') return 'kling-v3';
  return 'kling-v2.1';
}

/** Resolve the project-level image provider. */
function resolveImageProvider(config: VideoConfig): ImageProvider {
  return config.imageProvider ?? 'gemini';
}

/** Resolve the output type for a clip based on its config and pipeline mode. */
function resolveClipOutputType(clip: VideoClip, mode: PipelineMode): ClipOutputType {
  if (clip.outputType) return clip.outputType;
  return mode === 'brand-images' ? 'image' : 'video';
}

/** Data collected during Phase 1 (storyboard) for use in Phase 2 (video gen). */
interface ClipPlan {
  sceneIndex: number;
  outputType: ClipOutputType;
  generatedFrame: string | null;
  enrichedClipPlan?: DirectorClipPlan | undefined;
  clip: VideoClip;
  prompt: string;
}

/** Build a video prompt tailored to the target video provider. */
function buildVideoPrompt(
  plan: ClipPlan,
  provider: VideoProvider,
  imageRef: string | undefined,
): string {
  if (plan.outputType === 'animation') {
    const move = plan.enrichedClipPlan?.cameraMove ?? 'slow drift';
    return `Subtle gentle motion. ${move}.`;
  }

  const hasImage = imageRef !== undefined;
  const cameraMove = plan.enrichedClipPlan?.cameraMove;
  const continuityNote = plan.enrichedClipPlan?.continuityNote;
  const lighting = plan.enrichedClipPlan?.lighting;
  const colorGrade = plan.enrichedClipPlan?.colorGrade;

  switch (provider) {
    case 'kling-v2.1':
      // Kling v2.1 works best with short, direct motion prompts
      if (hasImage && cameraMove) {
        return `${cameraMove}. Smooth cinematic motion.`;
      }
      return plan.prompt;

    case 'kling-v3':
      // Kling v3 handles more scene context + motion detail
      if (hasImage && cameraMove) {
        return `${plan.prompt}. ${cameraMove}. Photorealistic, cinematic.`;
      }
      return continuityNote
        ? `${plan.prompt}. ${continuityNote}`
        : plan.prompt;

    case 'veo-3.1':
    case 'veo-3.1-fast': {
      // Veo thrives on rich atmospheric descriptions + camera language
      const parts = [plan.prompt];
      if (cameraMove) parts.push(cameraMove);
      if (lighting) parts.push(lighting);
      if (colorGrade) parts.push(colorGrade);
      parts.push('Cinematic, atmospheric, professional film quality.');
      return parts.join('. ');
    }

    case 'sora-2':
    case 'sora-2-720p': {
      // Sora handles rich descriptions well, similar to Veo
      const parts = [plan.prompt];
      if (cameraMove) parts.push(cameraMove);
      if (lighting) parts.push(lighting);
      if (colorGrade) parts.push(colorGrade);
      parts.push('Cinematic, photorealistic.');
      return parts.join('. ');
    }

    default:
      if (hasImage && cameraMove) {
        return `${plan.prompt}. ${cameraMove}. Photorealistic, cinematic, smooth subtle motion.`;
      }
      return continuityNote
        ? `${plan.prompt}. ${continuityNote}`
        : plan.prompt;
  }
}

/** Map clip duration to Kling v3 multi-shot duration values. */
function toMultiShotDuration(seconds: number): '3' | '5' | '10' {
  if (seconds <= 3) return '3';
  if (seconds <= 7) return '5';
  return '10';
}

/** Default variation angles when Director didn't provide them. */
const FALLBACK_VARIATION_ANGLES = [
  'different camera distance or angle',
  'warmer color temperature, golden hour emphasis',
  'tighter crop focused on texture detail',
];

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
  const isDraft = runOpts?.draft === true;
  const costTracker = new CostTracker(projectName, PROJECTS_ROOT);

  if (isDraft) {
    logger.info('[DRAFT] Cheap preview mode — Kling v2.1, skip voiceover & Remotion.');
  }
  const resultAssets: PipelineResult['assets'] = { images: [], clips: [] };

  // ── Prompt validation ─────────────────────────────────────────────────
  validatePrompts(config);

  // ── Config diff (show what changed since last run) ────────────────────
  const configDiff = await diffConfig(config, PROJECTS_ROOT, projectName);
  if (!configDiff.isFirstRun && configDiff.changedClips.length > 0) {
    const changed = configDiff.changedClips.join(', ');
    const unchanged = configDiff.unchangedClips.join(', ') || 'none';
    logger.info(`Config diff: clips ${changed} changed. Clips ${unchanged} unchanged (cached).`);
  }

  // ── Checkpoint loading (resume from previous partial run) ──────────────
  let checkpoint: PipelineCheckpoint | null = null;
  if (runOpts?.resume === true && !dryRun) {
    checkpoint = await loadCheckpoint(config, PROJECTS_ROOT, projectName);
  }
  if (!checkpoint) {
    checkpoint = createCheckpoint(config);
  }

  // ── Asset manifest (track provenance of every generated asset) ────────
  const manifest = new AssetManifest(PROJECTS_ROOT, projectName);

  // ── Asset sourcing (before Director so auto-sourced files are available) ──
  await sourceAssets(projectName, config, projectDir, costTracker, dryRun);

  // ── Video reference download + key frame extraction ─────────────────────
  await processVideoRef(config, projectDir, dryRun);

  // ── Video reference analysis (for both brand-images and video modes) ────
  const videoAnalysis = await analyzeReferenceVideos(PROJECTS_ROOT, projectName);
  if (videoAnalysis !== null) {
    costTracker.logStep('gemini-video-analysis', false);
    logger.info(`Video reference: ${videoAnalysis.mood} style, ${videoAnalysis.pacing} pacing`);
  }

  // ── Brand-images mode: generate multi-format images only ──────────────
  if (mode === 'brand-images') {
    // Run Director for brand-images too — enriches prompts and writes brand-context.json
    // for downstream skills (Copy Engine). Cheap (~$0.10) and cached.
    const loader = new AssetLoader(PROJECTS_ROOT, projectName);
    const assets = await loader.load();
    const directorPlan = await runDirector(config, assets, PROJECTS_ROOT, projectName, videoAnalysis ?? undefined);
    costTracker.logStep('director', directorPlan !== null);

    if (runOpts?.directorOnly === true) {
      await costTracker.save();
      const ctxPath = path.join(projectDir, 'cache', 'brand-context.json');
      logger.success(`Director plan ready. Review: ${path.relative(process.cwd(), ctxPath)}`);
      logger.info('Run again without --director-only to generate images.');
      return ctxPath;
    }

    if (dryRun) {
      const formats = config.imageFormats ?? ['story', 'square', 'landscape'];
      const imageCount = config.clips.length * formats.length;
      logger.info(`[DRY RUN] Would generate ${imageCount} brand images (${config.clips.length} image(s) × ${formats.length} formats)`);
      const multiClip = config.clips.length > 1;
      for (let i = 0; i < config.clips.length; i++) {
        const clip = config.clips[i];
        if (!clip?.prompt) continue;
        for (const fmt of formats) {
          const name = multiClip ? `${i + 1}-${fmt}` : fmt;
          logger.info(`[DRY RUN]   ${name}: ${clip.prompt.slice(0, 80)}...`);
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

    const imagesDir = await generateBrandImages(config, PROJECTS_ROOT, projectName, runOpts?.regenerateImages);
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
      await generateBrandImages(config, PROJECTS_ROOT, projectName, runOpts?.regenerateImages);
    }
  }

  // ── Format is required from here on (video/full modes) ─────────────
  if (!config.format) {
    throw new Error(
      `config.json is missing "format" — required for ${mode} mode. ` +
      `Valid values: youtube-short | tiktok | ad-16x9 | ad-1x1 | web-hero`,
    );
  }
  const format = config.format;

  // ── Environment validation (based on project-level providers) ────────
  if (!dryRun) {
    const videoProvider = resolveVideoProvider(config);
    const imgProvider = resolveImageProvider(config);
    const hasVideoClips = config.clips.some((c) => resolveClipOutputType(c, mode) !== 'image');
    const requiredKeys: string[] = [];

    // Image provider
    if (imgProvider === 'gpt-image') requiredKeys.push('OPENAI_API_KEY');
    else requiredKeys.push('GEMINI_API_KEY');

    // Video provider (only if any clips produce video/animation)
    if (hasVideoClips) {
      if (!requiredKeys.includes('OPENAI_API_KEY')) requiredKeys.push('OPENAI_API_KEY'); // Whisper
      requiredKeys.push('ELEVENLABS_API_KEY');
      if (videoProvider.startsWith('veo-')) {
        if (!requiredKeys.includes('GEMINI_API_KEY')) requiredKeys.push('GEMINI_API_KEY');
      } else {
        requiredKeys.push('FAL_KEY');
      }
    }

    validateEnv(requiredKeys);
  }

  // ── Airtable run tracking ───────────────────────────────────────────────
  const airtable = new AirtableLogger();
  let airtableRecordId: string | null = null;
  const startTime = Date.now();

  const formatMeta = getFormatMeta(format);
  if (runOpts?.storyboardOnly !== true && !dryRun) {
    airtableRecordId = await airtable.createRun(projectName, format, config);
  }

  try {
  // ── Asset loading ───────────────────────────────────────────────────────
  const loader = new AssetLoader(PROJECTS_ROOT, projectName);
  const assets = await loader.load();

  logger.info(
    `\n┌────────────────────────────────────────────────────┐\n` +
    `│  Project: ${projectName.padEnd(43)}│\n` +
    `│  Format:  ${format.padEnd(43)}│\n` +
    `│  Clips:   ${String(config.clips.length).padEnd(43)}│\n` +
    `│  Script:  ${(config.script ? 'Yes' : 'No').padEnd(43)}│\n` +
    `│  Music:   ${(assets.backgroundMusic ? 'Yes' : 'No').padEnd(43)}│\n` +
    `│  Mode:    ${(dryRun ? 'DRY RUN' : mode).padEnd(43)}│\n` +
    `└────────────────────────────────────────────────────┘`,
  );

  // ── Director step (runs even in dry-run — cheap and cached) ────────────
  const directorPlan = await runDirector(config, assets, PROJECTS_ROOT, projectName, videoAnalysis ?? undefined);
  costTracker.logStep('director', directorPlan !== null);

  if (runOpts?.directorOnly === true) {
    await costTracker.save();
    const ctxPath = path.join(projectDir, 'cache', 'brand-context.json');
    logger.success(`Director plan ready. Review: ${path.relative(process.cwd(), ctxPath)}`);
    logger.info('Run again without --director-only to generate.');
    return ctxPath;
  }

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

  // ── Steps 1-2: Voiceover + Whisper ──────────────────────────────────────
  // In non-dry-run mode, voiceover and whisper run concurrently with Phase 1
  // storyboard generation for faster pipeline completion.
  let voiceoverPath: string | undefined;
  let captions: CaptionWord[] = [];
  const shouldCaption = config.captions ?? formatMeta.defaultCaptions;
  let voiceoverFlow: Promise<void> | null = null;

  if (config.script && config.script.trim().length > 0 && config.voiceId && !isDraft) {
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

      // Start voiceover + whisper as background flow (runs concurrently with storyboard)
      voiceoverFlow = (async () => {
        voiceoverPath = await generateVoiceover(script, voiceOptions, PROJECTS_ROOT, projectName);
        resultAssets.voiceover = voiceoverPath;
        costTracker.logStep('elevenlabs', false);

        if (shouldCaption && voiceoverPath !== undefined) {
          const whisperResult = await transcribeAudio(voiceoverPath, PROJECTS_ROOT, projectName);
          captions = whisperResult.words;
          costTracker.logStep('whisper', false);
        }
      })();
    }
  } else {
    logger.skip('No script or voiceId in config — skipping voiceover generation.');
  }

  if (dryRun && shouldCaption && config.script && config.voiceId) {
    logger.info('[DRY RUN] Would transcribe voiceover with Whisper');
    costTracker.logStep('whisper', false);
  } else if (shouldCaption && !(config.script && config.voiceId)) {
    logger.skip('Captions enabled but no voiceover — captions will be empty.');
  }

  // ── Helper: resolve video cost key for logging ─────────────────────────
  const imgProvider = resolveImageProvider(config);
  const videoProvider: VideoProvider = isDraft ? 'kling-v2.1' : resolveVideoProvider(config);

  function getVideoCostKey(provider: VideoProvider, durationSec: number): { key: string; label: string } {
    const dur = durationSec > 5;
    if (provider === 'veo-3.1') return { key: dur ? 'veo-3.1-8s' : 'veo-3.1-6s', label: `Veo 3.1 ${dur ? '8s' : '6s'}` };
    if (provider === 'veo-3.1-fast') return { key: dur ? 'veo-3.1-fast-8s' : 'veo-3.1-fast-6s', label: `Veo 3.1 Fast ${dur ? '8s' : '6s'}` };
    if (provider === 'sora-2') {
      const sd = durationSec <= 4 ? 4 : durationSec <= 8 ? 8 : durationSec <= 12 ? 12 : durationSec <= 16 ? 16 : 20;
      return { key: `sora-2-${sd}s`, label: `Sora 2 1080p ${sd}s` };
    }
    if (provider === 'sora-2-720p') {
      const sd = durationSec <= 4 ? 4 : durationSec <= 8 ? 8 : durationSec <= 12 ? 12 : durationSec <= 16 ? 16 : 20;
      return { key: `sora-2-720p-${sd}s`, label: `Sora 2 720p ${sd}s` };
    }
    if (provider === 'kling-v3') return { key: dur ? 'kling-v3-10s' : 'kling-v3-5s', label: `Kling v3 ${dur ? '10s' : '5s'}` };
    return { key: dur ? 'kling-10s' : 'kling-5s', label: `Kling v2.1 ${dur ? '10s' : '5s'}` };
  }

  const imgProviderLabel = imgProvider === 'gpt-image' ? 'GPT Image' : 'Gemini';
  const frameCostKey = imgProvider === 'gpt-image' ? 'gpt-image-standard' : 'gemini-frame';
  const frameVariationCostKey = imgProvider === 'gpt-image' ? 'gpt-image-standard' : 'gemini-frame-variation';

  if (!assets.subjectReference) {
    logger.info(`No reference images — generating from ${imgProviderLabel} prompts.`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: Serial storyboard generation (preserves continuity chain)
  // ═══════════════════════════════════════════════════════════════════════════
  const clipPlans: ClipPlan[] = [];
  const clipPaths: string[] = [];
  const imageOutputPaths: string[] = [];
  const qaResults: ImageQAResult[] = [];
  let previousLastFramePath: string | undefined = undefined;
  let scene1AnchorPath: string | undefined = undefined;
  const rejectedScenes = new Set<number>();

  // Collect reference paths for QA evaluation
  const modelRefPaths: string[] = [];
  const productRefPaths: string[] = [];
  if (assets.modelReference) modelRefPaths.push(assets.modelReference);
  if (assets.subjectReference) productRefPaths.push(assets.subjectReference);

  for (let i = 0; i < config.clips.length; i++) {
    const clip = config.clips[i];
    if (!clip) continue;

    const outputType = resolveClipOutputType(clip, mode);
    const enrichedClipPlan = directorPlan?.clips.find((c) => c.sceneIndex === i + 1);
    const prompt = enrichedClipPlan?.enrichedPrompt ?? clip.prompt ?? '';

    // ── Checkpoint resume: skip frames already completed ──
    const checkpointFrame = checkpoint.completedFrames[i + 1];
    if (checkpointFrame && (await fs.pathExists(checkpointFrame))) {
      logger.skip(`Scene ${i + 1}: resuming from checkpoint.`);
      clipPlans.push({ sceneIndex: i + 1, outputType, generatedFrame: checkpointFrame, enrichedClipPlan, clip, prompt });
      if (i === 0) scene1AnchorPath = checkpointFrame;
      if (outputType === 'image') {
        const imagesDir = path.join(PROJECTS_ROOT, projectName, 'output', 'images');
        const destPath = path.join(imagesDir, `scene-${i + 1}${path.extname(checkpointFrame)}`);
        if (await fs.pathExists(destPath)) {
          imageOutputPaths.push(destPath);
          resultAssets.images.push(destPath);
        }
      }
      continue;
    }

    // Use pre-generated clip URL if provided — download and skip generation
    if (clip.url !== undefined) {
      if (!dryRun) {
        const prebuiltPath = path.join(PROJECTS_ROOT, projectName, 'output/clips', `scene-${i + 1}.mp4`);
        if (!(await fs.pathExists(prebuiltPath))) {
          logger.step(`Downloading pre-built clip for scene ${i + 1}...`);
          const res = await fetch(clip.url);
          if (!res.ok) throw new Error(`Failed to download pre-built clip for scene ${i + 1}: HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          await fs.ensureDir(path.dirname(prebuiltPath));
          await fs.writeFile(prebuiltPath, Buffer.from(buf));
        }
        clipPaths.push(prebuiltPath);
        resultAssets.clips.push(prebuiltPath);
      }
      continue;
    }

    // ── Dry-run logging for this clip ──
    if (dryRun) {
      const variationCount = Math.min(Math.max(runOpts?.variations ?? 1, 1), 4);
      logger.info(`[DRY RUN] Scene ${i + 1} (${outputType}): "${prompt.slice(0, 100)}..." via ${imgProviderLabel}`);
      costTracker.logStep(frameCostKey, false);
      for (let v = 2; v <= variationCount; v++) {
        costTracker.logStep(frameVariationCostKey, false);
      }

      if (outputType === 'video' || outputType === 'animation') {
        const dur = outputType === 'animation' ? Math.min(clip.duration ?? 3, 5) : (clip.duration ?? 5);
        const { key, label } = getVideoCostKey(videoProvider, dur);
        logger.info(`[DRY RUN]   → ${label} ${outputType} for scene ${i + 1} (${dur}s)`);
        costTracker.logStep(key, false);
      } else {
        logger.info(`[DRY RUN]   → Image output (no video gen)`);
      }
      continue;
    }

    // ── Generate storyboard frame(s) via image router ──
    const variationCount = Math.min(Math.max(runOpts?.variations ?? 1, 1), 4);
    let generatedFrame: string | null = null;
    const imageSource = clip.imageSource ?? 'generate';

    // ── Original mode: use existing image as-is ──
    if (imageSource === 'original' && clip.sourceImage) {
      const resolvedSource = resolveSourceImage(clip.sourceImage, projectDir);
      if (await fs.pathExists(resolvedSource)) {
        const storyboardDir = path.join(PROJECTS_ROOT, projectName, 'storyboard');
        await fs.ensureDir(storyboardDir);
        const ext = path.extname(resolvedSource);
        generatedFrame = path.join(storyboardDir, `scene-${i + 1}${ext}`);
        if (!(await fs.pathExists(generatedFrame))) {
          await fs.copy(resolvedSource, generatedFrame);
        }
        logger.success(`Scene ${i + 1}: using original — ${path.basename(resolvedSource)}`);
      } else {
        logger.warn(`Source image not found: ${resolvedSource}`);
      }
    }

    // ── Edit mode: AI-edit existing image ──
    if (imageSource === 'edit' && clip.sourceImage && clip.editPrompt && generatedFrame === null) {
      const resolvedSource = resolveSourceImage(clip.sourceImage, projectDir);
      const storyboardDir = path.join(PROJECTS_ROOT, projectName, 'storyboard');
      await fs.ensureDir(storyboardDir);
      const dest = path.join(storyboardDir, `scene-${i + 1}.jpg`);
      const provider = clip.imageProvider ?? imgProvider;
      generatedFrame = await editImage(resolvedSource, clip.editPrompt, dest, provider);
      if (generatedFrame !== null) {
        costTracker.logStep(frameCostKey, false);
      }
    }

    // ── Generate mode (default): AI creates from prompt ──
    if (generatedFrame === null) {
    for (let v = 1; v <= variationCount; v++) {
      const variationAngle = v > 1
        ? (enrichedClipPlan?.variationAngles?.[v - 2] ?? FALLBACK_VARIATION_ANGLES[v - 2])
        : undefined;

      const frame = await generateImage(imgProvider, {
        sceneIndex: i + 1,
        prompt,
        format,
        ...(directorPlan?.visualStyleSummary !== undefined && { visualStyleSummary: directorPlan.visualStyleSummary }),
        ...(directorPlan?.lightingSetup !== undefined && { lightingSetup: directorPlan.lightingSetup }),
        ...(directorPlan?.backgroundDescription !== undefined && { backgroundDescription: directorPlan.backgroundDescription }),
        ...(directorPlan?.colorPalette !== undefined && { colorPalette: directorPlan.colorPalette }),
        ...(enrichedClipPlan?.lighting !== undefined && { lighting: enrichedClipPlan.lighting }),
        ...(enrichedClipPlan?.colorGrade !== undefined && { colorGrade: enrichedClipPlan.colorGrade }),
        ...(enrichedClipPlan?.cameraMove !== undefined && { cameraMove: enrichedClipPlan.cameraMove }),
        ...(v === 1 && previousLastFramePath !== undefined && { previousLastFramePath }),
        ...(assets.subjectReference !== undefined && { subjectReferencePath: assets.subjectReference }),
        ...(scene1AnchorPath !== undefined && { scene1AnchorPath }),
        ...(variationCount > 1 && { variationIndex: v }),
        ...(variationAngle !== undefined && { variationAngle }),
        projectsRoot: PROJECTS_ROOT,
        projectName,
      });

      if (v === 1) {
        generatedFrame = frame;
        costTracker.logStep(frameCostKey, frame === null);
      } else {
        costTracker.logStep(frameVariationCostKey, frame === null);
      }
    }

    // ── QA evaluation + retry loop ──
    if (generatedFrame !== null && !dryRun) {
      const qaResult = await evaluateImage(generatedFrame, modelRefPaths, productRefPaths, `scene-${i + 1}`);
      if (qaResult) {
        qaResults.push(qaResult);
        costTracker.logStep('haiku-image-qa', false);

        // Retry if QA score is below threshold (only in full pipeline, not storyboard-only)
        if (!qaResult.pass && qaResult.score < 3.5 && runOpts?.storyboardOnly !== true) {
          let bestScore = qaResult.score;
          let bestQA = qaResult;

          for (let retry = 1; retry <= 2; retry++) {
            const issues = bestQA.issues.slice(0, 3).join(', ') || 'improve overall quality';
            logger.info(`  QA retry ${retry}/2 for scene ${i + 1} (score: ${bestScore.toFixed(1)}/5, fixing: ${issues})...`);

            const retryFrame = await generateImage(imgProvider, {
              sceneIndex: i + 1,
              prompt: `${prompt}. Avoid these issues: ${issues}.`,
              format,
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
              variationIndex: variationCount + retry,
              variationAngle: `QA fix: ${issues}`,
              projectsRoot: PROJECTS_ROOT,
              projectName,
            });

            if (retryFrame) {
              costTracker.logStep(frameCostKey, false);
              const retryQA = await evaluateImage(retryFrame, modelRefPaths, productRefPaths, `scene-${i + 1}-retry${retry}`);
              if (retryQA) {
                costTracker.logStep('haiku-image-qa', false);
                qaResults.push(retryQA);

                if (retryQA.score > bestScore) {
                  logger.info(`  QA: retry ${retry} improved score: ${bestScore.toFixed(1)} → ${retryQA.score.toFixed(1)}/5`);
                  await fs.copy(retryFrame, generatedFrame, { overwrite: true });
                  bestScore = retryQA.score;
                  bestQA = retryQA;
                }
                if (retryQA.pass) break;
              }
            }
          }
        }
      }
    }
    } // end if (generatedFrame === null) — generate mode

    // Scene 1's frame becomes the style anchor for all subsequent scenes
    if (i === 0 && generatedFrame !== null) {
      scene1AnchorPath = generatedFrame;
    }

    // For image outputType: the storyboard frame IS the final output
    if (outputType === 'image' && generatedFrame !== null) {
      const imagesDir = path.join(PROJECTS_ROOT, projectName, 'output', 'images');
      await fs.ensureDir(imagesDir);
      const destPath = path.join(imagesDir, `scene-${i + 1}${path.extname(generatedFrame)}`);
      await fs.copy(generatedFrame, destPath, { overwrite: true });

      // Apply text overlay if configured
      if (clip.overlay) {
        await compositeOverlay(destPath, clip.overlay, destPath, assets.fontBold);
      }

      imageOutputPaths.push(destPath);
      resultAssets.images.push(destPath);
      logger.success(`Image output: scene-${i + 1} saved to output/images/`);
    }

    // Collect plan for Phase 2
    clipPlans.push({
      sceneIndex: i + 1,
      outputType,
      generatedFrame,
      enrichedClipPlan,
      clip,
      prompt,
    });

    // Save checkpoint + manifest after each frame
    if (generatedFrame !== null && !dryRun) {
      checkpoint.completedFrames[i + 1] = generatedFrame;
      checkpoint.phase = 'storyboard';
      await saveCheckpoint(checkpoint, PROJECTS_ROOT, projectName);

      manifest.record({
        path: generatedFrame,
        type: 'image',
        prompt,
        provider: imgProvider,
        model: imgProvider === 'gpt-image' ? 'gpt-image-1' : 'gemini-3-pro-image-preview',
        references: assets.subjectReference ? [assets.subjectReference] : [],
      });
    }
  }

  // Save QA results if any evaluations were performed
  if (qaResults.length > 0) {
    await saveQAResults(qaResults, PROJECTS_ROOT, projectName);
  }

  // ── Airtable storyboard review gate (before video generation) ──────────
  if (runOpts?.storyboardOnly !== true && !dryRun && runOpts?.airtableReview === true) {
    const reviewer = new AirtableReviewer();
    if (reviewer.isConfigured) {
      logger.step('Pushing storyboard frames to Airtable for review...');
      for (let i = 0; i < config.clips.length; i++) {
        const enrichedClip = directorPlan?.clips.find((c) => c.sceneIndex === i + 1);
        const framePrompt = enrichedClip?.enrichedPrompt ?? config.clips[i]?.prompt ?? '';
        const framePath = path.join(PROJECTS_ROOT, projectName, 'storyboard', `scene-${i + 1}.png`);
        const framePathJpg = framePath.replace('.png', '.jpg');
        const actualPath = (await fs.pathExists(framePath)) ? framePath
          : (await fs.pathExists(framePathJpg)) ? framePathJpg : null;

        if (actualPath !== null) {
          await reviewer.pushFrameForReview(projectName, i + 1, actualPath, framePrompt);
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      logger.info('Waiting for frame approvals in Airtable...');
      const reviews = await reviewer.pollForApprovals(projectName, 'Storyboard Frame');
      for (const r of reviews) {
        if (r.status === 'Rejected') {
          rejectedScenes.add(r.sceneIndex);
          logger.warn(`Scene ${r.sceneIndex} rejected — will skip video generation.`);
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: Video/animation generation (parallel with concurrency limit)
  // ═══════════════════════════════════════════════════════════════════════════
  // Storyboard-only and dry-run modes skip this entirely.
  // Image-only clips were handled in Phase 1.

  // Await voiceover+whisper completion before proceeding (started concurrently with Phase 1)
  if (voiceoverFlow) {
    await voiceoverFlow;
  }

  if (runOpts?.storyboardOnly !== true && !dryRun) {
    const videoPlans = clipPlans.filter((p) => p.outputType === 'video' || p.outputType === 'animation');

    // ── Check if Kling v3 multi-shot is feasible ──
    const videoOnlyPlans = videoPlans.filter((p) => p.outputType === 'video' && !rejectedScenes.has(p.sceneIndex));
    const totalDuration = videoOnlyPlans.reduce((sum, p) => sum + (p.clip.duration ?? 5), 0);
    const firstFrame = videoOnlyPlans[0]?.generatedFrame;
    const useMultiShot = videoProvider === 'kling-v3'
      && videoOnlyPlans.length >= 2
      && videoOnlyPlans.length <= 6
      && totalDuration <= 15
      && firstFrame !== null && firstFrame !== undefined;

    if (useMultiShot) {
      // ── Kling v3 multi-shot: unified latent space for consistent clips ──
      logger.step(`Using Kling v3 multi-shot for ${videoOnlyPlans.length} clips (${totalDuration}s total)...`);

      // Check if all outputs already exist (simple file-based cache)
      const existChecks = await Promise.all(
        videoOnlyPlans.map((p) =>
          fs.pathExists(path.join(PROJECTS_ROOT, projectName, 'output/clips', `scene-${p.sceneIndex}.mp4`)),
        ),
      );
      const allExist = existChecks.every(Boolean);

      if (allExist) {
        logger.skip('Multi-shot clips already exist — using cached.');
        for (const plan of videoOnlyPlans) {
          const scenePath = path.join(PROJECTS_ROOT, projectName, 'output/clips', `scene-${plan.sceneIndex}.mp4`);
          clipPaths.push(scenePath);
          resultAssets.clips.push(scenePath);
        }
      } else {
        const shots: MultiShotPrompt[] = videoOnlyPlans.map((plan) => ({
          prompt: buildVideoPrompt(plan, videoProvider, plan.generatedFrame ?? plan.clip.imageReference),
          duration: toMultiShotDuration(plan.clip.duration ?? 5),
        }));

        const multiPaths = await generateV3MultiShot(
          shots,
          firstFrame,
          formatMeta.aspectRatio,
          PROJECTS_ROOT,
          projectName,
          videoOnlyPlans[0]!.sceneIndex,
        );

        for (let j = 0; j < multiPaths.length; j++) {
          const mp = multiPaths[j]!;
          clipPaths.push(mp);
          resultAssets.clips.push(mp);
          const dur = videoOnlyPlans[j]?.clip.duration ?? 5;
          const { key } = getVideoCostKey(videoProvider, dur);
          costTracker.logStep(key, false);
        }
      }

      // Handle any animation-type clips individually (multi-shot doesn't support them)
      const animPlans = videoPlans.filter((p) => p.outputType === 'animation' && !rejectedScenes.has(p.sceneIndex));
      for (const plan of animPlans) {
        const storyboardFrame = assets.storyboardFrames.find((f) => f.sceneIndex === plan.sceneIndex);
        const imageRef = plan.generatedFrame ?? storyboardFrame?.imagePath ?? plan.clip.imageReference;
        const clipDuration = Math.min(plan.clip.duration ?? 3, 5);
        const options: VideoGenOptions = { aspectRatio: formatMeta.aspectRatio, duration: clipDuration, projectName, sceneIndex: plan.sceneIndex };
        const videoPrompt = buildVideoPrompt(plan, videoProvider, imageRef);
        const kv: KlingVersion = videoProvider === 'kling-v3' ? 'v3' : 'v2.1';
        const clipPath = await generateFalClip(videoPrompt, options, PROJECTS_ROOT, imageRef, undefined, kv);
        clipPaths.push(clipPath);
        resultAssets.clips.push(clipPath);
        const { key } = getVideoCostKey(videoProvider, clipDuration);
        costTracker.logStep(key, false);
      }

    } else {
      // ── Parallel video generation with concurrency limit ──
      const generateClip = async (plan: ClipPlan): Promise<string | null> => {
        if (rejectedScenes.has(plan.sceneIndex)) {
          logger.skip(`Scene ${plan.sceneIndex} was rejected in review — skipping video generation.`);
          return null;
        }

        const storyboardFrame = assets.storyboardFrames.find((f) => f.sceneIndex === plan.sceneIndex);
        const imageRef = plan.generatedFrame ?? storyboardFrame?.imagePath ?? plan.clip.imageReference;
        const isAnimation = plan.outputType === 'animation';
        const clipDuration = isAnimation ? Math.min(plan.clip.duration ?? 3, 5) : (plan.clip.duration ?? 5);

        const options: VideoGenOptions = {
          aspectRatio: formatMeta.aspectRatio,
          duration: clipDuration,
          projectName,
          sceneIndex: plan.sceneIndex,
        };

        const videoPrompt = buildVideoPrompt(plan, videoProvider, imageRef);

        // Route to video provider (Veo falls back to Kling v3 on safety filter rejection)
        let clipPath: string;
        if (videoProvider === 'veo-3.1' || videoProvider === 'veo-3.1-fast') {
          try {
            clipPath = await generateVeoClip(videoPrompt, options, PROJECTS_ROOT, imageRef, videoProvider);
          } catch (veoErr) {
            const msg = veoErr instanceof Error ? veoErr.message : String(veoErr);
            if (msg.includes('safety') || msg.includes('filtered')) {
              logger.warn(`Veo safety-rejected scene ${plan.sceneIndex}. Falling back to Kling v3...`);
              clipPath = await generateFalClip(videoPrompt, options, PROJECTS_ROOT, imageRef, undefined, 'v3');
            } else {
              throw veoErr;
            }
          }
        } else if (videoProvider === 'sora-2' || videoProvider === 'sora-2-720p') {
          clipPath = await generateSoraClip(videoPrompt, options, PROJECTS_ROOT, videoProvider, imageRef);
        } else {
          const kv: KlingVersion = videoProvider === 'kling-v3' ? 'v3' : 'v2.1';
          clipPath = await generateFalClip(videoPrompt, options, PROJECTS_ROOT, imageRef, undefined, kv);
        }

        const { key } = getVideoCostKey(videoProvider, clipDuration);
        costTracker.logStep(key, false);
        return clipPath;
      };

      const tasks = videoPlans.map((plan) => () => generateClip(plan));
      const results = await parallelWithLimit(tasks, 3);

      for (const clipPath of results) {
        if (clipPath !== null) {
          clipPaths.push(clipPath);
          resultAssets.clips.push(clipPath);
        }
      }
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
    const storyboardDir = path.join(PROJECTS_ROOT, projectName, 'storyboard');
    logger.success('\nStoryboard generation complete!');
    logger.info(`Review your frames at: ${storyboardDir}`);

    // Push to Airtable for review if enabled
    if (runOpts?.airtableReview === true) {
      const reviewer = new AirtableReviewer();
      if (reviewer.isConfigured) {
        logger.step('Pushing storyboard frames to Airtable for review...');
        for (let i = 0; i < config.clips.length; i++) {
          const enrichedClip = directorPlan?.clips.find((c) => c.sceneIndex === i + 1);
          const framePrompt = enrichedClip?.enrichedPrompt ?? config.clips[i]?.prompt ?? '';

          const variationCount = Math.min(Math.max(runOpts?.variations ?? 1, 1), 4);
          for (let v = 1; v <= variationCount; v++) {
            const suffix = v > 1 ? `-v${v}` : '';
            const framePath = path.join(storyboardDir, `scene-${i + 1}${suffix}.png`);
            const framePathJpg = framePath.replace('.png', '.jpg');
            const actualPath = (await fs.pathExists(framePath)) ? framePath
              : (await fs.pathExists(framePathJpg)) ? framePathJpg : null;

            if (actualPath !== null) {
              await reviewer.pushFrameForReview(
                projectName, i + 1, actualPath, framePrompt,
                variationCount > 1 ? v : undefined,
              );
              // Throttle: Airtable rate limit is 5 req/s
              await new Promise((r) => setTimeout(r, 200));
            }
          }
        }
        logger.success('Frames pushed to Airtable. Review and approve/reject in the gallery view.');
      }
    }

    await costTracker.save();
    return storyboardDir;
  }

  // ── Draft mode exit: raw clips only, no Remotion ──────────────────────
  if (isDraft) {
    const clipsDir = path.join(PROJECTS_ROOT, projectName, 'output', 'clips');
    logger.success(`\n[DRAFT] Preview ready — ${clipPaths.length} clip(s) + ${imageOutputPaths.length} image(s).`);
    logger.info(`Clips: ${clipsDir}`);

    const elapsedSeconds = (Date.now() - startTime) / 1000;
    await airtable.completeRun(airtableRecordId, clipsDir, elapsedSeconds);
    await costTracker.save();
    await saveConfigSnapshot(config, PROJECTS_ROOT, projectName);

    if (runOpts?.jsonOutput === true) {
      const summary = costTracker.getSummary();
      return {
        success: true,
        outputPath: clipsDir,
        projectDir,
        mode,
        assets: resultAssets,
        estimatedCost: summary.totalEstimated,
        cachedSteps: summary.entries.filter((e) => e.cached).map((e) => e.step),
      };
    }
    return clipsDir;
  }

  // ── All-image project: skip Remotion, return images directory ──────────
  if (clipPaths.length === 0 && imageOutputPaths.length > 0) {
    const imagesDir = path.join(PROJECTS_ROOT, projectName, 'output', 'images');
    logger.success(`\nAll clips are image-only — ${imageOutputPaths.length} images saved.`);
    logger.info(`Output: ${imagesDir}`);

    const elapsedSeconds = (Date.now() - startTime) / 1000;
    await airtable.completeRun(airtableRecordId, imagesDir, elapsedSeconds);
    await costTracker.save();

    if (runOpts?.jsonOutput === true) {
      const summary = costTracker.getSummary();
      return {
        success: true,
        outputPath: imagesDir,
        projectDir,
        mode,
        assets: resultAssets,
        estimatedCost: summary.totalEstimated,
        cachedSteps: summary.entries.filter((e) => e.cached).map((e) => e.step),
      };
    }
    return imagesDir;
  }

  if (clipPaths.length === 0) {
    throw new Error(
      `No clips were generated or downloaded. ` +
      `Check your config.json clips array and API keys.`,
    );
  }

  // ── Step 4: Render with Remotion ─────────────────────────────────────────
  const compositionId = FORMAT_TO_COMPOSITION[format];
  if (!compositionId) {
    throw new Error(`Unknown format: ${format}`);
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

  const videoClips = config.clips.filter((c) => resolveClipOutputType(c, mode) !== 'image');
  const totalSeconds = videoClips.reduce((sum, c) => sum + (c.duration ?? 5), 0);
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
    format,
  );

  await fs.remove(tempOutputPath);
  resultAssets.video = finalPath;

  // ── Multi-format renders (additional formats, clips already generated) ──
  if (config.outputFormats && config.outputFormats.length > 0) {
    for (const extraFormat of config.outputFormats) {
      if (extraFormat === format) continue;
      const extraCompId = FORMAT_TO_COMPOSITION[extraFormat];
      if (!extraCompId) {
        logger.warn(`Unknown extra format: ${extraFormat} — skipping.`);
        continue;
      }

      const extraMeta = getFormatMeta(extraFormat);
      const extraTotalFrames = Math.round(totalSeconds * extraMeta.fps);
      const extraTempPath = path.join(PROJECTS_ROOT, projectName, 'output', `_render-${extraFormat}-temp.mp4`);
      const extraInputProps = { ...inputProps, config: { ...config, format: extraFormat } };

      logger.step(`Rendering extra format: ${extraFormat}...`);

      const extraComposition = await selectComposition({
        serveUrl: bundleLocation,
        id: extraCompId,
        inputProps: extraInputProps,
      });

      await renderMedia({
        composition: { ...extraComposition, durationInFrames: extraTotalFrames },
        serveUrl: bundleLocation,
        codec: 'h264',
        outputLocation: extraTempPath,
        inputProps: extraInputProps,
        ffmpegOverride: ({ type, args }) => {
          if (type === 'stitcher') {
            return [...args.slice(0, -1), '-movflags', '+faststart', args[args.length - 1]!];
          }
          return args;
        },
      });

      const extraFinalPath = await packageFinalVideo(
        extraTempPath, PROJECTS_ROOT, projectName, config.title, extraFormat,
      );
      await fs.remove(extraTempPath);
      logger.success(`Extra format done: ${extraFormat}`);
      void extraFinalPath;
    }
  }

  const elapsedSeconds = (Date.now() - startTime) / 1000;
  await airtable.completeRun(airtableRecordId, finalPath, elapsedSeconds);
  await costTracker.save();
  await saveConfigSnapshot(config, PROJECTS_ROOT, projectName);

  // ── Record brand + skill memory ──────────────────────────────────────────
  const brandName = config.brand ?? config.client ?? config.title;
  if (brandName && qaResults.length > 0) {
    const qaForMemory = qaResults.map((r) => {
      const entry: { scene: string; score: number; prompt?: string; format?: string } = {
        scene: r.scene,
        score: r.score,
      };
      const matchedPrompt = clipPlans.find((p) => `scene-${p.sceneIndex}` === r.scene)?.prompt;
      if (matchedPrompt !== undefined) entry.prompt = matchedPrompt;
      if (config.format !== undefined) entry.format = config.format;
      return entry;
    });
    await recordBrandRun(brandName, projectName, mode, imgProvider, qaForMemory);
    await recordSkillRun(imgProvider, qaForMemory);
  }

  // ── Save asset manifest + clear checkpoint ────────────────────────────────
  if (finalPath) {
    manifest.record({ path: finalPath, type: 'render', provider: 'remotion', model: 'local' });
  }
  await manifest.save();
  await clearCheckpoint(PROJECTS_ROOT, projectName);

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
