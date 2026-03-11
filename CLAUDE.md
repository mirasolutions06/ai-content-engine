# CLAUDE.md — AI Content Engine

## Project Overview

This is a unified AI content production engine that generates brand images, videos, voiceovers, captions, copy, and platform-ready content packages from a single brief. It combines two previously separate pipelines (brand image generation and full video production) into one system orchestrated by 5 Claude skills.

## Architecture

```
Brief Generator (Skill 1)
    ↓ config.json (validated, cost-estimated)
    ↓
Pipeline Runner (Skill 2)
    ↓ --storyboard-only first (cheap preview)
    ↓ human approval gate
    ↓ full generation (images, videos, audio)
    ↓
Copy Engine (Skill 3)
    ↓ captions, hashtags, ad copy, emails
    ↓
Asset Packager (Skill 4)
    ↓ platform-ready folders
    ↓
Distributor (Skill 5)
    ↓ scheduled, monetized, tracked
```

---

## Cost Management Rules

These rules are critical. A single bad pipeline run can burn $5-20+ in API credits. Follow these strictly.

### Cost Map

| Step | API | Cost per call | Waste risk |
|---|---|---|---|
| Director | Claude Sonnet 4.6 | ~$0.05-0.15 | Low — cached by config hash |
| Voiceover | ElevenLabs | ~$0.30-1.00 | Medium — no preview |
| Transcription | Whisper | ~$0.01-0.05 | Low — cheap |
| Storyboard (Gemini) | Gemini 3 Pro Image | ~$0.05-0.15/frame | Medium |
| Storyboard (GPT Image) | GPT Image 1 | ~$0.04-0.08/frame | Medium |
| Video clips (Kling v2.1) | Kling v2.1 Pro via fal.ai | ~$0.49-0.90/clip | HIGH — most expensive |
| Video clips (Kling v3) | Kling v3 Pro via fal.ai | ~$1.12-2.24/clip | HIGH — ~2.3x more than v2.1 |
| Video clips (Veo 3.1) | Google Veo 3.1 | ~$4.50-6.00/clip | HIGH — 4-8s clips |
| Rendering | Remotion | Free (local) | None |
| Copy gen | Claude (skills) | ~$0.05-0.15 | Low |

### Hard Rules

1. NEVER call Kling without the user reviewing storyboard frames first. Always run --storyboard-only on the first run of any new project. Only proceed to Kling after the user explicitly approves the frames.
2. Default to --dry-run for new projects. Show what every API call would send before actually sending it.
3. Cache every API call using content-hash based caching. Follow the Director's pattern: hash the inputs, check cache, skip if match.
4. Show estimated cost before any pipeline run. The Pipeline Runner skill must calculate and display estimated spend before executing.
5. Use Haiku for validation, Sonnet for generation. Quick checks use claude-haiku-4-5-20251001. Creative generation uses claude-sonnet-4-6.
6. Log all API costs to projects/{name}/cache/cost-log.json after every run.
7. Validate prompts before sending to any API. Catch bad prompts before they cost money.
8. Progressive generation order: cheapest first. Director → Storyboard → GATE → Voiceover → Whisper → GATE → Kling.

### Model Selection

| Task | Model | Reason |
|---|---|---|
| Director (creative decisions) | claude-sonnet-4-6 | Needs strong reasoning + vision |
| Brief generation | claude-sonnet-4-6 | Writing quality matters |
| Brief/config validation | claude-haiku-4-5-20251001 | Rule-based check, fast + cheap |
| Copy generation (captions etc) | claude-sonnet-4-6 | Writing quality matters |
| Prompt validation | claude-haiku-4-5-20251001 | Simple rule check |
| Telegram commentary | claude-haiku-4-5-20251001 | High volume, needs to be cheap |

---

## Existing Codebase — DO NOT REWRITE

This project absorbs two existing TypeScript pipelines. The code is production-tested and must not be rewritten. Only additive changes are allowed.

### Source 1: ai-video-production-pipeline (THE BASE)

Full video production pipeline. This is the foundation of the project.

Pipeline steps (in order):
1. Load config.json + project assets
2. AI Director (Claude Sonnet 4.6) — enriches prompts with cinematography direction, voice settings, hook/CTA suggestions. Cached by config hash.
3. ElevenLabs voiceover generation (with SSML enrichment from Director)
4. Whisper transcription → word-level captions
5. Gemini storyboard frame generation (with scene-to-scene continuity via lastframe)
6. fal.ai Kling v2.1 Pro image-to-video animation
7. Remotion programmatic video composition (compositions: YoutubeShort, TikTok, Ad, WebHero)
8. ffmpeg packaging with faststart for streaming
9. Airtable run logging

Key files:
- src/pipeline/index.ts — main orchestrator, two-phase (serial storyboard → sequential video), all steps idempotent
- src/pipeline/director.ts — Claude-powered AI director, reads prompt best practices
- src/pipeline/image-router.ts — dispatches to Gemini or GPT Image based on config.imageProvider
- src/pipeline/storyboard.ts — Gemini frame generation
- src/pipeline/gpt-image.ts — GPT Image 1 frame generation (alternative to Gemini)
- src/pipeline/fal.ts — Kling video generation via fal.ai
- src/pipeline/veo.ts — Google Veo 3.1 video generation
- src/pipeline/elevenlabs.ts — voiceover generation
- src/pipeline/whisper.ts — audio transcription
- src/pipeline/export.ts — final video packaging
- src/pipeline/airtable.ts — run tracking
- projects/_shared/prompt-best-practices.md — research-backed prompting reference (loaded by Director)
- src/remotion/ — all Remotion compositions and components
- src/types/index.ts — all TypeScript interfaces
- src/cli/run-pipeline.ts — CLI entry point
- src/cli/new-project.ts — project scaffolding

Config schema: See src/types/index.ts for VideoConfig interface. Projects live in projects/{name}/config.json.

Key config fields for flexible output:
- `imageProvider`: `'gemini'` (default) or `'gpt-image'` — project-level, routes storyboard generation
- `outputType` per clip: `'image'` / `'video'` / `'animation'` — determines what each scene produces
- `duration` per clip: any number 1-15 seconds (Veo maps to 4/6/8s, Kling to 5/10s)

Environment variables required:
- FAL_KEY — fal.ai API key
- ELEVENLABS_API_KEY — ElevenLabs API key
- OPENAI_API_KEY — for Whisper transcription AND GPT Image (when imageProvider: 'gpt-image')
- ANTHROPIC_API_KEY — for Director (Claude Sonnet 4.6)
- GEMINI_API_KEY — for storyboard frame generation (default) and Veo video generation
- AIRTABLE_TOKEN + AIRTABLE_BASE_ID (optional) — run logging

### Source 2: ai-brand-pack (ABSORB AS IMAGE-ONLY MODE)

Simpler pipeline focused on multi-format brand image generation.

Pipeline steps:
1. Load config.json
2. Gemini 2.5 Flash image generation (with optional reference image)
3. Multi-format output: story (9:16), square (1:1), landscape (16:9)
4. Optional: fal.ai Kling animation → ffmpeg reel assembly

Key files to absorb:
- src/pipeline/images.ts — Gemini image generation with format-aware prompting
- src/types/index.ts — ImageFormat, BrandPackConfig, FORMAT_ASPECT types

What to merge:
- Add ImageFormat and FORMAT_ASPECT to the main types file
- Add brand-images.ts to the pipeline directory (adapted from images.ts)
- Add a mode field to the config: "brand-images" | "video" | "full"
- In index.ts, route to image-only flow when mode is "brand-images"

---

## Merge Instructions

### Step 1: Set up the new repo structure

```
ai-content-engine/
├── CLAUDE.md                    (this file)
├── src/
│   ├── pipeline/                (from video-production + brand-pack merge)
│   ├── remotion/                (from video-production, untouched)
│   ├── cli/                     (from video-production, small additions)
│   ├── types/                   (merged types from both)
│   └── utils/                   (from video-production + new utilities)
├── skills/                      (NEW)
│   ├── brief-generator/SKILL.md
│   ├── pipeline-runner/SKILL.md
│   ├── copy-engine/SKILL.md
│   ├── asset-packager/SKILL.md
│   └── distributor/SKILL.md
├── projects/                    (existing structure)
├── package.json                 (merged deps)
└── tsconfig.json
```

### Step 2: Required code changes

All changes are additive. No existing behavior may be altered.

Change 1: Add --dry-run flag to src/cli/run-pipeline.ts
When --dry-run is passed, the pipeline runs all logic (config loading, validation, prompt building, Director planning) but skips all paid API calls (ElevenLabs, Whisper, Gemini image gen, Kling). Instead, log exactly what would be sent to each API with estimated cost. The Director step SHOULD still run in dry-run mode (it is cheap and cached). This lets you preview the enriched prompts before committing to expensive generation.

Change 2: Add --json-output flag to src/cli/run-pipeline.ts
When passed, print a JSON summary after completion with: success boolean, outputPath, projectDir, mode, assets object (listing all images, clips, voiceover, video paths), estimatedCost total, and which steps were cached.

Change 3: Add brand-context.json export to src/pipeline/director.ts
After the Director plan is generated and cached, also write a simplified brand context file to projects/{name}/cache/brand-context.json. Include: brand name, tone, visualStyle, hookText, cta, targetAudience, array of scene summaries with index/prompt/enrichedPrompt/mood, and voiceSettings with stability/style/tone description. This is what downstream skills (Copy Engine) read. ~15 lines added to the existing cache-saving function.

Change 4: Add mode field to config and routing
In src/types/index.ts add to VideoConfig: mode?: 'brand-images' | 'video' | 'full' with default 'video' for backward compatibility. In src/pipeline/index.ts add early routing: if mode is brand-images run only Gemini multi-format image generation. If mode is full run brand-images THEN the video pipeline. Existing behavior unchanged for mode video or undefined.

Change 5: Add src/pipeline/brand-images.ts
Adapted from brand-pack's images.ts. Uses same Gemini generation logic but integrated with this project's structure: uses the project assets/reference/ directory for reference images, uses Director brand-context.json for enriched prompting if available, outputs to projects/{name}/output/images/ with format in filename, follows idempotent pattern (skip if file exists), uses hash-based caching.

Change 6: Add src/utils/prompt-validator.ts
Validates prompts before they are sent to any paid API. Checks: prompt length (20-400 chars for Kling), detects text/logo requests (AI video cannot do these), checks for visual style cues, warns on complex multi-subject scenes, validates script length against format time limits, validates full config with clip count cost warnings. Run validation in the pipeline before any API calls. Log warnings but do not block.

Change 7: Add src/utils/cost-tracker.ts
Tracks estimated API spend per pipeline run. Has a cost estimate map for each API (director ~$0.10, elevenlabs ~$0.50, whisper ~$0.02, gemini frame ~$0.08, kling v2.1: $0.49/5s, $0.90/10s; kling v3: $1.12/5s, $2.24/10s). Logs each step with running total using the logger. Has estimateRun(config) method that pre-calculates total cost based on klingVersion. Saves full cost log to projects/{name}/cache/cost-log.json. Tracks which steps were cached (saved money).

Change 8: Add hash-based caching to ElevenLabs voiceover in src/pipeline/elevenlabs.ts
Replace the simple file-exists check with a content-hash cache. Hash the script text + voiceId + all voice settings (stability, similarityBoost, style). Cache voiceover files as voiceover-{hash}.mp3 in the cache/ directory. Copy to output/voiceover.mp3 for the pipeline to consume. This prevents regenerating voiceover when non-script config fields change.

### Step 3: Verify nothing is broken

After all changes: npm run build must pass clean. Existing test-project must produce identical output. New flags (--dry-run, --json-output, --storyboard-only) must work.

---

## Structured Data Patterns

Use JSON for data flowing between pipeline steps and skills. Use English for instructions and system prompts. Use JSON schemas for LLM output when you need structured responses.

When to use JSON input to LLMs:
- Passing configs, scene lists, asset manifests, or structured context → JSON
- The Director already does this correctly: sends brief as JSON, receives DirectorPlan as JSON
- Skills should pass brand-context.json contents as structured context when calling Claude

When to use English:
- System prompts and instructions → English
- Creative direction and tone guidance → English
- SKILL.md files → English with embedded JSON schemas for output

Structured output pattern for skills that need Claude to return structured data:
- Include the exact JSON schema in the system prompt
- Tell the model to return ONLY valid JSON, no markdown fences, no explanatory text
- Parse with try/catch and strip accidental markdown fences before JSON.parse (same pattern as Director)
- Use Haiku for validation of generated JSON, Sonnet for the generation itself

---

## Skills to Build

Build these IN ORDER. Each skill is a SKILL.md file in skills/.

### Skill 1: Brief Generator (skills/brief-generator/SKILL.md)

Purpose: Eliminates manual config.json writing. Takes natural language → valid config.json.

Trigger phrases: "create a brief", "new project", "generate content for [brand]", "start a campaign"

Behavior:
1. Gather input: brand/product name + what they sell. Optional: audience, platforms, reference images, budget, competitor URLs.
2. Web search to research brand/niche/competitors for visual and tonal references.
3. Generate valid config.json matching VideoConfig TypeScript interface exactly. Include mode, format, title, client, script (if video), voiceId (if script), clips array with detailed visual prompts, transition, captions, hookText, cta, music settings.
4. Validate using prompt-validator: check scene prompts for common issues (too short, mentions text, no style cues), check script length vs format, flag if clip count cost is high.
5. Show cost estimate breakdown before saving. Recommend --storyboard-only first.
6. Save to projects/{slug}/config.json.

Scene prompt quality rules embedded in the skill:
- Each prompt 50-300 characters
- Must include visual style cue (lighting, color, mood)
- Must NOT include text, logos, typography requests
- Describe a single clear moment, not a sequence
- First scene = most visually striking (the hook)
- Last scene = complements the CTA

After generating, validate with Haiku (cheap) before saving. Fix issues and re-validate. Never save an invalid config.

### Skill 2: Pipeline Runner (skills/pipeline-runner/SKILL.md)

Purpose: Orchestrates the TypeScript pipeline with cost-aware safeguards.

Trigger phrases: "run the pipeline", "generate assets", "build content", "run step 2"

Behavior:
1. Read config.json, determine mode.
2. Check .env for required API keys. Report missing ones.
3. ALWAYS --dry-run first for new projects. Show what would be generated + cost estimate. Ask confirmation.
4. ALWAYS --storyboard-only before full generation. Show frames to user. Only proceed to Kling on explicit approval.
5. On approval: npm start -- --project {name} --json-output
6. Parse JSON output, list generated assets.
7. On failure: check error, suggest fixes, offer retry.

Never skip storyboard review. Kling costs 10-40x more than Gemini frames.

### Skill 3: Copy Engine (skills/copy-engine/SKILL.md)

Purpose: Generates all text content paired with visual assets.

Trigger phrases: "write copy", "generate captions", "create post text", "run step 3"

Behavior:
1. Read projects/{name}/cache/brand-context.json
2. Read projects/{name}/config.json
3. List all generated assets in output/
4. For each asset, generate platform-specific copy using structured JSON output from Claude:
   - Instagram: caption (100-300 words) + 15-20 hashtags + CTA
   - TikTok: caption (<150 chars) + on-screen text suggestions + 5-8 hashtags + sound suggestion
   - LinkedIn: professional post (150-300 words, story-lesson-CTA) + 3-5 hashtags
   - Twitter: tweet (<280 chars) + optional thread
   - YouTube: title (<60 chars) + description (100-200 words) + 10-15 tags
   - Ad copy: headline (<40 chars) + body (<125 chars) + CTA
5. Generate 4-email sequence: welcome/deliver → value → soft pitch → urgency
6. Generate lead magnet concept: title, format, description, landing CTA
7. Save to projects/{name}/output/copy/ as separate JSON files per platform plus all-copy.json combined.

Copy quality rules: no generic filler, every post opens with a hook, monetization feels natural, hashtags are researched via web search not guessed, each platform follows its own conventions and limits.

### Skill 4: Asset Packager (skills/asset-packager/SKILL.md)

Purpose: Organizes outputs into platform-ready packages.

Trigger phrases: "package assets", "prepare for posting", "deliverables", "run step 4"

Behavior:
1. Read all outputs (images, clips, videos, copy)
2. Create deliverables/ folder structure: instagram/, tiktok/, linkedin/, youtube/, ads/, email/
3. Match each visual asset with corresponding copy
4. Rename files: {brand}-{platform}-{type}-{number}.{ext}
5. Generate posting-schedule.md with dates, times, order
6. Generate README.md explaining the package

### Skill 5: Distributor + Monetizer (skills/distributor/SKILL.md)

Purpose: Monetization strategies and distribution setup.

Trigger phrases: "monetize", "affiliate links", "distribution plan", "run step 5"

Behavior:
1. Web search for real affiliate programs in the niche with signup links
2. Research trending monetization strategies for the campaign platforms
3. Update copy files with affiliate CTA variants where natural
4. Generate monetization-plan.json: revenue streams with type/name/platform/commission/setup steps, projections by follower tier (1K/10K/50K), UTM parameters for all links, specific action items
5. Save to projects/{name}/output/monetization-plan.json
6. Generate tracking spreadsheet template (CSV)

Revenue projections must be realistic and based on published benchmarks found via web search.

---

## Code Style

- TypeScript with strict mode
- ES modules (import/export, .js extensions in imports)
- Async/await throughout, no callbacks
- Use existing logger utility for all console output
- All pipeline steps must be idempotent (skip if output exists)
- Cache expensive API calls with content-hash caching (follow Director pattern)
- Handle API failures gracefully: logger.warn() and continue, never crash
- New utilities go in src/utils/
- New pipeline steps go in src/pipeline/
- Skills are pure SKILL.md files in skills/ — no code, no dependencies
- Keep skills and docs lean — every line earns its place. Guide behavior, don't over-prescribe

## Testing

```bash
npm run build                                           # Must pass clean
npm start -- --project test-project --dry-run           # Existing project, dry run
npm start -- --project test-project --storyboard-only   # Storyboard preview
npm start -- --project test-project --json-output --dry-run | python3 -c "import sys,json; json.load(sys.stdin)"  # Valid JSON output
```

## Dependencies

Existing (keep all, do not upgrade):
- @google/genai — Gemini
- @fal-ai/client — Kling
- @anthropic-ai/sdk — Claude Director
- @remotion/bundler + @remotion/renderer — video composition
- commander — CLI
- dotenv — env management
- fs-extra — file operations

No new npm dependencies for any change. Skills require no dependencies.
