import crypto from 'crypto';
import path from 'path';
import fs from 'fs-extra';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
import { retryWithBackoff } from '../utils/retry.js';
import { loadBrandMemory, getDirectorContext } from '../utils/brand-memory.js';
import { loadSkillMemory, getSkillDirectorContext } from '../utils/skill-memory.js';
import type {
  VideoConfig,
  VideoAnalysis,
  ProjectAssets,
  DirectorPlan,
  DirectorClipPlan,
  DirectorCacheEntry,
  BrandContext,
  PipelineMode,
} from '../types/index.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// ── Shared system prompt base ────────────────────────────────────────────────

const SHARED_SYSTEM_PROMPT = `You are a photography director. The user's config prompts describe WHAT is in the scene. Your job is to describe HOW to photograph it — add lighting direction, lens choice, depth of field, color temperature, and camera position. NEVER change the setting, subject, or action the user described. If the prompt says "parking garage," your enrichedPrompt describes a parking garage with beautiful photography. If it says "bedroom," it stays a bedroom.

You will receive a PROJECT BRIEF in JSON format with clips and brand data, plus optional reference images.

Output ONLY a raw JSON object, no markdown fences, no explanatory text.

BASE OUTPUT SCHEMA (mode-specific fields added below):
{
  "visualStyleSummary": "<1 sentence, e.g. 'Warm editorial product photography on dark wood with golden amber side-light and shallow focus'>",
  "lightingSetup": "<THE lighting for ALL scenes, e.g. 'warm amber key light from camera-left at 45°, soft diffused fill'>",
  "backgroundDescription": "<THE background for ALL scenes, e.g. 'dark weathered wood surface with soft warm bokeh'>",
  "colorPalette": "<descriptive words ONLY, e.g. 'warm amber highlights, deep chocolate shadows, ivory cream accents' — NEVER hex codes>",
  "clips": [
    {
      "sceneIndex": 1,
      "enrichedPrompt": "<scene description rewritten for AI image generation, max 400 chars>"
    }
  ]
}

═══ VISUAL CONSISTENCY ═══

Every scene must feel like the SAME shoot. Every enrichedPrompt MUST include:
- The SAME lighting direction and quality (from lightingSetup). If scene 1 has "warm amber key light from camera-left," ALL scenes do.
- The SAME background/environment (from backgroundDescription). Exception: fashion/lifestyle campaigns may vary environments IF the brief describes multiple locations — but the material palette and lighting system stay consistent.
- The SAME color temperature (from colorPalette). No sudden shifts.
- The SAME hero subject/product at different distances and angles.

What SHOULD change: camera distance, camera angle, focus point, subject state.

═══ REALISM ═══

Scenes must be plausibly shootable. Enhance the PHOTOGRAPHY (lighting, angle, DOF), not the SETTING — if the config says "bedroom," write a bedroom with beautiful photography. Creative impact comes from HOW you shoot, not WHERE. If a reference video is provided, match its production scope.

═══ ENRICHED PROMPT RULES ═══

enrichedPrompt: vivid scene description for AI image generation, max 400 chars.
- Start with what is in frame — subject at a specific distance
- Include the GLOBAL lighting setup (same direction, same color temperature)
- Include the GLOBAL background (same surface/environment, varying blur)
- Specify depth of field with lens language (e.g. "85mm f/1.4 shallow focus")
- Use color palette as descriptive words ONLY — NEVER hex codes (AI renders them as visible text)
- Write as a natural scene description, not a keyword list
- NEVER use filler like "masterpiece, best quality, 4k, trending"

Derive lightingSetup, backgroundDescription, colorPalette from reference images when present. Without images, derive from brief, brand colors, and script tone.

Number of clip objects MUST exactly equal the number of clips in the input.

═══ PROMPT QUALITY ═══

Every enrichedPrompt must name: the exact surface or environment, the light source direction and color temperature, the lens focal length and aperture. Generic language ("dramatic lighting", "luxury aesthetic", "beautiful composition") tells the generator nothing and produces mediocre output. Derive all specifics from the brief and reference images.

═══ OPTICAL PHYSICS ═══

enrichedPrompts must specify lens behavior that matches real optics:

- 85mm f/1.4: smooth graduated bokeh, razor-thin focal plane, background practicals dissolve into soft circles
- 24mm ultra-wide: exaggerated perspective, converging lines, environments feel vast and oppressive
- 35mm: natural field of view, moderate distortion, good for environmental portraits
- Objects on the same focal plane are equally sharp; things closer or further fall off smoothly`;

// ── Mode-specific addenda ────────────────────────────────────────────────────

const VIDEO_ADDENDUM = `
═══ VIDEO MODE — ADDITIONAL OUTPUT FIELDS ═══

Your output JSON must also include these fields for video mode:

Per-clip additional fields:
  "cameraMove": "<SHORT motion description for video animation, e.g. 'slow gentle push-in, hands crack open a nut'. Max 80 chars. Describe WHAT MOVES and HOW. Keep motion MINIMAL — subtle drift, slow zoom, gentle push.>",
  "continuityNote": "<what connects this shot to the previous one visually>",
  "lighting": "<references global lightingSetup — same direction, same quality, for THIS shot>",
  "colorGrade": "<references global colorPalette — how it manifests in THIS shot>"

Top-level additional fields:
  "voice": {
    "stability": <float>,
    "similarityBoost": <float>,
    "style": <float>,
    "enrichedScript": "<exact original script with optional <break time='0.5s'/> SSML tags at natural pauses>"
  },
  "suggestedHookText": "<≤7 words, ALL CAPS — or null if hookText already in config>",
  "suggestedCta": { "text": "<≤5 words>", "subtext": "<≤10 words>" },
  "suggestedCaptionTheme": "<'bold' | 'editorial' | 'minimal' — or null if captionTheme already in config>"

Voice setting guidelines:
  - Energetic/promotional: stability=0.35, similarityBoost=0.75, style=0.5
  - Narrative/documentary: stability=0.65, similarityBoost=0.80, style=0.1
  - Calm/luxury/ASMR: stability=0.82, similarityBoost=0.88, style=0.0

enrichedScript must contain every word of the original script unchanged. Only ADD SSML pause tags.

If the brief includes "referenceVideoAnalysis", BLEND video style with user image refs:
  - Video analysis drives: camera moves, pacing, color grade, lighting style, mood.
  - User image refs (product-*, model-*) drive: actual subject/content.
  - Goal: "looks like MY product, moves like THEIR video."
  - Match the reference video's production scope — do NOT escalate beyond it.`;

const BRAND_IMAGES_ADDENDUM = `
═══ BRAND IMAGES MODE — ADDITIONAL OUTPUT FIELDS ═══

Your output JSON must also include these fields for brand-images mode:

Per-clip additional fields:
  "lighting": "<references global lightingSetup — same direction, same quality, for THIS image>",
  "colorGrade": "<references global colorPalette — how it manifests in THIS image>"

Top-level additional fields:
  "suggestedHookText": "<≤7 words, ALL CAPS — or null>",
  "suggestedCta": { "text": "<≤5 words>", "subtext": "<≤10 words>" }

Images will be cropped to multiple aspect ratios (9:16, 1:1, 16:9) — center-weighted compositions survive all crops best.

Product photography specifics:
  - Always describe surface material ("dark weathered wood", "dark slate", "raw linen")
  - One product per frame — multi-product confuses generators
  - Include scale reference when relevant (hands, objects nearby)

Fashion/lifestyle background rule:
  - Product campaigns: SAME background for ALL images
  - Fashion campaigns: environments MAY vary IF the brief describes multiple locations, but material palette and lighting system stay consistent

When a clip has "shotType" but no "prompt", generate a full enrichedPrompt using the brand brief and product details. Write it as if the user had written a detailed, vivid, brand-specific prompt.

If the brief includes "referenceVideoAnalysis", match its visual aesthetic while featuring the user's actual products/models. The reference video IS the ceiling for production scope.`;

let BEST_PRACTICES_LOADED = '';



// ── Config hashing ────────────────────────────────────────────────────────────

function hashConfig(config: VideoConfig, videoAnalysisHash?: string): string {
  const bestPracticesHash = BEST_PRACTICES_LOADED
    ? crypto.createHash('sha256').update(BEST_PRACTICES_LOADED).digest('hex').slice(0, 8)
    : '';
  const payload = JSON.stringify(
    {
      ...config,
      ...(videoAnalysisHash !== undefined && { _videoAnalysisHash: videoAnalysisHash }),
      ...(bestPracticesHash && { _bestPracticesHash: bestPracticesHash }),
    },
    Object.keys(config).sort(),
  );
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Loads the prompt best practices file if available.
 * Called once at the start of runDirector.
 */
async function loadBestPractices(projectsRoot: string): Promise<void> {
  const bestPracticesPath = path.join(projectsRoot, '_shared', 'prompt-best-practices.md');
  if (await fs.pathExists(bestPracticesPath)) {
    BEST_PRACTICES_LOADED = await fs.readFile(bestPracticesPath, 'utf8');
  }
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
  const isBrandImages = (config.mode ?? 'video') === 'brand-images';
  const contextPath = path.join(projectsRoot, projectName, 'cache', 'brand-context.json');
  const context: BrandContext = {
    brandName: config.brand ?? config.client ?? config.title,
    tone: plan.visualStyleSummary,
    visualStyle: plan.visualStyleSummary,
    hookText: plan.suggestedHookText ?? config.hookText ?? '',
    cta: plan.suggestedCta?.text ?? config.cta?.text ?? '',
    targetAudience: '',
    ...(plan.lightingSetup && { lightingSetup: plan.lightingSetup }),
    ...(plan.backgroundDescription && { backgroundDescription: plan.backgroundDescription }),
    ...(plan.colorPalette && { colorPalette: plan.colorPalette }),
    scenes: plan.clips.map((c) => ({
      index: c.sceneIndex,
      prompt: config.clips[c.sceneIndex - 1]?.prompt ?? '',
      enrichedPrompt: c.enrichedPrompt,
      mood: `${c.lighting}, ${c.colorGrade}`,
    })),
    voiceSettings: isBrandImages
      ? { stability: 0, style: 0, similarityBoost: 0, toneDescription: '' }
      : {
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
  const isBrandImages = (config.mode ?? 'video') === 'brand-images';

  const clips: DirectorClipPlan[] = config.clips.map((c, i) => {
    const sceneIdx = i + 1;
    const rawClip = (raw.clips ?? []).find((rc) => rc.sceneIndex === sceneIdx);
    const clip: DirectorClipPlan = {
      sceneIndex: sceneIdx,
      enrichedPrompt: rawClip?.enrichedPrompt ?? c.prompt ?? '',
      continuityNote: rawClip?.continuityNote ?? '',
      cameraMove: isBrandImages ? '' : (rawClip?.cameraMove ?? 'static wide'),
      lighting: rawClip?.lighting ?? 'natural available light',
      colorGrade: rawClip?.colorGrade ?? 'neutral',
      pace: rawClip?.pace ?? '',
    };
    if (rawClip?.shotType) clip.shotType = rawClip.shotType;
    if (rawClip?.composition) clip.composition = rawClip.composition;
    if (!isBrandImages && rawClip?.variationAngles) clip.variationAngles = rawClip.variationAngles;
    return clip;
  });

  const plan: DirectorPlan = {
    generatedAt: new Date().toISOString(),
    configHash,
    visualStyleSummary: raw.visualStyleSummary ?? (isBrandImages ? 'Brand photography' : 'Cinematic video production'),
    ...(raw.lightingSetup !== undefined && { lightingSetup: raw.lightingSetup }),
    ...(raw.backgroundDescription !== undefined && { backgroundDescription: raw.backgroundDescription }),
    ...(raw.colorPalette !== undefined && { colorPalette: raw.colorPalette }),
    clips,
    voice: {
      stability: isBrandImages ? 0 : (raw.voice?.stability ?? 0.5),
      similarityBoost: isBrandImages ? 0 : (raw.voice?.similarityBoost ?? 0.75),
      style: isBrandImages ? 0 : (raw.voice?.style ?? 0),
      enrichedScript: isBrandImages ? '' : (raw.voice?.enrichedScript ?? config.script ?? ''),
    },
  };

  // Only apply suggestions when config did NOT already have those values
  if (config.hookText === undefined && raw.suggestedHookText) {
    plan.suggestedHookText = raw.suggestedHookText;
  }
  if (config.cta === undefined && raw.suggestedCta) {
    plan.suggestedCta = raw.suggestedCta;
  }
  if (!isBrandImages && config.captionTheme === undefined && raw.suggestedCaptionTheme) {
    const valid = ['bold', 'editorial', 'minimal'] as const;
    const theme = raw.suggestedCaptionTheme as string;
    if (valid.includes(theme as typeof valid[number])) {
      plan.suggestedCaptionTheme = theme as typeof valid[number];
    }
  }

  return plan;
}

// ── Console logging ───────────────────────────────────────────────────────────

function logDirectorPlan(plan: DirectorPlan, mode: PipelineMode = 'video'): void {
  const isBrandImages = mode === 'brand-images';

  const clipLines = plan.clips
    .map((c) => {
      const detail = isBrandImages
        ? c.enrichedPrompt.slice(0, 42)
        : c.cameraMove.slice(0, 42);
      const label = isBrandImages ? 'Image' : 'Scene';
      return `│    ${label} ${c.sceneIndex}: ${detail.padEnd(42)}│`;
    })
    .join('\n');

  const headerLabel = isBrandImages ? 'BRAND PHOTOGRAPHY PLAN' : 'DIRECTOR PLAN';

  let box =
    `\n┌────────────────────────────────────────────────────┐\n` +
    `│  ${headerLabel.padEnd(50)}│\n` +
    `│  Style: ${plan.visualStyleSummary.slice(0, 43).padEnd(43)}│\n`;

  if (!isBrandImages) {
    const voiceLine =
      `stability=${plan.voice.stability.toFixed(2)}  ` +
      `style=${plan.voice.style.toFixed(2)}  ` +
      `sim=${plan.voice.similarityBoost.toFixed(2)}`;
    box += `│  Voice: ${voiceLine.padEnd(43)}│\n`;
  }

  box +=
    `│  ${(isBrandImages ? 'Images:' : 'Clips:').padEnd(50)}│\n` +
    clipLines + '\n';

  if (plan.suggestedHookText) {
    box += `│  Hook:  ${plan.suggestedHookText.slice(0, 43).padEnd(43)}│\n`;
  }
  if (plan.suggestedCta) {
    box += `│  CTA:   ${plan.suggestedCta.text.slice(0, 43).padEnd(43)}│\n`;
  }
  box += `└────────────────────────────────────────────────────┘`;

  logger.info(box);

  const label = isBrandImages ? 'Image' : 'Scene';
  for (const clip of plan.clips) {
    logger.info(`  ${label} ${clip.sceneIndex} prompt: ${clip.enrichedPrompt.slice(0, 120)}`);
    if (clip.continuityNote) {
      logger.info(`  ${label} ${clip.sceneIndex} continuity: ${clip.continuityNote}`);
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
  videoAnalysis?: VideoAnalysis,
): Promise<DirectorPlan | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    logger.warn('Director: ANTHROPIC_API_KEY not set — skipping director step.');
    return null;
  }

  // Load best practices for system prompt enrichment and hash invalidation
  await loadBestPractices(projectsRoot);

  const configHash = hashConfig(config, videoAnalysis?.sourceHash);
  const cachePath = getCachePath(projectsRoot, projectName);
  const mode: PipelineMode = config.mode ?? 'video';
  const isBrandImages = mode === 'brand-images';

  // ── Cache check ─────────────────────────────────────────────────────────────
  const cached = await loadCached(cachePath, configHash);
  if (cached !== null) {
    logger.skip(`Director: using cached plan (hash: ${configHash})`);
    await saveBrandContext(cached, config, projectsRoot, projectName);
    logDirectorPlan(cached, mode);
    return cached;
  }

  // ── Build multimodal content for Claude ──────────────────────────────────────

  const model = config.directorModel ?? DEFAULT_MODEL;
  logger.step(`Director: calling ${model} as ${isBrandImages ? 'photography art director' : 'video director'}...`);

  const brief = isBrandImages
    ? {
      mode: 'brand-images',
      brand: config.brand ?? config.client ?? config.title,
      brief: config.brief,
      title: config.title,
      clips: config.clips.map((c, i) => ({
        sceneIndex: i + 1,
        prompt: c.prompt ?? '',
        ...(c.shotType !== undefined && { shotType: c.shotType }),
      })),
      imageFormats: config.imageFormats ?? ['story', 'square', 'landscape'],
      brandColors: assets.brandColors,
      ...(config.imageProvider !== undefined && { imageProvider: config.imageProvider }),
    }
    : {
      brief: config.brief,
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
      ...(config.imageProvider !== undefined && { imageProvider: config.imageProvider }),
      ...(videoAnalysis !== undefined && { referenceVideoAnalysis: videoAnalysis }),
    };

  const contentParts: Anthropic.MessageParam['content'] = [
    { type: 'text', text: `PROJECT BRIEF:\n${JSON.stringify(brief, null, 2)}` },
  ];

  const referenceImages: Array<{ path: string; label: string }> = [
    { path: assets.styleReference ?? '', label: 'STYLE REFERENCE' },
    { path: assets.subjectReference ?? '', label: 'SUBJECT REFERENCE' },
    { path: assets.modelReference ?? '', label: 'MODEL REFERENCE' },
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

  // ── Inject brand memory + skill memory context ────────────────────────────────
  const brandName = config.brand ?? config.client ?? config.title;
  if (brandName) {
    const brandMemory = await loadBrandMemory(brandName);
    if (brandMemory && brandMemory.insights.runCount > 0) {
      (contentParts as Anthropic.ContentBlockParam[]).push(
        { type: 'text', text: getDirectorContext(brandMemory) },
      );
      logger.info(`Director: loaded brand memory for "${brandName}" (${brandMemory.insights.runCount} runs, avg ${brandMemory.insights.avgScore}/5)`);
    }
  }

  const skillMemory = await loadSkillMemory();
  if (skillMemory && skillMemory.totalRuns > 0) {
    (contentParts as Anthropic.ContentBlockParam[]).push(
      { type: 'text', text: getSkillDirectorContext(skillMemory) },
    );
  }

  // ── Claude call ───────────────────────────────────────────────────────────────
  try {
    const client = new Anthropic({ apiKey });

    const basePrompt = SHARED_SYSTEM_PROMPT + '\n' + (isBrandImages ? BRAND_IMAGES_ADDENDUM : VIDEO_ADDENDUM);
    const systemPrompt = BEST_PRACTICES_LOADED
      ? basePrompt + '\n\n## PROMPT BEST PRACTICES REFERENCE\n' + BEST_PRACTICES_LOADED
      : basePrompt;

    const response = await retryWithBackoff(
      () => client.messages.create({
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentParts }],
      }),
      { attempts: 3, delayMs: 3000, label: 'Director Claude call' },
    );

    const firstBlock = response.content[0];
    const rawJson = firstBlock?.type === 'text' ? firstBlock.text : null;
    if (!rawJson) throw new Error('Claude returned empty content');

    if (response.stop_reason === 'max_tokens') {
      logger.warn('Director: response was truncated (token limit). Attempting partial JSON recovery...');
    }

    // Strip any accidental markdown fences before parsing
    let cleaned = rawJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

    // Attempt to parse, with recovery for truncated JSON
    let parsed: Partial<DirectorPlan>;
    try {
      parsed = JSON.parse(cleaned) as Partial<DirectorPlan>;
    } catch {
      // Truncated JSON recovery: close open structures so normalizePlan can salvage partial data
      cleaned = cleaned.replace(/,\s*$/, ''); // trailing comma
      // Close any unclosed string literal
      if (cleaned.split('"').length % 2 === 0) cleaned += '"';
      // Close unclosed arrays and objects
      const openBrackets = (cleaned.match(/\[/g) ?? []).length - (cleaned.match(/]/g) ?? []).length;
      const openBraces = (cleaned.match(/{/g) ?? []).length - (cleaned.match(/}/g) ?? []).length;
      cleaned += ']'.repeat(Math.max(0, openBrackets));
      cleaned += '}'.repeat(Math.max(0, openBraces));
      try {
        parsed = JSON.parse(cleaned) as Partial<DirectorPlan>;
        logger.info('Director: recovered partial plan from truncated response.');
      } catch (parseErr) {
        throw new Error(`JSON parse failed even after recovery: ${String(parseErr)}`);
      }
    }

    const plan = normalizePlan(parsed, config, configHash);

    await saveToCache(cachePath, plan);
    await saveBrandContext(plan, config, projectsRoot, projectName);
    logDirectorPlan(plan, mode);

    return plan;
  } catch (err) {
    logger.warn(
      `Director: Claude call failed — falling back to raw config prompts. Error: ${String(err)}`,
    );
    return null;
  }
}
