import path from 'path';
import fs from 'fs-extra';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../utils/logger.js';
import type { StoryboardGenOptions } from '../types/index.js';

const MODEL = 'gemini-3-pro-image-preview';

function getFramePath(projectsRoot: string, projectName: string, sceneIndex: number, variationIndex?: number): string {
  const suffix = variationIndex !== undefined && variationIndex > 1 ? `-v${variationIndex}` : '';
  return path.join(projectsRoot, projectName, 'storyboard', `scene-${sceneIndex}${suffix}.png`);
}

function getGeminiAspectRatio(format: StoryboardGenOptions['format']): string {
  if (format === 'youtube-short' || format === 'tiktok') return '9:16';
  if (format === 'ad-1x1') return '1:1';
  return '16:9';
}

function buildImagePrompt(options: StoryboardGenOptions, hasAnchor: boolean): string {
  const parts: string[] = [];

  // For scenes 2+, strongly enforce visual consistency with the anchor frame
  if (hasAnchor) {
    parts.push(
      `Generate a cinematic still frame that belongs to the SAME photo shoot as the reference images above.`,
      `CRITICAL: Use the EXACT same lighting direction, color temperature, background surface, and atmosphere as Scene 1 above.`,
      `Only change the camera distance/angle and what part of the subject is in focus.`,
    );
  }

  // The enriched prompt is the core — it already contains the scene + cinematography from the Director
  parts.push(options.prompt + '.');

  // Global consistency fields from Director (reinforces the enriched prompt)
  if (options.lightingSetup) parts.push(`Lighting setup: ${options.lightingSetup}.`);
  if (options.backgroundDescription) parts.push(`Background: ${options.backgroundDescription}.`);
  if (options.colorPalette) parts.push(`Color palette: ${options.colorPalette}.`);

  // Per-scene Director fields (for scene-specific details)
  if (options.lighting && !options.lightingSetup) parts.push(`Lighting: ${options.lighting}.`);
  if (options.colorGrade && !options.colorPalette) parts.push(`Color palette: ${options.colorGrade}.`);
  if (options.cameraMove) parts.push(`Framing: ${options.cameraMove}.`);
  if (options.visualStyleSummary) parts.push(`Style: ${options.visualStyleSummary}.`);
  if (options.variationAngle) parts.push(`Variation emphasis: ${options.variationAngle}.`);

  parts.push(`Photorealistic, cinematic still frame. No text, no logos, no watermarks.`);

  return parts.join(' ');
}

/**
 * Encodes an image file as an inline data part for Gemini.
 * Detects PNG vs JPEG from magic bytes.
 */
async function encodeImagePart(
  filePath: string,
): Promise<{ inlineData: { mimeType: string; data: string } }> {
  const buffer = await fs.readFile(filePath);
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  return {
    inlineData: {
      mimeType: isPng ? 'image/png' : 'image/jpeg',
      data: buffer.toString('base64'),
    },
  };
}

/**
 * Generates a storyboard starting frame for a scene using Gemini.
 *
 * Visual consistency strategy:
 * - Subject reference photo is included in EVERY scene call
 * - Scene 1's generated frame is used as a STYLE ANCHOR for scenes 2+
 *   (this is the key to making all frames feel like one shoot)
 * - Previous clip's last frame provides motion continuity for Kling
 * - Director's global fields (lightingSetup, backgroundDescription, colorPalette)
 *   are included in every prompt to reinforce consistency
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

  const outputPath = getFramePath(options.projectsRoot, options.projectName, options.sceneIndex, options.variationIndex);
  const outputPathJpg = outputPath.replace('.png', '.jpg');

  const label = options.variationIndex !== undefined && options.variationIndex > 1
    ? `scene-${options.sceneIndex}-v${options.variationIndex}`
    : `scene-${options.sceneIndex}`;

  // Idempotent — skip if already generated (Gemini may return PNG or JPEG)
  if (await fs.pathExists(outputPath)) {
    logger.skip(`Storyboard: ${label}.png already exists.`);
    return outputPath;
  }
  if (await fs.pathExists(outputPathJpg)) {
    logger.skip(`Storyboard: ${label}.jpg already exists.`);
    return outputPathJpg;
  }

  const hasScene1Anchor =
    options.scene1AnchorPath !== undefined &&
    (await fs.pathExists(options.scene1AnchorPath));

  const hasPreviousFrame =
    options.previousLastFramePath !== undefined &&
    (await fs.pathExists(options.previousLastFramePath));

  logger.step(
    `Storyboard: generating ${label}` +
    (hasScene1Anchor ? ' (anchored to scene 1 style)' : '') +
    (hasPreviousFrame ? ` (+ scene ${options.sceneIndex - 1} continuity)` : '') +
    (options.variationAngle ? ` [variation: ${options.variationAngle}]` : '') +
    `...`,
  );

  try {
    const ai = new GoogleGenAI({ apiKey });

    type InlineDataPart = { inlineData: { mimeType: string; data: string } };
    type TextPart = { text: string };
    const parts: Array<TextPart | InlineDataPart> = [];

    // 1. Subject reference photo — what the product/subject actually looks like
    if (options.subjectReferencePath && (await fs.pathExists(options.subjectReferencePath))) {
      parts.push(
        { text: '[SUBJECT REFERENCE — this is the product/subject that must appear accurately in every scene]' },
        await encodeImagePart(options.subjectReferencePath),
      );
    }

    // 2. Scene 1 anchor — THE style reference for all subsequent frames
    //    This is the most important visual consistency mechanism: scene 1 defines
    //    the lighting, color temperature, background, and overall mood. All subsequent
    //    frames must match it exactly, only varying camera distance/angle.
    if (hasScene1Anchor && options.scene1AnchorPath) {
      parts.push(
        { text: '[SCENE 1 — this is the STYLE ANCHOR. Match this frame\'s lighting direction, color temperature, background surface, and atmosphere EXACTLY. Only change camera distance and angle.]' },
        await encodeImagePart(options.scene1AnchorPath),
      );
    }

    // 3. Previous clip's last frame — for Kling motion continuity
    if (hasPreviousFrame && options.previousLastFramePath) {
      parts.push(
        { text: '[PREVIOUS SCENE LAST FRAME — maintain visual continuity with this for smooth transition]' },
        await encodeImagePart(options.previousLastFramePath),
      );
    }

    // 4. The text prompt with global consistency fields baked in
    parts.push({ text: buildImagePrompt(options, hasScene1Anchor) });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: getGeminiAspectRatio(options.format),
          imageSize: '2K',
        },
      },
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
      logger.success(`Storyboard: ${label}.jpg saved.`);
      return jpgPath;
    }

    logger.success(`Storyboard: ${label}.png saved.`);
    return outputPath;
  } catch (err) {
    logger.warn(
      `Storyboard: Gemini failed for scene ${options.sceneIndex} — ` +
      `will use text-to-video mode. Error: ${String(err)}`,
    );
    return null;
  }
}
