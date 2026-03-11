import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { FORMAT_ASPECT } from '../types/index.js';
import type { VideoConfig, ImageFormat, ImageProvider, BrandContext } from '../types/index.js';

const MODEL = 'gemini-3-pro-image-preview';

// ── Prompt building ──────────────────────────────────────────────────────────

function buildBrandPrompt(
  scenePrompt: string,
  brand: string,
  brief: string | undefined,
  brandContext?: BrandContext,
  sceneIndex?: number,
): string {
  // Use the Director's enriched prompt if available — it has better cinematography direction
  const enrichedScene = brandContext?.scenes?.find((s) => s.index === sceneIndex);
  const prompt = enrichedScene?.enrichedPrompt ?? scenePrompt;

  const parts: string[] = [];

  // Brand context as a natural introduction
  if (brief) {
    parts.push(`Professional brand photography for ${brand}. ${brief}.`);
  } else {
    parts.push(`Professional brand photography for ${brand}.`);
  }

  // The scene description — enriched if Director ran, raw otherwise
  parts.push(prompt + '.');

  // Layer in mood/style from Director if available
  if (enrichedScene?.mood) parts.push(`Mood: ${enrichedScene.mood}.`);
  if (brandContext?.visualStyle) parts.push(`Style: ${brandContext.visualStyle}.`);

  parts.push(`Photorealistic, editorial photography. No text, no logos, no watermarks.`);

  return parts.join(' ');
}

// ── Reference image discovery ────────────────────────────────────────────────

const REF_TYPES = ['product', 'model', 'style', 'location'] as const;
const IMG_EXTS = ['jpg', 'jpeg', 'png'] as const;

/**
 * Discovers all reference images in a project folder.
 * Supports single files (product.jpg) and numbered variants (product-1.jpg, product-2.jpg).
 * Gemini accepts up to 14 reference images — more angles = better consistency.
 */
async function findReferenceImages(
  projectsRoot: string,
  projectName: string,
): Promise<string[]> {
  const projectDir = path.join(projectsRoot, projectName);
  const found: string[] = [];

  // Scan project root for all reference types (single + numbered)
  let files: string[];
  try {
    files = await fs.readdir(projectDir);
  } catch {
    return [];
  }

  for (const type of REF_TYPES) {
    // Match: product.jpg, product-1.jpg, product-2.jpg, etc.
    const pattern = new RegExp(`^${type}(?:-(\\d+))?\\.(?:${IMG_EXTS.join('|')})$`, 'i');
    const matches = files
      .filter((f) => pattern.test(f))
      .sort(); // alphabetical → product.jpg before product-1.jpg
    for (const m of matches) {
      found.push(path.join(projectDir, m));
    }
  }

  // Fall back to assets/reference/ for backward compat
  const refDir = path.join(projectDir, 'assets', 'reference');
  if (await fs.pathExists(refDir)) {
    const legacyCandidates = [
      'product.jpg', 'product.jpeg', 'product.png',
      'subject.jpg', 'subject.jpeg', 'subject.png',
      'style.jpg', 'style.jpeg', 'style.png',
      'location.jpg', 'location.jpeg', 'location.png',
    ];
    for (const name of legacyCandidates) {
      const p = path.join(refDir, name);
      if (await fs.pathExists(p) && !found.includes(p)) found.push(p);
    }
  }

  return found;
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
  referenceImagePaths: string[],
  brandContext: BrandContext | undefined,
): Promise<string | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not set — skipping image generation.');
    return null;
  }

  if (await fs.pathExists(outputPath)) {
    logger.skip(`${path.basename(outputPath)} already exists.`);
    return outputPath;
  }

  logger.step(`Generating ${path.basename(outputPath, path.extname(outputPath))}...`);

  try {
    const ai = new GoogleGenAI({ apiKey });

    type InlineDataPart = { inlineData: { mimeType: string; data: string } };
    type TextPart = { text: string };
    const parts: Array<TextPart | InlineDataPart> = [];

    // Include all reference images with labels — Gemini supports up to 14
    const refLabels: string[] = [];
    for (const refPath of referenceImagePaths) {
      if (!(await fs.pathExists(refPath))) continue;
      const buffer = await fs.readFile(refPath);
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      parts.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
      // Label by filename so Gemini knows what each reference is
      const basename = path.basename(refPath, path.extname(refPath));
      refLabels.push(basename);
    }

    // Build specific instructions per reference type so Gemini knows exactly what to do
    let refPrefix = '';
    if (refLabels.length > 0) {
      const instructions: string[] = [];
      const hasModel = refLabels.some((l) => l.startsWith('model'));
      const hasProduct = refLabels.some((l) => l.startsWith('product'));

      for (let idx = 0; idx < refLabels.length; idx++) {
        const label = refLabels[idx]!;
        if (label.startsWith('model')) {
          instructions.push(`Image ${idx + 1} ("${label}") is the MODEL/PERSON. Use this person's EXACT face, features, skin tone, and body in every image that includes a person. This must be recognizably the SAME person across all images.`);
        } else if (label.startsWith('product')) {
          instructions.push(`Image ${idx + 1} ("${label}") is the ACTUAL PRODUCT. When the scene includes a product, show THIS exact product — same shape, label, color, packaging.`);
        } else if (label.startsWith('style')) {
          instructions.push(`Image ${idx + 1} ("${label}") is a STYLE reference — match this visual mood and aesthetic.`);
        } else if (label.startsWith('location')) {
          instructions.push(`Image ${idx + 1} ("${label}") is a LOCATION reference — use this environment/background.`);
        }
      }

      if (hasModel) instructions.push('CRITICAL: The person must look identical across all generated images — same face, same features, same skin tone.');
      if (hasProduct) instructions.push('CRITICAL: The product must match the reference exactly — do not invent a different bottle, jar, or label.');

      refPrefix = instructions.join(' ') + ' ';
    }

    parts.push({ text: refPrefix + buildBrandPrompt(scenePrompt, brand, brief, brandContext, sceneIndex) });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: FORMAT_ASPECT[format].ratio,
          imageSize: '2K',
        },
      },
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
    logger.warn(`Gemini failed for ${path.basename(outputPath)}: ${String(err)}`);
    return null;
  }
}

// ── GPT Image size mapping for brand formats ────────────────────────────────

const FORMAT_GPT_SIZE: Record<ImageFormat, '1024x1024' | '1024x1536' | '1536x1024'> = {
  story: '1024x1536',
  square: '1024x1024',
  landscape: '1536x1024',
};

// ── GPT Image generation ─────────────────────────────────────────────────────

async function generateBrandImageGpt(
  sceneIndex: number,
  scenePrompt: string,
  brand: string,
  brief: string | undefined,
  format: ImageFormat,
  outputPath: string,
  brandContext: BrandContext | undefined,
): Promise<string | null> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set — skipping GPT Image generation.');
    return null;
  }

  if (await fs.pathExists(outputPath)) {
    logger.skip(`${path.basename(outputPath)} already exists.`);
    return outputPath;
  }

  logger.step(`GPT Image: generating ${path.basename(outputPath, path.extname(outputPath))}...`);

  try {
    const openai = new OpenAI({ apiKey });
    const prompt = buildBrandPrompt(scenePrompt, brand, brief, brandContext, sceneIndex);
    const size = FORMAT_GPT_SIZE[format];

    const response = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      n: 1,
      size,
    });

    const imageData = response.data?.[0]?.b64_json;
    if (!imageData) throw new Error('GPT Image returned no image data');

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, Buffer.from(imageData, 'base64'));

    logger.success(`GPT Image: saved ${path.basename(outputPath)}`);
    return outputPath;
  } catch (err) {
    logger.warn(`GPT Image failed for ${path.basename(outputPath)}: ${String(err)}`);
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
  regenerateImages?: number[],
): Promise<string> {
  const imagesDir = path.join(projectsRoot, projectName, 'output', 'images');
  await fs.ensureDir(imagesDir);

  const brand = config.brand ?? config.client ?? config.title;
  const brief = config.brief;
  const formats: ImageFormat[] = config.imageFormats ?? ['story', 'square', 'landscape'];
  const clips = config.clips;
  const multiClip = clips.length > 1;

  const referenceImagePaths = await findReferenceImages(projectsRoot, projectName);
  if (referenceImagePaths.length > 0) {
    logger.info(`Using ${referenceImagePaths.length} reference image(s): ${referenceImagePaths.map((p) => path.basename(p)).join(', ')}`);
  }

  const brandContext = await loadBrandContext(projectsRoot, projectName);

  // Delete targeted files so idempotency check re-generates them
  if (regenerateImages && regenerateImages.length > 0) {
    const multiClip = clips.length > 1;
    for (const num of regenerateImages) {
      for (const fmt of formats) {
        const filename = multiClip ? `${num}-${fmt}.jpg` : `${fmt}.jpg`;
        const filePath = path.join(imagesDir, filename);
        if (await fs.pathExists(filePath)) {
          await fs.remove(filePath);
          logger.info(`Deleted ${filename} for regeneration.`);
        }
      }
    }
  }

  logger.step(
    `Generating ${clips.length} image(s) × ${formats.length} format(s)...`,
  );

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (!clip?.prompt) continue;
    const clipIndex = i + 1;
    const clipProvider: ImageProvider = clip.imageProvider ?? config.imageProvider ?? 'gemini';
    const clipFormats = clip.imageFormat ? [clip.imageFormat] : formats;

    for (const format of clipFormats) {
      const filename = multiClip ? `${clipIndex}-${format}.jpg` : `${format}.jpg`;
      const outputPath = path.join(imagesDir, filename);

      if (clipProvider === 'gpt-image') {
        await generateBrandImageGpt(
          clipIndex, clip.prompt, brand, brief, format, outputPath,
          brandContext,
        );
      } else {
        await generateBrandImage(
          clipIndex, clip.prompt, brand, brief, format, outputPath,
          referenceImagePaths, brandContext,
        );
      }
    }
  }

  logger.success(`Done! Images saved to: ${path.relative(process.cwd(), imagesDir)}`);
  return imagesDir;
}
