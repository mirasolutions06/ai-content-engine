import crypto from 'crypto';
import path from 'path';
import fs from 'fs-extra';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger.js';
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

const DEFAULT_MODEL = 'claude-opus-4-6';

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
      "pace": "<e.g. hold 5s static — let the texture breathe>",
      "variationAngles": ["<alt camera angle or distance>", "<different lighting emphasis>", "<alternative composition or crop>"]
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

13. The colorGrade field for each clip MUST use the SAME palette as the global colorPalette. Never introduce new color temperatures in individual clips.

14. variationAngles: for EACH clip, suggest 3 short alternative creative directions (max 40 chars each). These are used for batch storyboard generation to give the user visual options. Examples: "low angle dramatic upward perspective", "tighter macro crop on texture detail", "warmer golden hour color temperature", "overhead top-down flat lay composition". Each angle should produce a meaningfully different image while maintaining the same subject, lighting direction, and background.

15. If the brief includes a "referenceVideoAnalysis" field, use it to DERIVE your style decisions — but BLEND with the user's own image references:
    - VIDEO ANALYSIS drives: camera moves, pacing, transitions, color grade, lighting style, overall mood. The reference video is the MOTION and STYLE target.
    - USER IMAGE REFS (product-*, model-*) drive: the actual subject/content. These are what appears in the video — the product, the person, the brand.
    - VIDEO REF FRAMES (videoref-*) are supplementary style references extracted from the reference video. Use them to reinforce the visual aesthetic.
    - The goal: "looks like MY product, moves like THEIR video." Match the reference video's cinematography and energy while featuring the user's actual products/models.

16. When writing enrichedPrompt, apply the relevant prompting framework:
    - UGC / talking heads → use realism techniques (natural skin, window light)
    - Cinematic / hero content → use SEAL CAM (Setting, Elements, Atmosphere, Lens, Camera Motion)
    - Product photography → use product guidelines (surface, scale, reflections)
    - Brand / lifestyle → use BOPA (Brand, Object, Person, Action)
    - If the brief includes "imageProvider", tailor prompts accordingly: GPT Image needs more explicit/literal descriptions, Gemini responds to photography terminology.`;

const BRAND_IMAGES_SYSTEM_PROMPT = `You are an expert brand photography art director. You create DirectorPlans for multi-format brand image campaigns. Each image set will be rendered in multiple aspect ratios (9:16 story, 1:1 square, 16:9 landscape), so compositions must work across crops.

Your images must feel like ONE professional photo shoot — not separate stock photos.

You will receive a user message containing:
1. A PROJECT BRIEF in JSON format with brand, brief, clips (image descriptions), and brand colors
2. Up to three reference images labeled [STYLE REFERENCE], [SUBJECT REFERENCE], [LOCATION REFERENCE]

OUTPUT FORMAT — return ONLY this JSON object, nothing else:

{
  "visualStyleSummary": "<1 sentence photography style, e.g. 'Warm editorial product photography on dark wood with golden amber side-light and shallow focus'>",
  "lightingSetup": "<THE lighting setup for ALL images, e.g. 'warm amber key light from camera-right at 45°, soft diffused fill, dark environment'>",
  "backgroundDescription": "<THE background/surface for ALL images, e.g. 'dark cracked wood planks with soft warm bokeh in deep background'>",
  "colorPalette": "<THE color palette for ALL images using descriptive words ONLY — NEVER hex codes like #D4AF37, AI generators render these as visible text>",
  "clips": [
    {
      "sceneIndex": 1,
      "shotType": "<'hero' | 'detail' | 'lifestyle' | 'flat-lay' | 'texture'>",
      "enrichedPrompt": "<image description rewritten for AI image generation — see rules below>",
      "continuityNote": "<what connects this image to the visual series>",
      "composition": "<e.g. 'centered subject, rule of thirds negative space left, shallow DOF isolates product'>",
      "lighting": "<references global lightingSetup — same direction, same quality, describe for THIS image>",
      "colorGrade": "<references global colorPalette — describe how it manifests in THIS specific image>"
    }
  ],
  "suggestedHookText": "<≤7 words, ALL CAPS — scroll-stopping text for social posts, or null>",
  "suggestedCta": { "text": "<≤5 word action phrase>", "subtext": "<≤10 words>" }
}

═══════════════════════════════════════════════════════════════
CRITICAL: ONE-SHOOT VISUAL CONSISTENCY
═══════════════════════════════════════════════════════════════

The #1 problem with AI-generated images is inconsistency. Your job is to make every image feel like it came from the SAME visual system.

MANDATORY consistency rules — every enrichedPrompt MUST include:
A) The SAME lighting DIRECTION and QUALITY (from lightingSetup). The key light always comes from the same side with the same color temperature.
B) The SAME color temperature and palette (from colorPalette). No sudden shifts from warm to cool.
C) The SAME hero subject/product at different distances and angles.
D) BACKGROUND rule depends on the brief:
   - PRODUCT PHOTOGRAPHY (skincare, food, objects on surfaces): SAME background/surface for ALL images. This is critical for product consistency.
   - FASHION / LIFESTYLE / EDITORIAL (clothing, athleisure, person-focused campaigns): Environments MAY vary between images IF the brief describes multiple locations. What must stay consistent is the MATERIAL PALETTE (concrete, industrial, natural textures) and the LIGHTING SYSTEM. Different rooms/settings that share the same visual language = cohesive campaign. Same gym repeated 5 times = boring catalog.

What SHOULD change between images:
- Camera distance: extreme close-up → close-up → medium → wide → detail
- Focus point: texture detail → full product → context/environment
- Subject state: raw ingredient → product hero → in-use → final beauty shot
- For fashion/lifestyle: environment can shift (corridor → locker room → outdoor → apartment) while maintaining visual system consistency

═══════════════════════════════════════════════════════════════
ENRICHED PROMPT RULES
═══════════════════════════════════════════════════════════════

1. Output only the raw JSON object. No markdown fences, no explanatory text.

2. enrichedPrompt MUST be a vivid image description optimized for AI image generation. Maximum 400 characters. Rules:
   - Start by describing exactly what is in frame — the subject at a specific distance
   - Include the GLOBAL lighting setup (same direction, same color temperature)
   - For product photography: include the GLOBAL background (same surface/environment, varying blur)
   - For fashion/lifestyle: describe THIS scene's specific environment while maintaining the material palette and lighting system
   - Specify depth of field (e.g. "shallow depth of field, f/1.8 bokeh background")
   - Use the GLOBAL colorPalette (descriptive words ONLY, NEVER hex codes)
   - Write as a natural scene description, not a keyword list
   - NEVER use generic filler like "masterpiece, best quality, 4k, trending"

3. Derive lightingSetup, backgroundDescription, colorPalette from reference images if present. Without images, derive from the brand brief and clip prompts.

4. composition: describe the framing approach for THIS image. Consider that it will be cropped to story (9:16), square (1:1), and landscape (16:9) — center-weighted compositions survive all three crops best.

5. Number of clip objects MUST exactly equal the number of clips in the input.

6. Use the brand brief to understand the brand's identity, heritage, and visual tone. This is the most important context — let it guide your lighting, palette, and styling decisions.

7. When writing enrichedPrompt, apply the product photography framework:
   - Always describe surface material ("on white marble", "dark slate", "raw linen")
   - Specify reflection: "matte finish", "glossy catch light", "soft sheen"
   - One product per frame — multi-product confuses generators
   - Include scale reference when relevant (hands, objects nearby)

8. When a clip has "shotType" but no "prompt", generate a full enrichedPrompt appropriate for that shot type using the brand brief and product details. Shot types:
   - "product-hero": Full product beauty shot — the money shot. Product centered, best lighting, maximum desire.
   - "application-closeup": Product being applied or used. Close on hands, skin, or interaction. Intimate moment.
   - "lifestyle": Person using product in a natural setting. Environmental context, relaxed feel.
   - "flat-lay": Overhead editorial arrangement. Product with complementary props on a surface.
   - "texture-detail": Extreme close-up on material, texture, or surface quality. Sensory hook.
   - "portrait": Person-focused with product secondary. Face, expression, beauty.
   Write the enrichedPrompt as if the user had written a detailed prompt — natural, vivid, specific to the brand.

9. If the brief includes a "referenceVideoAnalysis" field, BLEND video style with the user's image references:
   - VIDEO ANALYSIS drives: color grade, lighting style, composition approach, mood. Match the reference video's visual aesthetic.
   - USER IMAGE REFS (product-*, model-*) drive: the actual subject/content appearing in images.
   - VIDEO REF FRAMES (videoref-*) are key frames from the reference video — use as supplementary style references.
   - Goal: "my products, their visual style." Match the reference video's look while featuring the user's actual products/models.`;

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
      pace: isBrandImages ? '' : (rawClip?.pace ?? 'standard'),
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
        ? (c.composition ?? 'centered subject').slice(0, 42)
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

    const basePrompt = isBrandImages ? BRAND_IMAGES_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const systemPrompt = BEST_PRACTICES_LOADED
      ? basePrompt + '\n\n## PROMPT BEST PRACTICES REFERENCE\n' + BEST_PRACTICES_LOADED
      : basePrompt;

    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: contentParts }],
    });

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
