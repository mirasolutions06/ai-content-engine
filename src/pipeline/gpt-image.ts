import path from 'path';
import fs from 'fs-extra';
import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import type { StoryboardGenOptions, VideoFormat } from '../types/index.js';

/**
 * Maps video format to GPT Image size.
 * gpt-image-1 supports: 1024x1024, 1024x1536, 1536x1024
 */
function getImageSize(format: VideoFormat): '1024x1024' | '1024x1536' | '1536x1024' {
  if (format === 'youtube-short' || format === 'tiktok') return '1024x1536';
  if (format === 'ad-1x1') return '1024x1024';
  return '1536x1024'; // ad-16x9, web-hero
}

function getFramePath(projectsRoot: string, projectName: string, sceneIndex: number, variationIndex?: number): string {
  const suffix = variationIndex !== undefined && variationIndex > 1 ? `-v${variationIndex}` : '';
  return path.join(projectsRoot, projectName, 'storyboard', `scene-${sceneIndex}${suffix}.png`);
}

function buildPrompt(options: StoryboardGenOptions, hasAnchor: boolean): string {
  const parts: string[] = [];

  if (hasAnchor) {
    parts.push(
      'Generate a cinematic still frame that belongs to the SAME photo shoot as the reference images.',
      'Use the EXACT same lighting direction, color temperature, background surface, and atmosphere as Scene 1.',
      'Only change the camera distance/angle and what part of the subject is in focus.',
    );
  }

  parts.push(options.prompt + '.');

  if (options.lightingSetup) parts.push(`Lighting setup: ${options.lightingSetup}.`);
  if (options.backgroundDescription) parts.push(`Background: ${options.backgroundDescription}.`);
  if (options.colorPalette) parts.push(`Color palette: ${options.colorPalette}.`);
  if (options.lighting && !options.lightingSetup) parts.push(`Lighting: ${options.lighting}.`);
  if (options.colorGrade && !options.colorPalette) parts.push(`Color palette: ${options.colorGrade}.`);
  if (options.cameraMove) parts.push(`Framing: ${options.cameraMove}.`);
  if (options.visualStyleSummary) parts.push(`Style: ${options.visualStyleSummary}.`);
  if (options.variationAngle) parts.push(`Variation emphasis: ${options.variationAngle}.`);

  parts.push('Photorealistic, cinematic still frame. No text, no logos, no watermarks.');

  return parts.join(' ');
}

/**
 * Generates a storyboard frame using OpenAI's GPT Image model.
 *
 * Mirrors the same interface and behavior as generateStoryboardFrame (storyboard.ts):
 * - Uses subject reference and scene 1 anchor for visual consistency
 * - File-exists idempotency (skips if output already exists)
 * - Non-fatal — returns null on failure
 */
export async function generateGptImage(
  options: StoryboardGenOptions,
): Promise<string | null> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    logger.warn(`GPT Image: OPENAI_API_KEY not set — skipping scene ${options.sceneIndex}.`);
    return null;
  }

  const outputPath = getFramePath(options.projectsRoot, options.projectName, options.sceneIndex, options.variationIndex);

  const label = options.variationIndex !== undefined && options.variationIndex > 1
    ? `scene-${options.sceneIndex}-v${options.variationIndex}`
    : `scene-${options.sceneIndex}`;

  // Idempotent — skip if already generated
  if (await fs.pathExists(outputPath)) {
    logger.skip(`GPT Image: ${label}.png already exists.`);
    return outputPath;
  }
  const jpgPath = outputPath.replace('.png', '.jpg');
  if (await fs.pathExists(jpgPath)) {
    logger.skip(`GPT Image: ${label}.jpg already exists.`);
    return jpgPath;
  }

  const hasScene1Anchor =
    options.scene1AnchorPath !== undefined &&
    (await fs.pathExists(options.scene1AnchorPath));

  logger.step(
    `GPT Image: generating ${label}` +
    (hasScene1Anchor ? ' (anchored to scene 1 style)' : '') +
    (options.variationAngle ? ` [variation: ${options.variationAngle}]` : '') +
    '...',
  );

  try {
    const openai = new OpenAI({ apiKey });
    const prompt = buildPrompt(options, hasScene1Anchor);
    const size = getImageSize(options.format);

    // Collect reference images for context
    const images: Array<string | { image_url: string; detail: 'auto' }> = [];

    if (options.subjectReferencePath && (await fs.pathExists(options.subjectReferencePath))) {
      const buffer = await fs.readFile(options.subjectReferencePath);
      const ext = path.extname(options.subjectReferencePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      images.push({
        image_url: `data:${mime};base64,${buffer.toString('base64')}`,
        detail: 'auto',
      });
    }

    if (hasScene1Anchor && options.scene1AnchorPath) {
      const buffer = await fs.readFile(options.scene1AnchorPath);
      const ext = path.extname(options.scene1AnchorPath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      images.push({
        image_url: `data:${mime};base64,${buffer.toString('base64')}`,
        detail: 'auto',
      });
    }

    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size,
      ...(images.length > 0 && { image: images }),
    } as Parameters<typeof openai.images.generate>[0]);

    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) {
      throw new Error('GPT Image returned no image data');
    }

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, Buffer.from(imageData, 'base64'));

    logger.success(`GPT Image: ${label}.png saved.`);
    return outputPath;
  } catch (err) {
    logger.warn(
      `GPT Image: failed for scene ${options.sceneIndex} — ` +
      `will use text-to-video mode. Error: ${String(err)}`,
    );
    return null;
  }
}
