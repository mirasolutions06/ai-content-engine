import crypto from 'crypto';
import path from 'path';
import fs from 'fs-extra';
import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai';
import { logger } from '../utils/logger.js';
import type { VideoAnalysis } from '../types/index.js';

const MODEL = 'gemini-2.5-flash';

const ANALYSIS_PROMPT = `Analyze this reference video for a short-form content production pipeline.
Extract the visual style, pacing, and creative approach used.

Return ONLY this JSON object, no markdown fences, no explanatory text:
{
  "visualStyle": "<overall look: lighting style, camera work, lens choice, production quality>",
  "pacing": "<edit rhythm: fast cuts, slow holds, beat-synced, builds to climax>",
  "transitions": "<how scenes connect: hard cuts, fades, wipes, match-cuts, whip pans>",
  "colorGrading": "<color treatment: warm, cool, desaturated, high-contrast, specific LUT style>",
  "composition": "<framing tendencies: close-ups vs wide shots, symmetry, rule-of-thirds, overhead>",
  "textOverlayPatterns": "<how text appears: position, timing, font style, motion, or 'none'>",
  "mood": "<emotional tone: energetic, calm, dramatic, playful, luxurious, raw>"
}`;

/** Max bytes to read for hashing (10MB) */
const HASH_LIMIT = 10 * 1024 * 1024;
/** Max video duration to analyze (30 seconds) */
const MAX_ANALYZE_SECONDS = 30;
/** Max inline base64 file size (20MB raw = ~27MB base64) */
const INLINE_MAX_BYTES = 20 * 1024 * 1024;

function getCachePath(projectsRoot: string, projectName: string, hash: string): string {
  return path.join(projectsRoot, projectName, 'cache', `video-analysis-${hash}.json`);
}

/**
 * Hashes the first 10MB of a video file for cache keying.
 */
async function hashVideoFile(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath);
  const size = Math.min(stat.size, HASH_LIMIT);
  // Read up to HASH_LIMIT bytes for hashing (avoids loading huge files into memory)
  const nodeFs = await import('fs');
  const fd = await nodeFs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(size);
    await fd.read(buffer, 0, size, 0);
    return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);
  } finally {
    await fd.close();
  }
}

/**
 * Trims a video to the first N seconds using ffmpeg.
 * Returns the trimmed file path (in a temp location), or the original path if short enough.
 */
async function trimIfNeeded(filePath: string, projectsRoot: string, projectName: string): Promise<string> {
  const { execSync } = await import('child_process');

  // Probe duration
  try {
    const durationStr = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' },
    ).trim();
    const duration = parseFloat(durationStr);

    if (duration <= MAX_ANALYZE_SECONDS) {
      return filePath;
    }

    const trimmedPath = path.join(projectsRoot, projectName, 'cache', '_video-analysis-segment.mp4');
    await fs.ensureDir(path.dirname(trimmedPath));
    execSync(
      `ffmpeg -y -i "${filePath}" -t ${MAX_ANALYZE_SECONDS} -c copy "${trimmedPath}"`,
      { stdio: 'pipe' },
    );
    logger.info(`Video analyzer: trimmed ${path.basename(filePath)} to ${MAX_ANALYZE_SECONDS}s for analysis.`);
    return trimmedPath;
  } catch {
    // If ffprobe/ffmpeg fails, try analyzing the full file
    logger.warn('Video analyzer: ffprobe/ffmpeg not available — analyzing full video file.');
    return filePath;
  }
}

/**
 * Analyzes reference videos in a project's assets/reference/ directory using Gemini.
 *
 * Finds the first .mp4 or .mov file, analyzes it for style/pacing/mood, and caches the result.
 * Non-fatal — returns null if no videos found, GEMINI_API_KEY not set, or analysis fails.
 */
export async function analyzeReferenceVideos(
  projectsRoot: string,
  projectName: string,
): Promise<VideoAnalysis | null> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    return null;
  }

  // Check project root and legacy assets/reference/ for video files
  const projectDir = path.join(projectsRoot, projectName);
  const legacyDir = path.join(projectDir, 'assets', 'reference');
  let videoPath: string | null = null;

  // Check project root first
  const rootFiles = await fs.readdir(projectDir);
  const rootVideo = rootFiles.find((f) => /\.(mp4|mov)$/i.test(f));
  if (rootVideo) {
    videoPath = path.join(projectDir, rootVideo);
  }

  // Fall back to assets/reference/
  if (videoPath === null && await fs.pathExists(legacyDir)) {
    const legacyFiles = await fs.readdir(legacyDir);
    const legacyVideo = legacyFiles.find((f) => /\.(mp4|mov)$/i.test(f));
    if (legacyVideo) videoPath = path.join(legacyDir, legacyVideo);
  }

  if (videoPath === null) return null;
  const fileHash = await hashVideoFile(videoPath);
  const cachePath = getCachePath(projectsRoot, projectName, fileHash);

  // Check cache
  if (await fs.pathExists(cachePath)) {
    try {
      const cached = (await fs.readJson(cachePath)) as VideoAnalysis;
      logger.skip(`Video analyzer: using cached analysis for ${path.basename(videoPath)} (hash: ${fileHash})`);
      return cached;
    } catch {
      logger.warn('Video analyzer: cache unreadable — re-analyzing.');
    }
  }

  logger.step(`Video analyzer: analyzing ${path.basename(videoPath)} with ${MODEL}...`);

  try {
    const ai = new GoogleGenAI({ apiKey });
    const analyzePath = await trimIfNeeded(videoPath, projectsRoot, projectName);
    const stat = await fs.stat(analyzePath);

    let response;

    if (stat.size <= INLINE_MAX_BYTES) {
      // Small enough for inline base64
      const videoData = await fs.readFile(analyzePath);
      const ext = path.extname(analyzePath).toLowerCase();
      const mimeType = ext === '.mov' ? 'video/quicktime' : 'video/mp4';

      response = await ai.models.generateContent({
        model: MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: videoData.toString('base64') } },
              { text: ANALYSIS_PROMPT },
            ],
          },
        ],
      });
    } else {
      // Use file upload API for larger files
      const uploaded = await ai.files.upload({
        file: analyzePath,
        config: { mimeType: 'video/mp4' },
      });

      // Wait for processing
      let file = await ai.files.get({ name: uploaded.name! });
      const uploadStart = Date.now();
      while (file.state === 'PROCESSING') {
        if (Date.now() - uploadStart > 5 * 60 * 1000) {
          throw new Error('Video file processing timed out (5 minutes)');
        }
        await new Promise((r) => setTimeout(r, 5000));
        file = await ai.files.get({ name: file.name! });
      }

      if (file.state !== 'ACTIVE') {
        throw new Error(`Video file processing failed: state=${file.state}`);
      }

      response = await ai.models.generateContent({
        model: MODEL,
        contents: createUserContent([
          createPartFromUri(file.uri!, file.mimeType!),
          ANALYSIS_PROMPT,
        ]),
      });
    }

    const text = response.candidates?.[0]?.content?.parts?.[0];
    const rawJson = text && 'text' in text ? text.text : null;
    if (!rawJson) throw new Error('Gemini returned no text response');

    const cleaned = rawJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Omit<VideoAnalysis, 'sourceHash' | 'analyzedAt'>;

    const analysis: VideoAnalysis = {
      ...parsed,
      sourceHash: fileHash,
      analyzedAt: new Date().toISOString(),
    };

    await fs.ensureDir(path.dirname(cachePath));
    await fs.outputJson(cachePath, analysis, { spaces: 2 });
    logger.success(`Video analyzer: analysis cached for ${path.basename(videoPath)}`);

    // Clean up trimmed segment if it was created
    const segmentPath = path.join(projectsRoot, projectName, 'cache', '_video-analysis-segment.mp4');
    if (await fs.pathExists(segmentPath)) {
      await fs.remove(segmentPath);
    }

    return analysis;
  } catch (err) {
    logger.warn(`Video analyzer: analysis failed — ${String(err)}`);
    return null;
  }
}
