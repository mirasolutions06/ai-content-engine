import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';
import { evaluateImage, saveQAResults } from '../utils/image-qa.js';
import { editImage, resolveSourceImage } from './image-editor.js';
import { compositeOverlay } from './image-compositor.js';
import { recordBrandRun } from '../utils/brand-memory.js';
import { recordSkillRun } from '../utils/skill-memory.js';
import { AssetManifest } from '../utils/asset-manifest.js';
import { FORMAT_ASPECT } from '../types/index.js';
import type { VideoConfig, ImageFormat, ImageProvider, BrandContext, ImageQAResult } from '../types/index.js';

const MODEL = 'gemini-3-pro-image-preview';

const SYSTEM_INSTRUCTION =
  'You are a world-class commercial photographer shooting a global advertising campaign. ' +
  'Generate photorealistic images with natural skin textures, accurate product details, ' +
  'and bold cinematic composition. Include natural imperfections — visible pores, stray hairs, ' +
  'fabric creases, minor asymmetry in framing. These should look like a real photographer made ' +
  'intentional creative choices, not generic stock photo defaults. ' +
  'Avoid: AI artifacts, plastic skin, overprocessed HDR, floating limbs, extra fingers, blurred faces.';

// ── Prompt building ──────────────────────────────────────────────────────────

function buildBrandPrompt(
  scenePrompt: string,
  brand: string,
  brief: string | undefined,
  brandContext?: BrandContext,
  sceneIndex?: number,
  hasAnchor?: boolean,
  products?: string[],
): string {
  // Use the Director's enriched prompt if available — it has better cinematography direction
  const enrichedScene = brandContext?.scenes?.find((s) => s.index === sceneIndex);
  const useEnriched = enrichedScene?.enrichedPrompt != null;
  const prompt = enrichedScene?.enrichedPrompt ?? scenePrompt;

  const parts: string[] = [];

  // For scenes 2+, enforce visual consistency with the anchor frame
  if (hasAnchor) {
    parts.push(
      `Generate a photograph that belongs to the SAME campaign shoot as the style anchor image above.`,
      `CRITICAL: Match the SAME lighting quality, color temperature, and overall atmosphere as the anchor.`,
      `Only change the environment and composition as described below.`,
    );
  }

  // Brand context as a natural introduction
  if (brief) {
    parts.push(`Professional brand photography for ${brand}. ${brief}.`);
  } else {
    parts.push(`Professional brand photography for ${brand}.`);
  }

  // The scene description — enriched if Director ran, raw otherwise
  parts.push(prompt + '.');

  // Only layer global Director context when using the raw config prompt.
  // The enrichedPrompt already has lighting, color, mood, and environment baked in —
  // repeating them bloats the prompt and degrades output (especially without strong refs).
  if (!useEnriched) {
    if (enrichedScene?.mood) parts.push(`Mood: ${enrichedScene.mood}.`);
    if (brandContext?.visualStyle) parts.push(`Style: ${brandContext.visualStyle}.`);
    if (brandContext?.lightingSetup) parts.push(`Lighting: ${brandContext.lightingSetup}.`);
    if (brandContext?.backgroundDescription) parts.push(`Environment: ${brandContext.backgroundDescription}.`);
    if (brandContext?.colorPalette) parts.push(`Color palette: ${brandContext.colorPalette}.`);
  }

  // Product fidelity — prevent Gemini from inventing products not in references
  if (products && products.length > 0) {
    parts.push(`The only product(s) in this campaign: ${products.join(', ')}. Do not add or invent other products that aren't listed here.`);
  }

  parts.push(`Photorealistic, editorial photography. Single image only — no collage, no grid, no split frame, no multiple panels. No text, no logos, no watermarks.`);

  return parts.join(' ');
}

// ── Reference image discovery ────────────────────────────────────────────────

const REF_TYPES = ['product', 'model', 'style', 'location', 'videoref'] as const;
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
    // Match: product.jpg, product-1.jpg, product-2.jpg, model-sheet.jpg, model-body.jpg, etc.
    const pattern = new RegExp(`^${type}(?:-(?:\\d+|sheet|body))?\\.(?:${IMG_EXTS.join('|')})$`, 'i');
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
  scene1AnchorPath?: string,
  products?: string[],
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

  const hasAnchor = scene1AnchorPath !== undefined && (await fs.pathExists(scene1AnchorPath));

  logger.step(
    `Generating ${path.basename(outputPath, path.extname(outputPath))}` +
    (hasAnchor ? ' (anchored to scene 1 style)' : '') +
    `...`,
  );

  try {
    const ai = new GoogleGenAI({ apiKey });

    type InlineDataPart = { inlineData: { mimeType: string; data: string } };
    type TextPart = { text: string };
    const parts: Array<TextPart | InlineDataPart> = [];

    // Include reference images with INTERLEAVED labels — model sheets first, then model, product, style, location
    const typeSortOrder: Record<string, number> = { model: 0, product: 1, style: 2, location: 3 };
    const sortedRefs = [...referenceImagePaths].sort((a, b) => {
      const aBase = path.basename(a, path.extname(a));
      const bBase = path.basename(b, path.extname(b));
      // Model sheets get -1 priority (before regular model refs)
      const aOrder = (aBase === 'model-sheet' || aBase === 'model-body') ? -1
        : (typeSortOrder[aBase.split(/[-.]/, 1)[0] ?? ''] ?? 9);
      const bOrder = (bBase === 'model-sheet' || bBase === 'model-body') ? -1
        : (typeSortOrder[bBase.split(/[-.]/, 1)[0] ?? ''] ?? 9);
      return aOrder - bOrder;
    });

    let hasModelRef = false;
    let hasProductRef = false;
    for (const refPath of sortedRefs) {
      if (!(await fs.pathExists(refPath))) continue;
      const buffer = await fs.readFile(refPath);
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      const basename = path.basename(refPath, path.extname(refPath));

      // Interleave: text label BEFORE each image so Gemini knows what it's looking at
      if (basename === 'model-sheet') {
        parts.push({ text: '[MODEL SHEET — multi-angle FACE reference. This person MUST appear identical in every generated image. Match face, features, skin tone, hair from ALL angles shown.]' });
        hasModelRef = true;
      } else if (basename === 'model-body') {
        parts.push({ text: '[MODEL BODY REFERENCE — full-body proportion reference. Match this person\'s build, height, and body type. Ignore the clothing — dress them as described in the scene prompt.]' });
        hasModelRef = true;
      } else if (basename.startsWith('model')) {
        parts.push({ text: `[MODEL/PERSON REFERENCE — "${basename}". Use this person's EXACT face, features, skin tone, hair, and body. This must be recognizably the SAME person in every image.]` });
        hasModelRef = true;
      } else if (basename.startsWith('product')) {
        parts.push({ text: `[PRODUCT REFERENCE — "${basename}". Show THIS exact product — same shape, color, details.]` });
        hasProductRef = true;
      } else if (basename.startsWith('style')) {
        parts.push({ text: `[STYLE REFERENCE — "${basename}". Match this visual mood and aesthetic.]` });
      } else if (basename.startsWith('location')) {
        parts.push({ text: `[LOCATION REFERENCE — "${basename}". Use this environment/background.]` });
      } else if (basename.startsWith('videoref')) {
        parts.push({ text: `[VIDEO STYLE REFERENCE — "${basename}". This frame is from a reference video. Match its visual style, lighting, color grade, and composition.]` });
      }
      parts.push({ inlineData: { mimeType, data: buffer.toString('base64') } });
    }

    // Scene 1 anchor — THE style reference for all subsequent images
    if (hasAnchor && scene1AnchorPath) {
      const buffer = await fs.readFile(scene1AnchorPath);
      const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
      const mimeType = isPng ? 'image/png' : 'image/jpeg';
      parts.push(
        { text: '[SCENE 1 STYLE ANCHOR — this is the first image from this campaign. Match its lighting quality, color temperature, and overall atmosphere EXACTLY. Only change the environment and composition as described in the prompt.]' },
        { inlineData: { mimeType, data: buffer.toString('base64') } },
      );
    }

    // Summary reinforcement after all images
    const criticals: string[] = [];
    if (hasModelRef) criticals.push('CRITICAL: The person must look identical to the MODEL/PERSON reference — same face, same features, same skin tone.');
    if (hasProductRef) criticals.push('CRITICAL: Products must match the PRODUCT references exactly.');
    const refSummary = criticals.length > 0 ? criticals.join(' ') + ' ' : '';

    parts.push({ text: refSummary + buildBrandPrompt(scenePrompt, brand, brief, brandContext, sceneIndex, hasAnchor, products) });

    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        systemInstruction: SYSTEM_INSTRUCTION,
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
  products?: string[],
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
    const prompt = buildBrandPrompt(scenePrompt, brand, brief, brandContext, sceneIndex, false, products);
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
  const products = config.products;
  const formats: ImageFormat[] = config.imageFormats ?? ['story', 'square', 'landscape'];
  const clips = config.clips;
  const multiClip = clips.length > 1;

  const referenceImagePaths = await findReferenceImages(projectsRoot, projectName);

  // If model sheets exist (model-sheet.jpg / model-body.jpg), use them INSTEAD of the original
  // model refs (model.jpg, model-1.jpg, etc.) — sheets have more angles and are more useful.
  const hasSheets = referenceImagePaths.some((p) => {
    const base = path.basename(p, path.extname(p));
    return base === 'model-sheet' || base === 'model-body';
  });
  const effectiveRefs = hasSheets
    ? referenceImagePaths.filter((p) => !/^model(-\d+)?\./.test(path.basename(p)))
    : referenceImagePaths;

  if (effectiveRefs.length > 0) {
    logger.info(`Using ${effectiveRefs.length} reference image(s): ${effectiveRefs.map((p) => path.basename(p)).join(', ')}`);
  }

  // Split refs by type for QA comparison
  const modelRefPaths = effectiveRefs.filter((p) => path.basename(p).startsWith('model'));
  const productRefPaths = effectiveRefs.filter((p) => path.basename(p).startsWith('product'));
  const styleRefPaths = effectiveRefs.filter((p) => path.basename(p).startsWith('style'));
  const locationRefPaths = effectiveRefs.filter((p) => path.basename(p).startsWith('location'));

  const brandContext = await loadBrandContext(projectsRoot, projectName);
  const qaResults: ImageQAResult[] = [];

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

  // Track scene 1's output as a style anchor for subsequent scenes
  let scene1AnchorPath: string | undefined;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (!clip) continue;
    const clipIndex = i + 1;
    // Prompt from config, or Director's enrichedPrompt (for shotType-only clips)
    const enrichedScene = brandContext?.scenes?.find((s) => s.index === clipIndex);
    const clipPrompt = clip.prompt || enrichedScene?.enrichedPrompt;
    if (!clipPrompt) continue;
    const clipProvider: ImageProvider = clip.imageProvider ?? config.imageProvider ?? 'gemini';
    const clipFormats = clip.imageFormat ? [clip.imageFormat] : formats;

    for (const format of clipFormats) {
      const filename = multiClip ? `${clipIndex}-${format}.jpg` : `${format}.jpg`;
      const outputPath = path.join(imagesDir, filename);

      let result: string | null;
      const imageSource = clip.imageSource ?? 'generate';

      if (imageSource === 'original' && clip.sourceImage) {
        // Use existing image as-is — copy to output
        const resolvedSource = resolveSourceImage(clip.sourceImage, path.join(projectsRoot, projectName));
        if (await fs.pathExists(resolvedSource)) {
          if (!(await fs.pathExists(outputPath))) {
            await fs.ensureDir(path.dirname(outputPath));
            await fs.copy(resolvedSource, outputPath);
          }
          logger.success(`Using original: ${path.basename(outputPath)}`);
          result = outputPath;
        } else {
          logger.warn(`Source image not found: ${resolvedSource}`);
          result = null;
        }
      } else if (imageSource === 'edit' && clip.sourceImage && clip.editPrompt) {
        // AI-edit existing image
        const resolvedSource = resolveSourceImage(clip.sourceImage, path.join(projectsRoot, projectName));
        result = await editImage(resolvedSource, clip.editPrompt, outputPath, clipProvider, format);
      } else if (clipProvider === 'gpt-image') {
        result = await generateBrandImageGpt(
          clipIndex, clipPrompt, brand, brief, format, outputPath,
          brandContext, products,
        );
      } else {
        // Per-clip ref filtering: if clip.refs is set, only send those specific references
        // Model sheets auto-included when clip refs any model-* image (i.e. clip features a model)
        const clipHasModel = clip.refs?.some((r) => r.startsWith('model'));
        const clipRefs = clip.refs
          ? effectiveRefs.filter((p) => {
              if (clipHasModel) {
                const base = path.basename(p, path.extname(p));
                if (base === 'model-sheet' || base === 'model-body') return true;
              }
              return clip.refs!.includes(path.basename(p));
            })
          : effectiveRefs;
        result = await generateBrandImage(
          clipIndex, clipPrompt, brand, brief, format, outputPath,
          clipRefs, brandContext,
          clipIndex > 1 ? scene1AnchorPath : undefined, products,
        );
      }

      // Apply text overlay if configured
      if (result && clip.overlay) {
        const fontPath = path.join(projectsRoot, projectName, 'brand', 'font-bold.ttf');
        const font = (await fs.pathExists(fontPath)) ? fontPath : undefined;
        await compositeOverlay(result, clip.overlay, result, font);
      }

      // QA evaluation
      if (result) {
        const sceneLabel = multiClip ? `${clipIndex}-${format}` : format;
        const qa = await evaluateImage(result, modelRefPaths, productRefPaths, sceneLabel, styleRefPaths, locationRefPaths, clipPrompt);
        if (qa) qaResults.push(qa);
      }

      // Use scene 1's first format output as the style anchor for all subsequent scenes
      if (clipIndex === 1 && result && !scene1AnchorPath) {
        scene1AnchorPath = result;
      }
    }
  }

  // Save QA results
  await saveQAResults(qaResults, projectsRoot, projectName);

  // ── Record brand + skill memory ──────────────────────────────────────────
  const imgProvider: ImageProvider = config.imageProvider ?? 'gemini';
  if (brand && qaResults.length > 0) {
    const qaForMemory = qaResults.map((r) => {
      const entry: { scene: string; score: number; prompt?: string; format?: string } = {
        scene: r.scene,
        score: r.score,
      };
      // scene label is "clipIndex-format" or just "format"
      const parts = r.scene.split('-');
      const clipIdx = multiClip ? parseInt(parts[0] ?? '1', 10) : 1;
      const matchedClip = clips[clipIdx - 1];
      if (matchedClip?.prompt) entry.prompt = matchedClip.prompt;
      if (parts.length > 1) entry.format = parts.slice(multiClip ? 1 : 0).join('-');
      return entry;
    });
    await recordBrandRun(brand, projectName, 'brand-images', imgProvider, qaForMemory);
    await recordSkillRun(imgProvider, qaForMemory);
  }

  // ── Save asset manifest ────────────────────────────────────────────────────
  const manifest = new AssetManifest(projectsRoot, projectName);
  for (const qa of qaResults) {
    const imgPath = path.join(imagesDir, `${qa.scene}.jpg`);
    if (await fs.pathExists(imgPath)) {
      const fmt = qa.scene.includes('-') ? (qa.scene.split('-').pop() ?? qa.scene) : qa.scene;
      manifest.record({
        path: imgPath,
        type: 'image',
        provider: imgProvider,
        model: imgProvider === 'gpt-image' ? 'gpt-image-1' : 'gemini-3-pro-image-preview',
        qaScore: qa.score,
        format: fmt,
      });
    }
  }
  await manifest.save();

  logger.success(`Done! Images saved to: ${path.relative(process.cwd(), imagesDir)}`);
  return imagesDir;
}
