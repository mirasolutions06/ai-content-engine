---
name: pipeline-runner
description: "Runs the AI content generation pipeline with cost-safe guardrails. Use this skill whenever someone wants to run the pipeline, generate assets, build content, generate video, generate images, or says 'run step 2' or 'start generation'. This skill enforces the mandatory dry-run and storyboard preview steps before any expensive API calls. NEVER run the pipeline without this skill — it prevents wasted money."
---

# Pipeline Runner

You orchestrate the TypeScript pipeline with mandatory cost-safety guardrails. Your job is to prevent expensive mistakes by enforcing a progressive generation workflow: dry-run first, storyboard preview second, full generation only after explicit approval.

## Cost Safety Rules

These are non-negotiable. Embed them in your decision-making at every step.

1. **NEVER skip the dry-run step for new projects.** Even if the user says "just run it."
2. **NEVER skip the storyboard review step.** Storyboard frames cost ~$0.05 each. Kling clips cost $1-2 each. Always preview before committing.
3. **NEVER proceed to Kling without explicit user approval.** The word "approve", "yes", "go ahead", "looks good", or equivalent must appear.
4. **If the user says "just run it" or "skip preview"**, explain: "Kling clips cost $1-2 each and can't be refunded. Storyboard preview costs ~$0.25 total and catches prompt issues before they're expensive. Running storyboard first."
5. **Show running cost total after each step completes.**
6. **If a step fails, do not retry automatically.** Diagnose the error first.

## Workflow

### Step 1: Pre-flight Checks

Verify the project is ready to run.

**Check config exists:**
```bash
# Verify config.json exists
ls projects/{name}/config.json
```
If missing, tell user: "No config.json found. Say 'create a brief' or 'run step 1' to generate one."

**Read config and determine mode:**
```bash
# Read config to check mode
cat projects/{name}/config.json
```

Mode determines which API keys are required:

| Mode | Required API keys |
|---|---|
| `brand-images` | `GEMINI_API_KEY` (or `OPENAI_API_KEY` if imageProvider is `gpt-image`) |
| `video` (all image outputType) | Image provider key + `ANTHROPIC_API_KEY` |
| `video` (with video/animation clips) | Image provider key + `FAL_KEY`/`GEMINI_API_KEY` (video provider) + `ELEVENLABS_API_KEY` + `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` |
| `full` | All of the above |

Image provider key: `GEMINI_API_KEY` (default) or `OPENAI_API_KEY` (if `imageProvider: "gpt-image"`).
Video provider key: `FAL_KEY` (Kling) or `GEMINI_API_KEY` (Veo).

**Check .env for required keys:**
```bash
# Check which keys are set (don't print values)
grep -c "GEMINI_API_KEY=" .env
grep -c "FAL_KEY=" .env
grep -c "ELEVENLABS_API_KEY=" .env
grep -c "OPENAI_API_KEY=" .env
grep -c "ANTHROPIC_API_KEY=" .env
```

Report any missing keys with setup instructions:
- `GEMINI_API_KEY` — Get at https://aistudio.google.com/apikey
- `FAL_KEY` — Get at https://fal.ai/dashboard/keys
- `ELEVENLABS_API_KEY` — Get at https://elevenlabs.io/app/settings/api-keys
- `OPENAI_API_KEY` — Get at https://platform.openai.com/api-keys
- `ANTHROPIC_API_KEY` — Get at https://console.anthropic.com/settings/keys

**Optional keys** (not required but enhance output):
- `PEXELS_API_KEY` — Royalty-free style/location reference images
- `UNSPLASH_ACCESS_KEY` — Alternative image source
- `PIXABAY_API_KEY` — Royalty-free background music auto-sourcing
- `AIRTABLE_TOKEN` + `AIRTABLE_BASE_ID` — Run logging/tracking

### Step 2: Dry Run (MANDATORY for new projects)

Always start with a dry run. This runs the Director (cheap, ~$0.10, cached after first run) and shows exactly what every paid API call would send, without spending money.

```bash
npm start -- --project {name} --dry-run
```

Parse the output and present to the user:
- **Director plan**: visual style summary, enriched prompts per scene, voice settings, suggested caption theme
- **Asset sourcing**: what would be auto-sourced (colors, style ref, location ref, music)
- **Image provider**: which provider generates storyboard frames (Gemini or GPT Image)
- **Per-clip summary**: scene number, outputType (image/video/animation), duration, cost
- **Voiceover**: script text + voice ID + estimated cost (if applicable)
- **Video provider**: which provider generates clips (Kling v2.1/v3 or Veo 3.1)
- **Brand images** (if applicable): scene count x format count + cost
- **Total estimated cost**

Then ask:
```
Dry run complete. Estimated cost: ~${X.XX}

Breakdown:
  Asset sourcing:    ~$0.12
  Storyboard (Nx):   ~$0.XX
  Voiceover:         ~$0.50
  Whisper:           ~$0.02
  Kling clips (Nx):  ~$X.00
  ──────────────────────────
  Total:             ~$X.XX

Proceed to storyboard preview? (~$0.XX for Gemini frames only, no Kling charges)
```

**Skip condition:** If this project has been dry-run before and the user explicitly says to skip, you may proceed directly to storyboard. But NEVER skip dry-run on a project's first ever run.

### Step 3: Storyboard Preview (MANDATORY before Kling)

Generate Gemini storyboard frames without calling Kling. This costs ~$0.05 per frame.

```bash
npm start -- --project {name} --storyboard-only
```

After completion, list the generated frames (Gemini may return PNG or JPEG):
```
Storyboard frames generated:
  projects/{name}/assets/storyboard/scene-1.jpg
  projects/{name}/assets/storyboard/scene-2.jpg
  projects/{name}/assets/storyboard/scene-3.jpg
  projects/{name}/assets/storyboard/scene-4.jpg

Review the frames. Each one will become a 5-second video clip via Kling.
Cost per clip: v2.1 ~$0.49 (default) | v3 ~$1.12 (higher quality).

Options:
  "approve" — proceed to full generation (~$X.XX for Kling + voiceover)
  "revise scene 2" — describe what should change, I'll update the prompt
  "regenerate scene 3" — delete and re-run storyboard to get a new frame
  "abort" — stop here, no further charges
```

**If user wants to revise a prompt:**
1. Read current config.json
2. Update the specific clip prompt based on user feedback
3. Delete the storyboard frame for that scene: `projects/{name}/assets/storyboard/scene-{N}.png`
4. Re-run `--storyboard-only` (only the missing frame will regenerate — idempotent)
5. Show the new frame for approval

**If user wants to regenerate without changing the prompt:**
1. Delete the specific frame file
2. Re-run `--storyboard-only`

### Step 4: Full Generation (only after approval)

Only proceed when the user has explicitly approved the storyboard frames.

```bash
npm start -- --project {name} --json-output
```

This runs the full pipeline:
1. Asset sourcing (auto-sources brand colors, style reference, location reference, music)
2. Director (cached from dry-run — free)
3. Voiceover generation (ElevenLabs)
4. Transcription (Whisper)
5. Storyboard frames (cached from preview — free)
6. Kling video clips (the expensive part)
7. Remotion render (local, free)
8. Final video packaging (ffmpeg, local, free)

Parse the JSON output (`PipelineResult`):
```json
{
  "success": true,
  "outputPath": "/path/to/final-video.mp4",
  "projectDir": "/path/to/projects/{name}",
  "mode": "video",
  "assets": {
    "images": ["list of generated image paths"],
    "clips": ["list of generated clip paths"],
    "voiceover": "/path/to/voiceover.mp3",
    "video": "/path/to/final-video.mp4"
  },
  "estimatedCost": 5.42,
  "cachedSteps": ["director", "gemini-frame"]
}
```

Present results:
```
Pipeline complete!

Generated assets:
  Video:      projects/{name}/output/{title}-{timestamp}.mp4
  Voiceover:  projects/{name}/output/audio/voiceover.mp3
  Clips:      4 clips in projects/{name}/output/clips/
  Storyboard: 4 frames in projects/{name}/assets/storyboard/

Cost summary:
  Estimated total: ~$X.XX
  Saved by cache:  ~$X.XX (director, storyboard frames)

Say "write copy" or "run step 3" to generate text content for all platforms.
```

### Step 5: Handle Errors

If any step fails:

**API key errors:**
```
Error: ELEVENLABS_API_KEY is not set
→ Add your key to the .env file. Get one at: https://elevenlabs.io/app/settings/api-keys
```

**Kling generation failures:**
```
Error: fal.ai returned error for scene 3
→ The scene prompt may be too complex. Try simplifying it:
  Current: "{current prompt}"
  Suggestion: simplify to focus on one subject and one action
→ Or retry — fal.ai occasionally has transient failures
```

**Gemini failures:**
```
Error: Gemini returned no image data for scene 2
→ Try adjusting the prompt — Gemini may have flagged content.
→ Or delete the frame and re-run --storyboard-only
```

**General approach:** Never retry automatically. Diagnose first, suggest a fix, ask the user.

## Mode-Specific Behavior

### brand-images mode
```bash
# Dry run
npm start -- --project {name} --dry-run
# Full run (no storyboard step — images only)
npm start -- --project {name}
```
No storyboard preview needed — brand images are cheap (~$0.05 each) and fast. Still do the dry run to show what will be generated.

**QA scoring:** After each image generates, Claude Haiku vision scores it on model accuracy, product accuracy, composition, and artifacts (1-5 each). Results are logged inline and saved to `cache/qa-results.json`. Scores below 3.0 get a warning. QA does not auto-regenerate — it's a quality signal for review.

**Key quality factors for brand-images:**
- `products` field prevents phantom product invention
- `skipAutoRefs` avoids low-quality auto-generated style/location references
- Reference images (`model-*.jpg`, `product-*.jpg`) are the single biggest quality lever
- The Director enriches prompts with cinematography detail — config prompts should be evocative but not hyper-specific (leave room for enrichment)
- Scene-1 anchoring: the first generated image becomes the style reference for all subsequent images

### video mode — all image outputType
If every clip has `"outputType": "image"`, no video generation runs. Storyboard frames ARE the output — copied to `output/images/`. Skip storyboard review gate (images are cheap, ~$0.04-0.08 each). Remotion is skipped entirely.

### video mode — with video/animation clips
Full workflow: dry-run → storyboard → approve → full generation. Video clips generate sequentially to preserve tail-frame conditioning for smooth transitions. Animation clips auto-clamp to max 5s with minimal motion prompts.

### video mode — mixed (some images, some videos)
Dry-run shows which clips are images vs videos. Image clips are resolved in Phase 1 (storyboard). Only video/animation clips go through Phase 2 (video gen). Cost breakdown reflects the mix.

### full mode
Generates brand images first (cheap), then follows the full video workflow. Dry run shows both image and video costs.

## Partial Re-runs (Fix One Scene Without Re-running Everything)

This is the most common scenario after the first full generation: one scene looks wrong and needs fixing. The pipeline is fully idempotent — it skips any step whose output file already exists. So you only pay for what you regenerate.

### Fix a storyboard frame (scene looks wrong before Kling)

The user doesn't like how scene 3 looks in the storyboard preview.

1. **If the prompt needs changing:** Edit `config.json` to update the clip prompt for scene 3.
2. Delete the specific frame (check for both `.png` and `.jpg` — Gemini may return either format):
   ```bash
   rm projects/{name}/assets/storyboard/scene-3.png projects/{name}/assets/storyboard/scene-3.jpg 2>/dev/null
   ```
3. Re-run storyboard-only:
   ```bash
   npm start -- --project {name} --storyboard-only
   ```
   Only scene 3 regenerates (~$0.05). All other frames are skipped (files exist).
4. Show the new frame to the user for approval.

### Fix a Kling video clip (clip looks wrong after full generation)

Scene 2's video clip came out badly. The user wants just that one clip redone.

1. **Optionally** fix the storyboard frame first (see above) — better input = better video.
2. Delete the specific clip:
   ```bash
   rm projects/{name}/output/clips/scene-2.mp4
   ```
3. Re-run the full pipeline:
   ```bash
   npm start -- --project {name} --json-output
   ```
   Only scene 2's Kling generation runs (~$1.00). Director, voiceover, other storyboard frames, and other clips are all cached and free. The final Remotion render will re-run (local, free) to incorporate the new clip.

**Cost:** ~$1.00-2.00 for the single clip vs ~$4.00-8.00 for all clips. This is the biggest cost saver.

### Regenerate voiceover (after script edit)

The ElevenLabs voiceover uses hash-based caching: it hashes the script text + voice settings. If the user edits the script in `config.json`:

1. Just re-run the pipeline — the new script hash won't match the cache, so a new voiceover generates automatically.
2. The old cached file stays in `cache/voiceover-{old-hash}.mp3` (free rollback if needed).
3. Whisper will also re-run since the voiceover changed.

**No manual deletion needed** — the content hash handles it.

### Regenerate Director plan (after prompt edits)

The Director plan is cached by a hash of the entire `config.json`. If you edit any config field, the hash changes and the Director automatically re-runs on next pipeline execution.

To force a fresh plan even without config changes:
```bash
rm projects/{name}/cache/director-plan.json
```

Then re-run. The Director will also regenerate `cache/brand-context.json`.

### Quick reference

| What to fix | Delete | Re-run command | Cost |
|---|---|---|---|
| One storyboard frame | `assets/storyboard/scene-{N}.png` or `.jpg` | `--storyboard-only` | ~$0.05 |
| One video clip (v2.1) | `output/clips/scene-{N}.mp4` | `--json-output` | ~$0.49-0.90 |
| One video clip (v3) | `output/clips/scene-{N}.mp4` | `--json-output` | ~$1.12-2.24 |
| Voiceover | Nothing (hash auto-detects script change) | `--json-output` | ~$0.50 |
| Director plan | `cache/director-plan.json` | `--json-output` | ~$0.10 |
| Brand colors | `assets/brand/brand.json` | `--json-output` | ~$0.01-0.02 |
| Style reference | `assets/reference/style.png` or `.jpg` | `--json-output` | ~$0.05 |
| Everything | `cache/` and `output/` directories | `--json-output` | Full cost |

## Re-running Full Projects

If the user wants a complete re-run:

- **Cached steps are free.** Director plan, storyboard frames, and voiceover are all cached by content hash. Re-running with the same config produces the same output at zero cost.
- **Changed config triggers regeneration.** If the user modified prompts, script, or voice settings, only the changed steps regenerate.
- **To force full regeneration:** Delete the `cache/` and `output/` directories, then re-run.
