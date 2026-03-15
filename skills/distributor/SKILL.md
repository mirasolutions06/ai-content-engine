---
name: distributor
description: "Creates monetization strategies, finds real affiliate programs, and builds distribution plans. Triggers on: any request to monetize, add affiliate links, create revenue strategy, make money from content, or build a distribution plan. If deliverables exist but no monetization plan exists, proactively suggest running this skill."
---

# Distributor + Monetizer

You research real monetization opportunities and build actionable revenue plans for the generated content. Everything must be based on actual programs, real commission rates, and published benchmarks found via web search — never fabricated.

## Session Awareness

When invoked:
1. Check what exists in the project directory (config.json, output/copy/, deliverables/, output/monetization-plan.json)
2. If a monetization plan already exists, ask: "Update the existing plan, or research fresh?"
3. If no copy exists, this skill can still generate the plan — but can't create monetized copy variants
4. Check `memory/brands/{slug}/` — if previous campaigns exist, reference what worked

Key files: config.json, cache/brand-context.json, output/copy/all-copy.json, deliverables/

## Prerequisites

Before running, verify these exist:

**Required:**
- `projects/{name}/config.json` — for brand/niche context

**Strongly preferred:**
- `projects/{name}/output/copy/all-copy.json` — existing copy to add monetization CTAs to
- `projects/{name}/deliverables/` — packaged assets from the asset packager

If copy doesn't exist, this skill can still generate the monetization plan — but won't be able to create monetized copy variants.

## Workflow

### Step 1: Identify the Niche

Read project context to determine the niche and monetization opportunities:

```
From config.json:  client, brand, brief, title, mode
From brand-context.json:  brandName, tone, targetAudience, visualStyle
```

Determine the niche category. Examples:
- Skincare brand → beauty, wellness, clean beauty
- Fitness product → health, fitness, supplements
- SaaS tool → technology, productivity, business
- Food brand → food, cooking, health
- Fashion → fashion, lifestyle, sustainable fashion

### Step 2: Research Monetization (ALL via web search)

Every data point in this section MUST come from a web search. Never guess commission rates, program names, or revenue benchmarks.

**Search 1: Affiliate programs**
```
Search: "{niche} affiliate programs 2026"
Search: "best {niche} affiliate programs high commission"
Search: "{specific brand} affiliate program"
```

Find at least 3-5 real programs. For each, capture:
- Program name (e.g. "Amazon Associates", "ShareASale Beauty Network", "Sephora Affiliate Program")
- Signup URL
- Commission rate (specific percentage or range)
- Cookie duration
- Payout minimum and schedule
- Any follower/traffic requirements

**Search 2: Sponsorship benchmarks**
```
Search: "{niche} influencer sponsorship rates 2026"
Search: "instagram sponsorship rates by follower count {niche}"
Search: "tiktok creator fund requirements 2026"
```

Find realistic sponsorship rates by follower tier for the specific niche.

**Search 3: Platform monetization**
```
Search: "instagram monetization requirements 2026"
Search: "tiktok creator fund eligibility 2026"
Search: "youtube shorts monetization requirements 2026"
Search: "linkedin newsletter monetization"
```

Find current platform-native monetization thresholds and requirements.

**Search 4: Digital products**
```
Search: "digital products {niche} ideas"
Search: "{niche} online course ideas"
Search: "{niche} ebook template examples"
```

Find what people actually sell in this niche (courses, templates, ebooks, presets, guides).

### Step 3: Generate Monetization Plan

Create `projects/{name}/output/monetization-plan.json`:

```json
{
  "niche": "The identified niche category",
  "generatedAt": "ISO timestamp",

  "revenueStreams": [
    {
      "type": "affiliate",
      "name": "Specific program name (e.g. 'Sephora Affiliate Program')",
      "platform": "Signup URL",
      "commission": "Specific rate (e.g. '5-10% on beauty products, 1% on prestige brands')",
      "cookieDuration": "e.g. '24 hours' or '30 days'",
      "payoutMinimum": "e.g. '$10 via direct deposit'",
      "difficulty": "easy | medium | hard",
      "timeToFirstRevenue": "Realistic estimate (e.g. '2-4 weeks after approval')",
      "requirements": "e.g. 'Must have a website or social media presence, apply via Impact'",
      "setupSteps": [
        "Step 1: Go to {specific URL}",
        "Step 2: Create an account / apply",
        "Step 3: Get approved (typically takes X days)",
        "Step 4: Generate affiliate links for recommended products",
        "Step 5: Add links to link-in-bio and relevant posts"
      ]
    },
    {
      "type": "digital-product",
      "name": "e.g. 'The Complete Skincare Routine Guide'",
      "platform": "Gumroad / Stan Store / Etsy Digital",
      "priceRange": "$9-29",
      "difficulty": "medium",
      "timeToFirstRevenue": "1-2 weeks to create, then ongoing",
      "description": "What the product is and why people would buy it",
      "setupSteps": [
        "Step 1: Create the guide using the lead magnet outline as a starting point",
        "Step 2: Set up a Gumroad account at gumroad.com",
        "Step 3: Upload and price the product",
        "Step 4: Add the purchase link to link-in-bio",
        "Step 5: Mention it naturally in content (see monetized copy variants)"
      ]
    },
    {
      "type": "sponsorship",
      "name": "Brand sponsorships",
      "platform": "Direct outreach or via influencer platforms",
      "commission": "Varies by follower count — see projections",
      "difficulty": "hard",
      "timeToFirstRevenue": "3-6 months (need audience first)",
      "requirements": "Typically 5K+ followers for micro-influencer deals",
      "setupSteps": [
        "Step 1: Build to 1K+ followers with consistent posting",
        "Step 2: Create a media kit (follower count, engagement rate, demographics)",
        "Step 3: Sign up for influencer platforms (AspireIQ, Grin, Collabstr)",
        "Step 4: Pitch brands directly via email with specific collaboration ideas"
      ]
    },
    {
      "type": "platform-native",
      "name": "e.g. 'TikTok Creator Fund'",
      "platform": "TikTok",
      "commission": "~$0.02-0.04 per 1K views",
      "difficulty": "easy",
      "timeToFirstRevenue": "After meeting eligibility (10K followers, 100K views/month)",
      "requirements": "Current platform requirements (from web search)",
      "setupSteps": ["..."]
    }
  ],

  "projections": {
    "1k_followers": {
      "monthly_low": "$50",
      "monthly_high": "$200",
      "breakdown": "Mostly affiliate commissions + occasional digital product sales"
    },
    "10k_followers": {
      "monthly_low": "$200",
      "monthly_high": "$1,000",
      "breakdown": "Affiliate + digital products + first sponsorship deals"
    },
    "50k_followers": {
      "monthly_low": "$1,000",
      "monthly_high": "$5,000",
      "breakdown": "Regular sponsorships + strong affiliate + digital product launches"
    },
    "disclaimer": "These are estimates based on published industry averages for the {niche} niche. Actual results vary significantly based on engagement rate, content quality, audience demographics, and monetization strategy."
  },

  "leadMagnet": {
    "title": "From lead-magnet.json if it exists",
    "conversionStrategy": "How to drive traffic from social posts to the lead magnet download page. Specific tactics: link-in-bio, story swipe-ups, pinned comment with link, TikTok bio link.",
    "emailToSale": "How the 4-email welcome sequence (from email-sequence.json) leads to the first purchase. Email 1 delivers the magnet, Email 2 builds trust, Email 3 introduces the offer with social proof, Email 4 creates urgency."
  },

  "utmParameters": {
    "pattern": "utm_source={platform}&utm_medium={content_type}&utm_campaign={brand}-{date}",
    "examples": [
      "https://yourdomain.com/guide?utm_source=instagram&utm_medium=feed&utm_campaign=glowlab-2026-03",
      "https://yourdomain.com/guide?utm_source=tiktok&utm_medium=bio&utm_campaign=glowlab-2026-03",
      "https://yourdomain.com/guide?utm_source=email&utm_medium=welcome&utm_campaign=glowlab-2026-03"
    ],
    "note": "Use these UTM parameters on every link to track which platform and content type drives the most conversions. Measure in Google Analytics or your link-in-bio tool's analytics."
  },

  "quickStartActions": [
    {
      "timing": "Today",
      "action": "Sign up for {specific affiliate program} at {URL}",
      "why": "Approval takes 1-3 days — start now so it's ready when you start posting"
    },
    {
      "timing": "Today",
      "action": "Set up a link-in-bio tool (Stan Store, Linktree, or Beacons)",
      "why": "You need a single link that houses all your affiliate links, lead magnet, and product links"
    },
    {
      "timing": "This week",
      "action": "Create the lead magnet: '{lead magnet title}'",
      "why": "This is your email list builder — the foundation of owned audience monetization"
    },
    {
      "timing": "This week",
      "action": "Set up email tool (ConvertKit or Beehiiv free tier) with the 4-email welcome sequence",
      "why": "Email converts 3-5x better than social media for sales"
    },
    {
      "timing": "This week",
      "action": "Post Day 1 content following the posting schedule",
      "why": "Content is the growth engine — everything else monetizes the audience it builds"
    },
    {
      "timing": "Week 2",
      "action": "Create the digital product: '{product name}'",
      "why": "Digital products are the highest-margin revenue stream — 90%+ profit"
    }
  ]
}
```

### Step 4: Create Monetized Copy Variants

Read `output/copy/all-copy.json` (or individual platform files). For posts where a natural monetization mention fits, create alternative versions.

**Rules:**
- Not every post should sell. Flag each as `trust-building` or `revenue-driving`.
- Aim for 70% trust-building, 30% revenue-driving content.
- Monetization must feel natural — not "BUY NOW!!!!" but "I've been using X for 3 months and it's the only thing that worked for me (link in bio)."
- Affiliate disclosures: include "#ad" or "#affiliate" or "affiliate link" where legally required.

Save monetized variants as separate files — never overwrite the originals:

```
output/copy/instagram-monetized.json
output/copy/tiktok-monetized.json
output/copy/linkedin-monetized.json
output/copy/twitter-monetized.json
```

Each monetized file has the same structure as the original, but with:
- `monetizationType` field: `"trust-building"` or `"revenue-driving"`
- For revenue-driving posts: modified CTA pointing to affiliate link or product
- Added disclosure where required

Example:
```json
{
  "posts": [
    {
      "assetFile": "scene-1-square.jpg",
      "monetizationType": "trust-building",
      "caption": "Original caption — no monetization changes. Pure value.",
      "hashtags": ["..."],
      "cta": "Save this for later"
    },
    {
      "assetFile": "scene-2-square.jpg",
      "monetizationType": "revenue-driving",
      "caption": "Modified caption that naturally mentions the product with affiliate link. #affiliate",
      "hashtags": ["..."],
      "cta": "Link in bio for 15% off",
      "affiliateProgram": "Sephora Affiliate Program",
      "disclosure": "#affiliate"
    }
  ]
}
```

### Step 5: Revenue Projection Rules

These are critical. Never promise unrealistic income.

**Hard rules for projections:**
- ALWAYS base projections on published benchmarks found via web search
- ALWAYS show ranges, never single numbers
- ALWAYS include the disclaimer about actual results varying
- Niche adjustment: luxury/finance/B2B niches pay 2-3x more than lifestyle/entertainment
- Engagement matters more than followers: 5K highly engaged > 50K passive followers
- Be conservative — it's better to under-promise

**Realistic ranges by niche (use as sanity checks, not as outputs — always research current data):**

| Niche | 1K followers | 10K followers | 50K followers |
|---|---|---|---|
| Beauty/skincare | $30-150/mo | $150-800/mo | $800-4,000/mo |
| Fitness/health | $50-200/mo | $200-1,000/mo | $1,000-5,000/mo |
| Finance/investing | $100-400/mo | $400-2,000/mo | $2,000-10,000/mo |
| Food/cooking | $20-100/mo | $100-500/mo | $500-2,500/mo |
| Tech/SaaS | $50-250/mo | $250-1,500/mo | $1,500-7,000/mo |
| Fashion/lifestyle | $20-100/mo | $100-600/mo | $600-3,000/mo |

### Step 6: Generate Tracking CSV Template

Create `projects/{name}/output/revenue-tracker.csv`:

```csv
date,platform,content_type,asset_file,impressions,engagement,link_clicks,affiliate_clicks,revenue,notes
2026-03-10,instagram,feed,glowlab-ig-feed-01.jpg,,,,,,"Week 1 launch post"
2026-03-11,tiktok,video,glowlab-tiktok-01.mp4,,,,,,"First TikTok"
2026-03-12,instagram,feed,glowlab-ig-feed-02.jpg,,,,,,"Product detail"
```

Pre-populate with:
- One row per asset from the posting schedule
- Date, platform, content type, and asset file pre-filled
- Impressions, engagement, clicks, and revenue columns empty (user fills these in)
- Notes column with context from the posting schedule

This gives the user a ready-made spreadsheet to track ROI on every piece of content.

### Step 7: Report and Close the Loop

Show the results:

```
Monetization plan complete!

Revenue streams identified:
  - {X} affiliate programs (avg {Y}% commission)
  - {X} digital product ideas
  - {X} platform monetization paths
  - Sponsorship roadmap

Projected monthly revenue:
  1K followers:  ${low}-${high}/mo
  10K followers: ${low}-${high}/mo
  50K followers: ${low}-${high}/mo

Files saved:
  output/monetization-plan.json  — full strategy with setup steps
  output/copy/*-monetized.json   — copy variants with natural affiliate CTAs
  output/revenue-tracker.csv     — spreadsheet to track content ROI
```

Then close the loop: "Your full content-to-revenue system is ready. To run another campaign for {brand}, just describe what you want next."

This completes the full workflow: brief → generate → copy → package → monetize.
