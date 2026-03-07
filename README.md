# AI Content Engine

One brief in, platform-ready content out. Generate brand images, AI video, voiceovers, captions, copy, and deliverable packages from a single natural-language brief — orchestrated by 5 Claude skills with built-in cost controls.

---

## What It Does

```
Brief Generator ──→ Pipeline Runner ──→ Copy Engine ──→ Asset Packager ──→ Distributor
   (Skill 1)          (Skill 2)         (Skill 3)       (Skill 4)         (Skill 5)

 Natural language     Images, video,    Platform copy,   Organized         Monetization
 → valid config       voiceover,        hashtags, ads,   deliverables      strategy +
 + cost estimate      captions          email sequences  per platform      affiliate plan
```

**Three pipeline modes:**

| Mode | What it generates | Cost |
|------|-------------------|------|
| `brand-images` | Multi-format images (story 9:16, square 1:1, landscape 16:9) | Low |
| `video` | Full AI video with voiceover, captions, transitions, CTA | Medium–High |
| `full` | Brand images + full video pipeline | Highest |

## AI Stack

| Service | Role |
|---------|------|
| **Claude Sonnet 4.6** | Director AI — enriches prompts, plans cinematography, voice direction |
| **Gemini 2.5 Flash** | Storyboard frame generation + multi-format brand images |
| **fal.ai Kling v2.1** | Image-to-video clip generation |
| **ElevenLabs** | Voiceover generation |
| **OpenAI Whisper** | Word-level caption transcription |
| **Remotion** | Programmatic video composition (shorts, TikTok, ads, web hero) |

## Cost Safety

Every pipeline run follows a progressive generation order — cheapest steps first, human approval gates before expensive ones:

```
Director ($0.10) → Storyboard ($0.05/frame) → ⛔ REVIEW GATE
    → Voiceover ($0.50) → Whisper ($0.02) → ⛔ APPROVAL GATE
    → Kling ($1-2/clip) → Remotion (free) → Final MP4
```

The `--dry-run` flag shows exactly what every API call would send and the estimated total cost — without spending anything.

---

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **FFmpeg** — for last-frame extraction and video packaging

```bash
brew install ffmpeg
```

## Installation

```bash
git clone https://github.com/mirasolutions06/ai-content-engine.git
cd ai-content-engine
npm install
```

Create `.env` in the project root:

```env
FAL_KEY=
ELEVENLABS_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=

# Optional
AIRTABLE_API_KEY=
AIRTABLE_BASE_ID=
AIRTABLE_TABLE_ID=
```

<details>
<summary>Where to get API keys</summary>

| Key | Where to get it | Used for |
|-----|-----------------|----------|
| `FAL_KEY` | [fal.ai](https://fal.ai) → Settings → API Keys | Kling video generation |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API key | Storyboard + brand images |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys | Director AI (Claude) |
| `ELEVENLABS_API_KEY` | [elevenlabs.io](https://elevenlabs.io) → Profile → API Keys | Voiceover |
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) → API Keys | Whisper captions only |

</details>

---

## Quick Start

### 1. Create a project

```bash
npm run new-project -- --name my-ad --format youtube-short
```

Formats: `youtube-short`, `tiktok`, `ad-16x9`, `ad-1x1`, `web-hero`

### 2. Edit config or use the Brief Generator skill

Either edit `projects/my-ad/config.json` manually, or use **Skill 1** (Brief Generator) in Claude Code to generate a validated config from a natural-language brief.

### 3. Dry run — preview without spending

```bash
npm start -- --project my-ad --dry-run
```

Shows every planned API call and estimated cost.

### 4. Storyboard preview — review before committing to video

```bash
npm start -- --project my-ad --storyboard-only
```

Generates Gemini storyboard frames and stops. Review `assets/storyboard/scene-*.png` before proceeding.

### 5. Full pipeline

```bash
npm start -- --project my-ad
```

All steps are idempotent — re-running never duplicates API calls.

### 6. JSON output (for automation)

```bash
npm start -- --project my-ad --json-output
```

Prints a structured JSON summary: success status, output paths, generated assets, cost breakdown, and cache hits.

---

## The 5 Skills

Skills are Claude Code instructions in `skills/` that orchestrate the pipeline with guardrails. Use them conversationally:

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **Brief Generator** | "create a brief for [brand]" | Researches the brand, generates valid config.json, validates prompts, shows cost estimate |
| **Pipeline Runner** | "run the pipeline" | Enforces dry-run → storyboard → approval → generation flow |
| **Copy Engine** | "write copy" | Generates platform-specific captions, hashtags, ad copy, email sequences, lead magnets |
| **Asset Packager** | "package assets" | Organizes outputs into platform-ready folders with matched copy and posting schedule |
| **Distributor** | "monetize this" | Finds real affiliate programs, generates revenue projections, builds tracking plan |

---

## Visual Continuity

Gemini generates each storyboard frame using the **last frame of the previous clip** as context — maintaining subject, lighting, and color across scenes automatically.

```
scene-1.png (from prompt) → Kling → scene-1.mp4 → ffmpeg extracts lastframe
                                                         ↓
scene-2.png (from prompt + lastframe context) → Kling → scene-2.mp4 → ...
```

---

## CLI Reference

### Create a project

```bash
npm run new-project -- --name <name> --format <format>
```

### Run the pipeline

```bash
npm start -- --project <name> [options]
```

| Flag | Description |
|------|-------------|
| `--project <name>` | Project folder under `projects/` (required) |
| `--dry-run` | Preview all API calls with cost estimate, no spending |
| `--storyboard-only` | Generate storyboard frames only, stop before video |
| `--json-output` | Print structured JSON summary to stdout |
| `--list-voices` | List available ElevenLabs voices and exit |

### Other commands

```bash
npm run build       # TypeScript check (tsc --noEmit)
npm run remotion    # Open Remotion Studio for visual preview
```

---

## config.json Reference

<details>
<summary>Full config fields</summary>

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mode` | `string` | No | `"video"` | `"video"`, `"brand-images"`, or `"full"` |
| `format` | `string` | Yes | — | `youtube-short`, `tiktok`, `ad-16x9`, `ad-1x1`, `web-hero` |
| `title` | `string` | Yes | — | Used in output filename |
| `client` | `string` | No | — | Client name, shown in lower thirds |
| `script` | `string` | No | `""` | Voiceover text (empty = skip voiceover) |
| `voiceId` | `string` | No | — | ElevenLabs voice ID (required if script is set) |
| `clips` | `array` | Yes | — | Scene definitions (at least one) |
| `transition` | `string` | No | `"crossfade"` | `crossfade`, `cut`, or `wipe` |
| `captions` | `boolean` | No | format default | Render word-by-word captions |
| `captionStyle` | `string` | No | `"word-by-word"` | `word-by-word` or `line-by-line` |
| `captionPosition` | `string` | No | `"bottom"` | `bottom`, `center`, or `top` |
| `hookText` | `string` | No | — | Bold text shown at top for first 2 seconds |
| `cta` | `object` | No | — | End screen CTA: `{ text, subtext, durationSeconds }` |
| `music` | `boolean` | No | `false` | Use `assets/audio/music.mp3` as background |
| `musicVolume` | `number` | No | `0.15` | Background music volume (0–1) |

**Clip fields:**

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | Scene description for Gemini + Kling |
| `imageReference` | `string` | Path to storyboard image (overrides auto-discovery) |
| `url` | `string` | URL to pre-generated MP4 (skips fal.ai) |
| `duration` | `5 \| 10` | Clip duration in seconds (default: 5) |

</details>

<details>
<summary>Example config.json</summary>

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

</details>

---

## Project Structure

```
projects/<name>/
├── config.json                          # Pipeline configuration
├── assets/
│   ├── reference/                       # Style, subject, location references
│   ├── storyboard/                      # Gemini frames + lastframes
│   ├── brand/                           # Logo, fonts, brand.json
│   └── audio/                           # Music, SFX
├── cache/
│   ├── director-plan.json               # Cached Director enrichment
│   ├── brand-context.json               # Brand context for Copy Engine
│   ├── fal-cache.json                   # Kling generation cache
│   ├── captions.json                    # Whisper transcript cache
│   └── cost-log.json                    # API spend log
└── output/
    ├── audio/voiceover.mp3              # ElevenLabs voiceover
    ├── images/                          # Brand images (story, square, landscape)
    ├── clips/scene-*.mp4                # Kling video clips
    ├── copy/                            # Platform copy JSONs
    ├── final/                           # Final rendered MP4
    └── deliverables/                    # Platform-ready packages
```

---

## Troubleshooting

<details>
<summary>Common issues</summary>

**fal.ai returns 403 or balance error** — Top up at [fal.ai/dashboard](https://fal.ai/dashboard). Cached clips in `fal-cache.json` are never regenerated.

**Gemini returns no image data** — Check `GEMINI_API_KEY` is set. The storyboard step is non-fatal — falls back to text-to-video mode.

**FFmpeg not found** — `brew install ffmpeg` and restart your terminal.

**Remotion bundle error** — Run `npm run build` first to catch TypeScript errors.

**Whisper returns no word timestamps** — Audio must be at least 1 second. Set `captions: false` for very short scripts.

**ElevenLabs quota exceeded** — Cached `voiceover.mp3` is reused on re-runs.

**"No config.json found"** — Run `npm run new-project -- --name <name> --format youtube-short`

**Storyboard images not picked up** — Files must be named exactly `scene-1.png`, `scene-2.png` (lowercase, hyphens) in `assets/storyboard/`.

</details>
