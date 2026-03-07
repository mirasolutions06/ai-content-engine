# Glow Lab -- Deliverables Package

**Campaign:** Vitamin C Serum Launch
**Client:** Glow Lab
**Mode:** full (brand images + video production)
**Format:** youtube-short (9:16 vertical, 20s)
**Generated:** 2026-03-07
**Pipeline Cost Estimate:** $5.42

---

## Package Contents

### Brand Images (12 total)

Generated from 4 scenes x 3 image formats via Gemini 2.5 Flash.

| Scene | Story (9:16) | Square (1:1) | Landscape (16:9) |
|---|---|---|---|
| 1 -- Serum drop close-up | `glow-lab-ig-story-01.jpg` | `glow-lab-ig-feed-01.jpg` | `glow-lab-linkedin-post-01.jpg` |
| 2 -- Product flat lay | `glow-lab-ig-story-02.jpg` | `glow-lab-ig-feed-02.jpg` | `glow-lab-linkedin-post-02.jpg` |
| 3 -- Application ritual | `glow-lab-ig-story-03.jpg` | `glow-lab-ig-feed-03.jpg` | `glow-lab-linkedin-post-03.jpg` |
| 4 -- Before/after glow | `glow-lab-ig-story-04.jpg` | `glow-lab-ig-feed-04.jpg` | `glow-lab-linkedin-post-04.jpg` |

### Video Clips (4 total)

Generated via Kling v2.1 Pro (fal.ai), 5 seconds each, animated from storyboard frames.

| Clip | Duration | Source Scene | File |
|---|---|---|---|
| Clip 1 -- Serum drop slow-mo | 5s | Scene 1 | `glow-lab-tiktok-video-01.mp4` |
| Clip 2 -- Product reveal | 5s | Scene 2 | `glow-lab-tiktok-video-02.mp4` |
| Clip 3 -- Application ritual | 5s | Scene 3 | `glow-lab-tiktok-video-03.mp4` |
| Clip 4 -- Before/after transformation | 5s | Scene 4 | `glow-lab-tiktok-video-04.mp4` |

### Final Composed Video (1 total)

Rendered via Remotion with voiceover, captions, transitions, hook text, and CTA.

| Asset | Format | Duration | File |
|---|---|---|---|
| YouTube Short / Reel | 9:16 (1080x1920) | ~20s | `glow-lab-youtube-short-01.mp4` / `glow-lab-ig-reel-01.mp4` |

### Voiceover (1 total)

Generated via ElevenLabs. Voice: calm luxury narrator (stability 0.72, style 0.05).

| Asset | File |
|---|---|
| Voiceover audio | `voiceover.mp3` |

### Captions (1 total)

Word-level transcription via Whisper, positioned bottom-center.

| Asset | File |
|---|---|
| Caption data | `captions.json` |

### Copy Files

Platform-specific captions, hashtags, ad copy, and email sequences.

| File | Contents |
|---|---|
| `copy/instagram.json` | Feed captions, story text, reel captions, 15-20 hashtags per post |
| `copy/tiktok.json` | Short captions (<150 chars), on-screen text suggestions, 5-8 hashtags |
| `copy/linkedin.json` | Professional posts (150-300 words), 3-5 hashtags |
| `copy/youtube.json` | Titles, descriptions, 10-15 tags |
| `copy/ads.json` | Headlines, body copy, CTAs for paid campaigns |
| `copy/email-sequence.json` | 4-email sequence: welcome, value, soft pitch, urgency |
| `copy/all-copy.json` | Combined copy for all platforms |

---

## Folder Structure

```
deliverables/
├── instagram/
│   ├── feed/           4 square images (1:1) + caption files
│   ├── stories/        4 story images (9:16) + story text
│   └── reels/          1 final composed video (9:16)
├── tiktok/             4 individual video clips + captions
├── linkedin/           4 landscape images (16:9) + post copy
├── youtube/            1 final composed short + metadata
├── ads/                Ad-formatted assets + ad copy
├── email/              Email sequence HTML/text files
├── brand-assets/       Source brand images (all 12 formats)
├── posting-schedule.md 2-week content calendar
├── asset-manifest.csv  Bulk scheduling CSV for tools like Later, Buffer, Hootsuite
└── README.md           This file
```

---

## Naming Convention

All deliverable files follow this pattern:

```
{brand}-{platform}-{type}-{number}.{ext}
```

| Component | Values |
|---|---|
| `{brand}` | `glow-lab` |
| `{platform}` | `ig`, `tiktok`, `linkedin`, `youtube` |
| `{type}` | `feed`, `story`, `reel`, `video`, `post`, `short` |
| `{number}` | `01`, `02`, `03`, `04` |
| `{ext}` | `jpg` for images, `mp4` for video, `json` for copy |

Examples:
- `glow-lab-ig-feed-01.jpg` -- Instagram feed image, scene 1 (square)
- `glow-lab-ig-story-03.jpg` -- Instagram story image, scene 3 (vertical)
- `glow-lab-tiktok-video-02.mp4` -- TikTok video clip, scene 2
- `glow-lab-youtube-short-01.mp4` -- Final composed YouTube Short
- `glow-lab-ig-reel-01.mp4` -- Final composed Instagram Reel

---

## Usage Instructions

### For Social Media Managers

1. Open `posting-schedule.md` for the 2-week content calendar with dates, times, and platform assignments.
2. Each platform folder contains the ready-to-upload assets paired with their copy files.
3. Use `asset-manifest.csv` for bulk import into scheduling tools (Later, Buffer, Hootsuite, Sprout Social).
4. Copy files are in JSON format -- extract the `caption` field for each post.

### For Paid Advertising

1. Use assets in `ads/` for paid campaigns.
2. Ad copy (headlines, body, CTAs) is in `copy/ads.json`.
3. Recommended A/B test: Scene 1 (serum drop) vs Scene 3 (application ritual) as hero creative.
4. Video clips in `tiktok/` work well as Spark Ads on TikTok and Reels Ads on Instagram.

### For Email Marketing

1. Email sequence files are in `email/`.
2. 4-email sequence designed for post-lead-capture nurture flow.
3. Sequence: Welcome/Deliver -> Value/Education -> Soft Pitch -> Urgency/Final CTA.
4. Embed brand images directly or link to landing page.

### For Brand Asset Library

1. All 12 source brand images (4 scenes x 3 formats) are in `brand-assets/`.
2. These are the highest-quality originals before platform-specific cropping.
3. Use for website, print, PR, or any custom format needs.

---

## Technical Details

| Property | Value |
|---|---|
| Image formats | Story 9:16 (1080x1920), Square 1:1 (1080x1080), Landscape 16:9 (1920x1080) |
| Video resolution | 1080x1920 (9:16 vertical) |
| Video duration | ~20 seconds (4 clips x 5s) |
| Video codec | H.264 with faststart for streaming |
| Transition style | Crossfade |
| Caption style | Word-by-word, bottom positioned |
| Voiceover | ElevenLabs, calm luxury narrator |

---

## Pipeline Run Info

- **Mode:** full (brand-images + video)
- **Estimated cost:** $5.42
- **Steps:** Director -> Gemini brand images (12) -> ElevenLabs voiceover -> Whisper transcription -> Gemini storyboard frames (4) -> Kling video clips (4) -> Remotion render -> ffmpeg packaging
- **Config:** `projects/glow-lab/config.json`
- **Brand context:** `projects/glow-lab/cache/brand-context.json`
- **Cost log:** `projects/glow-lab/cache/cost-log.json`

---

*Generated by AI Content Engine -- Asset Packager (Skill 4)*
