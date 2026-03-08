import crypto from 'crypto';
import path from 'path';
import fs from 'fs-extra';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import type {
  VideoConfig,
  ProjectAssets,
  DirectorPlan,
  DirectorClipPlan,
  DirectorCacheEntry,
  BrandContext,
} from '../types/index.js';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are an expert video director and cinematographer AI. Your sole function is to analyze a video production brief and produce a structured DirectorPlan in JSON.

You will receive a user message containing:
1. A PROJECT BRIEF in JSON format with format, script, clips, and brand data
2. Up to three reference images labeled [STYLE REFERENCE], [SUBJECT REFERENCE], [LOCATION REFERENCE]

OUTPUT FORMAT — return ONLY this JSON object, nothing else:

{
  "visualStyleSummary": "<1 sentence, e.g. 'Cinematic dark editorial with warm amber tones and slow pacing'>",
  "clips": [
    {
      "sceneIndex": 1,
      "enrichedPrompt": "<original prompt text> — <camera move>, <lens>, <lighting>, <color treatment>, <atmosphere>",
      "continuityNote": "<for scene 1: describe the visual cold-open; for scene 2+: reference a specific visual element from the previous clip>",
      "cameraMove": "<e.g. slow push-in on subject face>",
      "lighting": "<e.g. golden hour rim light, soft fill, deep shadows>",
      "colorGrade": "<descriptive color words ONLY, e.g. desaturated blues, lifted blacks, warm orange skin tones — NEVER include hex codes>",
      "pace": "<e.g. hold 5s static — no movement, let scene breathe>"
    }
  ],
  "voice": {
    "stability": 0.65,
    "similarityBoost": 0.80,
    "style": 0.1,
    "enrichedScript": "<exact original script with optional <break time='0.5s'/> SSML tags added at natural pauses>"
  },
  "suggestedHookText": "<≤7 words, ALL CAPS, no trailing period — or null if hookText already in config>",
  "suggestedCta": { "text": "<≤5 word action phrase>", "subtext": "<≤10 words>" },
  "suggestedCaptionTheme": "<'bold' | 'editorial' | 'minimal' — or null if captionTheme already in config>"
}

STRICT RULES:
1. Output only the raw JSON object. No markdown fences, no explanatory text.
2. enrichedPrompt MUST be a vivid scene description optimized for AI image generation. Start with the original prompt text, then append " — " followed by cinematography enrichment. Maximum 400 characters total. Rules for the enrichment:
   - Describe ONE clear subject with specific material/texture cues (e.g. "raw golden shea butter with a matte, grainy texture")
   - Specify depth of field (e.g. "shallow depth of field, f/1.8 bokeh background")
   - Include lighting direction and quality (e.g. "warm side-light from the left, soft diffused fill")
   - Add color palette cues using descriptive color words ONLY (e.g. "earth tones with warm amber highlights against deep chocolate shadows"). NEVER include hex color codes like #D4AF37 — AI image generators render hex codes as visible text on the image.
   - Mention camera perspective naturally (e.g. "close-up from slightly above" not just "macro lens")
   - NEVER use generic filler like "masterpiece, best quality, 4k, trending" — be specific and descriptive
   - Write as a natural scene description, not a keyword list
3. Derive colorGrade, lighting, and visualStyleSummary from the reference images if present. Without images, derive from format style conventions, brand colors, and script tone.
4. Format-specific default styles when no images are provided:
   - youtube-short / tiktok: fast-paced, high-contrast, punchy cuts, vertical composition
   - ad-16x9 / ad-1x1: polished, brand-consistent, clean production
   - web-hero: cinematic, wide, atmospheric, slow motion preferred
5. ElevenLabs voice setting guidelines by content type:
   - Energetic/promotional: stability=0.35, similarityBoost=0.75, style=0.5
   - Narrative/documentary: stability=0.65, similarityBoost=0.80, style=0.1
   - Calm/luxury/ASMR: stability=0.82, similarityBoost=0.88, style=0.0
   - Instructional/corporate: stability=0.70, similarityBoost=0.78, style=0.05
   Choose based on the script tone and format.
6. enrichedScript must contain every word of the original script unchanged. Only ADD <break time="0.3s"/> or <break time="0.5s"/> SSML pause tags at natural sentence boundaries or for dramatic effect. Do not change wording.
7. suggestedHookText: generate ONLY if the config JSON has no hookText field. Make it scroll-stopping: a punchy statement or question in ALL CAPS, ≤7 words. Set to null if hookText exists in config.
8. suggestedCta: generate ONLY if config has no cta field. text should be an imperative call to action (≤5 words). subtext should give a reason or benefit (≤10 words). Set to null if cta exists.
9. Ensure visual continuity: continuityNote for scene 1 describes the visual cold-open moment. For scenes 2+, reference a specific element from the previous clip (color, subject position, motion direction, texture).
10. Number of clip objects in the output MUST exactly equal the number of clips in the input brief's clips array.
11. suggestedCaptionTheme: generate ONLY if config has no captionTheme field. Choose based on brand tone:
   - Luxury, calm, premium, editorial brands → "editorial" (clean underline accent, subtle shadows)
   - Energetic, bold, promotional, youth-oriented → "bold" (TikTok pill-style highlights)
   - Corporate, instructional, minimal branding → "minimal" (simple opacity-based)
   Set to null if captionTheme exists in config.`;

// ── Config hashing ────────────────────────────────────────────────────────────

function hashConfig(config: VideoConfig): string {
  const payload = JSON.stringify(config, Object.keys(config).sort());
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function getCachePath(projectsRoot: string, projectName: string): string {
  return path.join(projectsRoot, projectName, 'cache', 'director-plan.json');
}

async function loadCached(cachePath: string, configHash: string): Promise<DirectorPlan | null> {
  if (!(await fs.pathExists(cachePath))) return null;
  try {
    const entry = (await fs.readJson(cachePath)) as DirectorCacheEntry;
    if (entry.configHash !== configHash) {
      logger.info('Director: config changed since last run — regenerating plan.');
      return null;
    }
    return entry.plan;
  } catch {
    logger.warn('Director: cache unreadable — regenerating plan.');
    return null;
  }
}

async function saveToCache(cachePath: string, plan: DirectorPlan): Promise<void> {
  const entry: DirectorCacheEntry = {
    configHash: plan.configHash,
    plan,
    cachedAt: new Date().toISOString(),
  };
  await fs.ensureDir(path.dirname(cachePath));
  await fs.outputJson(cachePath, entry, { spaces: 2 });
}

// ── Brand context export ─────────────────────────────────────────────────────

async function saveBrandContext(
  plan: DirectorPlan,
  config: VideoConfig,
  projectsRoot: string,
  projectName: string,
): Promise<void> {
  const contextPath = path.join(projectsRoot, projectName, 'cache', 'brand-context.json');
  const context: BrandContext = {
    brandName: config.client ?? config.title,
    tone: plan.visualStyleSummary,
    visualStyle: plan.visualStyleSummary,
    hookText: plan.suggestedHookText ?? config.hookText ?? '',
    cta: plan.suggestedCta?.text ?? config.cta?.text ?? '',
    targetAudience: '',
    scenes: plan.clips.map((c) => ({
      index: c.sceneIndex,
      prompt: config.clips[c.sceneIndex - 1]?.prompt ?? '',
      enrichedPrompt: c.enrichedPrompt,
      mood: `${c.lighting}, ${c.colorGrade}`,
    })),
    voiceSettings: {
      stability: plan.voice.stability,
      style: plan.voice.style,
      similarityBoost: plan.voice.similarityBoost,
      toneDescription: `stability=${plan.voice.stability}, style=${plan.voice.style}`,
    },
  };
  await fs.outputJson(contextPath, context, { spaces: 2 });
  logger.info('Director: brand context saved to cache/brand-context.json');
}

// ── Reference image encoding ──────────────────────────────────────────────────

async function encodeImageForClaude(
  imagePath: string,
): Promise<Anthropic.ImageBlockParam | null> {
  if (!imagePath) return null;
  try {
    const buffer = await fs.readFile(imagePath);
    const base64 = buffer.toString('base64');
    // Detect actual format from magic bytes, not file extension
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    const mediaType = isPng ? 'image/png' : 'image/jpeg';
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    };
  } catch {
    logger.warn(`Director: could not encode image at ${imagePath} — skipping.`);
    return null;
  }
}

// ── Plan normalization (defensive parse) ──────────────────────────────────────

function normalizePlan(
  raw: Partial<DirectorPlan>,
  config: VideoConfig,
  configHash: string,
): DirectorPlan {
  const clips: DirectorClipPlan[] = config.clips.map((c, i) => {
    const sceneIdx = i + 1;
    const rawClip = (raw.clips ?? []).find((rc) => rc.sceneIndex === sceneIdx);
    return {
      sceneIndex: sceneIdx,
      enrichedPrompt: rawClip?.enrichedPrompt ?? c.prompt ?? '',
      continuityNote: rawClip?.continuityNote ?? '',
      cameraMove: rawClip?.cameraMove ?? 'static wide',
      lighting: rawClip?.lighting ?? 'natural available light',
      colorGrade: rawClip?.colorGrade ?? 'neutral',
      pace: rawClip?.pace ?? 'standard',
    };
  });

  const plan: DirectorPlan = {
    generatedAt: new Date().toISOString(),
    configHash,
    visualStyleSummary: raw.visualStyleSummary ?? 'Cinematic video production',
    clips,
    voice: {
      stability: raw.voice?.stability ?? 0.5,
      similarityBoost: raw.voice?.similarityBoost ?? 0.75,
      style: raw.voice?.style ?? 0,
      enrichedScript: raw.voice?.enrichedScript ?? config.script ?? '',
    },
  };

  // Only apply suggestions when config did NOT already have those values
  if (config.hookText === undefined && raw.suggestedHookText) {
    plan.suggestedHookText = raw.suggestedHookText;
  }
  if (config.cta === undefined && raw.suggestedCta) {
    plan.suggestedCta = raw.suggestedCta;
  }
  if (config.captionTheme === undefined && raw.suggestedCaptionTheme) {
    const valid = ['bold', 'editorial', 'minimal'] as const;
    const theme = raw.suggestedCaptionTheme as string;
    if (valid.includes(theme as typeof valid[number])) {
      plan.suggestedCaptionTheme = theme as typeof valid[number];
    }
  }

  return plan;
}

// ── Console logging ───────────────────────────────────────────────────────────

function logDirectorPlan(plan: DirectorPlan): void {
  const clipLines = plan.clips
    .map((c) => `│    Scene ${c.sceneIndex}: ${c.cameraMove.slice(0, 42).padEnd(42)}│`)
    .join('\n');

  const voiceLine =
    `stability=${plan.voice.stability.toFixed(2)}  ` +
    `style=${plan.voice.style.toFixed(2)}  ` +
    `sim=${plan.voice.similarityBoost.toFixed(2)}`;

  logger.info(
    `\n┌────────────────────────────────────────────────────┐\n` +
    `│  DIRECTOR PLAN                                     │\n` +
    `│  Style: ${plan.visualStyleSummary.slice(0, 43).padEnd(43)}│\n` +
    `│  Voice: ${voiceLine.padEnd(43)}│\n` +
    `│  Clips:                                            │\n` +
    clipLines + '\n' +
    (plan.suggestedHookText
      ? `│  Hook:  ${plan.suggestedHookText.slice(0, 43).padEnd(43)}│\n`
      : '') +
    (plan.suggestedCta
      ? `│  CTA:   ${plan.suggestedCta.text.slice(0, 43).padEnd(43)}│\n`
      : '') +
    `└────────────────────────────────────────────────────┘`,
  );

  for (const clip of plan.clips) {
    logger.info(`  Scene ${clip.sceneIndex} prompt: ${clip.enrichedPrompt.slice(0, 120)}`);
    if (clip.continuityNote) {
      logger.info(`  Scene ${clip.sceneIndex} continuity: ${clip.continuityNote}`);
    }
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Runs the Director step: calls GPT-4o with the full project brief and optional
 * reference images to produce a DirectorPlan with enriched prompts, voice settings,
 * and hook/CTA suggestions.
 *
 * Non-fatal — returns null if the API key is missing or the call fails,
 * allowing the pipeline to continue with raw config values.
 *
 * Caches the plan to cache/director-plan.json keyed by a config hash.
 * Re-runs with the same config.json are free (no GPT-4o call made).
 */
export async function runDirector(
  config: VideoConfig,
  assets: ProjectAssets,
  projectsRoot: string,
  projectName: string,
): Promise<DirectorPlan | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    logger.warn('Director: ANTHROPIC_API_KEY not set — skipping director step.');
    return null;
  }

  const configHash = hashConfig(config);
  const cachePath = getCachePath(projectsRoot, projectName);

  // ── Cache check ─────────────────────────────────────────────────────────────
  const cached = await loadCached(cachePath, configHash);
  if (cached !== null) {
    logger.skip(`Director: using cached plan (hash: ${configHash})`);
    await saveBrandContext(cached, config, projectsRoot, projectName);
    logDirectorPlan(cached);
    return cached;
  }

  // ── Build multimodal content for Claude ──────────────────────────────────────
  logger.step(`Director: calling ${MODEL} to generate production plan...`);

  const brief = {
    format: config.format,
    title: config.title,
    client: config.client,
    script: config.script,
    clips: config.clips.map((c, i) => ({
      sceneIndex: i + 1,
      prompt: c.prompt ?? '',
      duration: c.duration ?? 5,
    })),
    transition: config.transition,
    hookText: config.hookText,
    cta: config.cta,
    brandColors: assets.brandColors,
  };

  const contentParts: Anthropic.MessageParam['content'] = [
    { type: 'text', text: `PROJECT BRIEF:\n${JSON.stringify(brief, null, 2)}` },
  ];

  const referenceImages: Array<{ path: string; label: string }> = [
    { path: assets.styleReference ?? '', label: 'STYLE REFERENCE' },
    { path: assets.subjectReference ?? '', label: 'SUBJECT REFERENCE' },
    { path: assets.locationReference ?? '', label: 'LOCATION REFERENCE' },
  ];

  for (const ref of referenceImages) {
    if (!ref.path) continue;
    const encoded = await encodeImageForClaude(ref.path);
    if (encoded === null) continue;
    (contentParts as Anthropic.ContentBlockParam[]).push(
      { type: 'text', text: `[${ref.label}]` },
      encoded,
    );
  }

  // ── Claude call ───────────────────────────────────────────────────────────────
  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contentParts }],
    });

    const firstBlock = response.content[0];
    const rawJson = firstBlock?.type === 'text' ? firstBlock.text : null;
    if (!rawJson) throw new Error('Claude returned empty content');

    // Strip any accidental markdown fences before parsing
    const cleaned = rawJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Partial<DirectorPlan>;
    const plan = normalizePlan(parsed, config, configHash);

    await saveToCache(cachePath, plan);
    await saveBrandContext(plan, config, projectsRoot, projectName);
    logDirectorPlan(plan);

    return plan;
  } catch (err) {
    logger.warn(
      `Director: Claude call failed — falling back to raw config prompts. Error: ${String(err)}`,
    );
    return null;
  }
}
