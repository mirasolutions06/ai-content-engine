import path from 'path';
import fs from 'fs-extra';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';
import {
  hashVideoRequest,
  getCacheManifestPath,
  loadCacheManifest,
  saveCacheEntry,
} from '../utils/cache.js';
import { extractLastFrame } from './frames.js';
import type { VideoGenOptions, VideoProvider } from '../types/index.js';

// ─── Model mapping ──────────────────────────────────────────────────────────

const VEO_MODELS: Record<string, string> = {
  'veo-3.1': 'veo-3.1-generate-preview',
  'veo-3.1-fast': 'veo-3.1-fast-generate-preview',
};

/** Map flexible pipeline durations to Veo's supported durations (4/6/8) */
function mapVeoDuration(seconds: number): number {
  if (seconds <= 4) return 4;
  if (seconds <= 6) return 6;
  return 8;
}

/** Map pipeline aspect ratio to Veo format. Veo only supports 16:9 and 9:16. */
function mapVeoAspectRatio(ratio: string): string {
  if (ratio === '9:16') return '9:16';
  if (ratio === '1:1') {
    logger.warn('Veo: 1:1 aspect ratio not supported — using 16:9 instead.');
  }
  return '16:9';
}

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 8 * 60 * 1000; // 8 minutes

/**
 * Generates a video clip using Google's Veo 3.1 model.
 *
 * Supports both text-to-video (prompt only) and image-to-video (prompt + image).
 * Caches results using the same hash-based system as fal.ts.
 *
 * @param prompt - Scene description / motion prompt
 * @param options - Aspect ratio, duration, project context
 * @param projectsRoot - Root folder containing all projects
 * @param imageReference - Optional path to storyboard image for image-to-video mode
 * @param provider - Veo model variant: 'veo-3.1' or 'veo-3.1-fast'
 * @returns Absolute path to the downloaded .mp4 clip
 */
export async function generateVeoClip(
  prompt: string,
  options: VideoGenOptions,
  projectsRoot: string,
  imageReference?: string,
  provider: VideoProvider = 'veo-3.1',
): Promise<string> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY must be set to use Veo video generation');
  }

  const { projectName, sceneIndex, ...hashableOptions } = options;

  const cacheHash = hashVideoRequest(prompt, {
    ...hashableOptions,
    imageReference: imageReference ?? null,
    provider,
  });

  const manifestPath = getCacheManifestPath(projectsRoot, projectName);
  const manifest = await loadCacheManifest(manifestPath);

  const cachedEntry = manifest[cacheHash];
  if (cachedEntry !== undefined) {
    if (await fs.pathExists(cachedEntry.clipPath)) {
      logger.skip(`Using cached Veo clip for scene ${sceneIndex}: ${cachedEntry.clipPath}`);
      return cachedEntry.clipPath;
    }
    logger.warn(`Cache entry found for scene ${sceneIndex} but file is missing. Regenerating...`);
  }

  const outputPath = path.join(
    projectsRoot,
    projectName,
    'output/clips',
    `scene-${sceneIndex}.mp4`,
  );
  await fs.ensureDir(path.dirname(outputPath));

  const modelId = VEO_MODELS[provider];
  if (!modelId) {
    throw new Error(`Unknown Veo provider: ${provider}`);
  }

  const mode = imageReference ? 'image-to-video' : 'text-to-video';
  const veoDuration = mapVeoDuration(options.duration);
  const veoAspectRatio = mapVeoAspectRatio(options.aspectRatio);

  logger.step(`Submitting Veo ${provider} ${mode} for scene ${sceneIndex} (${veoDuration}s, ${veoAspectRatio})...`);

  const ai = new GoogleGenAI({ apiKey });

  // Build generation parameters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params: any = {
    model: modelId,
    prompt,
    config: {
      aspectRatio: veoAspectRatio,
      durationSeconds: veoDuration,
      numberOfVideos: 1,
      generateAudio: false,
    },
  };

  // Image-to-video: read the storyboard frame and pass as image bytes
  if (imageReference && (await fs.pathExists(imageReference))) {
    const imageBuffer = await fs.readFile(imageReference);
    const ext = path.extname(imageReference).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
    params.image = {
      imageBytes: imageBuffer.toString('base64'),
      mimeType,
    };
  }

  // Start generation
  let operation = await ai.models.generateVideos(params);

  // Poll for completion
  const startTime = Date.now();
  while (!operation.done) {
    if (Date.now() - startTime > POLL_TIMEOUT_MS) {
      throw new Error(`Veo generation timed out after ${POLL_TIMEOUT_MS / 60000} minutes`);
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    logger.info(`  Scene ${sceneIndex}: generating with Veo... (${elapsed}s elapsed)`);

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    operation = await ai.operations.getVideosOperation({ operation });
  }

  // Check for errors
  if (operation.error) {
    throw new Error(`Veo generation failed: ${JSON.stringify(operation.error)}`);
  }

  const generatedVideos = operation.response?.generatedVideos;
  if (!generatedVideos || generatedVideos.length === 0) {
    const filtered = operation.response?.raiMediaFilteredCount;
    if (filtered) {
      throw new Error(`Veo: ${filtered} video(s) filtered by safety. Try a different prompt.`);
    }
    throw new Error('Veo returned no generated videos');
  }

  // Download the result
  const video = generatedVideos[0]!.video;
  if (!video) {
    throw new Error('Veo: generated video object is empty');
  }

  await ai.files.download({
    file: video,
    downloadPath: outputPath,
  });

  logger.success(`Veo clip saved: ${outputPath}`);

  await saveCacheEntry(manifestPath, cacheHash, outputPath);
  await extractLastFrame(outputPath, sceneIndex, projectsRoot, projectName);

  return outputPath;
}
