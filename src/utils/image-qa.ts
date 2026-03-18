import fs from 'fs-extra';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';
import { retryWithBackoff } from './retry.js';
import type { ImageQAResult } from '../types/index.js';

const QA_MODEL = 'claude-haiku-4-5-20251001';

const QA_SYSTEM_PROMPT = `You are a creative director reviewing AI-generated images for real brand campaigns on social media (Instagram, TikTok, ads). Your job is to judge whether each image WORKS as campaign content — not whether it literally matches every word of the prompt.

The prompt is a creative direction guide, NOT a technical specification. Gemini interprets prompts loosely. If the prompt says "85mm f/2" but the image looks like it was shot at 50mm — that is irrelevant if the image looks great. Score the OUTPUT on its own merits.

Return ONLY a JSON object with these fields — no markdown fences, no explanation:

{
  "modelAccuracy": <1-5>,
  "productAccuracy": <1-5>,
  "composition": <1-5>,
  "artifacts": <1-5>,
  "editorialImpact": <1-5>,
  "issues": ["<issue 1>", "<issue 2>"]
}

Scoring guide:
- modelAccuracy: Does the person match the model reference? Same face, skin tone, hair, features. 5 = clearly the same person, 4 = strong resemblance with minor differences, 3 = similar type but noticeable drift, 2 = different person similar type, 1 = completely wrong. Score 5 if no model reference was provided. For detail/close-up shots where face is not visible, score based on visible attributes only (skin tone, body type).
- productAccuracy: Does the product look correct? Right color, right garment type, right silhouette. 5 = product looks exactly right, 4 = minor color/texture differences, 3 = recognizable but notably off, 2 = wrong product, 1 = unrelated. Score 5 if no product reference was provided. Do NOT nitpick subtle color shifts from lighting — colored gels and dramatic lighting WILL shift how fabric color reads, and that's intentional photography, not a product error.
- composition: Would a real brand post this? Professional framing, single image (no collage), good use of space, strong visual hierarchy. 5 = campaign-ready, 4 = strong with minor tweaks, 3 = acceptable, 2 = amateur, 1 = unusable. When style/location refs are provided, editorial/lifestyle settings are expected.
- artifacts: AI generation quality. 5 = photorealistic, indistinguishable from a real photo. 4 = minor tells but wouldn't stop someone scrolling. 3 = noticeable artifacts. 2 = distracting issues. 1 = severe (extra fingers, floating limbs, melted features, watermarks).
- editorialImpact: Would this image stop someone scrolling? Does it have attitude, mood, visual drama? 5 = scroll-stopping, brand would proudly post this. 4 = strong editorial. 3 = competent but safe/generic. 2 = stock photo feel. 1 = flat/boring. This is the most important score — a technically imperfect image with great energy beats a technically clean but boring one.
- issues: Only flag issues that would actually matter to a brand posting this on social media. Do NOT flag: minor lighting deviations from the prompt, lens/f-stop differences, subtle color shifts from dramatic lighting, or any prompt-literal nitpicks. DO flag: wrong person, wrong product, AI artifacts visible at social media resolution, bad composition, collages/grids, or anything that makes the image look unprofessional.`;

async function encodeImage(imagePath: string): Promise<Anthropic.ImageBlockParam | null> {
  try {
    const buffer = await fs.readFile(imagePath);
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
    const mediaType = isPng ? 'image/png' : 'image/jpeg';
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') },
    };
  } catch {
    return null;
  }
}

/**
 * Evaluates a generated image using Claude Haiku vision.
 * Compares against model and product reference images if provided.
 *
 * @returns QA result with scores and pass/fail, or null if evaluation fails
 */
export async function evaluateImage(
  generatedImagePath: string,
  modelRefPaths: string[],
  productRefPaths: string[],
  sceneLabel: string,
  styleRefPaths: string[] = [],
  sceneIntent?: string,
  productDescriptions?: string[],
  brandName?: string,
): Promise<ImageQAResult | null> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return null;

  try {
    const client = new Anthropic({ apiKey });
    const contentParts: Anthropic.ContentBlockParam[] = [];

    // Add model references
    for (const refPath of modelRefPaths) {
      const encoded = await encodeImage(refPath);
      if (encoded) {
        contentParts.push(
          { type: 'text', text: `[MODEL REFERENCE — "${path.basename(refPath)}"]` },
          encoded,
        );
      }
    }

    // Add product references
    for (const refPath of productRefPaths) {
      const encoded = await encodeImage(refPath);
      if (encoded) {
        contentParts.push(
          { type: 'text', text: `[PRODUCT REFERENCE — "${path.basename(refPath)}"]` },
          encoded,
        );
      }
    }

    // Add style references — gives QA context about intended mood/aesthetic
    for (const refPath of styleRefPaths) {
      const encoded = await encodeImage(refPath);
      if (encoded) {
        contentParts.push(
          { type: 'text', text: `[STYLE REFERENCE — "${path.basename(refPath)}" — this shows the intended mood/aesthetic]` },
          encoded,
        );
      }
    }



    // Add the generated image
    const generatedEncoded = await encodeImage(generatedImagePath);
    if (!generatedEncoded) return null;

    contentParts.push(
      { type: 'text', text: `[GENERATED IMAGE TO EVALUATE — "${sceneLabel}"]` },
      generatedEncoded,
    );

    const hasLifestyleContext = styleRefPaths.length > 0;
    const intentContext = sceneIntent ? `\n\nSCENE INTENT: "${sceneIntent}" — Judge whether the image successfully delivers on this creative brief. Detail shots, close-ups, and partial views are intentional when described in the intent.` : '';
    const productContext = (productDescriptions && productDescriptions.length > 0 && brandName)
      ? `\n\nIMPORTANT — PRODUCT REFERENCE CONTEXT: The product reference images are used for PACKAGING SHAPE and FORM guidance only. The brand being photographed is "${brandName}". The generated products should match these descriptions: ${productDescriptions.join('; ')}. Judge productAccuracy on shape, material, and form similarity to the references — NOT on brand labeling. The generated products correctly show "${brandName}" branding, which will differ from whatever brand appears on the reference packaging photos.`
      : '';
    contentParts.push({
      type: 'text',
      text: `Score this generated image against the reference images above.${intentContext}${productContext} ${modelRefPaths.length === 0 ? 'No model reference provided — score modelAccuracy as 5.' : ''} ${productRefPaths.length === 0 ? 'No product reference provided — score productAccuracy as 5.' : ''} ${hasLifestyleContext ? 'Style/location references are provided — this is editorial/lifestyle photography. Outdoor and environmental settings are intentional and expected.' : ''}`,
    });

    const response = await retryWithBackoff(
      () => client.messages.create({
        model: QA_MODEL,
        max_tokens: 512,
        system: QA_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: contentParts }],
      }),
      { attempts: 3, delayMs: 3000, label: 'Image QA Claude call' },
    );

    const text = response.content[0]?.type === 'text' ? response.content[0].text : null;
    if (!text) return null;

    const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as {
      modelAccuracy: number;
      productAccuracy: number;
      composition: number;
      artifacts: number;
      editorialImpact?: number;
      issues: string[];
    };

    const editorial = parsed.editorialImpact ?? 3;
    const score = (parsed.modelAccuracy + parsed.productAccuracy + parsed.composition + parsed.artifacts + editorial) / 5;
    const result: ImageQAResult = {
      scene: sceneLabel,
      score: Math.round(score * 10) / 10,
      modelAccuracy: parsed.modelAccuracy,
      productAccuracy: parsed.productAccuracy,
      composition: parsed.composition,
      artifacts: parsed.artifacts,
      editorialImpact: editorial,
      issues: parsed.issues ?? [],
      pass: score >= 3.0,
    };

    // Log result
    const scoreStr = `${result.score}/5 (model: ${result.modelAccuracy}, product: ${result.productAccuracy}, composition: ${result.composition}, artifacts: ${result.artifacts}, impact: ${editorial})`;
    if (result.pass) {
      logger.info(`  QA: ${scoreStr}`);
    } else {
      logger.warn(`  QA: ${scoreStr} — review recommended`);
    }
    if (result.issues.length > 0) {
      logger.info(`  QA issues: ${result.issues.join('; ')}`);
    }

    return result;
  } catch (err) {
    logger.warn(`QA evaluation failed for ${sceneLabel}: ${String(err)}`);
    return null;
  }
}

/**
 * Saves all QA results to the project's cache directory.
 */
export async function saveQAResults(
  results: ImageQAResult[],
  projectsRoot: string,
  projectName: string,
): Promise<void> {
  if (results.length === 0) return;
  const qaPath = path.join(projectsRoot, projectName, 'cache', 'qa-results.json');
  await fs.ensureDir(path.dirname(qaPath));
  await fs.outputJson(qaPath, {
    evaluatedAt: new Date().toISOString(),
    results,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.pass).length,
      averageScore: Math.round((results.reduce((sum, r) => sum + r.score, 0) / results.length) * 10) / 10,
    },
  }, { spaces: 2 });
  logger.info(`QA results saved to cache/qa-results.json`);
}
