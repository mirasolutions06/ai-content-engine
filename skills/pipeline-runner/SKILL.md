---
name: pipeline-runner
description: "Generates visual assets (images and video). Triggers on: any request to generate, run, build, preview, or render content. Also handles: scene feedback ('scene 3 is too dark'), regeneration requests ('try that again'), quality concerns ('this looks bad'), and cost queries ('how much will this cost?'). If a project has a config.json but no generated assets, use this skill."
---

# Pipeline Runner

You orchestrate the TypeScript pipeline. Your job is to generate assets efficiently — protecting the user from expensive mistakes while not wasting their time on cheap operations.

## Session Awareness

When invoked:
1. Check what exists in the project directory (config.json, assets/, cache/, output/, deliverables/)
2. If previous output exists but wasn't acknowledged, briefly summarize it: "You already have 5 images from a previous run (avg QA 4.6/5)."
3. Read `cache/brand-context.json` if it exists — show the Director's creative decisions when relevant
4. Read `cache/cost-log.json` if it exists — know what was spent previously
5. Read `memory/brands/{slug}/brand-memory.json` if it exists — know this brand's history

## Pre-flight Checks

Verify the project is ready to run.

**Check config exists:**
```bash
ls projects/{name}/config.json
```
If missing: "No config found. Describe what you want and I'll create a brief."

**Read config and determine mode:**
```bash
cat projects/{name}/config.json
```

**Check .env for required API keys** based on mode:

| Mode | Required API keys |
|---|---|
| `brand-images` | `GEMINI_API_KEY` (or `OPENAI_API_KEY` if imageProvider is `gpt-image`) |
| `video` (all image outputType) | Image provider key + `ANTHROPIC_API_KEY` |
| `video` (with video/animation clips) | Image provider key + `FAL_KEY`/`GEMINI_API_KEY` (video provider) + `ELEVENLABS_API_KEY` + `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` |
| `full` | All of the above |

Report any missing keys with setup instructions:
- `GEMINI_API_KEY` — https://aistudio.google.com/apikey
- `FAL_KEY` — https://fal.ai/dashboard/keys
- `ELEVENLABS_API_KEY` — https://elevenlabs.io/app/settings/api-keys
- `OPENAI_API_KEY` — https://platform.openai.com/api-keys
- `ANTHROPIC_API_KEY` — https://console.anthropic.com/settings/keys

## Generation Flow (cost-proportional gates)

Match the approval ceremony to the cost. Don't make the user approve $0.50 of images the same way they approve $15 of video.

### LOW COST — brand-images or video with all image outputType (~$0.08/image)

Run immediately. No dry-run, no storyboard gate.

```bash
npm start -- --project {name} --json-output
```

After completion:
- Show generated images with QA scores inline
- If any QA score < 3.5, flag it: "Scene 3 scored 2.8/5 — want me to regenerate it?"
- Offer copy generation naturally (see Auto-Chain)

### MEDIUM COST — video with Kling v2.1, total <$5

Skip dry-run if the project has run before (config hash hasn't changed for Director).

Run storyboard preview:
```bash
npm start -- --project {name} --storyboard-only
```

Show frames. One approval gate:
```
Frames ready. Each becomes a 5-second video clip.
Cost for Kling v2.1: ~$X.XX for {N} clips.
Approve?
```

On approval:
```bash
npm start -- --project {name} --json-output
```

### HIGH COST — Kling v3, Veo, or total >$5

Always dry-run first:
```bash
npm start -- --project {name} --dry-run
```

Present Director plan + cost breakdown. Read `cache/brand-context.json` and show:
- Visual style, lighting, and color palette decisions
- Enriched prompt for each scene (first 100 chars)
- Suggested hook and CTA
- Full cost breakdown by step

Then storyboard preview:
```bash
npm start -- --project {name} --storyboard-only
```

Show frames. Explicit approval with cost stated:
```
Approve all {N} clips at ~$X.XX?
```

On approval:
```bash
npm start -- --project {name} --json-output
```

### Override

If the user says "just run it" or "skip preview" — explain the cost once. If they insist, respect it. The user's explicit intent takes priority.

## Scene Feedback

When the user gives feedback on specific scenes, translate it into pipeline operations. Don't make them know about file deletion or CLI flags.

### Prompt feedback ("scene 3 is too dark", "make scene 2 warmer")

1. Read config.json
2. Update the specific clip's prompt to incorporate the feedback
3. Delete the scene's output file(s) — check both `assets/storyboard/` and `output/` directories (both `.png` and `.jpg`)
4. Re-run with the appropriate flag (`--storyboard-only` for frames, full for clips)
5. Only the changed scene regenerates — everything else is cached
6. Show the new result

### Regeneration ("try scene 4 again", "give me options for scene 1")

- **Single retry**: Delete the file, re-run (same prompt, different generation result)
- **Multiple options**: `npm start -- --project {name} --variations 3`

### Bulk operations

- "Regenerate scenes 2 and 5": `npm start -- --project {name} --regenerate 2,5`
- "Start fresh": delete `cache/` and `output/` directories, re-run
- "Start completely fresh" (nuclear): also delete `assets/storyboard/`, `assets/`, `brand/`, and any root-level auto-generated ref images (`style.jpg`, `location.jpg`). Just deleting cache/ and output/ leaves contaminating files from previous runs.
- "Resume": `npm start -- --project {name} --resume`

### Video clip feedback ("the video for scene 2 is bad")

1. Delete `output/clips/scene-{N}.mp4`
2. Optionally fix the storyboard frame first (better input = better video)
3. Re-run: `npm start -- --project {name} --json-output`
4. Only that clip's Kling call runs (~$1). Everything else cached.

**Always show the cost of regeneration before doing it.**

## Advanced Features

Surface these when contextually relevant — don't list them upfront.

**Draft mode** (`--draft`):
Cheap preview: Kling v2.1 5s for all clips, skip voiceover and Remotion. ~60% cheaper. Offer when the user wants a "quick preview" or "rough cut" or is iterating on prompts.

**Resume** (`--resume`):
Continues from last checkpoint if pipeline was interrupted. Offer when pipeline fails mid-run, or user says "pick up where we left off."

**Variations** (`--variations 3`):
Generates 2-4 storyboard variations per scene using Director-suggested angles. Implies `--storyboard-only`. Offer when user is unsure about composition or wants options.

**Regenerate** (`--regenerate 3,5`):
Deletes and regenerates specific scenes. Other scenes untouched. Offer when user says "redo scene 3 and 5" or "try those two again."

**Config diff** (automatic):
Pipeline auto-detects which clips changed since last run. Unchanged clips use cached output (free). Mention when user edits prompts: "Only scenes 2 and 4 changed — regenerating those two only (~$0.16)."

**QA scores** (automatic for brand-images):
Every generated image gets a 1-5 quality score from Haiku vision. Proactively flag low scores: "Scene 3 scored 2.8/5 (artifacts detected). Regenerate?"

## Handle Errors

If any step fails:

**API key errors:**
```
Error: ELEVENLABS_API_KEY is not set
→ Add your key to .env. Get one at: https://elevenlabs.io/app/settings/api-keys
```

**Generation failures:**
```
Error: fal.ai returned error for scene 3
→ The prompt may be too complex. Try simplifying to one subject, one action.
→ Or retry — fal.ai occasionally has transient failures.
```

**Gemini failures:**
```
Error: Gemini returned no image for scene 2
→ Gemini may have flagged the content. Try adjusting the prompt.
→ Or delete the frame and regenerate.
```

**Remotion LowerThird crash:**
```
Error: inputRange must be strictly monotonically increasing but got [30,50,10,30]
→ This happens on very short single-clip videos (5s animation).
→ The CTA/hook timing arithmetic produces invalid ranges when total duration is very short.
→ The raw clip at output/clips/scene-{N}.mp4 IS the deliverable.
→ Remotion render can be skipped for single animation clips.
```

Never retry automatically. Diagnose first, suggest a fix, ask the user.

## Mode-Specific Behavior

### brand-images mode
No storyboard gate — images are cheap (~$0.08 each). Run directly via `npm start -- --project {name}`.

**QA scoring:** Haiku vision scores each image on model accuracy, product accuracy, composition, and artifacts (1-5). Results saved to `cache/qa-results.json`. Scores below 3.0 get a warning.

**Key quality factors:**
- `products` field prevents phantom product invention
- `skipAutoRefs` avoids low-quality auto-generated references
- Reference images (`model-*.jpg`, `product-*.jpg`) are the single biggest quality lever
- Per-clip `refs` field: when multiple products exist, assign specific refs per scene (`"refs": ["product-1.jpg"]`) instead of sending all refs to every generation — prevents Gemini from conflating different products
- Director enriches prompts — config prompts should be evocative, not hyper-specific
- `moodBoard` URLs: paste Pinterest pins or image URLs to auto-download as style/location refs before generation
- Scene-1 anchoring: first image becomes style reference for all subsequent images

### video mode — all image outputType
No video generation. Storyboard frames ARE the output. No storyboard review gate needed. Remotion skipped.

### video mode — with video/animation clips
Full flow with cost-proportional gates (see above). Each clip is independent. Animation clips auto-clamp to 5s max.

### video mode — mixed
Dry-run shows which clips are images vs videos. Image clips resolve in Phase 1 (cheap). Video clips go through Phase 2 (expensive). Cost breakdown reflects the mix.

### full mode
Brand images first (cheap), then full video workflow. Dry run shows both costs.

### Animation from Existing Image

When the user wants to animate an already-generated image (e.g. "animate image 2"), create a separate project:

```json
{
  "mode": "video",
  "format": "ad-1x1",
  "captions": false,
  "music": false,
  "hookText": "",
  "videoProvider": "kling-v2.1",
  "skipAutoRefs": ["style", "location"],
  "clips": [{
    "prompt": "Subtle gentle motion. Model walks slowly forward, fabric shifts naturally.",
    "imageSource": "original",
    "sourceImage": "../{source-project}/output/images/{filename}",
    "outputType": "animation",
    "duration": 5
  }]
}
```

**Key fields:**
- `imageSource: "original"` + `sourceImage` — copies the existing image, skips ALL generation (no Gemini, no asset sourcing)
- Do NOT use `imageReference` — it doesn't prevent storyboard generation, just adds a ref
- `skipAutoRefs` — prevents downloading style/location refs that aren't needed
- `captions: false`, `music: false`, `hookText: ""` — strip everything, just animate

**Cost:** ~$0.59 total (Director ~$0.10 cached + Kling i2v ~$0.49). No gates needed.

**Output:** Raw clip at `output/clips/scene-1.mp4`. Remotion may crash on short single-clip videos (see errors below) — the raw clip IS the deliverable.

## Partial Re-runs

The pipeline is fully idempotent — it skips any step whose output file exists. You only pay for what you regenerate.

| What to fix | Delete | Re-run command | Cost |
|---|---|---|---|
| One storyboard frame | `assets/storyboard/scene-{N}.png` or `.jpg` | `--storyboard-only` | ~$0.05 |
| One video clip (v2.1) | `output/clips/scene-{N}.mp4` | `--json-output` | ~$0.49-0.90 |
| One video clip (v3) | `output/clips/scene-{N}.mp4` | `--json-output` | ~$1.12-2.24 |
| Voiceover | Nothing — hash auto-detects script change | `--json-output` | ~$0.50 |
| Director plan | `cache/director-plan.json` | `--json-output` | ~$0.10 |
| Everything | `cache/` and `output/` dirs | `--json-output` | Full cost |

## Kling Video Quality

### What works
- **Storyboard-driven i2v**: High-quality frame as `start_image_url` anchors the scene
- **cfg_scale 0.7**: Close to source image but allows natural motion
- **Scene description + camera move prompts**: "Woman holding serum bottle. Slow push-in. Cinematic."
- **Enhanced negative prompt**: face distortion, changing face, melting skin, identity shift
- **Reference images for Director**: Model and product photos → better enriched prompts → better Kling output
- **Independent clips**: Each from its own frame. No cross-scene morphing.

### What doesn't work
- **Cross-scene end_image_url**: Forces morphing between compositions. Disabled.
- **Motion-only prompts**: Kling needs scene context, not just camera moves
- **Text/logo rendering**: Kling can't do text. Use Remotion overlays.
- **Complex multi-subject scenes**: More artifacts. One subject, one action.
- **cfg_scale >0.8**: Nearly static video. 0.7 is the sweet spot.
- **v2.1 vs v3**: v3 smoother motion, 2.3x more. Worth it for beauty/portrait.

### Quality checklist before Kling
1. Storyboard frames correct (composition, subject, lighting)
2. Reference images provided (`model-1.jpg`, `product-1.jpg`)
3. `videoProvider: "kling-v3"` for beauty/portrait content
4. `skipAutoRefs` if you don't want auto-sourced refs
5. Single clear moment per prompt with lighting/mood cues
6. No text/logo requests in prompts

## Auto-Chain

After generation completes:
- Show assets inline with QA scores (for brand-images)
- Show cost summary (estimated vs saved by cache)
- If any images scored < 3.5, ask about regeneration first
- Then: "Want copy for these? I'll write captions, ads, and an email sequence."
- If user says "looks good" or "perfect" without asking for copy, treat as implicit interest: "Great. Want me to write copy for these too?"
