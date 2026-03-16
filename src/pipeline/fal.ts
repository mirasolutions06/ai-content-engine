import { fal, type QueueStatus } from '@fal-ai/client';
import path from 'path';
import fs from 'fs-extra';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import {
  hashVideoRequest,
  getCacheManifestPath,
  loadCacheManifest,
  saveCacheEntry,
} from '../utils/cache.js';
import { extractLastFrame } from './frames.js';
import type { VideoGenOptions, KlingVersion, VideoProvider } from '../types/index.js';

const execFileAsync = promisify(execFile);

// ─── Endpoint constants ─────────────────────────────────────────────────────

const ENDPOINTS = {
  'v2.1': {
    i2v: 'fal-ai/kling-video/v2.1/pro/image-to-video',
    t2v: 'fal-ai/kling-video/v2.1/master/text-to-video',
  },
  v3: {
    i2v: 'fal-ai/kling-video/v3/pro/image-to-video',
    t2v: 'fal-ai/kling-video/v3/pro/text-to-video',
  },
} as const;

const SORA_ENDPOINTS = {
  i2v: 'fal-ai/sora-2/image-to-video/pro',
  t2v: 'fal-ai/sora-2/text-to-video/pro',
} as const;

interface FalKlingOutput {
  video: { url: string };
}

interface FalSoraOutput {
  video: { url: string };
  video_id: string;
}

const NEGATIVE_PROMPT = 'camera shake, flickering, morphing, shape shifting, melting, distortion, jitter, inconsistent lighting, motion blur, duplicate subject, extra limbs, extra fingers, text, logos, watermarks, blurry, low quality, fast movement, abrupt changes, face distortion, changing face, melting skin, deformed face, changing hair, identity shift';

/** Multi-shot prompt element for Kling v3 */
export interface MultiShotPrompt {
  prompt: string;
  duration: '3' | '5' | '10';
}

function configureFal(): void {
  const key = process.env['FAL_KEY'];
  if (!key) {
    throw new Error('FAL_KEY must be set in .env');
  }
  fal.config({ credentials: key });
}

/**
 * Downloads a video from a URL and saves it to disk.
 */
async function downloadVideo(url: string, destPath: string): Promise<void> {
  await fs.ensureDir(path.dirname(destPath));
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download video from fal.ai CDN: HTTP ${response.status}. URL: ${url}`,
    );
  }
  const buffer = await response.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(buffer));
}

/**
 * Encodes an image file as a base64 data URI for fal.ai.
 */
async function encodeImageAsDataUri(imagePath: string): Promise<string> {
  const buffer = await fs.readFile(imagePath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(imagePath).toLowerCase().slice(1);
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Center-crop an image to match target aspect ratio before sending to i2v.
 * Returns original path if already matching (within 5% tolerance).
 * Saves cropped version to project cache dir.
 */
async function cropToAspectRatio(
  imagePath: string,
  targetAspectRatio: string,
  projectsRoot: string,
  projectName: string,
  sceneIndex: number,
): Promise<string> {
  const ratioParts = targetAspectRatio.split(':');
  if (ratioParts.length !== 2) return imagePath;
  const targetRatio = Number(ratioParts[0]) / Number(ratioParts[1]);
  if (!isFinite(targetRatio) || targetRatio <= 0) return imagePath;

  // Get source dimensions via ffprobe
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=s=x:p=0',
    imagePath,
  ]);
  const [wStr, hStr] = stdout.trim().split('x');
  const srcW = Number(wStr);
  const srcH = Number(hStr);
  if (!srcW || !srcH) return imagePath;

  const srcRatio = srcW / srcH;
  // Within 5% tolerance — no crop needed
  if (Math.abs(srcRatio - targetRatio) / targetRatio < 0.05) return imagePath;

  // Calculate center-crop dimensions
  let cropW: number;
  let cropH: number;
  if (srcRatio > targetRatio) {
    // Source wider than target — crop width
    cropH = srcH;
    cropW = Math.round(srcH * targetRatio);
  } else {
    // Source taller than target — crop height
    cropW = srcW;
    cropH = Math.round(srcW / targetRatio);
  }
  const x = Math.round((srcW - cropW) / 2);
  const y = Math.round((srcH - cropH) / 2);

  const cacheDir = path.join(projectsRoot, projectName, 'cache');
  await fs.ensureDir(cacheDir);
  const croppedPath = path.join(cacheDir, `cropped-scene-${sceneIndex}.jpg`);

  await execFileAsync('ffmpeg', [
    '-i', imagePath,
    '-vf', `crop=${cropW}:${cropH}:${x}:${y}`,
    '-q:v', '1',
    '-y',
    croppedPath,
  ]);

  logger.info(`  Cropped source image from ${srcW}×${srcH} (${srcRatio.toFixed(2)}) to ${cropW}×${cropH} (${targetRatio.toFixed(2)})`);
  return croppedPath;
}

// ─── Queue logging helper ────────────────────────────────────────────────────

function onQueue(sceneLabel: string) {
  return (update: QueueStatus) => {
    if (update.status === 'IN_QUEUE') {
      logger.info(`  ${sceneLabel}: queued (position ${update.queue_position ?? '?'})`);
    } else if (update.status === 'IN_PROGRESS') {
      logger.info(`  ${sceneLabel}: generating...`);
    }
  };
}

// ─── v2.1 generators ────────────────────────────────────────────────────────

async function generateTextToVideo(
  prompt: string,
  options: VideoGenOptions,
  outputPath: string,
): Promise<void> {
  logger.step(`Submitting fal.ai Kling v2.1 text-to-video for scene ${options.sceneIndex}...`);

  const result = await fal.subscribe(ENDPOINTS['v2.1'].t2v, {
    input: {
      prompt,
      duration: options.duration > 5 ? '10' : '5',
      aspect_ratio: options.aspectRatio,
      negative_prompt: NEGATIVE_PROMPT,
      cfg_scale: 0.65,
    },
    onQueueUpdate: onQueue(`Scene ${options.sceneIndex}`),
  }) as { data: FalKlingOutput };

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(`fal.ai Kling t2v returned no video URL. Response: ${JSON.stringify(result)}`);
  }
  await downloadVideo(videoUrl, outputPath);
}

async function generateImageToVideo(
  prompt: string,
  imageReferencePath: string,
  options: VideoGenOptions,
  outputPath: string,
  tailImagePath?: string,
): Promise<void> {
  logger.step(`Submitting fal.ai Kling v2.1 image-to-video for scene ${options.sceneIndex}...`);

  const imageUrl = await encodeImageAsDataUri(imageReferencePath);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: any = {
    prompt,
    image_url: imageUrl,
    duration: options.duration > 5 ? '10' : '5',
    aspect_ratio: options.aspectRatio,
    negative_prompt: NEGATIVE_PROMPT,
    // Higher cfg_scale in i2v mode keeps the output closer to the storyboard frame
    // (less morphing/deviation). 0.7 = tight fidelity with natural motion.
    cfg_scale: 0.7,
  };

  if (tailImagePath && (await fs.pathExists(tailImagePath))) {
    input.tail_image_url = await encodeImageAsDataUri(tailImagePath);
    logger.info(`  Scene ${options.sceneIndex}: using tail frame for continuity`);
  }

  const result = await fal.subscribe(ENDPOINTS['v2.1'].i2v, {
    input,
    onQueueUpdate: onQueue(`Scene ${options.sceneIndex}`),
  }) as { data: FalKlingOutput };

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(`fal.ai Kling i2v returned no video URL. Response: ${JSON.stringify(result)}`);
  }
  await downloadVideo(videoUrl, outputPath);
}

// ─── v3 generators ──────────────────────────────────────────────────────────

async function generateV3ImageToVideo(
  prompt: string,
  imageReferencePath: string,
  options: VideoGenOptions,
  outputPath: string,
  tailImagePath?: string,
): Promise<void> {
  logger.step(`Submitting fal.ai Kling v3 Pro image-to-video for scene ${options.sceneIndex}...`);

  const startImageUrl = await encodeImageAsDataUri(imageReferencePath);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: any = {
    prompt,
    start_image_url: startImageUrl,
    duration: options.duration > 5 ? '10' : '5',
    aspect_ratio: options.aspectRatio,
    negative_prompt: NEGATIVE_PROMPT,
    cfg_scale: 0.7,
    generate_audio: false, // avoid unexpected audio charges
  };

  if (tailImagePath && (await fs.pathExists(tailImagePath))) {
    input.end_image_url = await encodeImageAsDataUri(tailImagePath);
    logger.info(`  Scene ${options.sceneIndex}: using end frame for continuity`);
  }

  const result = await fal.subscribe(ENDPOINTS.v3.i2v, {
    input,
    onQueueUpdate: onQueue(`Scene ${options.sceneIndex}`),
  }) as { data: FalKlingOutput };

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(`fal.ai Kling v3 i2v returned no video URL. Response: ${JSON.stringify(result)}`);
  }
  await downloadVideo(videoUrl, outputPath);
}

async function generateV3TextToVideo(
  prompt: string,
  options: VideoGenOptions,
  outputPath: string,
): Promise<void> {
  logger.step(`Submitting fal.ai Kling v3 Pro text-to-video for scene ${options.sceneIndex}...`);

  const result = await fal.subscribe(ENDPOINTS.v3.t2v, {
    input: {
      prompt,
      duration: options.duration > 5 ? '10' : '5',
      aspect_ratio: options.aspectRatio,
      negative_prompt: NEGATIVE_PROMPT,
      cfg_scale: 0.65,
      generate_audio: false,
    },
    onQueueUpdate: onQueue(`Scene ${options.sceneIndex}`),
  }) as { data: FalKlingOutput };

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(`fal.ai Kling v3 t2v returned no video URL. Response: ${JSON.stringify(result)}`);
  }
  await downloadVideo(videoUrl, outputPath);
}

/**
 * Kling v3 multi-shot mode: generates multiple shots in a single API call
 * with unified latent space for seamless transitions.
 *
 * Max 6 shots, max 15s total across all shots.
 *
 * @returns Array of clip output paths (one per shot, split from the single video)
 */
export async function generateV3MultiShot(
  shots: MultiShotPrompt[],
  imageReferencePath: string,
  aspectRatio: string,
  projectsRoot: string,
  projectName: string,
  startSceneIndex: number,
): Promise<string[]> {
  configureFal();

  const totalDuration = shots.reduce((sum, s) => sum + parseInt(s.duration, 10), 0);
  if (totalDuration > 15) {
    throw new Error(`Kling v3 multi-shot max total duration is 15s, got ${totalDuration}s`);
  }
  if (shots.length > 6) {
    throw new Error(`Kling v3 multi-shot max 6 shots, got ${shots.length}`);
  }

  logger.step(`Submitting fal.ai Kling v3 multi-shot (${shots.length} shots, ${totalDuration}s total)...`);

  const croppedRef = await cropToAspectRatio(imageReferencePath, aspectRatio, projectsRoot, projectName, startSceneIndex);
  const startImageUrl = await encodeImageAsDataUri(croppedRef);

  const result = await fal.subscribe(ENDPOINTS.v3.i2v, {
    input: {
      start_image_url: startImageUrl,
      shot_type: 'customize',
      multi_prompt: shots.map((s) => ({
        prompt: s.prompt,
        duration: s.duration,
      })),
      aspect_ratio: aspectRatio,
      negative_prompt: NEGATIVE_PROMPT,
      cfg_scale: 0.65,
      generate_audio: false,
    },
    onQueueUpdate: onQueue(`Multi-shot (${shots.length} shots)`),
  }) as { data: FalKlingOutput };

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(`fal.ai Kling v3 multi-shot returned no video URL. Response: ${JSON.stringify(result)}`);
  }

  // Download the combined video
  const combinedPath = path.join(
    projectsRoot,
    projectName,
    'output/clips',
    `multi-shot-${startSceneIndex}-${startSceneIndex + shots.length - 1}.mp4`,
  );
  await downloadVideo(videoUrl, combinedPath);

  // For multi-shot, we store the combined clip and create symlinks/copies per scene
  // so the rest of the pipeline can reference individual scene files
  const outputPaths: string[] = [];
  for (let i = 0; i < shots.length; i++) {
    const scenePath = path.join(
      projectsRoot,
      projectName,
      'output/clips',
      `scene-${startSceneIndex + i}.mp4`,
    );
    // Copy combined video for each scene reference
    // (Remotion handles timing via Sequence offsets, not separate files when using multi-shot)
    await fs.copy(combinedPath, scenePath, { overwrite: true });
    outputPaths.push(scenePath);
  }

  logger.success(`Multi-shot clip saved: ${combinedPath} (${shots.length} shots)`);
  return outputPaths;
}

// ─── Sora 2 generators ─────────────────────────────────────────────────────

/** Map pipeline duration to Sora's supported durations (4/8/12/16/20). */
function mapSoraDuration(seconds: number): number {
  if (seconds <= 4) return 4;
  if (seconds <= 8) return 8;
  if (seconds <= 12) return 12;
  if (seconds <= 16) return 16;
  return 20;
}

/** Map pipeline aspect ratio to Sora format. Sora only supports 9:16, 16:9, auto (no 1:1). */
function mapSoraAspectRatio(ratio: string): string {
  if (ratio === '9:16') return '9:16';
  if (ratio === '16:9') return '16:9';
  return 'auto';
}

async function generateSoraImageToVideo(
  prompt: string,
  imageReferencePath: string,
  options: VideoGenOptions,
  outputPath: string,
  resolution: '720p' | '1080p',
): Promise<void> {
  logger.step(`Submitting fal.ai Sora 2 ${resolution} image-to-video for scene ${options.sceneIndex}...`);

  const imageUrl = await encodeImageAsDataUri(imageReferencePath);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: any = {
    prompt,
    image_url: imageUrl,
    duration: mapSoraDuration(options.duration),
    resolution,
    aspect_ratio: mapSoraAspectRatio(options.aspectRatio),
    delete_video: false,
  };

  const result = await fal.subscribe(SORA_ENDPOINTS.i2v, {
    input,
    onQueueUpdate: onQueue(`Scene ${options.sceneIndex}`),
  }) as { data: FalSoraOutput };

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(`fal.ai Sora i2v returned no video URL. Response: ${JSON.stringify(result)}`);
  }
  await downloadVideo(videoUrl, outputPath);
}

async function generateSoraTextToVideo(
  prompt: string,
  options: VideoGenOptions,
  outputPath: string,
  resolution: '720p' | '1080p',
): Promise<void> {
  logger.step(`Submitting fal.ai Sora 2 ${resolution} text-to-video for scene ${options.sceneIndex}...`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const input: any = {
    prompt,
    duration: mapSoraDuration(options.duration),
    resolution,
    aspect_ratio: mapSoraAspectRatio(options.aspectRatio),
    delete_video: false,
  };

  const result = await fal.subscribe(SORA_ENDPOINTS.t2v, {
    input,
    onQueueUpdate: onQueue(`Scene ${options.sceneIndex}`),
  }) as { data: FalSoraOutput };

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(`fal.ai Sora t2v returned no video URL. Response: ${JSON.stringify(result)}`);
  }
  await downloadVideo(videoUrl, outputPath);
}

/**
 * Main entry point for Sora 2 clip generation via fal.ai.
 *
 * Follows the same cache/download/lastframe pattern as generateFalClip.
 *
 * @param prompt - Scene description
 * @param options - Aspect ratio, duration, project context
 * @param projectsRoot - Root folder containing all projects
 * @param provider - 'sora-2' (1080p) or 'sora-2-720p'
 * @param imageReference - Optional path to storyboard image (enables image-to-video mode)
 * @returns Absolute path to the downloaded .mp4 clip
 */
export async function generateSoraClip(
  prompt: string,
  options: VideoGenOptions,
  projectsRoot: string,
  provider: VideoProvider = 'sora-2',
  imageReference?: string,
): Promise<string> {
  configureFal();

  const resolution = provider === 'sora-2-720p' ? '720p' : '1080p';
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
      logger.skip(`Using cached Sora clip for scene ${sceneIndex}: ${cachedEntry.clipPath}`);
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

  if (imageReference) {
    const croppedRef = await cropToAspectRatio(imageReference, options.aspectRatio, projectsRoot, projectName, sceneIndex);
    await generateSoraImageToVideo(prompt, croppedRef, options, outputPath, resolution);
  } else {
    await generateSoraTextToVideo(prompt, options, outputPath, resolution);
  }

  logger.success(`Sora clip saved: ${outputPath}`);

  await saveCacheEntry(manifestPath, cacheHash, outputPath);
  await extractLastFrame(outputPath, sceneIndex, projectsRoot, projectName);

  return outputPath;
}

// ─── Main entry point (Kling) ───────────────────────────────────────────────

/**
 * Main entry point for fal.ai Kling clip generation.
 *
 * Checks the cache first. If a clip with the same prompt + options was already
 * generated for this project, returns the cached path without hitting the API.
 *
 * After generation, automatically extracts the last frame and saves it to
 * assets/storyboard/scene-N-lastframe.png for use in Gemini's feedback loop.
 *
 * @param prompt - Scene description
 * @param options - Aspect ratio, duration, project context (projectName, sceneIndex)
 * @param projectsRoot - Root folder containing all projects
 * @param imageReference - Optional path to Gemini storyboard image (enables image-to-video mode)
 * @param tailImagePath - Optional path to previous clip's last frame (enables end-frame conditioning)
 * @param klingVersion - Kling model version: 'v2.1' (default) or 'v3'
 * @returns Absolute path to the downloaded .mp4 clip
 */
export async function generateFalClip(
  prompt: string,
  options: VideoGenOptions,
  projectsRoot: string,
  imageReference?: string,
  tailImagePath?: string,
  klingVersion: KlingVersion = 'v2.1',
): Promise<string> {
  configureFal();

  const { projectName, sceneIndex, ...hashableOptions } = options;

  const cacheHash = hashVideoRequest(prompt, {
    ...hashableOptions,
    imageReference: imageReference ?? null,
    klingVersion,
  });

  const manifestPath = getCacheManifestPath(projectsRoot, projectName);
  const manifest = await loadCacheManifest(manifestPath);

  const cachedEntry = manifest[cacheHash];
  if (cachedEntry !== undefined) {
    if (await fs.pathExists(cachedEntry.clipPath)) {
      logger.skip(`Using cached clip for scene ${sceneIndex}: ${cachedEntry.clipPath}`);
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

  const croppedRef = imageReference
    ? await cropToAspectRatio(imageReference, options.aspectRatio, projectsRoot, projectName, sceneIndex)
    : undefined;

  if (klingVersion === 'v3') {
    if (croppedRef) {
      await generateV3ImageToVideo(prompt, croppedRef, options, outputPath, tailImagePath);
    } else {
      await generateV3TextToVideo(prompt, options, outputPath);
    }
  } else {
    if (croppedRef) {
      await generateImageToVideo(prompt, croppedRef, options, outputPath, tailImagePath);
    } else {
      await generateTextToVideo(prompt, options, outputPath);
    }
  }

  logger.success(`Clip saved: ${outputPath}`);

  await saveCacheEntry(manifestPath, cacheHash, outputPath);
  await extractLastFrame(outputPath, sceneIndex, projectsRoot, projectName);

  return outputPath;
}
