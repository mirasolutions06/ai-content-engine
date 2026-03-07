import path from 'path';
import fs from 'fs-extra';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { CostTracker } from '../utils/cost-tracker.js';
import type { VideoConfig, BrandColors, AssetSourcingResult } from '../types/index.js';

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
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

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
    outer: for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if ((part as InlineDataPart).inlineData?.data) {
          imageData = (part as InlineDataPart).inlineData.data;
          break outer;
        }
      }
    }

    if (!imageData) throw new Error('Gemini returned no image data');

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, Buffer.from(imageData, 'base64'));
    logger.success(`Asset sourcer: ${label} saved to ${path.basename(outputPath)}`);
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
      '  2. Place a music.mp3 file in the project\'s assets/audio/ directory\n' +
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
  logger.step('Asset sourcer: checking for auto-sourceable assets...');

  const assetsDir = path.join(projectDir, 'assets');
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
  // AssetLoader reads assets/brand/brand.json — save there for integration
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
    const subjectPath = path.join(assetsDir, 'reference', 'subject.jpg');
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
  const stylePath = path.join(assetsDir, 'reference', 'style.png');

  if (await fs.pathExists(stylePath)) {
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
          'Generate a photography mood board reference image. ' +
          `Style: ${styleDesc}. ` +
          'This is a reference for art direction, not final content. ' +
          'Aesthetic, professional, editorial feel. No text, no logos.';

        sourced = await generateReferenceImage(prompt, stylePath, 'style reference');
        if (sourced) {
          result.styleSource = 'gemini';
          costTracker.logStep('gemini-style-ref', false);
        }
      }

      result.styleReferenceSourced = sourced;
    }
  }

  // ── 3. Location Reference ───────────────────────────────────────────────────
  const locationPath = path.join(assetsDir, 'reference', 'location.png');

  if (await fs.pathExists(locationPath)) {
    logger.skip('Asset sourcer: location.png already exists — skipping.');
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
        }
      }

      result.locationReferenceSourced = sourced;
    }
  }

  // ── 4. Background Music ─────────────────────────────────────────────────────
  const musicPath = path.join(assetsDir, 'audio', 'music.mp3');
  const attributionPath = path.join(assetsDir, 'audio', 'music-attribution.txt');

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
