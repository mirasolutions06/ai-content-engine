---
name: brief-generator
description: "Generates a complete project config.json from a natural language brief. Use this skill whenever someone wants to create content for a brand or product, start a new project, or set up a campaign. Triggers on: 'create a brief', 'new project', 'generate content for', 'start a campaign', 'make a video for', 'content for [product]', 'create a config', 'set up [brand]', or any request involving content creation for a brand/product that doesn't already have a project folder. When in doubt, use this skill first — it's the entry point for all content production."
---

# Brief Generator

You are the entry point for the AI Content Engine. Your job is to take a natural language description of a brand, product, or campaign and produce a valid `config.json` that the pipeline can execute.

## Workflow

### Step 1: Gather Input

Ask the user for these details. Only the first two are required — infer the rest from research if not provided.

**Required:**
- Brand/product name
- What they sell or do (one sentence)

**Optional (ask but don't block on):**
- Target audience (e.g. "women 25-40 interested in skincare")
- Target platforms (Instagram, TikTok, YouTube, LinkedIn — default: all)
- Website URL (enables auto color extraction)
- Reference images (product photos, mood boards)
- Budget sensitivity (low / normal / high — affects clip count)
- Competitor URLs (for differentiation research)
- Preferred video format: `youtube-short`, `tiktok`, `ad-16x9`, `ad-1x1`, `web-hero`

### Step 2: Research

Use web search to inform the brief. Search for:

1. **Brand website** — if a URL was given, fetch it to understand visual tone and messaging
2. **Competitor content** — search `"{niche}" content marketing examples` to find what's working
3. **Platform trends** — search `"{platform}" trending content {niche} 2026` for each target platform
4. **Voice and tone** — use the brand's own website copy to match their voice

This research directly informs scene prompts, script tone, and CTA strategy.

### Step 3: Choose Mode

Select the pipeline mode based on what the user wants:

| User intent | Mode | What it produces |
|---|---|---|
| Social media posts (images only) | `brand-images` | Multi-format brand images (story, square, landscape) |
| Video content (TikTok, YouTube Short, ad) | `video` | Full video with voiceover, captions, transitions |
| Both images AND video | `full` | Brand images + full video pipeline |
| Instagram content (feed + reels) | `full` | Images for feed posts + video for reels |
| "Just images" or "no video" | `brand-images` | Image-only mode |
| Unclear or wants everything | `full` | Maximum output — gives them everything |

### Step 4: Generate config.json

Produce a valid JSON file matching the `VideoConfig` TypeScript interface. Here is the exact schema:

```json
{
  "mode": "video | brand-images | full",
  "format": "youtube-short | tiktok | ad-16x9 | ad-1x1 | web-hero",
  "title": "project-slug-used-in-filenames",
  "client": "Brand Name (or website URL for auto color extraction)",
  "brand": "Brand Name (used in Gemini prompts for brand-images mode)",
  "brief": "One-paragraph brand description and campaign context for Gemini",
  "script": "Voiceover narration text. Only include if mode is 'video' or 'full'. Write at ~2.5 words/second: 40-75 words for 15-30s shorts, 75-150 words for 30-60s ads.",
  "voiceId": "ElevenLabs voice ID — only if script is provided. Ask user to run 'npm start -- --project X --list-voices' if they don't know their voice ID.",
  "clips": [
    {
      "prompt": "Visual scene description, 50-300 chars. See prompt rules below.",
      "duration": 5,
      "outputType": "image | video | animation"
    }
  ],
  "transition": "crossfade | cut | wipe",
  "captions": true,
  "captionStyle": "word-by-word | line-by-line",
  "captionPosition": "bottom | center | top",
  "captionTheme": "bold | editorial | minimal",
  "hookText": "SCROLL-STOPPING HOOK IN ALL CAPS, 7 WORDS MAX",
  "cta": {
    "text": "Action phrase, 5 words max",
    "subtext": "Benefit statement, 10 words max"
  },
  "music": true,
  "musicVolume": 0.15,
  "imageFormats": ["story", "square", "landscape"],
  "imageProvider": "gemini | gpt-image",
  "videoProvider": "kling-v2.1 | kling-v3 | veo-3.1 | veo-3.1-fast",
  "klingVersion": "v2.1 | v3",
  "colorUnify": false,
  "colorUnifyOpacity": 0.06
}
```

**Fields to omit when not applicable:**
- `script` and `voiceId`: omit entirely if mode is `brand-images`
- `hookText`: omit if not relevant (Director will suggest one)
- `cta`: omit if not relevant (Director will suggest one)
- `imageFormats`: omit to use default `["story", "square", "landscape"]`
- `captionPosition`: omit to use default `"bottom"`
- `captionTheme`: omit to let the Director auto-select based on brand tone. Set explicitly to override. Options: `bold` (TikTok pill-style highlights), `editorial` (clean luxury underline accent), `minimal` (simple opacity-based)
- `imageProvider`: omit for default `"gemini"`. Set to `"gpt-image"` for GPT Image 1 (~$0.04-0.08/frame, more literal/explicit style). Project-level — applies to all clips.
- `videoProvider`: omit for default `"kling-v2.1"`. Options: `"kling-v3"` (better motion, ~2.3x more), `"veo-3.1"` (Google, longer clips 4-8s), `"veo-3.1-fast"` (cheaper Veo).
- `outputType` per clip: omit for default based on mode (`"video"` for video mode, `"image"` for brand-images). Set to `"image"` for stills, `"animation"` for short subtle motion (clamped to 5s max).
- `duration` per clip: omit for default `5`. Any number 1-15. Veo maps to 4/6/8s; Kling to 5/10s.
- `klingVersion`: omit for default `"v2.1"` (cheaper, ~$0.49/5s clip). Set to `"v3"` for higher quality with multi-shot storyboards (~$1.12/5s clip, ~2.3x more expensive). v3 produces smoother transitions and better motion quality. Prefer `videoProvider` over this field.
- `colorUnify`: omit for default `false`. Set to `true` to apply a subtle brand-colored overlay on clips to unify color temperature across different Kling-generated scenes.
- `colorUnifyOpacity`: omit for default `0.06` (6%). Adjust 0-1 if color unity overlay is too strong or subtle.

### Brand-Images Config Best Practices

These fields are critical for brand-images mode quality:

**`products` field (strongly recommended):**
List the exact product(s) in the campaign. Prevents Gemini from inventing phantom products.
```json
"products": ["amber glass dropper serum bottle"]
```

**`skipAutoRefs` field (use when appropriate):**
Skip auto-generated style/location references when they're not needed. Product-only campaigns with no model or specific location should skip both to avoid polluting generation with low-quality auto-refs.
```json
"skipAutoRefs": ["style", "location"]
```

**Reference images (the biggest quality lever):**
Provide specific reference images in the project directory. Named files get labeled instructions in the Gemini prompt:
- `model-1.jpg`, `model-2.jpg` — person's face/features (CRITICAL for multi-person scenes)
- `product-1.jpg`, `product-2.jpg` — exact product appearance
- `style.jpg` — visual mood reference
- `location.jpg` — environment reference

More refs = better consistency. Nike used 6 refs (3 shoe angles, model, top, tights) and got campaign-grade results. Ama Shea used zero refs and still scored 4.5-5.0/5 with good prompts.

**Prompt style for brand-images:**
Write LOOSE, evocative prompts — not hyper-specific product descriptions. The Director will enrich them with cinematography detail. Over-specifying (exact materials, exact compositions) constrains Gemini and degrades output.

Good: `"Hero product shot on dark weathered wood surface, surrounded by raw shea nuts and dried botanicals, warm golden-amber key light from camera-right, shallow depth of field, editorial product photography"`

Bad: `"Glass jar of whipped shea body butter with wooden lid on dark weathered wood, raw shea nuts and a small bowl of golden shea oil beside it, warm amber key light from camera-right at exactly 45 degrees, f/2.8 shallow depth of field"`

### Scene Prompt Rules

These are critical. Bad prompts waste expensive API calls. **The #1 quality issue is scenes that look like 4 different clips glued together.** Follow these rules to produce visually coherent content.

#### Visual Consistency (MOST IMPORTANT)

ALL scenes must share the SAME:
- **Lighting direction** — pick ONE setup (e.g. "soft window light from camera-left") and use it in every prompt
- **Background/surface** — pick ONE setting (e.g. "clean white marble surface") and repeat it
- **Color temperature** — pick ONE palette (e.g. "warm amber tones, muted highlights") and keep it consistent
- **Subject** — the same product/person must appear in EVERY scene

The Director AI enriches each prompt with detailed `lightingSetup`, `backgroundDescription`, and `colorPalette`. Your prompts should be consistent but leave room for the Director to add cinematography detail — don't over-specify what the Director will fill in.

#### Progressive Reveal Shot Framework

Structure scenes as a single continuous photo shoot where only the camera distance changes:

| Scene | Shot Type | Purpose | Example |
|---|---|---|---|
| 1 (Hook) | Extreme close-up or detail | Sensory curiosity — stop the scroll | "Extreme close-up of golden serum drops on fingertip" |
| 2 (Context) | Close-up | Reveal more — what IS this? | "Close-up of hands holding the serum bottle" |
| 3 (Hero) | Medium or wide | Money shot — full product in context | "Medium shot of the bottle on marble surface with botanicals" |
| 4 (CTA) | Detail or medium | Reinforce desire — support the call to action | "Detail shot of serum texture catching the light" |

This mirrors how professional product shoots work: same subject, same set, same lighting, different focal lengths.

#### Prompt Writing Rules

1. **Length**: 50-300 characters per prompt. Under 50 = too vague for Kling. Over 400 = gets truncated.
2. **NO text/logos/typography**: AI video cannot render readable text. Never include words like "text", "logo", "typography", "font", "write", "writing", "saying", "reads", "letter", "word", "headline" in scene prompts.
3. **Visual style cues required**: Every prompt must include at least one style keyword: lighting, light, shadow, cinematic, mood, tone, color, warm, cool, dark, bright, soft, dramatic, golden, neon, pastel, muted, vibrant, editorial, minimal, luxury, gritty, bokeh, ambient, backlit, silhouette.
4. **One moment per prompt**: Describe a single clear visual moment, not a sequence. "Woman applying serum in golden light" not "Woman picks up serum, applies it, then smiles."
5. **Repeat the lighting setup**: Mention the SAME lighting in every prompt (e.g. "soft diffused window light from camera-left" in all 4 scenes).
6. **Repeat the background**: Mention the SAME surface/environment in every prompt (e.g. "on white marble surface" in all 4 scenes).
7. **Vary only the camera**: Each scene should differ only in camera distance (extreme close-up, close-up, medium, wide, detail).
8. **Typical clip count**: 3-5 clips is standard. Each 5s clip costs ~$1.05 (storyboard + Kling). Warn if proposing >6 clips.

### Step 5: Validate Before Saving

Run these checks on the generated config. Fix any issues and re-validate. Never save an invalid config.

| Check | Rule | Action if fails |
|---|---|---|
| Prompt length | Each prompt 50-300 chars | Rewrite the prompt |
| Text/logo mentions | No `text`, `logo`, `typography`, `font`, `write`, `saying`, `reads`, `letter`, `word`, `headline` | Remove text references, describe visuals only |
| Style cues | At least one style keyword per prompt | Add lighting/color/mood direction |
| Script length | `word_count / 2.5 <= time_limit` (30s shorts, 60s ads, 15s web-hero) | Trim the script |
| Clip count | Warn if >6 clips (cost > $6.30 for Kling alone) | Suggest consolidation |
| voiceId presence | If `script` is set, `voiceId` must also be set | Ask user for voice ID |
| Format match | `format` must be one of: `youtube-short`, `tiktok`, `ad-16x9`, `ad-1x1`, `web-hero` | Fix to valid format |

### Step 6: Show Cost Estimate

Calculate and display estimated cost before saving:

| Step | Cost | Condition |
|---|---|---|
| Director (Claude Sonnet) | ~$0.10 | Always (runs once, cached after) |
| Asset sourcing (Gemini) | ~$0.05-0.12 | Style ref + optional location ref + optional color extraction |
| Storyboard frames (Gemini) | ~$0.08 x clips | Per clip (default imageProvider) |
| Storyboard frames (GPT Image) | ~$0.04-0.08 x clips | Per clip (imageProvider: "gpt-image") |
| Voiceover (ElevenLabs) | ~$0.50 | Only if script provided |
| Transcription (Whisper) | ~$0.02 | Only if voiceover generated |
| Video clips (Kling v2.1) | ~$0.49/5s, ~$0.90/10s | Per video/animation clip |
| Video clips (Kling v3) | ~$1.12/5s, ~$2.24/10s | Per video/animation clip — higher quality |
| Video clips (Veo 3.1) | ~$4.50/6s, ~$6.00/8s | Per video/animation clip — Google |
| Brand images (Gemini 3 Pro) | ~$0.08 x clips x formats | Only if mode includes brand-images |

Show the breakdown and total. Example:

```
Estimated cost breakdown:
  Director:           $0.10
  Asset sourcing:     $0.12
  Storyboard (4x):    $0.20
  Voiceover:          $0.50
  Whisper:            $0.02
  Kling v2.1 5s (4x): $1.96   (or v3: $4.48)
  Brand images (4x3): $0.60
  ─────────────────────────
  Total (v2.1):       ~$3.50
  Total (v3):         ~$6.02

Recommendation: Run --storyboard-only first (~$0.42) to preview frames before committing to Kling.
Note: v3 produces smoother transitions and better motion quality but costs ~2.3x more per clip.
```

ALWAYS recommend `--storyboard-only` first.

### Step 7: Save and Instruct

Create the project directory and save config.json:

```
projects/{slug}/
├── config.json
└── assets/
    └── reference/     (empty — for user's product photo)
```

Use `fs-extra` via the pipeline's `new-project` scaffolder if available, or create manually.

Then tell the user:

```
Config saved to projects/{slug}/config.json.

The pipeline will automatically source:
  - Brand colors (from website / product photo / AI-generated)
  - Style reference image (via Gemini or Pexels)
  - Location reference (if scenes describe a setting)
  - Background music (via Pixabay if PIXABAY_API_KEY is set)

For best results, provide:
  - Product photo -> projects/{slug}/assets/reference/subject.jpg
  - Logo (optional) -> projects/{slug}/assets/brand/logo.png

If no product photo is uploaded, the pipeline generates frames from prompts
using the configured imageProvider. Reference images improve quality but aren't required.

Next steps:
  Preview:  npm start -- --project {slug} --storyboard-only
  Dry run:  npm start -- --project {slug} --dry-run
  Or say "run step 2" to start the pipeline runner.
```

## Example

**User**: "Create content for GlowLab — they sell luxury organic skincare serums. Target audience is women 25-40 on Instagram and TikTok."

**Generated config.json:**

```json
{
  "mode": "full",
  "format": "youtube-short",
  "title": "glowlab-serum-launch",
  "client": "GlowLab",
  "brand": "GlowLab",
  "brief": "GlowLab is a luxury organic skincare brand specializing in high-performance serums. Their target audience is health-conscious women aged 25-40 who value clean beauty and self-care rituals. Visual tone: minimal, warm, editorial.",
  "script": "Your skin deserves more than chemicals. GlowLab crafts each serum from organic botanicals, cold-pressed and concentrated for maximum glow. One drop. That's all it takes. Feel the difference in your first week. Your radiance, reimagined.",
  "voiceId": "USER_MUST_SPECIFY",
  "clips": [
    {
      "prompt": "Extreme close-up of a single golden serum drop falling from the dropper in slow motion, soft diffused window light from camera-left, clean white marble surface, warm amber tones, shallow depth of field",
      "duration": 5
    },
    {
      "prompt": "Close-up of hands gently holding the frosted glass serum bottle, soft diffused window light from camera-left, clean white marble surface, warm amber tones, editorial beauty photography",
      "duration": 5
    },
    {
      "prompt": "Medium shot of the serum bottle standing on the marble surface with fresh botanicals arranged around it, soft diffused window light from camera-left, warm amber tones, luxury product photography",
      "duration": 5
    },
    {
      "prompt": "Detail shot of serum texture glistening on fingertips, the bottle softly blurred in the background on marble, soft diffused window light from camera-left, warm amber tones, shallow focus",
      "duration": 5
    }
  ],
  "transition": "crossfade",
  "captions": true,
  "captionStyle": "word-by-word",
  "captionTheme": "editorial",
  "hookText": "YOUR SKIN DESERVES BETTER",
  "cta": {
    "text": "Try GlowLab Today",
    "subtext": "Organic serums that actually work"
  },
  "music": true,
  "musicVolume": 0.12,
  "imageFormats": ["story", "square", "landscape"]
}
```
