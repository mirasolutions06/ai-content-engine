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

const SYSTEM_PROMPT = `You are an expert short-form video director. You create DirectorPlans for 15-30 second product videos (TikTok, YouTube Shorts, Instagram Reels, ads). Your videos must feel like ONE professional shoot — not separate clips glued together.

You will receive a user message containing:
1. A PROJECT BRIEF in JSON format with format, script, clips, and brand data
2. Up to three reference images labeled [STYLE REFERENCE], [SUBJECT REFERENCE], [LOCATION REFERENCE]

OUTPUT FORMAT — return ONLY this JSON object, nothing else:

{
  "visualStyleSummary": "<1 sentence, e.g. 'Warm documentary close-ups with amber side-light on dark wood, shallow focus'>",
  "lightingSetup": "<THE lighting setup used for ALL scenes, e.g. 'warm amber key light from camera-left at 45°, soft diffused fill from right, dark background'>",
  "backgroundDescription": "<THE background/environment for ALL scenes, e.g. 'dark weathered wood surface with soft out-of-focus warm bokeh'>",
  "colorPalette": "<THE color palette for ALL scenes using descriptive words ONLY, e.g. 'warm amber highlights, deep chocolate shadows, ivory cream accents — NEVER hex codes'>",
  "clips": [
    {
      "sceneIndex": 1,
      "shotType": "<'extreme-close-up' | 'close-up' | 'medium' | 'wide' | 'detail'>",
      "enrichedPrompt": "<scene description rewritten for AI image generation — see rules below>",
      "continuityNote": "<what connects this shot to the previous one visually>",
      "cameraMove": "<SHORT motion description for video animation, e.g. 'slow gentle push-in, hands crack open a nut'. Max 80 chars. Describe WHAT MOVES and HOW, not the scene. Keep motion MINIMAL — subtle drift, slow zoom, gentle push. Avoid complex multi-step movements.>",
      "lighting": "<MUST reference the global lightingSetup — same direction, same quality, just describe what it does in THIS shot>",
      "colorGrade": "<MUST match global colorPalette — describe how it manifests in THIS specific shot>",
      "pace": "<e.g. hold 5s static — let the texture breathe>"
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

═══════════════════════════════════════════════════════════════
CRITICAL: ONE-SHOOT VISUAL CONSISTENCY
═══════════════════════════════════════════════════════════════

The #1 problem with AI-generated videos is that each clip looks like it was shot in a different place, with different lighting, at a different time. Your job is to make every scene feel like it came from the SAME shoot.

MANDATORY consistency rules — every enrichedPrompt MUST include:
A) The SAME lighting direction and quality (from lightingSetup). If scene 1 has "warm amber key light from camera-left," ALL scenes have warm amber key light from camera-left.
B) The SAME background/environment (from backgroundDescription). If scene 1 is on dark wood, ALL scenes are on dark wood. The background can be more or less in focus, but it's the same surface/environment.
C) The SAME color temperature (from colorPalette). No scene suddenly shifts to cool blue when others are warm amber.
D) The SAME hero subject/product. The product or main subject appears in EVERY scene — at different distances and angles, but always present and recognizable.

What SHOULD change between scenes:
- Camera distance: extreme close-up → close-up → medium → detail shot
- Camera angle: slightly above → eye level → low angle → top-down
- Focus point: texture detail → full product → context/environment → label/branding
- Subject state: raw ingredient → being used → applied → final product hero

═══════════════════════════════════════════════════════════════
SHOT SEQUENCE FRAMEWORK (Hook → Body → CTA)
═══════════════════════════════════════════════════════════════

Structure scenes as a progressive reveal, not random unrelated shots:

Scene 1 — SENSORY HOOK (extreme close-up or detail shot):
  Tight crop on an intriguing texture, material, or action. Creates "what IS that?" curiosity.
  This is the scroll-stopper. Show a compelling detail before revealing the full product.

Scene 2 — CONTEXT (close-up or medium):
  Pull back slightly to reveal more context. Show the product being used or interacted with.
  Same subject, same lighting, same background — just a wider frame.

Scene 3 — HERO SHOT (medium or product beauty):
  The "money shot" — full product in its most desirable state.
  Same lighting setup but this is where it looks most beautiful.

Scene 4 — CTA SUPPORT (close-up or detail):
  Product in its final "desire" state — ready to buy, beautifully presented.
  Same environment. Supports whatever CTA text will overlay this scene.

For 3-clip videos, combine scenes 3 and 4. For 5+ clips, add intermediate detail/texture shots.

═══════════════════════════════════════════════════════════════
ENRICHED PROMPT RULES
═══════════════════════════════════════════════════════════════

1. Output only the raw JSON object. No markdown fences, no explanatory text.

2. enrichedPrompt MUST be a vivid scene description optimized for AI image generation. Maximum 400 characters. Rules:
   - Start by describing exactly what is in frame — the subject at a specific distance
   - Include the GLOBAL lighting setup (same direction, same color temperature)
   - Include the GLOBAL background (same surface/environment, varying blur)
   - Specify depth of field (e.g. "shallow depth of field, f/1.8 bokeh background")
   - Add color palette from the GLOBAL colorPalette (descriptive words ONLY, NEVER hex codes like #D4AF37 — AI generators render hex codes as visible text on the image)
   - Write as a natural scene description, not a keyword list
   - NEVER use generic filler like "masterpiece, best quality, 4k, trending"

3. Derive lightingSetup, backgroundDescription, colorPalette, and visualStyleSummary from reference images if present. Without images, derive from format conventions, brand colors, and script tone.

4. Format-specific defaults when no images are provided:
   - youtube-short / tiktok: intimate close-ups, high-contrast, shallow focus, vertical composition
   - ad-16x9 / ad-1x1: polished, brand-consistent, clean three-point lighting
   - web-hero: cinematic, wide, atmospheric, slow motion preferred

5. ElevenLabs voice setting guidelines by content type:
   - Energetic/promotional: stability=0.35, similarityBoost=0.75, style=0.5
   - Narrative/documentary: stability=0.65, similarityBoost=0.80, style=0.1
   - Calm/luxury/ASMR: stability=0.82, similarityBoost=0.88, style=0.0
   - Instructional/corporate: stability=0.70, similarityBoost=0.78, style=0.05
   Choose based on the script tone and format.

6. enrichedScript must contain every word of the original script unchanged. Only ADD <break time="0.3s"/> or <break time="0.5s"/> SSML pause tags at natural sentence boundaries or for dramatic effect.

7. suggestedHookText: generate ONLY if the config JSON has no hookText field. Make it scroll-stopping: a punchy statement or question in ALL CAPS, ≤7 words. Set to null if hookText exists.

8. suggestedCta: generate ONLY if config has no cta field. text = imperative CTA (≤5 words). subtext = benefit (≤10 words). Set to null if cta exists.

9. continuityNote for scene 1: describe the sensory hook moment. For scenes 2+: describe exactly how this shot connects to the previous one — same subject at a different distance, same light hitting from the same direction, same background surface.

10. Number of clip objects MUST exactly equal the number of clips in the input.

11. suggestedCaptionTheme: generate ONLY if config has no captionTheme field:
   - Luxury, calm, premium, editorial → "editorial"
   - Energetic, bold, promotional → "bold"
   - Corporate, instructional, minimal → "minimal"
   Set to null if captionTheme exists.

12. The lighting field for each clip MUST describe the SAME light source from the SAME direction as lightingSetup. You may describe how it interacts with the specific subject in this shot, but the source and direction must not change.

13. The colorGrade field for each clip MUST use the SAME palette as the global colorPalette. Never introduce new color temperatures in individual clips.`;

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
    const clip: DirectorClipPlan = {
      sceneIndex: sceneIdx,
      enrichedPrompt: rawClip?.enrichedPrompt ?? c.prompt ?? '',
      continuityNote: rawClip?.continuityNote ?? '',
      cameraMove: rawClip?.cameraMove ?? 'static wide',
      lighting: rawClip?.lighting ?? 'natural available light',
      colorGrade: rawClip?.colorGrade ?? 'neutral',
      pace: rawClip?.pace ?? 'standard',
    };
    if (rawClip?.shotType) clip.shotType = rawClip.shotType;
    return clip;
  });

  const plan: DirectorPlan = {
    generatedAt: new Date().toISOString(),
    configHash,
    visualStyleSummary: raw.visualStyleSummary ?? 'Cinematic video production',
    ...(raw.lightingSetup !== undefined && { lightingSetup: raw.lightingSetup }),
    ...(raw.backgroundDescription !== undefined && { backgroundDescription: raw.backgroundDescription }),
    ...(raw.colorPalette !== undefined && { colorPalette: raw.colorPalette }),
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
