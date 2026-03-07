---
name: asset-packager
description: "Organizes generated content into platform-ready deliverable packages with matched copy, proper naming, and a posting schedule. Use this skill whenever someone asks to package assets, prepare for posting, create deliverables, organize files, do a client handoff, or says 'run step 4'. Activates when visual assets AND copy both exist and need to be organized for distribution. If both exist but aren't packaged yet, proactively suggest running this skill."
---

# Asset Packager

You organize all generated content (images, videos, copy) into platform-ready packages that someone can immediately start posting from. Every file is renamed for clarity, matched with its copy, and organized by platform.

## Prerequisites

Before running, verify these exist:

**Required:**
- `projects/{name}/output/` — must contain at least some generated assets (images, clips, or video)

**Required for full packaging:**
- `projects/{name}/output/copy/` — copy files from the copy engine. If missing, tell the user: "No copy files found. Say 'write copy' or 'run step 3' first to generate captions and post text."

**Optional but used if available:**
- `projects/{name}/config.json` — for brand name, format info
- `projects/{name}/cache/brand-context.json` — for brand name and tone

If copy doesn't exist, offer two options:
1. "Run the copy engine first, then package" (recommended)
2. "Package assets without copy — just organize and rename files" (assets-only mode)

## Workflow

### Step 1: Inventory All Outputs

Scan the project directory and catalog everything:

```
projects/{name}/
├── output/
│   ├── images/           → brand images (scene-{N}-{format}.jpg)
│   ├── clips/            → video clips (scene-{N}.mp4)
│   ├── audio/            → voiceover.mp3
│   ├── copy/             → all JSON copy files
│   └── *.mp4             → final rendered video
├── assets/
│   ├── storyboard/       → storyboard frames (reference only, don't package)
│   ├── brand/            → logo, brand.json, fonts
│   └── audio/            → music.mp3, music-attribution.txt
```

Build an inventory object:

```json
{
  "brand": "Brand name from config/brand-context",
  "images": ["scene-1-story.jpg", "scene-1-square.jpg", "scene-1-landscape.jpg", ...],
  "clips": ["scene-1.mp4", "scene-2.mp4", ...],
  "video": "final-video-timestamp.mp4 or null",
  "voiceover": "voiceover.mp3 or null",
  "music": "music.mp3 or null",
  "musicAttribution": "music-attribution.txt or null",
  "logo": "logo.png or null",
  "copyFiles": ["instagram.json", "tiktok.json", ...],
  "mode": "video | brand-images | full"
}
```

### Step 2: Create Deliverables Structure

Build this directory tree under `projects/{name}/deliverables/`:

```
deliverables/
├── instagram/
│   ├── feed/
│   │   ├── {brand}-ig-feed-01-square.jpg
│   │   ├── {brand}-ig-feed-01-caption.txt
│   │   ├── {brand}-ig-feed-02-square.jpg
│   │   ├── {brand}-ig-feed-02-caption.txt
│   │   └── ...
│   ├── stories/
│   │   ├── {brand}-ig-story-01.jpg
│   │   ├── {brand}-ig-story-02.jpg
│   │   └── ...
│   └── reels/
│       ├── {brand}-ig-reel-01.mp4
│       ├── {brand}-ig-reel-01-caption.txt
│       └── ...
├── tiktok/
│   ├── {brand}-tiktok-01.mp4
│   ├── {brand}-tiktok-01-caption.txt
│   └── ...
├── linkedin/
│   ├── {brand}-linkedin-01-landscape.jpg
│   ├── {brand}-linkedin-01-post.txt
│   └── ...
├── youtube/
│   ├── {brand}-youtube-short-01.mp4
│   ├── {brand}-youtube-metadata.json
│   └── ...
├── ads/
│   ├── {brand}-ad-16x9.mp4
│   ├── {brand}-ad-1x1.mp4
│   ├── {brand}-ad-copy.json
│   └── ...
├── email/
│   ├── email-sequence.json
│   └── lead-magnet-brief.json
├── brand-assets/
│   ├── logo.png (if exists)
│   ├── brand-colors.json
│   └── music-attribution.txt (if music was used)
├── posting-schedule.md
└── README.md
```

### Step 3: Match Assets to Copy

For each platform's copy JSON file, pair assets with their corresponding text:

**Instagram:**
- `scene-{N}-square.jpg` → feed posts (pair with instagram.json posts)
- `scene-{N}-story.jpg` → stories (no caption needed, visual only)
- Final video or clips → reels (pair with instagram.json reel captions)

**TikTok:**
- Final video or individual clips → TikTok posts
- Pair each with tiktok.json caption + hashtags

**LinkedIn:**
- `scene-{N}-landscape.jpg` → LinkedIn posts
- Pair with linkedin.json post text + hashtags

**YouTube:**
- Final video → YouTube Shorts
- Pair with youtube.json title, description, tags

**Ads:**
- All format variants → ad platform
- Pair with ads.json headline/body/CTA variants

**Email:**
- Copy email-sequence.json and lead-magnet.json directly

**For each asset-copy pair, create a plain text caption file:**
```
{brand}-ig-feed-01-caption.txt contents:

Your skin deserves more than chemicals.

GlowLab crafts each serum from organic botanicals, cold-pressed
and concentrated for maximum glow. One drop. That's all it takes.

Save this for your next self-care night.

#OrganicSkincare #CleanBeauty #GlowLab #SerumLover #SelfCareRitual
#NaturalGlow #SkincareRoutine #LuxurySkincare #GreenBeauty
```

### Step 4: Generate Posting Schedule

Create `deliverables/posting-schedule.md`:

```markdown
# Posting Schedule: {Brand}

Generated: {date}
Content pieces: {total count}

## Week 1

| Day | Time | Platform | File | Type | Notes |
|-----|------|----------|------|------|-------|
| Mon | 8-10am | Instagram | ig-feed-01-square.jpg | Feed post | Lead with strongest visual. Hook: "{hookText}" |
| Mon | 9-11am | LinkedIn | linkedin-01-landscape.jpg | Post | Cross-post adapted for professional audience |
| Mon | 12-2pm | Twitter/X | (link to IG post) | Tweet | Drive traffic to Instagram post |
| Tue | 6-9pm | TikTok | tiktok-01.mp4 | Video | Hook in first 2 seconds. Peak engagement window |
| Tue | 8-10am | Instagram | ig-story-01.jpg | Story | Behind-the-scenes or teaser for feed post |
| Wed | 8-10am | Instagram | ig-feed-02-square.jpg | Feed post | Second strongest visual |
| Wed | 11am-1pm | LinkedIn | linkedin-02-landscape.jpg | Post | Different angle from Monday |
| Thu | 6-9pm | TikTok | tiktok-02.mp4 | Video | Build on Monday's content |
| Thu | 8-10am | Instagram | ig-story-02.jpg | Story | Engagement prompt or poll |
| Fri | 8-10am | Instagram | ig-reel-01.mp4 | Reel | Full video content, highest production value |
| Fri | 12-2pm | YouTube | youtube-short-01.mp4 | Short | Cross-post reel with YouTube metadata |

## Week 2

| Day | Time | Platform | File | Type | Notes |
|-----|------|----------|------|------|-------|
| Mon | 8-10am | Instagram | ig-feed-03-square.jpg | Feed post | Product detail or lifestyle shot |
| Mon | 9-11am | LinkedIn | linkedin-03-landscape.jpg | Post | Industry insight angle |
| Tue | 6-9pm | TikTok | tiktok-03.mp4 | Video | Respond to any engagement from week 1 |
| Wed | 8-10am | Email | email-1-welcome | Welcome email | Send to new subscribers from week 1 traffic |
| Thu | 8-10am | Instagram | ig-feed-04-square.jpg | Feed post | CTA-focused, drive to link in bio |
| Fri | 8-10am | Email | email-2-value | Value email | Build trust before pitch |

## Posting Best Practices

- **Instagram**: Best times 8-10am and 6-8pm. Feed posts Tue-Fri, Reels Fri-Sat.
- **TikTok**: Best times 6-9pm. Post when your audience is scrolling, not working.
- **LinkedIn**: Best times 9-11am Tue-Thu. Professional content for business hours.
- **Twitter/X**: Best times 12-2pm. Use to amplify other platform content.
- **YouTube Shorts**: Consistent daily posting drives the algorithm. Cross-post from TikTok/Reels.
- **Email**: Send welcome immediately on signup. Space follow-ups 2-3 days apart.
```

Adapt the schedule based on:
- How many assets were actually generated (don't schedule assets that don't exist)
- The project mode (brand-images only = no video slots)
- Platform conventions for the niche (research via web search if needed)

### Step 5: Generate Asset Manifest CSV

Create `deliverables/asset-manifest.csv` for bulk uploading to scheduling tools (Buffer, Later, Hootsuite, Publer — most accept CSV imports).

One row per asset:

```csv
filename,platform,type,dimensions,duration,caption_file,posting_day,posting_time,hashtags
glowlab-ig-feed-01-square.jpg,instagram,feed,1080x1080,,glowlab-ig-feed-01-caption.txt,Mon,08:00,"#OrganicSkincare #CleanBeauty #GlowLab"
glowlab-ig-story-01.jpg,instagram,story,1080x1920,,,,
glowlab-ig-reel-01.mp4,instagram,reel,1080x1920,20s,glowlab-ig-reel-01-caption.txt,Fri,08:00,"#SkincareRoutine #GlowUp"
glowlab-tiktok-01.mp4,tiktok,video,1080x1920,20s,glowlab-tiktok-01-caption.txt,Tue,18:00,"#skincare #fyp #glowlab"
glowlab-linkedin-01-landscape.jpg,linkedin,post,1920x1080,,glowlab-linkedin-01-post.txt,Mon,09:00,"#CleanBeauty #Skincare"
glowlab-youtube-short-01.mp4,youtube,short,1080x1920,20s,,Fri,12:00,
glowlab-ad-16x9.mp4,ads,video-ad,1920x1080,20s,,,
```

Fields:
- `filename` — the renamed deliverable file
- `platform` — instagram, tiktok, linkedin, twitter, youtube, ads
- `type` — feed, story, reel, video, post, tweet, short, video-ad
- `dimensions` — WxH in pixels (1080x1080 for square, 1080x1920 for story/reel, 1920x1080 for landscape)
- `duration` — video length in seconds, empty for images
- `caption_file` — path to the matching caption .txt file, empty if none
- `posting_day` — from the posting schedule
- `posting_time` — from the posting schedule (24h format)
- `hashtags` — comma-separated within quotes, from the copy files

### Step 6: Zip Archives (Optional)

After creating the deliverables folder, ask the user:

```
Create zip archives? Useful for sending to clients or uploading to scheduling tools.
  - "Yes, per platform" — creates instagram.zip, tiktok.zip, linkedin.zip, etc.
  - "Yes, full package" — creates one {brand}-full-package.zip with everything
  - "Yes, both" — per-platform zips + full package zip
  - "No" — skip, just the folder structure
```

If yes, create archives using the `zip` command:

**Per-platform archives:**
```bash
cd projects/{name}/deliverables
zip -r {brand}-instagram.zip instagram/
zip -r {brand}-tiktok.zip tiktok/
zip -r {brand}-linkedin.zip linkedin/
zip -r {brand}-youtube.zip youtube/
zip -r {brand}-ads.zip ads/
zip -r {brand}-email.zip email/
```

**Full package archive:**
```bash
cd projects/{name}
zip -r deliverables/{brand}-full-package.zip deliverables/ \
  -x "deliverables/*.zip"
```

The full package includes posting-schedule.md, README.md, asset-manifest.csv, and all platform folders. Exclude other zip files to avoid nesting.

### Step 7: Generate README

Create `deliverables/README.md`:

```markdown
# {Brand} Content Package

**Generated:** {date}
**Mode:** {video | brand-images | full}
**Format:** {youtube-short | tiktok | ad-16x9 | ad-1x1 | web-hero}

## What's Included

- {X} Instagram posts (feed + stories + reels)
- {X} TikTok videos with captions
- {X} LinkedIn posts with images
- {X} Twitter/X posts
- {X} YouTube Shorts with metadata
- {X} Ad creative variants
- 4-email welcome sequence
- Lead magnet concept
- Posting schedule (2 weeks)
- Brand assets (logo, colors)

## How to Use

1. Open the platform folder you want to post on
2. Each asset has a matching `-caption.txt` file — copy the text when posting
3. Follow `posting-schedule.md` for optimal timing
4. Start with Instagram and TikTok for maximum reach
5. Use the email sequence after setting up your landing page

## File Naming Convention

`{brand}-{platform}-{type}-{number}.{ext}`

Examples:
- `glowlab-ig-feed-01-square.jpg` — Instagram feed post, scene 1
- `glowlab-tiktok-01.mp4` — TikTok video, scene 1
- `glowlab-ig-feed-01-caption.txt` — Caption for the matching image

## Notes

- All images are AI-generated. Review before posting.
- Video clips use Kling AI. Minor artifacts are normal.
- Hashtags were researched but should be verified for your specific account.
- Email copy assumes a welcome/nurture sequence — customize the CTA links.
- Music attribution is in `brand-assets/music-attribution.txt` if background music was used.
```

### Step 8: Report

Tell the user:

```
Deliverables packaged in projects/{name}/deliverables/

  instagram/  — {X} feed posts, {X} stories, {X} reels
  tiktok/     — {X} videos with captions
  linkedin/   — {X} posts with images
  youtube/    — {X} shorts with metadata
  ads/        — {X} creative variants
  email/      — 4-email sequence + lead magnet brief

  posting-schedule.md — 2-week content calendar
  README.md           — package overview and instructions

Total files: {N}

Say "monetize" or "run step 5" to add revenue strategies and affiliate links.
```
