import path from 'path';
import fs from 'fs-extra';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';
import type { StoryboardGenOptions } from '../types/index.js';

const MODEL = 'gemini-3-pro-image-preview';

function getFramePath(projectsRoot: string, projectName: string, sceneIndex: number): string {
  return path.join(projectsRoot, projectName, 'assets', 'storyboard', `scene-${sceneIndex}.png`);
}

function buildImagePrompt(options: StoryboardGenOptions, isContinuation: boolean): string {
  const aspectHint =
    options.format === 'youtube-short' || options.format === 'tiktok'
      ? 'vertical 9:16 cinematic frame'
      : 'horizontal 16:9 cinematic frame';

  const styleHint = options.visualStyleSummary
    ? `Overall visual style: ${options.visualStyleSummary}.`
    : '';

  if (isContinuation) {
    return (
      `You are generating a storyboard starting frame for a video clip. ` +
      `This image should visually continue from the previous clip shown above. ` +
      `Maintain the same subject, lighting, color palette, and atmosphere. ` +
      `New scene: ${options.prompt}. ` +
      `${styleHint} ` +
      `Format: ${aspectHint}. ` +
      `High quality, photorealistic, cinematic still frame. No text, no watermarks.`
    );
  }

  return (
    `You are generating a storyboard starting frame for a video clip. ` +
    `Scene: ${options.prompt}. ` +
    `${styleHint} ` +
    `Format: ${aspectHint}. ` +
    `High quality, photorealistic, cinematic still frame. No text, no watermarks.`
  );
}

/**
 * Generates a storyboard starting frame for a scene using Gemini 2.0 Flash.
 *
 * For scene 1: text prompt only.
 * For scene N>1: includes the previous clip's last frame as visual context,
 *   giving Gemini the ability to maintain subject, lighting, and color continuity.
 *
 * Non-fatal — returns null if GEMINI_API_KEY is not set or the call fails.
 * Idempotent — skips generation if the output file already exists on disk.
 */
export async function generateStoryboardFrame(
  options: StoryboardGenOptions,
): Promise<string | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    logger.warn(`Storyboard: GEMINI_API_KEY not set — skipping scene ${options.sceneIndex}.`);
    return null;
  }

  const outputPath = getFramePath(options.projectsRoot, options.projectName, options.sceneIndex);

  // Idempotent — skip if already generated
  if (await fs.pathExists(outputPath)) {
    logger.skip(`Storyboard: scene-${options.sceneIndex}.png already exists.`);
    return outputPath;
  }

  const isContinuation =
    options.previousLastFramePath !== undefined &&
    (await fs.pathExists(options.previousLastFramePath));

  logger.step(
    `Storyboard: generating scene-${options.sceneIndex}.png` +
    (isContinuation ? ` (continuing from scene ${options.sceneIndex - 1} last frame)` : '') +
    `...`,
  );

  try {
    const ai = new GoogleGenAI({ apiKey });

    type InlineDataPart = { inlineData: { mimeType: string; data: string } };
    type TextPart = { text: string };
    const parts: Array<TextPart | InlineDataPart> = [];

    // For continuations, prepend the previous clip's last frame so Gemini can see it
    if (isContinuation && options.previousLastFramePath) {
      const frameBuffer = await fs.readFile(options.previousLastFramePath);
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: frameBuffer.toString('base64'),
        },
      });
    }

    parts.push({ text: buildImagePrompt(options, isContinuation) });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    // Extract the first image block from the response
    const candidates = response.candidates ?? [];
    let imageData: string | null = null;
    let imageMime = 'image/jpeg';

    outer: for (const candidate of candidates) {
      for (const part of candidate.content?.parts ?? []) {
        if ((part as InlineDataPart).inlineData?.data) {
          imageData = (part as InlineDataPart).inlineData.data;
          imageMime = (part as InlineDataPart).inlineData.mimeType ?? 'image/jpeg';
          break outer;
        }
      }
    }

    if (!imageData) {
      throw new Error('Gemini returned no image data');
    }

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, Buffer.from(imageData, 'base64'));

    // Rename if Gemini returned JPEG instead of PNG
    const ext = imageMime.includes('png') ? 'png' : 'jpg';
    if (ext !== 'png') {
      const jpgPath = outputPath.replace('.png', '.jpg');
      await fs.rename(outputPath, jpgPath);
      logger.success(`Storyboard: scene-${options.sceneIndex}.jpg saved.`);
      return jpgPath;
    }

    logger.success(`Storyboard: scene-${options.sceneIndex}.png saved.`);
    return outputPath;
  } catch (err) {
    logger.warn(
      `Storyboard: Gemini failed for scene ${options.sceneIndex} — ` +
      `will use text-to-video mode. Error: ${String(err)}`,
    );
    return null;
  }
}
