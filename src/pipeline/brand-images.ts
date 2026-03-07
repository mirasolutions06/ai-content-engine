import { GoogleGenAI } from '@google/genai';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { FORMAT_ASPECT } from '../types/index.js';
import type { VideoConfig, ImageFormat, BrandContext } from '../types/index.js';

const MODEL = 'gemini-2.5-flash-image';

// ── Prompt building ──────────────────────────────────────────────────────────

function buildBrandPrompt(
  scenePrompt: string,
  brand: string,
  brief: string | undefined,
  format: ImageFormat,
  brandContext?: BrandContext,
): string {
  const aspectHint = FORMAT_ASPECT[format].hint;
  const brandLine = brief ? `Brand: ${brand}. ${brief}.` : `Brand: ${brand}.`;
  const styleHint = brandContext
    ? ` Overall visual style: ${brandContext.visualStyle}.`
    : '';
  return (
    `You are generating professional brand imagery. ${brandLine} ` +
    `Scene: ${scenePrompt}.${styleHint} ` +
    `Format: ${aspectHint}. ` +
    `High quality, professional photography style, photorealistic. No text, no watermarks.`
  );
}

// ── Reference image discovery ────────────────────────────────────────────────

async function findReferenceImage(
  projectsRoot: string,
  projectName: string,
): Promise<string | undefined> {
  const refDir = path.join(projectsRoot, projectName, 'assets', 'reference');
  if (!(await fs.pathExists(refDir))) return undefined;

  const candidates = [
    'product.jpg', 'product.jpeg', 'product.png',
    'style.jpg', 'style.jpeg', 'style.png',
  ];
  for (const name of candidates) {
    const p = path.join(refDir, name);
    if (await fs.pathExists(p)) return p;
  }

  const files = await fs.readdir(refDir);
  const first = files.find((f) => /\.(jpg|jpeg|png)$/i.test(f));
  return first ? path.join(refDir, first) : undefined;
}

// ── Brand context loader ─────────────────────────────────────────────────────

async function loadBrandContext(
  projectsRoot: string,
  projectName: string,
): Promise<BrandContext | undefined> {
  const ctxPath = path.join(projectsRoot, projectName, 'cache', 'brand-context.json');
  if (!(await fs.pathExists(ctxPath))) return undefined;
  try {
    return (await fs.readJson(ctxPath)) as BrandContext;
  } catch {
    return undefined;
  }
}

// ── Single image generation ──────────────────────────────────────────────────

async function generateBrandImage(
  sceneIndex: number,
  scenePrompt: string,
  brand: string,
  brief: string | undefined,
  format: ImageFormat,
  outputPath: string,
  referenceImagePath: string | undefined,
  brandContext: BrandContext | undefined,
): Promise<string | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not set — skipping image generation.');
    return null;
  }

  if (await fs.pathExists(outputPath)) {
    logger.skip(`scene-${sceneIndex}-${format} already exists.`);
    return outputPath;
  }

  logger.step(`Generating scene-${sceneIndex}-${format}...`);

  try {
    const ai = new GoogleGenAI({ apiKey });

    type InlineDataPart = { inlineData: { mimeType: string; data: string } };
    type TextPart = { text: string };
    const parts: Array<TextPart | InlineDataPart> = [];

    // Include reference image if provided
    if (referenceImagePath && (await fs.pathExists(referenceImagePath))) {
      const buffer = await fs.readFile(referenceImagePath);
      const ext = path.extname(referenceImagePath).toLowerCase();
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
      parts.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
    }

    parts.push({ text: buildBrandPrompt(scenePrompt, brand, brief, format, brandContext) });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    // Extract first image block from response
    let imageData: string | null = null;
    let imageMime = 'image/jpeg';

    outer: for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if ((part as InlineDataPart).inlineData?.data) {
          imageData = (part as InlineDataPart).inlineData.data;
          imageMime = (part as InlineDataPart).inlineData.mimeType ?? 'image/jpeg';
          break outer;
        }
      }
    }

    if (!imageData) throw new Error('Gemini returned no image data');

    await fs.ensureDir(path.dirname(outputPath));

    const isJpeg = imageMime.includes('jpeg') || imageMime.includes('jpg');
    const finalPath = isJpeg ? outputPath.replace(/\.jpg$/, '.jpg') : outputPath;
    await fs.writeFile(finalPath, Buffer.from(imageData, 'base64'));

    logger.success(`Saved: ${path.basename(finalPath)}`);
    return finalPath;
  } catch (err) {
    logger.warn(`Gemini failed for scene-${sceneIndex}-${format}: ${String(err)}`);
    return null;
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Generates multi-format brand images via Gemini for each scene in the config.
 * Adapted from the brand-pack pipeline's images.ts.
 *
 * @returns Path to the output/images/ directory
 */
export async function generateBrandImages(
  config: VideoConfig,
  projectsRoot: string,
  projectName: string,
): Promise<string> {
  const imagesDir = path.join(projectsRoot, projectName, 'output', 'images');
  await fs.ensureDir(imagesDir);

  const brand = config.brand ?? config.client ?? config.title;
  const brief = config.brief;
  const formats: ImageFormat[] = config.imageFormats ?? ['story', 'square', 'landscape'];
  const scenes = config.clips;

  const referenceImagePath = await findReferenceImage(projectsRoot, projectName);
  if (referenceImagePath) {
    logger.info(`Using reference image: ${path.basename(referenceImagePath)}`);
  }

  const brandContext = await loadBrandContext(projectsRoot, projectName);

  logger.step(
    `Generating images for ${scenes.length} scene(s) × ${formats.length} format(s)...`,
  );

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene?.prompt) continue;
    const sceneIndex = i + 1;

    for (const format of formats) {
      const outputPath = path.join(imagesDir, `scene-${sceneIndex}-${format}.jpg`);
      await generateBrandImage(
        sceneIndex,
        scene.prompt,
        brand,
        brief,
        format,
        outputPath,
        referenceImagePath,
        brandContext,
      );
    }
  }

  logger.success(`Done! Images saved to: ${path.relative(process.cwd(), imagesDir)}`);
  return imagesDir;
}
