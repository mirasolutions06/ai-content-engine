# AI Video Production Pipeline

An AI-driven video production system for creating short-form and ad-format video content. Orchestrates five AI services into a single CLI-driven pipeline with a storyboard approval gate and full visual continuity across scenes.

**AI stack:**
- **fal.ai Kling v2.1** — video clip generation (image-to-video or text-to-video)
- **Gemini 2.5 Flash** — automated storyboard frame generation
- **Claude Sonnet 4.6** — Director AI that enriches prompts and voice settings
- **ElevenLabs** — voiceover generation
- **OpenAI Whisper** — caption transcription
- **Remotion** — final composition with captions, logo, CTA, transitions
- **Airtable** — run logging and video delivery tracking (optional)

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [API Key Setup](#api-key-setup)
4. [Full Workflow](#full-workflow)
5. [The Visual Continuity Loop](#the-visual-continuity-loop)
6. [CLI Commands](#cli-commands)
7. [config.json Reference](#configjson-reference)
8. [Asset Folder Structure](#asset-folder-structure)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 20 or higher** — [nodejs.org](https://nodejs.org)
- **FFmpeg installed system-wide** — used for last-frame extraction, video probing, and brand reel assembly

Install FFmpeg on macOS:

```bash
brew install ffmpeg
```

Verify both are available:

```bash
node --version   # should be v20.x.x or higher
ffmpeg -version  # should print ffmpeg version info
```

---

## Installation

```bash
git clone <repo-url> "AI Video Production Pipeline"
cd "AI Video Production Pipeline"
npm install
```

Create `.env` in the project root:

```env
FAL_KEY=
ELEVENLABS_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=

# Optional — pipeline runs without these
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_TABLE_ID=
```

---

## API Key Setup

### fal.ai (Video Generation)

1. Sign up at [fal.ai](https://fal.ai)
2. Go to **Settings** → **API Keys** → create a key
3. Add to `.env` as `FAL_KEY=`

fal.ai charges per generation. Kling v2.1 Pro (image-to-video): ~$0.20 per 5s clip. Kling v2.1 Master (text-to-video): ~$0.14 per 5s clip.

### Gemini (Storyboard Generation)

1. Go to [aistudio.google.com](https://aistudio.google.com) → **Get API key**
2. Add to `.env` as `GEMINI_API_KEY=`

Gemini image generation is free at low usage on the standard tier.

### Anthropic (Director AI)

1. Go to [console.anthropic.com](https://console.anthropic.com) → **API Keys**
2. Add to `.env` as `ANTHROPIC_API_KEY=`

The Director step uses Claude Sonnet 4.6 to enrich scene prompts and voice settings before generation.

### ElevenLabs (Voiceover)

1. Sign up at [elevenlabs.io](https://elevenlabs.io)
2. Go to **Profile Settings** → **API Keys** → create a key
3. Add to `.env` as `ELEVENLABS_API_KEY=`
4. Find a voice ID:
   ```bash
   npm run pipeline -- --project test-project --list-voices
   ```

### OpenAI (Whisper Captions)

1. Go to [platform.openai.com](https://platform.openai.com) → **API Keys**
2. Add to `.env` as `OPENAI_API_KEY=`

Only used for Whisper transcription (caption word timing). Not used for any generative text tasks.

---

## Full Workflow

### Step 1 — Create a project

```bash
npm run new-project -- --name my-ad --format youtube-short
```

Scaffolds `projects/my-ad/` with the full folder structure and a starter `config.json`.

Supported formats: `youtube-short`, `tiktok`, `ad-16x9`, `ad-1x1`, `web-hero`

### Step 2 — Add reference assets (optional but recommended)

Drop files into `projects/my-ad/assets/reference/` before running:

- `style.jpg` — visual mood/style reference. Gemini uses this to guide image generation.
- `subject.jpg` — your product, person, or main subject.
- `location.jpg` — environment or setting reference.

The Director AI (Claude) analyzes these and uses them to enrich your scene prompts.

### Step 3 — Edit config.json

Fill in:
- `title` — used in the output filename
- `script` — voiceover narration text (leave blank to skip voiceover)
- `voiceId` — ElevenLabs voice ID
- `clips` — one entry per scene, each with a `prompt` describing the action
- `format`, `captions`, `transition`, `hookText`, `cta` — see config reference below

### Step 4 — Preview storyboard frames (recommended)

```bash
npm run pipeline -- --project my-ad --storyboard-only
```

This runs the Director step and Gemini image generation, then **stops before fal.ai**. You get to review the storyboard images before spending video generation credits.

What happens:
1. Director (Claude) enriches your prompts and voice settings
2. Gemini generates `scene-1.png`, `scene-2.png`, etc. in `assets/storyboard/`
3. Pipeline stops and logs the storyboard folder path

Review the images. Delete any you want regenerated (Gemini will redo them on the next run). Replace any with your own PNG to override a scene entirely.

### Step 5 — Run the full pipeline

```bash
npm run pipeline -- --project my-ad
```

Steps run in order, skipping anything already done:

1. Validates `.env` and `config.json`
2. Director (Claude) enriches prompts and voice settings — cached after first run
3. Generates voiceover audio via ElevenLabs — skipped if `voiceover.mp3` exists
4. Transcribes audio via Whisper — skipped if captions cache exists
5. Generates storyboard frames via Gemini — skipped if `scene-N.png` already exists
6. Generates video clips via fal.ai Kling — cached by content hash
7. Bundles and renders the final composition via Remotion
8. Packages the final MP4 with a timestamp into `output/final/`
9. Logs the run to Airtable (if configured)

**All steps are idempotent.** Re-running never duplicates API calls.

### Step 6 — Delivery

Final videos land in:

```
projects/my-ad/output/final/my-ad-youtube-short-2026-03-01T12-00-00.mp4
```

---

## The Visual Continuity Loop

Gemini generates each storyboard frame using the **last frame of the previous clip** as visual context. This maintains subject, lighting, color palette, and atmosphere across scenes — preventing the typical visual incoherence of text-to-video models.

```
Gemini generates           fal.ai Kling generates
scene-1.png          →     scene-1.mp4
(from text prompt)         (using scene-1.png as start)

                                  ↓

Gemini generates           ffmpeg extracts
scene-2.png          ←     scene-1-lastframe.png
(continuing from           (auto-saved to assets/storyboard/)
 scene-1-lastframe)
```

This loop runs automatically — no manual steps required.

---

## CLI Commands

### Create a new project

```bash
npm run new-project -- --name <project-name> --format <format>
```

| Argument | Required | Description |
|----------|----------|-------------|
| `--name` | Yes | Project name (kebab-case). Creates `projects/<name>/`. |
| `--format` | Yes | `youtube-short`, `tiktok`, `ad-16x9`, `ad-1x1`, or `web-hero` |

### Run the pipeline

```bash
npm run pipeline -- --project <project-name> [options]
```

| Option | Description |
|--------|-------------|
| `--project <name>` | Project folder under `projects/` (required) |
| `--storyboard-only` | Generate Gemini storyboard frames and stop for review before fal.ai |
| `--list-voices` | Print available ElevenLabs voices and exit |

### Open Remotion Studio

```bash
npm run remotion
```

Opens the visual preview UI. Useful for checking composition layout before a full render.

### TypeScript check

```bash
npm run build
```

Runs `tsc --noEmit`. Run this first if the pipeline throws unexpected errors.

---

## config.json Reference

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `format` | `VideoFormat` | Yes | — | Output format. See formats table. |
| `title` | `string` | Yes | — | Used in the output filename. |
| `client` | `string` | No | — | Client name. Shown in lower thirds. |
| `script` | `string` | No | `""` | Voiceover text. If empty, voiceover is skipped. |
| `voiceId` | `string` | No | — | ElevenLabs voice ID. Required if `script` is set. |
| `clips` | `VideoClip[]` | Yes | — | Array of scene definitions. At least one required. |
| `transition` | `string` | No | `"crossfade"` | `crossfade`, `cut`, or `wipe` |
| `captions` | `boolean` | No | Format default | Render word-by-word captions. Default `true` for shorts/TikTok. |
| `captionStyle` | `string` | No | `"word-by-word"` | `word-by-word` or `line-by-line` |
| `captionPosition` | `string` | No | `"bottom"` | `bottom`, `center`, or `top` |
| `hookText` | `string` | No | — | Bold text shown at the top for the first 2 seconds. |
| `cta` | `CTAConfig` | No | — | End screen call-to-action overlay. |
| `music` | `boolean` | No | `false` | Use `assets/audio/music.mp3` as background music. |
| `musicVolume` | `number` | No | `0.15` | Background music volume (0–1). |

### VideoFormat options

| Format | Dimensions | Aspect Ratio | Default Captions |
|--------|-----------|--------------|-----------------|
| `youtube-short` | 1080×1920 | 9:16 | Yes |
| `tiktok` | 1080×1920 | 9:16 | Yes |
| `ad-16x9` | 1920×1080 | 16:9 | No |
| `ad-1x1` | 1080×1080 | 1:1 | No |
| `web-hero` | 1920×1080 | 16:9 | No |

### VideoClip fields

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | Scene description. Guides both Gemini (storyboard) and Kling (motion). |
| `imageReference` | `string` | Path to a storyboard image. Overrides auto-discovery. |
| `url` | `string` | URL to a pre-generated MP4. Downloads and skips fal.ai entirely. |
| `duration` | `5 \| 10` | Clip duration in seconds. Default: `5`. |

### CTAConfig fields

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | Main CTA text (e.g. `"Shop Now"`). |
| `subtext` | `string` | Optional secondary line. |
| `durationSeconds` | `number` | CTA overlay duration. Default: `3`. |

### Example config.json

```json
{
  "format": "youtube-short",
  "title": "summer-campaign",
  "client": "Nike",
  "script": "This summer, move like never before. The new Air Max — built for the streets.",
  "voiceId": "pNInz6obpgDQGcFmaJgB",
  "clips": [
    {
      "prompt": "A runner sprints through a neon-lit city street at dusk, dynamic camera tracking",
      "duration": 5
    },
    {
      "prompt": "Close up of Nike Air Max shoes hitting wet asphalt, water splashing in slow motion",
      "duration": 5
    },
    {
      "prompt": "The runner stops, looks at camera, confident smile, city lights bokeh background",
      "duration": 5
    }
  ],
  "transition": "cut",
  "captions": true,
  "captionStyle": "word-by-word",
  "captionPosition": "bottom",
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

---

## Asset Folder Structure

```
projects/<name>/
│
├── config.json                        # Video configuration (edit this)
│
├── assets/
│   ├── reference/
│   │   ├── style.jpg                  # Visual mood reference → Director + Gemini use this
│   │   ├── subject.jpg                # Product or person reference
│   │   └── location.jpg               # Location or environment reference
│   │
│   ├── storyboard/
│   │   ├── scene-1.png                # AUTO: Gemini-generated starting frame for clip 1
│   │   ├── scene-1-lastframe.png      # AUTO: extracted by ffmpeg after clip 1 is generated
│   │   ├── scene-2.png                # AUTO: Gemini used scene-1-lastframe for visual continuity
│   │   └── ...
│   │
│   ├── brand/
│   │   ├── logo.png                   # Brand logo (transparent background)
│   │   ├── font-bold.ttf              # Optional custom font (bold)
│   │   ├── font-regular.ttf           # Optional custom font (regular)
│   │   └── brand.json                 # Brand colors: { "primary", "secondary", "accent" }
│   │
│   └── audio/
│       ├── music.mp3                  # Background track (set music: true in config)
│       └── sfx/                       # Sound effects (reserved for future use)
│
├── cache/
│   ├── fal-cache.json                 # Prevents duplicate fal.ai API calls
│   ├── director-plan.json             # Cached Director enrichment plan
│   └── captions.json                  # Whisper transcript cache
│
└── output/
    ├── audio/
    │   └── voiceover.mp3              # ElevenLabs-generated voiceover
    ├── clips/
    │   ├── scene-1.mp4                # fal.ai output per scene
    │   └── scene-2.mp4
    └── final/
        └── [title]-[format]-[timestamp].mp4   # Final deliverable
```

### Auto-discovery

The pipeline automatically matches `scene-N.png` files in `assets/storyboard/` to clips by scene index. No `imageReference` paths needed in `config.json` as long as you follow the naming convention.

You can manually place your own PNGs in `assets/storyboard/` to override or supplement Gemini's output — Gemini will skip any scene that already has a file.

---

## Troubleshooting

### fal.ai returns 403 or balance error

Top up your fal.ai balance at [fal.ai/dashboard](https://fal.ai/dashboard). The pipeline charges per clip generation. Check `fal-cache.json` — cached clips are never regenerated.

### Gemini returns no image data

The `gemini-2.5-flash-image` model requires the `GEMINI_API_KEY` to be set. The storyboard step is non-fatal — if Gemini fails, the pipeline falls back to text-to-video mode for that scene (no starting frame image).

### FFmpeg not found

```
Error: spawn ffmpeg ENOENT
```

```bash
which ffmpeg   # should return /opt/homebrew/bin/ffmpeg
brew install ffmpeg  # if nothing returned
```

Restart your terminal after installing.

### Remotion bundle error

```
Error: Could not find file ...
```

Usually a TypeScript error preventing the bundle from resolving. Run first:

```bash
npm run build
```

Fix any reported errors, then re-run the pipeline.

### Whisper returns no word timestamps

Whisper word-level timestamps require audio of at least 1 second. If your script is very short, set `captions: false` in `config.json`.

### ElevenLabs quota exceeded

You've used all available characters for the billing period. The cached `output/audio/voiceover.mp3` is reused on subsequent runs — re-running never regenerates audio if the file exists.

### "No config.json found"

```bash
npm run new-project -- --name <project-name> --format youtube-short
```

### "No clips were generated or downloaded"

- All clips are missing both `prompt` and `url` in `config.json`
- fal.ai failed for every clip (check your balance and API key)
- The `clips` array is empty

### Storyboard images not being picked up

The pipeline logs `"No storyboard frames found"` and falls back to text-to-video. Check that images are named exactly `scene-1.png`, `scene-2.png` (lowercase, hyphens, no spaces) inside `assets/storyboard/`.
