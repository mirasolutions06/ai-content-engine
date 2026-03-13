import fs from 'fs-extra';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';
import type { ImageQAResult } from '../types/index.js';

const QA_MODEL = 'claude-haiku-4-5-20251001';

const QA_SYSTEM_PROMPT = `You are a quality-control reviewer for AI-generated commercial photography. You score images against reference photos and professional standards.

Return ONLY a JSON object with these fields — no markdown fences, no explanation:

{
  "modelAccuracy": <1-5>,
  "productAccuracy": <1-5>,
  "composition": <1-5>,
  "artifacts": <1-5>,
  "issues": ["<issue 1>", "<issue 2>"]
}

Scoring guide:
- modelAccuracy: Does the person match the model reference? Same face, skin tone, hair, features. 5 = identical, 3 = similar but differences, 1 = different person. Score 5 if no model reference was provided.
- productAccuracy: Does the product match the product reference? Same shape, color, label, material. 5 = exact match, 3 = similar, 1 = wrong product or phantom product invented. Score 5 if no product reference was provided.
- composition: Professional framing? Single image (no collage/grid)? Good use of space? 5 = editorial quality, 3 = acceptable, 1 = poor framing or collage.
- artifacts: AI generation quality. 5 = photorealistic, no issues. 3 = minor artifacts. 1 = severe issues (extra fingers, floating limbs, plastic skin, text/watermarks).
- issues: List specific problems found. Empty array if none.`;

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

    // Add the generated image
    const generatedEncoded = await encodeImage(generatedImagePath);
    if (!generatedEncoded) return null;

    contentParts.push(
      { type: 'text', text: `[GENERATED IMAGE TO EVALUATE — "${sceneLabel}"]` },
      generatedEncoded,
    );

    contentParts.push({
      type: 'text',
      text: `Score this generated image against the reference images above. ${modelRefPaths.length === 0 ? 'No model reference provided — score modelAccuracy as 5.' : ''} ${productRefPaths.length === 0 ? 'No product reference provided — score productAccuracy as 5.' : ''}`,
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
      issues: string[];
    };

    const score = (parsed.modelAccuracy + parsed.productAccuracy + parsed.composition + parsed.artifacts) / 4;
    const result: ImageQAResult = {
      scene: sceneLabel,
      score: Math.round(score * 10) / 10,
      modelAccuracy: parsed.modelAccuracy,
      productAccuracy: parsed.productAccuracy,
      composition: parsed.composition,
      artifacts: parsed.artifacts,
      issues: parsed.issues ?? [],
      pass: score >= 3.0,
    };

    // Log result
    const scoreStr = `${result.score}/5 (model: ${result.modelAccuracy}, product: ${result.productAccuracy}, composition: ${result.composition}, artifacts: ${result.artifacts})`;
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
