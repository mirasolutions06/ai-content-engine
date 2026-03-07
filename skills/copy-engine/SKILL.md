---
name: copy-engine
description: "Generates platform-specific copy, captions, hashtags, ad text, email sequences, and lead magnets for all generated visual assets. Use this skill whenever someone asks to write copy, generate captions, create post text, write hashtags, produce social media copy, create ad copy, write an email sequence, or says 'run step 3'. Activates for ANY request about text content to accompany generated visual assets. If visual assets exist in a project and no copy has been written yet, proactively suggest running this skill."
---

# Copy Engine

You generate all text content paired with the project's visual assets. Every platform gets purpose-built copy — not generic repurposed text.

## Prerequisites

Before running, verify these exist:
- `projects/{name}/config.json` — needed for brand name, format, script
- At least some generated assets in `projects/{name}/output/` (images, clips, or video)

Optional but strongly preferred:
- `projects/{name}/cache/brand-context.json` — written by the Director step, contains enriched brand tone, visual style, hook, CTA, scene summaries, and voice settings

If `brand-context.json` doesn't exist (pipeline hasn't run or Director was skipped), extract context directly from `config.json`.

## Platform Selection

When triggered, determine which platforms to generate copy for based on the user's request:

| User says | Generate |
|---|---|
| "write copy" / "run step 3" | All platforms (default) |
| "write instagram copy" | instagram.json only |
| "write copy for instagram and tiktok" | instagram.json + tiktok.json |
| "write ad copy" | ads.json only |
| "write email sequence" | email-sequence.json + lead-magnet.json |
| "write youtube copy" | youtube.json only |
| "write linkedin posts" | linkedin.json only |
| "write twitter copy" / "write tweets" | twitter.json only |

The `all-copy.json` file is always generated, but only includes whatever platforms were actually produced in this run.

## Handling Existing Copy

Before generating, check `projects/{name}/output/copy/` for existing files. If any copy files already exist:

1. List which platforms already have copy: "Copy already exists for: instagram, tiktok, linkedin."
2. Ask the user:
   - **"Regenerate all"** — overwrites everything and generates fresh copy for all requested platforms
   - **"Regenerate specific"** — ask which platforms to regenerate, keep the rest untouched
   - **"Skip existing"** — only generate copy for platforms that don't have files yet
   - **"Add platforms"** — keep all existing copy, only generate for new platforms not yet covered

When regenerating specific platforms, back up the old file as `{platform}-previous.json` before overwriting, so the user can compare.

When adding new platforms or skipping existing, merge the new output into `all-copy.json` alongside the existing platform data.

## Workflow

### Step 1: Load Project Context

Read these files and build a context object:

```
brand-context.json fields:
  brandName, tone, visualStyle, hookText, cta, targetAudience,
  scenes[].index, scenes[].prompt, scenes[].enrichedPrompt, scenes[].mood,
  voiceSettings.stability, voiceSettings.style, voiceSettings.toneDescription

config.json fields:
  client, brand, brief, format, script, hookText, cta, mode
```

List all generated assets in `projects/{name}/output/`:
- `output/images/scene-{N}-{format}.jpg` — brand images
- `output/clips/scene-{N}.mp4` — video clips
- `output/*.mp4` — final rendered video
- `output/audio/voiceover.mp3` — voiceover

Build the context object to pass to Claude for each generation:

```json
{
  "brand": "Brand name",
  "tone": "From brand-context.json or inferred from brief",
  "visualStyle": "From brand-context.json or 'professional brand content'",
  "hookText": "From brand-context or config",
  "cta": "From brand-context or config",
  "targetAudience": "From brand-context or inferred",
  "assets": ["list of generated files"],
  "script": "Voiceover script if available"
}
```

### Step 2: Generate Platform Copy

For EACH generated asset, produce copy for every relevant platform. Use Claude Sonnet (`claude-sonnet-4-6`) for generation quality.

Generate each platform file by calling Claude with the brand context and the specific output schema. Use this system prompt:

```
You are a social media copywriter and content strategist. Given brand context and asset details, generate platform-specific copy. Return ONLY valid JSON matching the exact schema provided. No markdown fences, no explanatory text.

Rules:
- Never use generic filler ("In today's fast-paced world...", "Are you tired of...")
- Every post opens with a hook that creates curiosity, urgency, or emotion
- Hashtags must be realistic and platform-appropriate — mix of large (1M+ posts), medium (100K-1M), and niche (<100K)
- Monetization mentions feel natural, never salesy
- Each platform follows its own conventions, character limits, and culture
- Ad copy variants test different psychological angles (benefit vs curiosity vs urgency vs social proof)
- Email subjects are short and curiosity-driven, never clickbait
```

### Step 3: Save Output Files

Save all files to `projects/{name}/output/copy/`. Each platform gets its own JSON file.

#### instagram.json

```json
{
  "posts": [
    {
      "assetFile": "scene-1-square.jpg",
      "caption": "Hook in the first line (this shows before '...more'). 100-300 words with intentional line breaks for readability. Story or insight that connects to the brand. End with a clear CTA (save this, share with a friend, link in bio).",
      "hashtags": [
        "#niche_specific_tag",
        "#medium_reach_tag",
        "#broad_category_tag"
      ],
      "cta": "Save this for your next [relevant moment]"
    }
  ]
}
```

Rules for Instagram:
- First line IS the hook — it must stop the scroll before the fold
- 15-20 hashtags: ~5 large (1M+), ~8 medium (100K-1M), ~5 niche (<100K)
- Use line breaks for readability, not walls of text
- End every caption with a CTA: save, share, comment, or link in bio
- Research hashtags via web search — never guess popularity tiers

#### tiktok.json

```json
{
  "posts": [
    {
      "assetFile": "scene-1.mp4",
      "caption": "Short, punchy, conversational. Under 150 chars.",
      "onScreenText": [
        { "time": "0-2s", "text": "Hook overlay — first thing viewers see" },
        { "time": "2-5s", "text": "Key point or surprising fact" },
        { "time": "5-end", "text": "CTA or punchline" }
      ],
      "hashtags": ["#trending_tag", "#niche_tag"],
      "soundSuggestion": "Trending audio idea that fits the mood and niche"
    }
  ]
}
```

Rules for TikTok:
- Caption under 150 chars — the video does the talking
- On-screen text is crucial: hook in first 2 seconds or lose the viewer
- 5-8 hashtags only, mix trending + niche
- Sound suggestion should reference actual trending audio categories
- Conversational, raw, slightly unpolished tone — polished = corporate = scroll past

#### linkedin.json

```json
{
  "posts": [
    {
      "assetFile": "scene-1-landscape.jpg",
      "post": "Hook in first 2 lines (shows before '...see more'). 150-300 words. Use the Story-Lesson-CTA framework: open with a personal/brand story, extract a professional insight, close with engagement prompt. Professional but human — not corporate robot.",
      "hashtags": ["#IndustryTerm", "#ThoughtLeadership", "#BrandName"]
    }
  ]
}
```

Rules for LinkedIn:
- First 2 lines must hook before the fold
- 3-5 hashtags max — LinkedIn penalizes hashtag spam
- Story-Lesson-CTA framework works best
- Professional tone but with personality — not stiff corporate speak
- Questions at the end drive comments

#### twitter.json

```json
{
  "posts": [
    {
      "assetFile": "scene-1-landscape.jpg",
      "tweet": "Under 280 chars. Sharp, opinionated, or surprising. No hashtags in the tweet body — they kill engagement on X.",
      "thread": [
        "1/ Thread opener if content warrants a thread. Hook in tweet 1.",
        "2/ Value or insight per tweet. Keep each under 280 chars.",
        "3/ Final tweet: CTA + link. 'Follow for more [topic]' or 'Link in bio'."
      ]
    }
  ]
}
```

Rules for Twitter/X:
- No hashtags in the tweet body — they reduce engagement on X
- Threads only when content genuinely warrants multiple tweets
- Sharp, opinionated takes outperform safe generic posts
- Thread hook (tweet 1) must stand alone as a great tweet

#### youtube.json

```json
{
  "videos": [
    {
      "assetFile": "final-video.mp4",
      "title": "Under 60 chars. Front-load keywords. Create curiosity gap.",
      "description": "First 2 lines: keywords + hook (shows in search results). 100-200 words total. Include relevant links. End with CTA to subscribe/like.",
      "tags": ["keyword_1", "keyword_2", "long_tail_keyword"]
    }
  ]
}
```

Rules for YouTube:
- Title: keywords first, curiosity second, under 60 chars
- Description: first 2 lines show in search — make them count
- 10-15 tags mixing broad terms and long-tail keywords
- Tags should be researched via web search for the niche

#### ads.json

```json
{
  "variants": [
    {
      "assetFile": "scene-1-landscape.jpg",
      "angle": "benefit",
      "headline": "Under 40 chars — lead with the transformation or benefit",
      "body": "Under 125 chars — urgency, social proof, or curiosity",
      "cta": "Shop Now | Learn More | Get Started | Try Free"
    },
    {
      "assetFile": "scene-1-landscape.jpg",
      "angle": "curiosity",
      "headline": "Under 40 chars — open a curiosity loop",
      "body": "Under 125 chars — hint at what they'll discover",
      "cta": "See How"
    },
    {
      "assetFile": "scene-1-landscape.jpg",
      "angle": "social-proof",
      "headline": "Under 40 chars — lead with numbers or testimonial",
      "body": "Under 125 chars — specific result or transformation",
      "cta": "Join 10K+ Others"
    }
  ]
}
```

Rules for ads:
- Generate at least 3 variants per asset testing different angles
- Angles: benefit, curiosity, urgency, social proof, fear of missing out
- Headlines under 40 chars — benefit-driven
- Body under 125 chars — creates urgency or curiosity
- CTA must be a clear imperative action

#### email-sequence.json

```json
{
  "emails": [
    {
      "day": 0,
      "type": "welcome",
      "subject": "Short, curiosity-driven subject line",
      "preheader": "Extends the subject, creates more intrigue",
      "body": "Welcome + deliver immediate value. Introduce the brand story. Set expectations for what's coming. Light CTA.",
      "cta": "Specific action with clear benefit"
    },
    {
      "day": 2,
      "type": "value",
      "subject": "Educational or insight-driven subject",
      "preheader": "Tease the value inside",
      "body": "Pure value — teach something useful, share an insight, or tell a story. Build trust and authority. No hard sell.",
      "cta": "Soft engagement — reply, read more, try a tip"
    },
    {
      "day": 5,
      "type": "soft-pitch",
      "subject": "Social proof or results-focused subject",
      "preheader": "Hint at transformation",
      "body": "Social proof: customer results, testimonials, before/after. Introduce the offer naturally. Benefits over features.",
      "cta": "Check it out — low-pressure CTA"
    },
    {
      "day": 7,
      "type": "urgency",
      "subject": "Scarcity or deadline-driven subject",
      "preheader": "Last chance framing",
      "body": "Create real urgency (limited time, limited stock, price increase). Recap the key benefit. Final strong CTA.",
      "cta": "Strong imperative — Get yours before [deadline]"
    }
  ]
}
```

#### lead-magnet.json

```json
{
  "title": "Compelling name that promises specific, tangible value",
  "format": "pdf | checklist | template | video | swipe-file",
  "description": "What it contains and why someone would trade their email for it",
  "landingCTA": "Link-in-bio text that drives downloads",
  "contentOutline": [
    "Section 1: Quick win that proves your expertise",
    "Section 2: Framework or process they can follow",
    "Section 3: Templates or tools they can use immediately",
    "Section 4: Next steps that lead to your paid offer"
  ]
}
```

#### all-copy.json

Combine all of the above into a single file:

```json
{
  "projectName": "{name}",
  "generatedAt": "ISO timestamp",
  "brand": "Brand name",
  "instagram": { ... },
  "tiktok": { ... },
  "linkedin": { ... },
  "twitter": { ... },
  "youtube": { ... },
  "ads": { ... },
  "emailSequence": { ... },
  "leadMagnet": { ... }
}
```

### Step 4: Hashtag Research

This is critical — never guess hashtags. For each platform, use web search:

- Search `"{niche}" instagram hashtags 2026` — find actually-used tags with real post counts
- Search `"{niche}" tiktok trending hashtags` — find current trending tags
- Search `"{niche}" linkedin hashtags` — find professional community tags

Categorize each hashtag by reach:
- Large (1M+ posts): broad discovery
- Medium (100K-1M): category-level
- Niche (<100K): targeted community

### Step 5: Quality Checklist

Before saving, verify every piece of copy against these rules:

- [ ] No generic filler openings
- [ ] Every post starts with a hook
- [ ] Character limits respected per platform
- [ ] Hashtags are researched, not guessed
- [ ] Ad copy has multiple angle variants
- [ ] Email sequence follows value-before-pitch arc
- [ ] Lead magnet promises specific, tangible value
- [ ] CTAs are specific actions, not vague ("learn more" is weak, "get your free guide" is strong)
- [ ] Brand voice is consistent across platforms but adapted to each platform's culture

### Step 6: Next Steps

Tell the user:

```
Copy generated for all platforms. Files saved to projects/{name}/output/copy/:
  - instagram.json ({N} posts)
  - tiktok.json ({N} posts)
  - linkedin.json ({N} posts)
  - twitter.json ({N} posts)
  - youtube.json ({N} videos)
  - ads.json ({N} variants)
  - email-sequence.json (4 emails)
  - lead-magnet.json
  - all-copy.json (combined)

Say "package assets" or "run step 4" to create platform-ready deliverables.
```
