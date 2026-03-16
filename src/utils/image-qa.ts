import fs from 'fs-extra';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';
import type { ImageQAResult } from '../types/index.js';

const QA_MODEL = 'claude-haiku-4-5-20251001';

const QA_SYSTEM_PROMPT = `You are a quality-control reviewer for AI-generated commercial photography. You score images against reference photos, professional standards, AND the creative intent of each scene.

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
- modelAccuracy: Does the person match the model reference? Same face, skin tone, hair, features. 5 = identical, 3 = similar but differences, 1 = different person. Score 5 if no model reference was provided. IMPORTANT: For intentional detail/close-up shots where the face is not visible (fabric close-ups, waistband details, flat-lays), score based on visible attributes only (skin tone, body type). Do NOT penalize for face not being visible when the scene intent is a detail or product shot.
- productAccuracy: Does the product match the product reference? Same shape, color, fabric, material. 5 = exact match, 3 = similar, 1 = wrong product. Score 5 if no product reference was provided. IMPORTANT: If the scene intent describes showing only PART of the product (e.g. "waistband detail", "fabric close-up"), score based on what IS shown — do not penalize for not showing the full outfit.
- composition: Professional framing? Single image (no collage/grid)? Good use of space? 5 = editorial quality, 3 = acceptable, 1 = poor framing or collage. When STYLE or LOCATION references are provided, the image is intended as editorial/lifestyle — outdoor settings, environmental context, and non-studio backgrounds are EXPECTED and should NOT be penalized. Judge composition by editorial photography standards, not studio product photography.
- artifacts: AI generation quality. 5 = photorealistic, no issues. 3 = minor artifacts. 1 = severe issues (extra fingers, floating limbs, plastic skin, text/watermarks).
- editorialImpact: Would this image stop someone scrolling on social media? Does it have attitude, mood, visual drama? 5 = scroll-stopping, would perform well on TikTok/Instagram. 4 = strong editorial quality. 3 = competent but generic/safe. 2 = stock photography feel. 1 = boring, flat, no visual interest. This is about CREATIVE IMPACT, not technical accuracy.
- issues: List specific problems found. Empty array if none. Do NOT flag outdoor/environmental settings as issues when style or location references are provided — those settings are intentional.`;

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
  locationRefPaths: string[] = [],
  sceneIntent?: string,
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

    // Add location references — gives QA context about intended environment
    for (const refPath of locationRefPaths) {
      const encoded = await encodeImage(refPath);
      if (encoded) {
        contentParts.push(
          { type: 'text', text: `[LOCATION REFERENCE — "${path.basename(refPath)}" — this shows the intended setting/environment]` },
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

    const hasLifestyleContext = styleRefPaths.length > 0 || locationRefPaths.length > 0;
    const intentContext = sceneIntent ? `\n\nSCENE INTENT: "${sceneIntent}" — Judge whether the image successfully delivers on this creative brief. Detail shots, close-ups, and partial views are intentional when described in the intent.` : '';
    contentParts.push({
      type: 'text',
      text: `Score this generated image against the reference images above.${intentContext} ${modelRefPaths.length === 0 ? 'No model reference provided — score modelAccuracy as 5.' : ''} ${productRefPaths.length === 0 ? 'No product reference provided — score productAccuracy as 5.' : ''} ${hasLifestyleContext ? 'Style/location references are provided — this is editorial/lifestyle photography. Outdoor and environmental settings are intentional and expected.' : ''}`,
    });

    const response = await client.messages.create({
      model: QA_MODEL,
      max_tokens: 512,
      system: QA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contentParts }],
    });

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
