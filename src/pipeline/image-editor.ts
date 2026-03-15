import path from 'path';
import { createReadStream } from 'fs';
import fs from 'fs-extra';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { FORMAT_ASPECT } from '../types/index.js';
import type { ImageProvider, ImageFormat } from '../types/index.js';

/** Resolve sourceImage path — project-relative or absolute. */
export function resolveSourceImage(sourceImage: string, projectDir: string): string {
  if (path.isAbsolute(sourceImage)) return sourceImage;
  return path.join(projectDir, sourceImage);
}

/**
 * Edits an existing image using AI based on an edit prompt.
 * Routes to Gemini or GPT Image based on provider.
 * Idempotent: skips if output already exists.
 */
export async function editImage(
  sourceImagePath: string,
  editPrompt: string,
  outputPath: string,
  provider: ImageProvider = 'gemini',
  format?: ImageFormat,
): Promise<string | null> {
  if (await fs.pathExists(outputPath)) {
    logger.skip(`${path.basename(outputPath)} already exists (edit cached).`);
    return outputPath;
  }

  if (!(await fs.pathExists(sourceImagePath))) {
    logger.warn(`Source image not found for edit: ${sourceImagePath}`);
    return null;
  }

  switch (provider) {
    case 'gpt-image':
      return editImageGpt(sourceImagePath, editPrompt, outputPath);
    case 'gemini':
    default:
      return editImageGemini(sourceImagePath, editPrompt, outputPath, format);
  }
}

async function editImageGemini(
  sourceImagePath: string,
  editPrompt: string,
  outputPath: string,
  format?: ImageFormat,
): Promise<string | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not set — skipping image edit.');
    return null;
  }

  logger.step(`Gemini edit: ${path.basename(outputPath)} — "${editPrompt.slice(0, 80)}..."`);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const buffer = await fs.readFile(sourceImagePath);
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
    const mimeType = isPng ? 'image/png' : 'image/jpeg';

    type InlineDataPart = { inlineData: { mimeType: string; data: string } };
    const aspectRatio = format ? FORMAT_ASPECT[format].ratio : undefined;

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: [{
        role: 'user',
        parts: [
          { text: '[SOURCE IMAGE to edit:]' },
          { inlineData: { mimeType, data: buffer.toString('base64') } },
          { text: `Edit this image: ${editPrompt}. Keep the overall composition and style intact. Single image only — no collage, no grid.` },
        ],
      }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        ...(aspectRatio !== undefined && {
          imageConfig: { aspectRatio },
        }),
      },
    });

    let imageData: string | null = null;
    outer: for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if ((part as InlineDataPart).inlineData?.data) {
          imageData = (part as InlineDataPart).inlineData.data;
          break outer;
        }
      }
    }

    if (!imageData) throw new Error('Gemini returned no edited image');

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, Buffer.from(imageData, 'base64'));

    logger.success(`Edit saved: ${path.basename(outputPath)}`);
    return outputPath;
  } catch (err) {
    logger.warn(`Gemini edit failed: ${String(err)}`);
    return null;
  }
}

async function editImageGpt(
  sourceImagePath: string,
  editPrompt: string,
  outputPath: string,
): Promise<string | null> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set — skipping GPT image edit.');
    return null;
  }

  logger.step(`GPT Image edit: ${path.basename(outputPath)} — "${editPrompt.slice(0, 80)}..."`);

  try {
    const openai = new OpenAI({ apiKey });

    const response = await openai.images.edit({
      model: 'gpt-image-1',
      image: createReadStream(sourceImagePath),
      prompt: editPrompt,
    });

    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) throw new Error('GPT Image edit returned no data');

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, Buffer.from(imageData, 'base64'));

    logger.success(`GPT edit saved: ${path.basename(outputPath)}`);
    return outputPath;
  } catch (err) {
    logger.warn(`GPT Image edit failed: ${String(err)}`);
    return null;
  }
}
