# Claude Code Kickoff Guide

## Setup (do this before opening Claude Code)

```bash
# 1. Create the new repo
mkdir ai-content-engine && cd ai-content-engine
git init

# 2. Copy video-production as the base
cp -r /path/to/ai-video-production-pipeline/* .
cp /path/to/ai-video-production-pipeline/.gitignore .

# 3. Drop CLAUDE.md into the root
cp /path/to/CLAUDE.md .

# 4. Have brand-pack accessible (Claude Code will read from it during merge)
# Make sure /path/to/ai-brand-pack is accessible

# 5. Open in Claude Code
claude
```

---

## Phase 1 Prompt — Merge the repos

Paste this into Claude Code:

```
Read CLAUDE.md thoroughly — it is the single source of truth for this project.

Phase 1: Merge two existing TypeScript pipelines into one. Here is what to do in order:

1. Read the entire existing codebase (src/, types, cli, pipeline, remotion, utils). Understand every file before changing anything.

2. Read the brand-pack source at /path/to/ai-brand-pack/src/pipeline/images.ts and /path/to/ai-brand-pack/src/types/index.ts

3. Execute all 8 changes listed in CLAUDE.md Step 2, in order:
   - Change 1: --dry-run flag
   - Change 2: --json-output flag
   - Change 3: brand-context.json export in director.ts
   - Change 4: mode field + routing in types and index.ts
   - Change 5: brand-images.ts (absorbed from brand-pack)
   - Change 6: prompt-validator.ts
   - Change 7: cost-tracker.ts
   - Change 8: hash-based ElevenLabs caching

4. After each change, run npm run build to verify TypeScript compiles clean. Fix any errors before moving to the next change.

5. After all 8 changes: run the full test suite from CLAUDE.md to verify nothing is broken.

Do NOT change any existing pipeline behavior. All changes are additive only. Show me the result of npm run build when done.
```

---

## Phase 2 Prompt — Build the skills

After Phase 1 compiles clean:

```
Phase 1 is solid. Now build all 5 skills following CLAUDE.md specs exactly.

Build them in this order, showing me each one before moving to the next:
1. skills/brief-generator/SKILL.md
2. skills/copy-engine/SKILL.md
3. skills/pipeline-runner/SKILL.md
4. skills/asset-packager/SKILL.md
5. skills/distributor/SKILL.md

For each skill:
- Follow the spec in CLAUDE.md exactly
- Include the structured JSON output schemas where specified
- Include the cost management rules (especially in pipeline-runner)
- Make trigger descriptions slightly pushy so they activate reliably

Show me each SKILL.md before moving to the next.
```

After each skill review:
```
Looks good. Next skill.
```

---

## Phase 3 Prompt — End-to-end test

After all 5 skills are built:

```
All skills built. Test the full pipeline end-to-end.

1. Run the brief-generator skill yourself with this input:
   "Premium organic skincare brand called Glow Lab targeting women 25-40, hero product is a daily vitamin C serum, $48 price point, launching on Instagram and TikTok"

2. Validate the generated config.json — check it matches VideoConfig schema, run the prompt validator, show the cost estimate.

3. Run --dry-run to show what the pipeline would do.

4. Run the copy-engine skill against the generated config (simulate brand-context.json from the config since we haven't actually run the Director yet).

5. Run the asset-packager skill to create the deliverables structure.

6. Show me the full project folder tree when done.

Do NOT call any paid APIs during this test. Use --dry-run and simulated data only.
```

---

## Phase 4 Prompt — First real run

When you are ready to spend API credits on a real test:

```
Time for a real run with the Glow Lab test project.

1. Run: npm start -- --project glow-lab --storyboard-only
2. Show me the generated storyboard frames
3. I will review and approve before proceeding to full generation
```

After reviewing frames:
```
Frames look good. Run the full pipeline:
npm start -- --project glow-lab --json-output

Then run the copy-engine and asset-packager skills against the real output.
```

---

## Quick Reference: What goes where

| What you want | Command / prompt |
|---|---|
| Create a new brief | "Create a brief for [brand/product description]" |
| Preview before spending | npm start -- --project X --dry-run |
| Preview visual frames cheaply | npm start -- --project X --storyboard-only |
| Run full generation | npm start -- --project X --json-output |
| Generate copy for assets | "Write copy for project X" or "run step 3" |
| Package deliverables | "Package assets for project X" or "run step 4" |
| Add monetization | "Monetize project X" or "run step 5" |

## Cost-saving workflow (always follow this)

```
1. Brief Generator → config.json       (free — just Claude conversation)
2. --dry-run → review what would happen (free)
3. --storyboard-only → preview frames   (~$0.25)
4. Review frames → approve or tweak     (free)
5. Full pipeline → generate everything  (~$3-8 depending on clips)
6. Copy Engine → text content           (~$0.10)
7. Asset Packager → deliverables        (free — just file organization)
8. Distributor → monetization           (~$0.05)
```

Total for a well-executed run: ~$3.50-8.50
Total for a wasteful run without previews: $15-25+ (and possibly wrong output)
