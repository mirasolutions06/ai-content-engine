# Mira Content Engine

One brief in, platform-ready content out. Generate brand images, AI video, voiceovers, captions, copy, and deliverable packages from a single natural-language brief.

---

## How It Works

Talk to Claude Code. Describe your brand and what you need. Claude handles everything through 5 skills:

```
Brief Generator  →  Pipeline Runner  →  Copy Engine  →  Asset Packager  →  Distributor
   (Skill 1)          (Skill 2)          (Skill 3)       (Skill 4)         (Skill 5)

 "Create a brief   "Run the pipeline"  "Write copy"    "Package assets"  "Monetize this"
  for Ama Shea"
```

You don't need to touch the CLI directly — the skills handle commands, cost gates, and file management for you.

---

## Three Modes

| Mode | What you get | When to use |
|------|-------------|-------------|
| `brand-images` | Multi-format images (story 9:16, square 1:1, landscape 16:9) | Social media content, product photography |
| `video` | Full AI video with voiceover, captions, transitions, CTA | YouTube Shorts, TikTok, ads |
| `full` | Brand images + full video in one run | Complete campaign package |

---

## Quick Start

### 1. Install

```bash
git clone <repo-url>
cd mira-content-engine
npm install
```

### 2. Set up API keys

Create `.env` in the project root:

```env
GEMINI_API_KEY=          # Gemini — images + brand photos
ANTHROPIC_API_KEY=       # Claude — Director AI
FAL_KEY=                 # fal.ai — Kling video generation
ELEVENLABS_API_KEY=      # ElevenLabs — voiceover
OPENAI_API_KEY=          # Whisper captions + GPT Image (optional)
```

Not all keys are needed for every mode:

| Mode | Required keys |
|------|--------------|
| `brand-images` | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` |
| `video` (Gemini + Kling) | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `FAL_KEY` |
| `video` (with voiceover) | + `ELEVENLABS_API_KEY`, `OPENAI_API_KEY` |
| `video` (GPT Image) | + `OPENAI_API_KEY` |
| `video` (Veo) | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` |

### 3. Tell Claude what you need

Open Claude Code and say something like:

> "Create a brief for Ama Shea — luxury African shea butter skincare brand. Hero product is whipped shea body butter. Target: women 25-40 who care about clean beauty and heritage brands."

Claude generates a validated `config.json`, shows the cost estimate, and asks for approval before spending anything.

---

## Use Case: Brand Images

Generate professional product photography in multiple formats for social media.

### What you need

1. A `config.json` with `"mode": "brand-images"`
2. Reference photos dropped in the project folder (optional but recommended)

### Reference photos

Drop these in `projects/your-project/`:

| File | What it's for | Required? |
|------|--------------|-----------|
| `product.jpg` | The product — jar, bottle, packaging | No, but strongly recommended |
| `product-1.jpg`, `product-2.jpg` | Multiple angles of the product | No |
| `model.jpg` | Person/face to feature with the product | No |
| `model-1.jpg`, `model-2.jpg` | Multiple photos of the same person | No |
| `style.jpg` | Visual mood reference — aesthetic you want to match | No |

- Filenames are exact — `product.jpg`, not `my-product-photo.jpg`
- Numbered variants (`product-1.jpg`, `model-2.jpg`) let you provide multiple angles
- More reference photos = better consistency. Gemini uses up to 14
- Any image format works: `.jpg`, `.jpeg`, `.png`
- The pipeline labels each reference by filename so Gemini knows what it's looking at

### Example config

```json
{
  "mode": "brand-images",
  "title": "ama-shea-whipped-butter",
  "brand": "Ama Shea",
  "brief": "Luxury African shea butter skincare. Warm golden amber lighting, earthy textures, raw ingredients on dark wood, West African textiles. Premium but grounded.",
  "clips": [
    {
      "prompt": "Glass jar of whipped ivory shea butter on dark cracked wood planks surrounded by raw shea nuts and kente cloth, warm golden-amber key light, luxury handmade product photography"
    },
    {
      "prompt": "Close-up of hands scooping whipped shea butter from jar, warm skin tones, soft studio lighting, editorial beauty photography, shallow depth of field"
    }
  ],
  "imageFormats": ["story", "square", "landscape"]
}
```

### What you get

```
output/images/
├── 1-story.jpg       ← 9:16 for Instagram Stories / TikTok
├── 1-square.jpg      ← 1:1 for Instagram Feed
├── 1-landscape.jpg   ← 16:9 for Twitter / LinkedIn
├── 2-story.jpg
├── 2-square.jpg
└── 2-landscape.jpg
```

Each clip generates one image per format. 2 clips x 3 formats = 6 images.

### Cost

~$0.05-0.15 per image (Gemini). A typical 3-clip x 3-format run costs ~$0.45-1.35.

---

## Use Case: AI Video

Generate a complete video with AI-generated visuals, voiceover, captions, transitions, and CTA overlay.

### What you need

1. A `config.json` with `"mode": "video"` (or omit mode — video is the default)
2. A `format` — determines aspect ratio and composition
3. Reference photos (optional, improves visual consistency)

### Video formats

| Format | Aspect | Duration | Use for |
|--------|--------|----------|---------|
| `youtube-short` | 9:16 | Up to 60s | YouTube Shorts |
| `tiktok` | 9:16 | Up to 60s | TikTok, Instagram Reels |
| `ad-16x9` | 16:9 | Any | Landscape ads, YouTube pre-roll |
| `ad-1x1` | 1:1 | Any | Square ads, Instagram Feed |
| `web-hero` | 16:9 | Any | Website hero sections, landing pages |

### Example config

```json
{
  "mode": "video",
  "format": "youtube-short",
  "title": "summer-campaign",
  "client": "Nike",
  "script": "This summer, move like never before. The new Air Max — built for the streets.",
  "voiceId": "pNInz6obpgDQGcFmaJgB",
  "clips": [
    {
      "prompt": "Runner sprints through neon-lit city street at dusk, dynamic tracking shot, cinematic lighting",
      "duration": 5
    },
    {
      "prompt": "Close-up of Nike Air Max shoes hitting wet asphalt, water splashing in slow motion, 85mm lens",
      "duration": 5
    },
    {
      "prompt": "Runner stops and looks at camera, confident, city lights bokeh background, golden hour rim light",
      "duration": 5
    }
  ],
  "transition": "cut",
  "captions": true,
  "captionTheme": "bold",
  "hookText": "Move different this summer",
  "cta": {
    "text": "Shop Air Max",
    "subtext": "nike.com",
    "durationSeconds": 3
  },
  "music": true,
  "musicVolume": 0.12
}
```

### Pipeline steps

```
1. Director AI (Claude)     — enriches prompts, plans cinematography    ~$0.10
2. Voiceover (ElevenLabs)   — generates speech from script              ~$0.50
3. Captions (Whisper)       — word-level transcription                  ~$0.02
4. Storyboard (Gemini)      — generates scene frames                    ~$0.08/frame
   ⛔ REVIEW GATE — you approve frames before proceeding
5. Video (Kling/Veo)        — animates frames into clips                ~$0.50-6.00/clip
6. Render (Remotion)        — composites everything into final MP4      free
7. Package (ffmpeg)         — optimizes for streaming                   free
```

### Video providers

| Provider | Cost per clip | Quality | Best for |
|----------|--------------|---------|----------|
| `kling-v2.1` (default) | $0.49/5s, $0.90/10s | Good | Most projects, budget-conscious |
| `kling-v3` | $1.12/5s, $2.24/10s | Better | Higher quality, multi-subject scenes |
| `veo-3.1` | ~$4.50-6.00/clip | Best | Complex camera moves, atmospheric effects |

Set in config: `"videoProvider": "kling-v3"` or `"veo-3.1"`

### Image providers

| Provider | Cost per frame | Best for |
|----------|---------------|----------|
| `gemini` (default) | ~$0.05-0.15 | Most scenes, supports reference images |
| `gpt-image` | ~$0.04-0.08 | Text rendering, literal interpretation |

Set in config: `"imageProvider": "gpt-image"`

### What you get

```
output/
├── audio/voiceover.mp3
├── clips/
│   ├── scene-1.mp4
│   ├── scene-2.mp4
│   └── scene-3.mp4
└── final/
    └── summer-campaign-youtube-short.mp4
```

---

## Use Case: Mixed Mode (Images + Video in One Project)

You can control what each clip produces using `outputType` per clip:

```json
{
  "mode": "video",
  "format": "youtube-short",
  "title": "product-launch",
  "clips": [
    {
      "prompt": "Product hero shot on marble surface, warm studio lighting",
      "outputType": "image"
    },
    {
      "prompt": "Hand picks up the bottle, slow dolly-in, golden hour light",
      "outputType": "video",
      "duration": 5
    },
    {
      "prompt": "Product on display with soft bokeh, subtle parallax movement",
      "outputType": "animation",
      "duration": 5
    }
  ]
}
```

| outputType | What happens | Cost |
|-----------|-------------|------|
| `image` | Generates a still frame only (Gemini/GPT Image) | ~$0.08 |
| `video` | Generates frame → animates with Kling/Veo (text-to-video) | ~$0.50-6.00 |
| `animation` | Generates frame → animates with Kling (image-to-video, more faithful) | ~$0.50-2.25 |

---

## Use Case: Video Reference Upload

If you have an existing video you want to match the style of, drop it in the project folder:

```
projects/your-project/
├── config.json
├── reference.mp4      ← existing video to analyze
└── ...
```

The pipeline analyzes the video (shot types, pacing, color palette, transitions) and feeds that context to the Director AI, which uses it to enrich your scene prompts.

Supported formats: `.mp4`, `.mov`

---

## Project Folder Structure

```
projects/your-project/
├── config.json              ← your brief (required)
├── product.jpg              ← product reference photo
├── product-1.jpg            ← additional product angles
├── model.jpg                ← person/face reference
├── model-1.jpg              ← additional model photos
├── style.jpg                ← visual mood reference
├── music.mp3                ← background music
├── brand/
│   ├── brand.json           ← brand colors { primary, secondary, accent }
│   ├── logo.png             ← transparent logo
│   ├── font-bold.ttf        ← custom font (optional)
│   └── font-regular.ttf
├── storyboard/              ← auto-generated (pipeline writes here)
├── cache/                   ← auto-managed (Director plan, cost log, hashes)
└── output/                  ← results
    ├── images/              ← brand images (brand-images mode)
    ├── audio/               ← voiceover (video mode)
    ├── clips/               ← video clips (video mode)
    ├── final/               ← rendered video (video mode)
    ├── copy/                ← platform copy (Copy Engine skill)
    └── deliverables/        ← packaged assets (Asset Packager skill)
```

Only `config.json` is required. Everything else is optional and auto-discovered.

---

## Cost Safety

The pipeline never spends money without your approval:

```
1. Brief generation           free (Claude conversation)
2. Dry run                    free (preview all API calls)
3. Director AI                ~$0.10 (cached after first run)
4. Storyboard frames          ~$0.08/frame
   ⛔ REVIEW GATE
5. Voiceover + captions       ~$0.52
6. Video clips                ~$0.50-6.00/clip
   ⛔ APPROVAL GATE
7. Remotion render            free
```

All steps are **idempotent** — re-running skips anything already generated. Delete a specific file to regenerate just that step.

All API calls are **cached by content hash** — changing unrelated config fields doesn't regenerate expensive steps.

---

## CLI Reference

Most users interact through Claude Code skills. For direct CLI access:

```bash
# Create a new project
npm run new-project -- --name my-project --format youtube-short

# Run the pipeline
npm start -- --project my-project [options]
```

| Flag | Description |
|------|-------------|
| `--project <name>` | Project folder name (required) |
| `--dry-run` | Preview all API calls with cost estimate |
| `--storyboard-only` | Generate frames only, stop before video |
| `--variations <n>` | Generate 1-4 variations per scene (implies --storyboard-only) |
| `--json-output` | Print structured JSON summary |
| `--airtable-review` | Enable Airtable review gates |
| `--list-voices` | List available ElevenLabs voices |

---

## Config Reference

<details>
<summary>All config fields</summary>

### Top-level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `"video"` / `"brand-images"` / `"full"` | `"video"` | Pipeline mode |
| `format` | `string` | — | Required for video/full mode |
| `title` | `string` | — | Used in output filename |
| `brand` | `string` | — | Brand name (used in brand-images prompts) |
| `client` | `string` | — | Client name (shown in lower thirds) |
| `brief` | `string` | — | Overall brand context passed to Director + Gemini |
| `script` | `string` | `""` | Voiceover text (empty = no voiceover) |
| `voiceId` | `string` | — | ElevenLabs voice ID |
| `clips` | `VideoClip[]` | — | Scene definitions (at least one) |
| `transition` | `"crossfade"` / `"cut"` / `"wipe"` | `"crossfade"` | Scene transitions |
| `captions` | `boolean` | format default | Render captions |
| `captionStyle` | `"word-by-word"` / `"line-by-line"` | `"word-by-word"` | Caption display |
| `captionTheme` | `"bold"` / `"editorial"` / `"minimal"` | `"bold"` | Caption visual style |
| `captionPosition` | `"bottom"` / `"center"` / `"top"` | `"bottom"` | Caption placement |
| `hookText` | `string` | — | Bold text overlay for first 2 seconds |
| `cta` | `{ text, subtext?, durationSeconds? }` | — | End screen CTA |
| `music` | `boolean` | `false` | Use background music |
| `musicVolume` | `number` | `0.15` | Music volume (0-1) |
| `imageFormats` | `ImageFormat[]` | all three | Which image formats to generate |
| `imageProvider` | `"gemini"` / `"gpt-image"` | `"gemini"` | Storyboard frame provider |
| `videoProvider` | `string` | `"kling-v2.1"` | `"kling-v2.1"` / `"kling-v3"` / `"veo-3.1"` |
| `colorUnify` | `boolean` | `false` | Apply brand-colored overlay to unify color |
| `colorGrade` | `boolean` | `true` | Apply CSS color grade filter |

### Clip fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt` | `string` | — | Scene description for image/video generation |
| `duration` | `number` | `5` | Clip duration in seconds (1-15) |
| `outputType` | `"image"` / `"video"` / `"animation"` | inferred | What this clip produces |
| `imageReference` | `string` | — | Path to custom storyboard image |
| `url` | `string` | — | URL to pre-generated MP4 (skips generation) |

</details>

---

## AI Stack

| Service | Role | Cost |
|---------|------|------|
| **Claude Sonnet 4.6** | Director AI — prompt enrichment, cinematography planning | ~$0.10 |
| **Gemini 3 Pro Image** | Storyboard frames + brand images | ~$0.05-0.15/image |
| **GPT Image 1** | Alternative image provider (better text rendering) | ~$0.04-0.08/image |
| **Kling v2.1/v3** (fal.ai) | Image-to-video clip generation | $0.49-2.24/clip |
| **Veo 3.1** (Google) | Text/image-to-video (complex scenes) | ~$4.50-6.00/clip |
| **ElevenLabs** | Voiceover generation | ~$0.30-1.00 |
| **OpenAI Whisper** | Word-level caption transcription | ~$0.01-0.05 |
| **Remotion** | Programmatic video composition | Free (local) |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `GEMINI_API_KEY not set` | Add key to `.env` — get one at [aistudio.google.com](https://aistudio.google.com) |
| fal.ai 403 or balance error | Top up at [fal.ai/dashboard](https://fal.ai/dashboard) |
| Gemini returns no image data | Check API key. Storyboard step is non-fatal — continues without it |
| FFmpeg not found | `brew install ffmpeg` and restart terminal |
| Remotion bundle error | Run `npm run build` first to catch TypeScript errors |
| Storyboard images not detected | Files must be named `scene-1.png` (lowercase, hyphens) in `storyboard/` |
| Voiceover not generating | Check `ELEVENLABS_API_KEY` and that `script` is set in config |
| Re-running regenerates everything | It shouldn't — all steps are idempotent. Delete specific output files to force regeneration |
