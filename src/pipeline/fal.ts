import { fal, type QueueStatus } from '@fal-ai/client';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import {
  hashVideoRequest,
  getCacheManifestPath,
  loadCacheManifest,
  saveCacheEntry,
} from '../utils/cache.js';
import { extractLastFrame } from './frames.js';
import type { VideoGenOptions } from '../types/index.js';

const FAL_KLING_I2V = 'fal-ai/kling-video/v2.1/pro/image-to-video';
const FAL_KLING_T2V = 'fal-ai/kling-video/v2.1/master/text-to-video';

interface FalKlingOutput {
  video: { url: string };
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
 * Generates a video clip from a text prompt via fal.ai Kling (text-to-video mode).
 */
async function generateTextToVideo(
  prompt: string,
  options: VideoGenOptions,
  outputPath: string,
): Promise<void> {
  logger.step(`Submitting fal.ai Kling text-to-video for scene ${options.sceneIndex}...`);

  const result = await fal.subscribe(FAL_KLING_T2V, {
    input: {
      prompt,
      duration: options.duration > 5 ? '10' : '5',
      aspect_ratio: options.aspectRatio,
    },
    onQueueUpdate: (update: QueueStatus) => {
      if (update.status === 'IN_QUEUE') {
        logger.info(`  Scene ${options.sceneIndex}: queued (position ${update.queue_position ?? '?'})`);
      } else if (update.status === 'IN_PROGRESS') {
        logger.info(`  Scene ${options.sceneIndex}: generating...`);
      }
    },
  }) as { data: FalKlingOutput };

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(
      `fal.ai Kling t2v returned no video URL. Response: ${JSON.stringify(result)}`,
    );
  }

  await downloadVideo(videoUrl, outputPath);
}

/**
 * Generates a video clip from a storyboard image via fal.ai Kling (image-to-video mode).
 * The image is base64-encoded and sent as a data URI.
 */
async function generateImageToVideo(
  prompt: string,
  imageReferencePath: string,
  options: VideoGenOptions,
  outputPath: string,
): Promise<void> {
  logger.step(`Submitting fal.ai Kling image-to-video for scene ${options.sceneIndex}...`);

  const imageBuffer = await fs.readFile(imageReferencePath);
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imageReferencePath).toLowerCase().slice(1);
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  const imageUrl = `data:${mimeType};base64,${base64Image}`;

  const result = await fal.subscribe(FAL_KLING_I2V, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: {
      prompt,
      image_url: imageUrl,
      duration: options.duration > 5 ? '10' : '5',
      aspect_ratio: options.aspectRatio,
    } as any,
    onQueueUpdate: (update: QueueStatus) => {
      if (update.status === 'IN_QUEUE') {
        logger.info(`  Scene ${options.sceneIndex}: queued (position ${update.queue_position ?? '?'})`);
      } else if (update.status === 'IN_PROGRESS') {
        logger.info(`  Scene ${options.sceneIndex}: generating...`);
      }
    },
  }) as { data: FalKlingOutput };

  const videoUrl = result.data?.video?.url;
  if (!videoUrl) {
    throw new Error(
      `fal.ai Kling i2v returned no video URL. Response: ${JSON.stringify(result)}`,
    );
  }

  await downloadVideo(videoUrl, outputPath);
}

/**
 * Main entry point for fal.ai clip generation.
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
 * @returns Absolute path to the downloaded .mp4 clip
 */
export async function generateFalClip(
  prompt: string,
  options: VideoGenOptions,
  projectsRoot: string,
  imageReference?: string,
): Promise<string> {
  configureFal();

  const { projectName, sceneIndex, ...hashableOptions } = options;

  const cacheHash = hashVideoRequest(prompt, {
    ...hashableOptions,
    imageReference: imageReference ?? null,
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

  if (imageReference) {
    await generateImageToVideo(prompt, imageReference, options, outputPath);
  } else {
    await generateTextToVideo(prompt, options, outputPath);
  }

  logger.success(`Clip saved: ${outputPath}`);

  await saveCacheEntry(manifestPath, cacheHash, outputPath);
  await extractLastFrame(outputPath, sceneIndex, projectsRoot, projectName);

  return outputPath;
}
