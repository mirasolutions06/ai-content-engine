import path from 'path';
import fs from 'fs-extra';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { retryWithBackoff } from '../utils/retry.js';
import type { VideoConfig, PipelineMode } from '../types/index.js';

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 15000);
}

interface BriefExtraction {
  brand: string;
  product: string;
  description: string;
  price?: string;
  audience: string;
  features: string[];
  imageUrls: string[];
  mood: string;
}

/**
 * Fetches a product page URL and extracts brand/product information using Claude.
 * Returns structured data that can be used to generate a config.json.
 */
export async function extractBriefFromUrl(url: string): Promise<BriefExtraction> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY must be set to use URL-to-brief');
  }

  logger.step(`Fetching ${url}...`);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  const html = await response.text();
  const text = htmlToText(html);

  logger.step('Extracting product brief with Claude...');

  const client = new Anthropic({ apiKey });
  const result = await retryWithBackoff(
    () => client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `Extract product/brand information from this web page content. Return ONLY valid JSON, no markdown fences.

Schema:
{
  "brand": "brand name",
  "product": "specific product name",
  "description": "1-2 sentence product description",
  "price": "price if found, or null",
  "audience": "target audience in 1 sentence",
  "features": ["key feature 1", "key feature 2"],
  "imageUrls": ["url1", "url2"],
  "mood": "visual mood/aesthetic in 3-5 words"
}

Extract up to 5 product image URLs. If no images found, return empty array.

Page content:
${text}`,
      }],
    }),
    { attempts: 3, delayMs: 3000, label: 'URL brief extraction' },
  );

  const content = result.content[0];
  if (content?.type !== 'text') {
    throw new Error('Claude returned no text response');
  }

  const jsonStr = content.text
    .replace(/^```json?\s*/m, '')
    .replace(/\s*```$/m, '')
    .trim();

  return JSON.parse(jsonStr) as BriefExtraction;
}

/**
 * Generates a complete project from a URL:
 * 1. Fetches and extracts product info
 * 2. Downloads product images as references
 * 3. Returns a ready-to-use VideoConfig
 */
export async function generateConfigFromUrl(
  url: string,
  projectsRoot: string,
  projectName: string,
  mode: PipelineMode = 'brand-images',
): Promise<VideoConfig> {
  const brief = await extractBriefFromUrl(url);
  const projectDir = path.join(projectsRoot, projectName);

  logger.info(`Brand: ${brief.brand} | Product: ${brief.product}`);
  logger.info(`Mood: ${brief.mood} | Audience: ${brief.audience}`);

  // Download product images as references
  if (brief.imageUrls.length > 0) {
    logger.step(`Downloading ${Math.min(brief.imageUrls.length, 5)} product image(s)...`);
    let downloaded = 0;

    for (let i = 0; i < Math.min(brief.imageUrls.length, 5); i++) {
      const imgUrl = brief.imageUrls[i];
      if (!imgUrl) continue;

      try {
        const res = await fetch(imgUrl);
        if (!res.ok) continue;
        const buffer = Buffer.from(await res.arrayBuffer());

        // Detect format from content-type or URL
        const contentType = res.headers.get('content-type') ?? '';
        const ext = contentType.includes('png') ? 'png'
          : contentType.includes('webp') ? 'webp'
            : 'jpg';

        const filename = i === 0 ? `product.${ext}` : `product-${i + 1}.${ext}`;
        await fs.ensureDir(projectDir);
        await fs.writeFile(path.join(projectDir, filename), buffer);
        downloaded++;
      } catch {
        logger.warn(`Failed to download image ${i + 1}`);
      }
    }

    if (downloaded > 0) {
      logger.success(`Downloaded ${downloaded} reference image(s).`);
    }
  }

  // Generate config
  const config: VideoConfig = {
    title: `${brief.brand} — ${brief.product}`,
    mode,
    brand: brief.brand,
    brief: `${brief.description} Target audience: ${brief.audience}. Key features: ${brief.features.join(', ')}.`,
    clips: [
      { prompt: `Hero shot of ${brief.product} — ${brief.mood}, dramatic lighting, centered composition, premium feel` },
      { prompt: `${brief.product} in use — lifestyle setting, warm natural light, authentic moment, shallow depth of field` },
      { prompt: `Close-up detail of ${brief.product} — texture and craftsmanship visible, studio macro photography` },
      { prompt: `${brief.product} flat lay arrangement — top-down editorial styling with complementary props` },
    ],
    products: [brief.product],
  };

  if (mode === 'brand-images') {
    config.imageFormats = ['story', 'square', 'landscape'];
  }

  if (brief.price) {
    config.brief += ` Price: ${brief.price}.`;
  }

  // Save config
  const configPath = path.join(projectDir, 'config.json');
  await fs.ensureDir(projectDir);
  await fs.outputJson(configPath, config, { spaces: 2 });
  logger.success(`Config saved: ${configPath}`);

  return config;
}
