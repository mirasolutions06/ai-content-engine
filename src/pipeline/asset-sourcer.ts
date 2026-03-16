import path from 'path';
import fs from 'fs-extra';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { CostTracker } from '../utils/cost-tracker.js';
import type { VideoConfig, BrandColors, AssetSourcingResult, MoodBoardEntry } from '../types/index.js';

// ── Auto-ref evaluation (Haiku vision) ──────────────────────────────────────

const REF_EVAL_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Evaluates an auto-generated reference image using Claude Haiku vision.
 * Checks for collages, quality, and relevance. Returns true if acceptable.
 */
async function evaluateAutoRef(
  imagePath: string,
  refType: 'style' | 'location',
  description: string,
  costTracker: CostTracker,
): Promise<boolean> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return true; // no key = skip evaluation, keep the image

  try {
    const buffer = await fs.readFile(imagePath);
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    const mediaType = isPng ? 'image/png' : 'image/jpeg';

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: REF_EVAL_MODEL,
      max_tokens: 256,
      system: 'You evaluate AI-generated reference images for quality. Return ONLY a JSON object: { "score": <1-5>, "isCollage": <boolean>, "issues": ["<issue>"] }. Score: 5 = excellent single photo, 3 = acceptable, 1 = unusable. isCollage = true if the image is a grid, mood board, or multiple images composited together.',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
          },
          {
            type: 'text',
            text: `Evaluate this auto-generated ${refType} reference image. It should be: "${description}". Is it a single high-quality photograph suitable as a ${refType} reference?`,
          },
        ],
      }],
    });

    costTracker.logStep('haiku-ref-eval', false);

    const text = response.content[0]?.type === 'text' ? response.content[0].text : null;
    if (!text) return true;

    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as { score: number; isCollage: boolean; issues: string[] };

    if (parsed.isCollage) {
      logger.warn(`Auto-ref evaluation: ${refType} reference is a collage — deleted. Consider adding your own ${refType}.jpg`);
      await fs.remove(imagePath);
      return false;
    }

    if (parsed.score < 3) {
      logger.warn(`Auto-ref evaluation: ${refType} reference scored ${parsed.score}/5 — deleted. Issues: ${(parsed.issues ?? []).join('; ')}`);
      await fs.remove(imagePath);
      return false;
    }

    logger.info(`Auto-ref evaluation: ${refType} reference scored ${parsed.score}/5 — accepted.`);
    return true;
  } catch (err) {
    logger.warn(`Auto-ref evaluation failed for ${refType}: ${String(err)} — keeping image.`);
    return true;
  }
}

// ── Brand Colors: Strategy A — Extract from website URL ──────────────────────

async function extractColorsFromWebsite(url: string): Promise<BrandColors | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AssetSourcer/1.0)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const html = await res.text();

    const colors: string[] = [];

    // meta theme-color
    const metaMatch = /meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{3,8})["']/i.exec(html);
    if (metaMatch?.[1]) colors.push(metaMatch[1]);

    // CSS custom properties for brand colors
    const cssVarPattern = /--(?:primary|brand|accent|secondary|main|theme)[^:]*:\s*(#[0-9a-fA-F]{3,8})/gi;
    let cssMatch: RegExpExecArray | null;
    while ((cssMatch = cssVarPattern.exec(html)) !== null) {
      if (cssMatch[1] && !colors.includes(cssMatch[1])) colors.push(cssMatch[1]);
    }

    // background-color on common brand elements
    const bgPattern = /(?:header|nav|hero|banner)[^}]*?background(?:-color)?:\s*(#[0-9a-fA-F]{3,8})/gi;
    let bgMatch: RegExpExecArray | null;
    while ((bgMatch = bgPattern.exec(html)) !== null) {
      if (bgMatch[1] && !colors.includes(bgMatch[1])) colors.push(bgMatch[1]);
    }

    if (colors.length === 0) return null;

    return {
      primary: colors[0]!,
      ...(colors[1] ? { secondary: colors[1] } : {}),
      ...(colors[2] ? { accent: colors[2] } : {}),
    };
  } catch {
    logger.warn(`Asset sourcer: could not fetch ${url} for color extraction.`);
    return null;
  }
}

// ── Brand Colors: Strategy B — Extract from product image via Gemini ─────────

async function extractColorsFromImage(imagePath: string): Promise<BrandColors | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const buffer = await fs.readFile(imagePath);
    // Detect actual format from magic bytes, not file extension
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    const mimeType = isPng ? 'image/png' : 'image/jpeg';

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: buffer.toString('base64') } },
          {
            text: 'Analyze this product/brand image. Extract the 3 most prominent brand-like colors ' +
              '(skip white, black, and neutral greys). Return ONLY valid JSON: ' +
              '{"primary":"#hex","secondary":"#hex","accent":"#hex"}',
          },
        ],
      }],
    });

    const text = response.candidates?.[0]?.content?.parts?.[0];
    if (!text || !('text' in text) || !text.text) return null;

    const cleaned = text.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned) as BrandColors;
  } catch (err) {
    logger.warn(`Asset sourcer: Gemini color extraction failed: ${String(err)}`);
    return null;
  }
}

// ── Brand Colors: Strategy C — Generate from brand description via Haiku ─────

async function generateColorsFromDescription(description: string): Promise<BrandColors | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `Given this brand description: "${description}", suggest 3 hex color codes ` +
          `(primary, secondary, accent) that match the brand's tone. ` +
          `Return ONLY valid JSON: {"primary":"#hex","secondary":"#hex","accent":"#hex"}`,
      }],
    });

    const block = response.content[0];
    if (block?.type !== 'text') return null;

    const cleaned = block.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    return JSON.parse(cleaned) as BrandColors;
  } catch (err) {
    logger.warn(`Asset sourcer: Haiku color generation failed: ${String(err)}`);
    return null;
  }
}

// ── Style / Location reference via Gemini image generation ───────────────────

async function generateReferenceImage(
  prompt: string,
  outputPath: string,
  label: string,
): Promise<boolean> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    logger.warn(`Asset sourcer: GEMINI_API_KEY not set — skipping ${label} generation.`);
    return false;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    type InlineDataPart = { inlineData: { mimeType: string; data: string } };

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-image-preview',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    });

    let imageData: string | null = null;
    let imageMime = 'image/png';
    outer: for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if ((part as InlineDataPart).inlineData?.data) {
          imageData = (part as InlineDataPart).inlineData.data;
          imageMime = (part as InlineDataPart).inlineData.mimeType ?? 'image/png';
          break outer;
        }
      }
    }

    if (!imageData) throw new Error('Gemini returned no image data');

    await fs.ensureDir(path.dirname(outputPath));

    // Save with correct extension matching actual image format
    const isJpeg = imageMime.includes('jpeg') || imageMime.includes('jpg');
    if (isJpeg && outputPath.endsWith('.png')) {
      const jpgPath = outputPath.replace('.png', '.jpg');
      await fs.writeFile(jpgPath, Buffer.from(imageData, 'base64'));
      logger.success(`Asset sourcer: ${label} saved to ${path.basename(jpgPath)}`);
    } else {
      await fs.writeFile(outputPath, Buffer.from(imageData, 'base64'));
      logger.success(`Asset sourcer: ${label} saved to ${path.basename(outputPath)}`);
    }
    return true;
  } catch (err) {
    logger.warn(`Asset sourcer: ${label} generation failed: ${String(err)}`);
    return false;
  }
}

// ── Style reference via Pexels ───────────────────────────────────────────────

async function searchPexelsImage(query: string, outputPath: string): Promise<boolean> {
  const apiKey = process.env['PEXELS_API_KEY'];
  if (!apiKey) return false;

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: apiKey }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return false;

    const data = (await res.json()) as { photos?: Array<{ src?: { large?: string } }> };
    const url = data.photos?.[0]?.src?.large;
    if (!url) return false;

    const imgRes = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) return false;

    const buf = await imgRes.arrayBuffer();
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, Buffer.from(buf));
    logger.success(`Asset sourcer: downloaded Pexels image to ${path.basename(outputPath)}`);
    return true;
  } catch (err) {
    logger.warn(`Asset sourcer: Pexels search failed: ${String(err)}`);
    return false;
  }
}

// ── Style reference via Unsplash ─────────────────────────────────────────────

async function searchUnsplashImage(query: string, outputPath: string): Promise<boolean> {
  const apiKey = process.env['UNSPLASH_ACCESS_KEY'];
  if (!apiKey) return false;

  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=1&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${apiKey}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return false;

    const data = (await res.json()) as { results?: Array<{ urls?: { regular?: string } }> };
    const url = data.results?.[0]?.urls?.regular;
    if (!url) return false;

    const imgRes = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!imgRes.ok) return false;

    const buf = await imgRes.arrayBuffer();
    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, Buffer.from(buf));
    logger.success(`Asset sourcer: downloaded Unsplash image to ${path.basename(outputPath)}`);
    return true;
  } catch (err) {
    logger.warn(`Asset sourcer: Unsplash search failed: ${String(err)}`);
    return false;
  }
}

// ── Background music via Pixabay ─────────────────────────────────────────────

function mapStyleToMusicQuery(config: VideoConfig): string {
  const hints = [
    config.brief ?? '',
    config.title ?? '',
    ...(config.clips.map((c) => c.prompt ?? '')),
  ].join(' ').toLowerCase();

  if (/luxury|calm|minimal|zen|spa|asmr|elegant/i.test(hints)) return 'ambient calm corporate';
  if (/energetic|bold|fast|power|strong|gym|sport/i.test(hints)) return 'upbeat energetic';
  if (/cinematic|dramatic|epic|film|movie/i.test(hints)) return 'cinematic orchestral';
  if (/playful|fun|happy|bright|joy|kid/i.test(hints)) return 'happy uplifting';
  return 'corporate background';
}

async function sourceMusic(
  config: VideoConfig,
  musicPath: string,
  attributionPath: string,
): Promise<'pixabay' | 'skipped'> {
  const apiKey = process.env['PIXABAY_API_KEY'];
  if (!apiKey) {
    logger.info(
      'No music API key found. To add background music, either:\n' +
      '  1. Set PIXABAY_API_KEY in .env for auto-sourcing\n' +
      '  2. Place a music.mp3 file in the project directory\n' +
      '  3. Set music: false in config.json to skip music',
    );
    return 'skipped';
  }

  const query = mapStyleToMusicQuery(config);
  logger.step(`Asset sourcer: searching Pixabay for "${query}" music...`);

  try {
    const res = await fetch(
      `https://pixabay.com/api/?key=${encodeURIComponent(apiKey)}` +
      `&q=${encodeURIComponent(query)}&media_type=music&per_page=3`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) throw new Error(`Pixabay API returned HTTP ${res.status}`);

    const data = (await res.json()) as {
      hits?: Array<{
        audio?: string;
        previewURL?: string;
        user?: string;
        pageURL?: string;
        tags?: string;
      }>;
    };

    const hit = data.hits?.[0];
    const audioUrl = hit?.audio ?? hit?.previewURL;
    if (!audioUrl) throw new Error('No audio results found');

    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(30_000) });
    if (!audioRes.ok) throw new Error(`Failed to download audio: HTTP ${audioRes.status}`);

    const buf = await audioRes.arrayBuffer();
    await fs.ensureDir(path.dirname(musicPath));
    await fs.writeFile(musicPath, Buffer.from(buf));

    // Save attribution
    const attribution = [
      `Track: ${hit?.tags ?? 'Unknown'}`,
      `Author: ${hit?.user ?? 'Unknown'}`,
      `Source: ${hit?.pageURL ?? 'Pixabay'}`,
      `License: Pixabay Content License (free for commercial use)`,
      `Downloaded: ${new Date().toISOString()}`,
    ].join('\n');
    await fs.writeFile(attributionPath, attribution);

    logger.success(`Asset sourcer: music saved, attribution in music-attribution.txt`);
    return 'pixabay';
  } catch (err) {
    logger.warn(`Asset sourcer: Pixabay music sourcing failed: ${String(err)}`);
    return 'skipped';
  }
}

// ── Location extraction from clip prompts ────────────────────────────────────

function extractLocationFromPrompts(config: VideoConfig): string | null {
  const locationPatterns = /\b(?:in|at|on|inside|outside|overlooking|surrounded by|against|through)\s+(?:a|an|the)?\s*([^,.]+)/i;

  let bestMatch: string | null = null;
  let bestLength = 0;

  for (const clip of config.clips) {
    if (!clip.prompt) continue;
    const match = locationPatterns.exec(clip.prompt);
    if (match?.[1] && match[1].length > bestLength) {
      bestMatch = match[1].trim();
      bestLength = bestMatch.length;
    }
  }

  return bestMatch;
}

// ── Main export ──────────────────────────────────────────────────────────────

// ── Mood board URL importer ──────────────────────────────────────────────────

interface MoodBoardManifest {
  [url: string]: string;
}

const IMG_EXTS_RE = /\.(?:jpg|jpeg|png|webp)$/i;

/**
 * Resolves a URL to a direct image URL.
 * If the URL itself serves an image, returns it as-is.
 * Otherwise fetches HTML and extracts the og:image meta tag.
 */
async function resolveImageUrl(url: string): Promise<string | null> {
  try {
    const headRes = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    const contentType = headRes.headers.get('content-type') ?? '';
    if (contentType.startsWith('image/')) return url;

    // Fetch HTML and extract og:image
    const htmlRes = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    if (!htmlRes.ok) return null;
    const html = await htmlRes.text();

    // Handle both attribute orderings: property then content, or content then property
    const ogMatch = html.match(
      /<meta[^>]+(?:property=["']og:image["'][^>]+content=["']([^"']+)["']|content=["']([^"']+)["'][^>]+property=["']og:image["'])/i,
    );
    return ogMatch?.[1] ?? ogMatch?.[2] ?? null;
  } catch {
    return null;
  }
}

/**
 * Downloads an image from a URL to disk. Returns true on success.
 * Rejects images smaller than 10KB (likely thumbnails or tracking pixels).
 */
async function downloadMoodBoardImage(imageUrl: string, outputPath: string): Promise<boolean> {
  try {
    const res = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AssetSourcer/1.0)' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return false;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 10_000) return false;

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Imports mood board images from config.moodBoard URLs.
 * Downloads to project root as {type}-{n}.jpg following the existing naming convention.
 * Idempotent via cache/mood-board-manifest.json.
 */
async function importMoodBoard(
  config: VideoConfig,
  projectDir: string,
  dryRun: boolean,
): Promise<void> {
  const entries = config.moodBoard;
  if (!entries || entries.length === 0) return;

  logger.step(`Mood board: processing ${entries.length} URL(s)...`);

  // Load manifest for idempotency
  const manifestPath = path.join(projectDir, 'cache', 'mood-board-manifest.json');
  let manifest: MoodBoardManifest = {};
  if (await fs.pathExists(manifestPath)) {
    manifest = (await fs.readJson(manifestPath)) as MoodBoardManifest;
  }

  // Count existing files per type to pick next number
  let files: string[] = [];
  try { files = await fs.readdir(projectDir); } catch { /* empty */ }

  const typeCounts: Record<string, number> = { style: 0, location: 0, product: 0, model: 0 };
  for (const type of Object.keys(typeCounts)) {
    const pattern = new RegExp(`^${type}(?:-(\\d+))?\\.(?:jpg|jpeg|png)$`, 'i');
    for (const f of files) {
      const m = pattern.exec(f);
      if (m) {
        const num = m[1] ? parseInt(m[1], 10) : 1;
        typeCounts[type] = Math.max(typeCounts[type]!, num);
      }
    }
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of entries) {
    const url = typeof entry === 'string' ? entry : entry.url;
    const refType = (typeof entry === 'string' ? 'style' : entry.type) ?? 'style';

    // Idempotency check
    const existingFile = manifest[url];
    if (existingFile && (await fs.pathExists(path.join(projectDir, existingFile)))) {
      logger.skip(`Mood board: ${existingFile} already exists`);
      skipped++;
      continue;
    }

    if (dryRun) {
      logger.info(`[DRY RUN] Would download mood board ${refType} from: ${url.slice(0, 80)}...`);
      continue;
    }

    const imageUrl = await resolveImageUrl(url);
    if (!imageUrl) {
      logger.warn(`Mood board: no image found at ${url.slice(0, 80)}`);
      failed++;
      continue;
    }

    typeCounts[refType] = (typeCounts[refType] ?? 0) + 1;
    const num = typeCounts[refType]!;
    const filename = `${refType}-${num}.jpg`;
    const outputPath = path.join(projectDir, filename);

    const ok = await downloadMoodBoardImage(imageUrl, outputPath);
    if (!ok) {
      logger.warn(`Mood board: failed to download ${url.slice(0, 80)}`);
      failed++;
      continue;
    }

    manifest[url] = filename;
    imported++;
    logger.success(`Mood board: saved ${filename}`);
  }

  // Save manifest
  if (imported > 0) {
    await fs.ensureDir(path.dirname(manifestPath));
    await fs.outputJson(manifestPath, manifest, { spaces: 2 });
  }

  if (imported > 0 || failed > 0) {
    logger.info(`Mood board: ${imported} imported, ${skipped} cached, ${failed} failed`);
  }
}

// ── Model sheet generation ───────────────────────────────────────────────────

const MODEL_SHEET_SYSTEM = `You are a professional portrait photographer creating model comp cards / character reference sheets.
Generate a MULTI-VIEW reference image showing the same person from different angles arranged in a single image.
This is intentionally a multi-view layout — NOT a single photo.`;

/**
 * Generates model reference sheets (face + body) from a source model image using Gemini.
 * Produces two files:
 *   - model-sheet.jpg — 5 headshot angles on white background
 *   - model-body.jpg — 2 full-body poses in plain neutral clothing on white background
 *
 * Idempotent: skips if output files already exist.
 */
async function generateModelSheets(
  config: VideoConfig,
  projectDir: string,
  costTracker: CostTracker,
  dryRun: boolean,
): Promise<void> {
  if (!config.modelSheet) return;

  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not set — skipping model sheet generation.');
    return;
  }

  // Find source model image
  let sourceImagePath: string | null = null;

  if (typeof config.modelSheet === 'string') {
    const candidate = path.join(projectDir, config.modelSheet);
    if (await fs.pathExists(candidate)) {
      sourceImagePath = candidate;
    } else {
      logger.warn(`Model sheet: specified source "${config.modelSheet}" not found — skipping.`);
      return;
    }
  } else {
    // Auto-detect: find first model-*.jpg/png in project root (exclude model-sheet, model-body)
    let files: string[];
    try { files = await fs.readdir(projectDir); } catch { return; }
    const modelPattern = /^model(?:-(\d+))?\.(?:jpg|jpeg|png)$/i;
    const match = files.filter((f) => modelPattern.test(f)).sort()[0];
    if (match) {
      sourceImagePath = path.join(projectDir, match);
    } else {
      logger.warn('Model sheet: no model-*.jpg found in project root — skipping.');
      return;
    }
  }

  // Read source image once
  const sourceBuffer = await fs.readFile(sourceImagePath);
  const isPng = sourceBuffer[0] === 0x89 && sourceBuffer[1] === 0x50 && sourceBuffer[2] === 0x4E && sourceBuffer[3] === 0x47;
  const sourceMime = isPng ? 'image/png' : 'image/jpeg';

  logger.step(`Model sheet: using ${path.basename(sourceImagePath)} as source reference.`);

  const sheets: Array<{ name: string; outputFile: string; label: string; prompt: string }> = [
    {
      name: 'face sheet',
      outputFile: 'model-sheet.jpg',
      label: '[SOURCE MODEL — generate a multi-angle face reference sheet of THIS EXACT person]',
      prompt: [
        'Create a professional model/character reference sheet of this exact person.',
        'Show 5 head-and-shoulders views in a single horizontal row:',
        '1. Front-facing  2. Three-quarter left  3. Three-quarter right  4. Left profile  5. Looking over right shoulder (slight back-turn)',
        'White seamless studio background. Even, flat lighting — no dramatic shadows.',
        'Neutral relaxed expression in every view. Same exact person, same hair, same skin tone, same facial features in ALL views.',
        'Consistent framing and scale across all views.',
        'This is a reference sheet for visual consistency — clinical accuracy is more important than artistic style.',
      ].join('\n'),
    },
    {
      name: 'body sheet',
      outputFile: 'model-body.jpg',
      label: '[SOURCE MODEL — generate a full-body reference of THIS EXACT person]',
      prompt: [
        'Create a full-body reference sheet of this exact person.',
        'Show 2 full-body views side by side:',
        '1. Standing front-facing, relaxed posture, weight evenly distributed',
        '2. Three-quarter angle, natural walking or relaxed stance',
        'Wearing plain neutral clothing: simple white or light grey crew-neck t-shirt and dark navy or black trousers. No logos, no branding, no accessories.',
        'White seamless studio background. Even, flat lighting from all directions.',
        'Same person as the reference — same face, same build, same skin tone. Full body visible from head to shoes.',
        'This is a body proportion reference — accuracy and consistency matter more than style.',
      ].join('\n'),
    },
  ];

  type InlineDataPart = { inlineData: { mimeType: string; data: string } };
  type TextPart = { text: string };

  for (const sheet of sheets) {
    const outputPath = path.join(projectDir, sheet.outputFile);

    if (await fs.pathExists(outputPath)) {
      logger.skip(`Model sheet: ${sheet.outputFile} already exists.`);
      continue;
    }

    if (dryRun) {
      logger.info(`[DRY RUN] Would generate ${sheet.name} → ${sheet.outputFile} (~$0.08)`);
      continue;
    }

    logger.step(`Model sheet: generating ${sheet.name}...`);

    try {
      const ai = new GoogleGenAI({ apiKey });

      const parts: Array<TextPart | InlineDataPart> = [
        { text: sheet.label },
        { inlineData: { mimeType: sourceMime, data: sourceBuffer.toString('base64') } },
        { text: sheet.prompt },
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          systemInstruction: MODEL_SHEET_SYSTEM,
        },
      });

      let imageData: string | null = null;
      let imageMime = 'image/png';
      outer: for (const candidate of response.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if ((part as InlineDataPart).inlineData?.data) {
            imageData = (part as InlineDataPart).inlineData.data;
            imageMime = (part as InlineDataPart).inlineData.mimeType ?? 'image/png';
            break outer;
          }
        }
      }

      if (!imageData) {
        logger.warn(`Model sheet: Gemini returned no image data for ${sheet.name}.`);
        costTracker.logStep('gemini-model-sheet', false);
        continue;
      }

      // Save with correct extension
      const isJpeg = imageMime.includes('jpeg') || imageMime.includes('jpg');
      const finalPath = isJpeg ? outputPath : outputPath.replace('.jpg', '.png');
      await fs.writeFile(finalPath, Buffer.from(imageData, 'base64'));

      costTracker.logStep('gemini-model-sheet', false);
      logger.success(`Model sheet: ${sheet.name} saved to ${path.basename(finalPath)}`);
    } catch (err) {
      logger.warn(`Model sheet: ${sheet.name} generation failed: ${String(err)}`);
      costTracker.logStep('gemini-model-sheet', false);
    }
  }
}

/**
 * Auto-sources project assets: brand colors, style reference, location reference,
 * and background music. Runs AFTER config.json is loaded but BEFORE the Director step.
 *
 * Every step is idempotent — existing files are never overwritten.
 * User-provided files always take priority over auto-sourced ones.
 */
export async function sourceAssets(
  projectName: string,
  config: VideoConfig,
  projectDir: string,
  costTracker: CostTracker,
  dryRun: boolean,
): Promise<AssetSourcingResult> {
  // Import mood board images first (before any other asset sourcing)
  await importMoodBoard(config, projectDir, dryRun);

  // Generate model sheets if configured (before refs are discovered)
  await generateModelSheets(config, projectDir, costTracker, dryRun);

  logger.step('Asset sourcer: checking for auto-sourceable assets...');

  const assetsDir = projectDir;
  const result: AssetSourcingResult = {
    colorsExtracted: false,
    colorSource: 'skipped',
    styleReferenceSourced: false,
    styleSource: 'skipped',
    locationReferenceSourced: false,
    locationSource: 'skipped',
    musicSourced: false,
    musicSource: 'skipped',
    estimatedCost: 0,
  };

  // ── 1. Brand Colors ─────────────────────────────────────────────────────────
  // AssetLoader reads brand/brand.json — save there for integration
  const brandJsonPath = path.join(assetsDir, 'brand', 'brand.json');

  if (await fs.pathExists(brandJsonPath)) {
    logger.skip('Asset sourcer: brand.json already exists — skipping color extraction.');
    result.colorsExtracted = true;
    result.colorSource = 'existing';
  } else {
    const brandDescription = config.brief ?? config.title;
    const clientUrl = config.client && /^https?:\/\//i.test(config.client)
      ? config.client
      : undefined;
    const subjectPath = path.join(assetsDir, 'product.jpg');
    const hasSubject = await fs.pathExists(subjectPath);

    if (dryRun) {
      if (clientUrl) {
        logger.info(`[DRY RUN] Would extract brand colors from ${clientUrl}`);
      } else if (hasSubject) {
        logger.info('[DRY RUN] Would extract brand colors from subject.jpg via Gemini (~$0.02)');
        result.estimatedCost += 0.02;
      } else {
        logger.info('[DRY RUN] Would generate brand colors via Haiku (~$0.01)');
        result.estimatedCost += 0.01;
      }
    } else {
      let colors: BrandColors | null = null;

      // Strategy A: website
      if (clientUrl) {
        logger.step(`Asset sourcer: extracting colors from ${clientUrl}...`);
        colors = await extractColorsFromWebsite(clientUrl);
        if (colors) result.colorSource = 'website';
      }

      // Strategy B: product image via Gemini
      if (!colors && hasSubject) {
        logger.step('Asset sourcer: extracting colors from subject.jpg via Gemini...');
        colors = await extractColorsFromImage(subjectPath);
        if (colors) {
          result.colorSource = 'image';
          costTracker.logStep('gemini-color-extract', false);
        }
      }

      // Strategy C: generate from description via Haiku
      if (!colors && brandDescription) {
        logger.step('Asset sourcer: generating brand colors via Haiku...');
        colors = await generateColorsFromDescription(brandDescription);
        if (colors) {
          result.colorSource = 'generated';
          costTracker.logStep('haiku-color-gen', false);
        }
      }

      if (colors) {
        await fs.ensureDir(path.dirname(brandJsonPath));
        await fs.outputJson(brandJsonPath, colors, { spaces: 2 });
        result.colorsExtracted = true;
        logger.success(`Asset sourcer: brand colors saved (source: ${result.colorSource})`);
      } else {
        logger.warn('Asset sourcer: could not extract brand colors from any source.');
      }
    }
  }

  // ── 2. Style Reference ──────────────────────────────────────────────────────
  const skipAutoRefs = config.skipAutoRefs ?? [];
  const stylePath = path.join(assetsDir, 'style.png');

  if (skipAutoRefs.includes('style')) {
    logger.skip('Asset sourcer: style reference skipped via config.skipAutoRefs.');
    result.styleSource = 'skipped';
  } else if (await fs.pathExists(stylePath)) {
    logger.skip('Asset sourcer: style.png already exists — skipping.');
    result.styleReferenceSourced = true;
    result.styleSource = 'existing';
  } else {
    const styleDesc = config.brief ?? config.title ?? 'professional brand photography';
    const styleQuery = `${styleDesc} photography mood aesthetic`;

    if (dryRun) {
      if (process.env['PEXELS_API_KEY'] || process.env['UNSPLASH_ACCESS_KEY']) {
        const source = process.env['PEXELS_API_KEY'] ? 'Pexels' : 'Unsplash';
        logger.info(`[DRY RUN] Would search ${source} for style reference: "${styleQuery}"`);
      } else {
        logger.info(`[DRY RUN] Would generate style reference via Gemini (~$0.05)`);
        result.estimatedCost += 0.05;
      }
    } else {
      let sourced = false;

      // Try Pexels first
      if (!sourced && process.env['PEXELS_API_KEY']) {
        sourced = await searchPexelsImage(styleQuery, stylePath);
        if (sourced) result.styleSource = 'pexels';
      }

      // Try Unsplash
      if (!sourced && process.env['UNSPLASH_ACCESS_KEY']) {
        sourced = await searchUnsplashImage(styleQuery, stylePath);
        if (sourced) result.styleSource = 'unsplash';
      }

      // Fallback: Gemini generation
      if (!sourced) {
        const prompt =
          'Generate a single high-quality professional photograph that establishes the visual style for a photo campaign. ' +
          `Style: ${styleDesc}. ` +
          'This should be ONE compelling photograph, NOT a mood board, NOT a collage, NOT multiple images. ' +
          'Professional editorial photography with natural lighting and authentic textures. No text, no logos.';

        sourced = await generateReferenceImage(prompt, stylePath, 'style reference');
        if (sourced) {
          result.styleSource = 'gemini';
          costTracker.logStep('gemini-style-ref', false);
          // Evaluate quality — delete if collage or low quality
          const accepted = await evaluateAutoRef(stylePath, 'style', styleDesc, costTracker);
          if (!accepted) sourced = false;
        }
      }

      result.styleReferenceSourced = sourced;
    }
  }

  // ── 3. Location Reference ───────────────────────────────────────────────────
  const locationPath = path.join(assetsDir, 'location.png');
  const locationPathJpg = path.join(assetsDir, 'location.jpg');

  if (skipAutoRefs.includes('location')) {
    logger.skip('Asset sourcer: location reference skipped via config.skipAutoRefs.');
    result.locationSource = 'skipped';
  } else if (await fs.pathExists(locationPath) || await fs.pathExists(locationPathJpg)) {
    logger.skip('Asset sourcer: location reference already exists — skipping.');
    result.locationReferenceSourced = true;
    result.locationSource = 'existing';
  } else {
    const locationDesc = extractLocationFromPrompts(config);

    if (!locationDesc) {
      logger.info('Asset sourcer: no distinct location found in scene prompts — skipping location reference.');
    } else if (dryRun) {
      if (process.env['PEXELS_API_KEY'] || process.env['UNSPLASH_ACCESS_KEY']) {
        const source = process.env['PEXELS_API_KEY'] ? 'Pexels' : 'Unsplash';
        logger.info(`[DRY RUN] Would search ${source} for location reference: "${locationDesc}"`);
      } else {
        logger.info(`[DRY RUN] Would generate location reference via Gemini (~$0.05)`);
        result.estimatedCost += 0.05;
      }
    } else {
      let sourced = false;

      // Try Pexels
      if (!sourced && process.env['PEXELS_API_KEY']) {
        sourced = await searchPexelsImage(`${locationDesc} photography`, locationPath);
        if (sourced) result.locationSource = 'pexels';
      }

      // Try Unsplash
      if (!sourced && process.env['UNSPLASH_ACCESS_KEY']) {
        sourced = await searchUnsplashImage(`${locationDesc} photography`, locationPath);
        if (sourced) result.locationSource = 'unsplash';
      }

      // Fallback: Gemini
      if (!sourced) {
        const prompt =
          `Generate a photographic reference of this setting: ${locationDesc}. ` +
          'Photorealistic, professional photography, establishing shot feel. No people, no text.';

        sourced = await generateReferenceImage(prompt, locationPath, 'location reference');
        if (sourced) {
          result.locationSource = 'gemini';
          costTracker.logStep('gemini-location-ref', false);
          // Evaluate quality — delete if collage or low quality
          const accepted = await evaluateAutoRef(locationPath, 'location', locationDesc, costTracker);
          if (!accepted) sourced = false;
        }
      }

      result.locationReferenceSourced = sourced;
    }
  }

  // ── 4. Background Music ─────────────────────────────────────────────────────
  const musicPath = path.join(assetsDir, 'music.mp3');
  const attributionPath = path.join(assetsDir, 'music-attribution.txt');

  if (config.music === false) {
    logger.skip('Asset sourcer: music disabled in config — skipping.');
  } else if (await fs.pathExists(musicPath)) {
    logger.skip('Asset sourcer: music.mp3 already exists — skipping.');
    result.musicSourced = true;
    result.musicSource = 'existing';
  } else if (dryRun) {
    if (process.env['PIXABAY_API_KEY']) {
      const query = mapStyleToMusicQuery(config);
      logger.info(`[DRY RUN] Would search Pixabay for "${query}" music`);
    } else {
      logger.info('[DRY RUN] No music API key — would skip music sourcing');
    }
  } else {
    const musicResult = await sourceMusic(config, musicPath, attributionPath);
    result.musicSourced = musicResult === 'pixabay';
    result.musicSource = musicResult;
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  logger.info(
    `Asset sourcing complete: ` +
    `colors=${result.colorSource}, ` +
    `style=${result.styleSource}, ` +
    `location=${result.locationSource}, ` +
    `music=${result.musicSource}`,
  );

  return result;
}
