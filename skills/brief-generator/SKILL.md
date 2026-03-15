---
name: brief-generator
description: "Entry point for all content creation. Triggers on any request to create content for a brand, product, or campaign. Also handles: 'change the brief', 'update the config', 'add more scenes', 'switch to video mode', 'adjust the prompts'. If the user describes what they want but doesn't have a project yet, start here."
---

# Brief Generator

You are the entry point for the AI Content Engine. Your job is to take a natural language description of a brand, product, or campaign and produce a valid `config.json` that the pipeline can execute.

## Session Awareness

When invoked:
1. Check what exists in the project directory (config.json, assets/, cache/, output/)
2. If a config already exists, ask: "Update the existing brief, or start fresh?"
3. If output exists from a previous run, mention it: "You have assets from a previous run."
4. Check `memory/brands/` for returning brand data

Key files: config.json, cache/brand-context.json, cache/cost-log.json, memory/brands/{slug}/brand-memory.json

## Brand Memory (Repeat Brands)

Before asking questions, check if this is a returning brand:

1. Search `memory/brands/` for a matching brand slug
2. If found, load `brand-memory.json`

**Returning brand with memory:**
- Skip Question 1 — brand/product already known
- Show: "I have {runCount} previous campaigns for {brand} (avg QA: {avgScore}/5). Best provider: {bestProvider}."
- Show top 3 highest-scoring prompts from past campaigns
- Ask only: "What's different about this campaign?" and "Same visual style, or new direction?"
- Default to best-performing imageProvider from memory

**New brand:** Follow the standard three-question flow below.

## Workflow

### Step 1: Three-Question Brief (Default Flow)

Ask exactly three questions. Everything else is inferred by the Director or filled from research.

**Question 1 — What?**
"What brand/product is this for, and what do they sell?"
Accept: brand name + product description. A URL works too — use `url-to-brief.ts` to auto-extract.

**Question 2 — Who + Where?**
"Who's the audience, and what platform(s)?"
Accept: audience description + platform list. Default: "general audience, all platforms."

**Question 3 — Vibe?**
"Any visual references, mood, or style direction? (Skip if none)"
Accept: reference images, mood words, competitor URLs, or "skip."

That's it. Three questions, then generate the config. The Director handles cinematography, the pipeline handles everything else.

**Advanced options** — available if the user volunteers them, but never prompted:
- Budget sensitivity (low / normal / high — affects clip count)
- Preferred video format: `youtube-short`, `tiktok`, `ad-16x9`, `ad-1x1`, `web-hero`
- Specific videoProvider or imageProvider
- Template to start from (product-launch, brand-story, before-after)

**URL shortcut**: If the user provides a product page URL instead of answering questions, use `url-to-brief.ts` (`extractBriefFromUrl` + `generateConfigFromUrl`) to auto-extract brand, product, audience, images, and mood. Skip to Step 3.

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
- `captionTheme`: omit to let the Director auto-select based on brand tone. Options: `bold` (TikTok pill-style), `editorial` (clean luxury underline), `minimal` (simple opacity)
- `imageProvider`: omit for default `"gemini"`. Set `"gpt-image"` for GPT Image 1 (~$0.04-0.08/frame, more literal style).
- `videoProvider`: omit for default `"kling-v2.1"`. Options: `"kling-v3"` (better motion, ~2.3x more), `"veo-3.1"` (Google, 4-8s clips), `"veo-3.1-fast"` (cheaper Veo).
- `outputType` per clip: omit for default based on mode
- `duration` per clip: omit for default `5`. Any number 1-15.
- `colorUnify`: omit for default `false`. Set `true` to apply subtle brand-colored overlay across clips.

### Brand-Images Config Best Practices

**`products` field (strongly recommended):**
List exact product(s). Prevents Gemini from inventing phantom products.
```json
"products": ["amber glass dropper serum bottle"]
```

**`skipAutoRefs` field (use when appropriate):**
Skip auto-generated references when not needed.
```json
"skipAutoRefs": ["style", "location"]
```

**Reference images (the biggest quality lever):**
Named files in the project directory get labeled in the Gemini prompt:
- `model-1.jpg`, `model-2.jpg` — person's face/features
- `product-1.jpg`, `product-2.jpg` — exact product appearance
- `style.jpg` — visual mood reference
- `location.jpg` — environment reference

More refs = better consistency. Nike used 6 refs and got campaign-grade output. Ama Shea used zero refs and still scored 4.5-5.0/5 with good prompts.

**Prompt style for brand-images:**
Write LOOSE, evocative prompts — not hyper-specific descriptions. The Director enriches them. Over-specifying constrains Gemini.

Good: `"Hero product shot on dark weathered wood surface, surrounded by raw shea nuts and dried botanicals, warm golden-amber key light from camera-right, shallow depth of field, editorial product photography"`

Bad: `"Glass jar of whipped shea body butter with wooden lid on dark weathered wood, raw shea nuts and a small bowl of golden shea oil beside it, warm amber key light from camera-right at exactly 45 degrees, f/2.8 shallow depth of field"`

### Scene Prompt Rules

#### Visual Consistency (MOST IMPORTANT)

ALL scenes must share the SAME:
- **Lighting direction** — pick ONE setup and use it in every prompt
- **Background/surface** — pick ONE setting and repeat it
- **Color temperature** — pick ONE palette and keep it consistent
- **Subject** — the same product/person in EVERY scene

#### Progressive Reveal Shot Framework

Structure scenes as a single continuous photo shoot where only the camera distance changes:

| Scene | Shot Type | Purpose | Example |
|---|---|---|---|
| 1 (Hook) | Extreme close-up or detail | Sensory curiosity — stop the scroll | "Extreme close-up of golden serum drops on fingertip" |
| 2 (Context) | Close-up | Reveal more — what IS this? | "Close-up of hands holding the serum bottle" |
| 3 (Hero) | Medium or wide | Money shot — full product in context | "Medium shot of the bottle on marble surface with botanicals" |
| 4 (CTA) | Detail or medium | Reinforce desire — support the call to action | "Detail shot of serum texture catching the light" |

#### Prompt Writing Rules

1. **Length**: 50-300 characters per prompt. Under 50 = too vague. Over 400 = gets truncated.
2. **NO text/logos/typography**: AI cannot render readable text. Never include "text", "logo", "font", "write", "saying", "reads", "letter", "word", "headline" in prompts.
3. **Visual style cues required**: Every prompt needs at least one style keyword: lighting, shadow, cinematic, mood, warm, cool, golden, bokeh, ambient, backlit, editorial, etc.
4. **One moment per prompt**: "Woman applying serum in golden light" not "Woman picks up serum, applies it, then smiles."
5. **Repeat the lighting**: Same lighting in every prompt.
6. **Repeat the background**: Same surface/environment in every prompt.
7. **Vary only the camera**: Each scene differs only in camera distance.
8. **Typical clip count**: 3-5 clips standard. Warn if >6.

### Video-Specific Prompt Tips

- **Describe a frozen moment, not motion**: Kling adds motion. "Woman holding serum bottle" not "Woman picks up bottle."
- **Include environment/lighting**: Kling uses context to animate consistently.
- **Keep scenes compositionally independent**: Each clip from its own frame, standalone moment.
- **Avoid complex multi-person scenes**: Single subject best.
- **For beauty/portrait**: Use `videoProvider: "kling-v3"` and provide `model-1.jpg` reference.

### Step 5: Validate Before Saving

| Check | Rule | Action if fails |
|---|---|---|
| Prompt length | 50-300 chars each | Rewrite |
| Text/logo mentions | No text rendering words | Remove, describe visuals only |
| Style cues | At least one per prompt | Add lighting/color/mood |
| Script length | `words / 2.5 <= time_limit` | Trim |
| Clip count | Warn if >6 | Suggest consolidation |
| voiceId | Required if script is set | Ask user |
| Format | Must be valid | Fix |

### Step 6: Show Cost Estimate

| Step | Cost | Condition |
|---|---|---|
| Director (Claude) | ~$0.10 | Always |
| Asset sourcing (Gemini) | ~$0.05-0.12 | Style ref + optional extras |
| Storyboard frames (Gemini) | ~$0.08 x clips | Default imageProvider |
| Storyboard frames (GPT Image) | ~$0.04-0.08 x clips | imageProvider: "gpt-image" |
| Voiceover (ElevenLabs) | ~$0.50 | Only if script |
| Transcription (Whisper) | ~$0.02 | Only if voiceover |
| Video clips (Kling v2.1) | ~$0.49/5s, ~$0.90/10s | Per video/animation clip |
| Video clips (Kling v3) | ~$1.12/5s, ~$2.24/10s | Per clip — higher quality |
| Video clips (Veo 3.1) | ~$4.50/6s, ~$6.00/8s | Per clip — Google |
| Brand images (Gemini) | ~$0.08 x clips x formats | brand-images mode |

Show breakdown and total.

### Step 7: Save and Generate

Create the project directory and save config.json:

```
projects/{slug}/
├── config.json
└── assets/
    └── reference/     (for user's reference photos)
```

Then tell the user what reference images to provide for best results.

## Auto-Chain

After saving config.json, don't stop. Flow into generation based on mode:

**brand-images mode:**
Run the pipeline immediately — cost is low (~$0.08/image). Show results with QA scores when done, then offer copy generation.

**video/full mode:**
Run `--dry-run` to trigger the Director (~$0.10, cached). Show the Director's creative plan:
```
Director's creative plan:
  Visual style: {visualStyleSummary}
  Lighting: {lightingSetup}
  Color: {colorPalette}

  Scene 1: {enrichedPrompt snippet}
  Scene 2: {enrichedPrompt snippet}
  ...

  Hook: {suggestedHookText}
  CTA: {suggestedCta}
```

Then ask: "Preview frames? (~$X.XX for storyboard only, no video charges)"

On approval, run `--storyboard-only` and show the frames.

Never say "run step 2". Say "Generating your images now..." or "Want to preview the frames?"

## Templates

Pre-built configs in `projects/_templates/`. Use as a starting point when user's intent matches:

| Template | Mode | Scenes | Best for |
|---|---|---|---|
| `product-launch` | brand-images | 5 images | New product announcements |
| `brand-story` | video | 6 clips | Brand awareness |
| `before-after` | brand-images | 4 images | Transformation results |

To use: `npm run new-project -- --name {slug} --template {name} --brand "{Brand}"`

## Examples

### Standard Flow

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

### URL Shortcut

**User**: "Make content for this: https://example.com/products/vitamin-c-serum"

The skill uses `url-to-brief.ts` to fetch the page, extract brand/product info via Claude Haiku, download product images as references, and generate a complete config.json — no questions needed.
