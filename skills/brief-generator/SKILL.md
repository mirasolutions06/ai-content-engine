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
      "duration": 5
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
- `klingVersion`: omit for default `"v2.1"` (cheaper, ~$0.49/5s clip). Set to `"v3"` for higher quality with multi-shot storyboards (~$1.12/5s clip, ~2.3x more expensive). v3 produces smoother transitions and better motion quality.
- `colorUnify`: omit for default `false`. Set to `true` to apply a subtle brand-colored overlay on clips to unify color temperature across different Kling-generated scenes.
- `colorUnifyOpacity`: omit for default `0.06` (6%). Adjust 0-1 if color unity overlay is too strong or subtle.

### Scene Prompt Rules

These are critical. Bad prompts waste expensive API calls.

1. **Length**: 50-300 characters per prompt. Under 50 = too vague for Kling. Over 400 = gets truncated.
2. **NO text/logos/typography**: AI video cannot render readable text. Never include words like "text", "logo", "typography", "font", "write", "writing", "saying", "reads", "letter", "word", "headline" in scene prompts.
3. **Visual style cues required**: Every prompt must include at least one style keyword: lighting, light, shadow, cinematic, mood, tone, color, warm, cool, dark, bright, soft, dramatic, golden, neon, pastel, muted, vibrant, editorial, minimal, luxury, gritty, bokeh, ambient, backlit, silhouette.
4. **One moment per prompt**: Describe a single clear visual moment, not a sequence. "Woman applying serum in golden light" not "Woman picks up serum, applies it, then smiles."
5. **First scene = the hook**: The most visually striking, attention-grabbing scene goes first. This is what stops the scroll.
6. **Last scene = supports CTA**: The final scene should complement the call to action (e.g. product on display, satisfied customer, brand moment).
7. **Typical clip count**: 3-5 clips is standard. Each 5s clip costs ~$1.05 (storyboard + Kling). Warn if proposing >6 clips.

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
| Storyboard frames (Gemini 3 Pro) | ~$0.08 x clips | Per clip |
| Voiceover (ElevenLabs) | ~$0.50 | Only if script provided |
| Transcription (Whisper) | ~$0.02 | Only if voiceover generated |
| Video clips (Kling v2.1 via fal.ai) | ~$0.49/5s, ~$0.90/10s | Per clip — default, cheaper |
| Video clips (Kling v3 via fal.ai) | ~$1.12/5s, ~$2.24/10s | Per clip — higher quality, ~2.3x more |
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

You still need to provide:
  - Product photo -> projects/{slug}/assets/reference/subject.jpg
  - Logo (optional) -> projects/{slug}/assets/brand/logo.png

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
      "prompt": "Extreme close-up of a single golden serum drop falling in slow motion against soft warm backlight, luxury minimal aesthetic, shallow depth of field, amber tones",
      "duration": 5
    },
    {
      "prompt": "Hands gently holding an elegant frosted glass serum bottle, soft diffused natural window light, clean white marble surface, editorial beauty photography style, muted warm palette",
      "duration": 5
    },
    {
      "prompt": "Woman with glowing dewy skin touching her face softly, golden hour side lighting creating a warm rim glow, soft bokeh background, cinematic shallow focus, luxury skincare mood",
      "duration": 5
    },
    {
      "prompt": "Flat lay of the serum bottle surrounded by fresh botanical ingredients — lavender, rosemary, citrus slices — on natural linen, soft overhead diffused lighting, editorial product photography",
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
