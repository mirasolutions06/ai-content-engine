# Prompt Best Practices

Tested techniques from published guides, creator communities, and API documentation.

## Universal Prompt Structure

Works across Kling, Veo, Gemini, GPT Image:
```
[shot type] of [subject] doing [action] in [setting], [camera movement], [lens], [lighting], [atmosphere]
```

- One clear moment per prompt, not a sequence
- Narrative descriptions outperform keyword lists
- ONE camera verb, ONE lighting motif, ONE action per clip
- Every word should earn its place — concise + specific > verbose + vague

## Lens Language

| Lens | Effect | Use for |
|---|---|---|
| 24-35mm wide | Environmental context, spacious | Establishing shots, lifestyle |
| 50mm | Natural "human eye" perspective | General scenes, balanced |
| 85mm telephoto | Compression, shallow DOF, intimate | Portraits, product close-ups |
| Macro | Extreme detail | Texture, ingredients, small objects |

## Lighting Terms That Work

- "Golden hour" — warm, directional, long shadows (universally understood)
- "Three-point softbox" — even studio lighting
- "Chiaroscuro" — high contrast, dramatic shadows
- "Rim lighting" / "edge-lit" — subject separation from dark background
- "Practical lighting" — in-scene sources (lamps, screens, fire)
- "Soft diffused window light" — natural, authentic, UGC feel

## Frameworks

### SEAL CAM (Cinematic / Hero)
- **Setting** — environment first ("dark marble surface with warm bokeh")
- **Elements** — subjects in frame ("frosted glass bottle, dried botanicals")
- **Atmosphere** — light, mood, temperature ("warm amber side-light, lifted shadows")
- **Lens** — distance, angle, DOF ("close-up, 85mm, f/1.8 shallow focus")
- **Camera Movement** — movement LAST, keep minimal ("slow push-in")

### BOPA (Brand / Lifestyle)
- **Brand** — palette, aesthetic ("luxury minimal, warm earth tones")
- **Object** — product placement ("bottle centered, label facing camera")
- **Person** — model if applicable ("woman mid-30s, natural makeup")
- **Action** — the moment ("applying serum to cheek, eyes closed")

### UGC / Realism
- Realism keywords: "pores visible", "natural skin texture", "subtle imperfections", "unretouched"
- Avoid: "perfect", "flawless", "beautiful" — triggers AI smoothing
- Lighting: "natural window light", "phone camera flash", "ring light"
- Environment cues: "kitchen counter", "bathroom mirror", "car interior"

### Product Photography
- Always describe surface material ("on white marble", "dark slate", "raw linen")
- Specify reflection: "matte finish", "glossy catch light", "soft sheen"
- One product per frame — multi-product confuses generators
- Include scale reference when relevant (hands, objects nearby)

## Provider: Kling (Image-to-Video via fal.ai)

**The critical rule: In i2v mode, describe ONLY motion. Never re-describe the image.**

- Prompt max: 2,500 chars. Optimal: 50-150 words
- cfg_scale: 0.3-0.7 (default 0.5). Lower = more creative
- Limit to 2-4 main ideas. More causes overload

**Motion keywords that work:**
- Soft: "subtle", "slow", "micro", "gentle", "gradually"
- Camera: "slow pan left", "gentle dolly-in", "tracking shot from side"
- Atmospheric: "soft parallax", "depth-based reveals", "natural handheld motion"

**Motion prompt structure:**
```
[Subject movement], [camera behavior], [environmental motion]
```

**Preventing failures:**
- Objects morph → add rigidity: "the metal surface remains solid throughout"
- Proportions distort → add locks: "maintain scale", "keep silhouette identical"
- Static output → always specify camera movement explicitly
- 99% hang → add endpoints: "then settles into place"
- Geometry warp → ONE motion at a time, never simultaneous camera transforms

**Negative prompt format:** State unwanted elements as nouns, no "don't" or "no":
```
blur, distortion, morphing, jitter, low quality, text, watermarks
```

**Always start with a calm baseline.** If identity/anatomy break at low motion, high motion amplifies every failure.

## Provider: Veo 3.1

- Duration: 4, 6, or 8 seconds at 24fps
- Aspect: 16:9 or 9:16 only
- Supports up to 3 reference images

**Prompt structure:**
```
Subject + Action + Setting + Style + Camera + Lighting + Motion
```

**Camera terms:** static, pan, tilt, dolly, truck, crane, aerial, handheld, POV, tracking

**What makes Veo different:**
- Better at complex camera movements than Kling ("crane shot ascending")
- Good with atmospheric motion: "steam rising", "fabric billowing", "dust particles"
- Supports facial micro-expressions: "eyes narrow slightly, furrow appears between brows"
- Native audio generation — specify: `Audio: distant traffic hum, sizzling oil`

**Subtitle prevention:** Add "no subtitles, no on-screen text" — Veo can render unwanted text

**Consistency across shots:** Re-state key identity cues every generation (wardrobe, hair, specific props). Veo drifts without anchoring.

## Provider: Gemini (Image Generation)

- Model: gemini-3-pro-image
- Supports up to 14 reference images for consistency
- Narrative descriptions > keyword lists

**What works:**
- Photography terminology: "editorial fashion", "food photography", "product flat lay"
- Aspect context in prompt: "vertical portrait composition", "wide landscape framing"
- Quality modifiers: "HD", "4K", "HDR" improve clarity
- Lens language: "85mm portrait lens", "wide-angle shot", "macro detail"

**Text rendering:** Enclose in quotes: `the text "Brand Name"`, describe font style

**Iteration strategy:** Start with 1-2 sentences. Run. Add details until right. Single-element changes per iteration.

## Provider: GPT Image

- Model: gpt-image-1
- ~98% text accuracy (best in class)
- Sizes: 1024x1024, 1024x1536, 1536x1024
- Does NOT auto-rewrite prompts (unlike DALL-E 3)

**Prompt order:** Background/Scene → Subject → Key Details → Constraints

**What works:**
- More literal interpretation — be explicit about every visual element
- Include intended use ("product ad", "social media post") to set polish level
- Photography language: "35mm film", "50mm lens", "shallow depth of field"
- For realism: "candid", "unposed", "everyday detail", "weathered surfaces"

**Reference images:** Label by index: "Image 1: product photo, Image 2: style reference. Apply Image 2's style to Image 1."

**Critical:** Re-state invariants every iteration. Drift is the default behavior. State exclusions: "no watermark", "no extra text", "preserve identity/layout"

## Anti-Patterns

- "Beautiful" / "stunning" / "amazing" — empty calories, replace with specific descriptors
- Multi-subject scenes without clear spatial relationships
- Simultaneous competing camera movements
- Keyword spam instead of narrative description
- Describing a sequence ("picks up, opens, pours") — that's 3 frames, not 1
- Conflicting lighting in same prompt ("golden hour" + "studio lighting")
- Expecting consistency across generations without explicit visual anchoring
