import path from 'path';
import fs from 'fs-extra';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import type { VideoConfig } from '../types/index.js';

const execFileAsync = promisify(execFile);

/** Number of key frames to extract from reference video */
const FRAME_COUNT = 4;
/** Frame positions as percentages of total duration (avoids intro/outro) */
const FRAME_POSITIONS = [0.15, 0.35, 0.55, 0.75];
/** Minimum download size to accept (50KB — reject bad downloads) */
const MIN_DOWNLOAD_BYTES = 50_000;

const SOCIAL_DOMAINS = ['tiktok.com', 'instagram.com', 'youtube.com', 'youtu.be', 'x.com', 'twitter.com'];

function isSocialUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return SOCIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function isUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

async function ytDlpAvailable(): Promise<boolean> {
  try {
    await execFileAsync('which', ['yt-dlp']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads a video from a direct URL using fetch.
 */
async function downloadDirect(url: string, outputPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MiraEngine/1.0)' },
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return false;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_DOWNLOAD_BYTES) {
      logger.warn(`Video ref: download too small (${buffer.length} bytes) — likely not a video.`);
      return false;
    }

    await fs.ensureDir(path.dirname(outputPath));
    await fs.writeFile(outputPath, buffer);
    return true;
  } catch (err) {
    logger.warn(`Video ref: direct download failed — ${String(err)}`);
    return false;
  }
}

/**
 * Downloads a video from a social media URL using yt-dlp.
 */
async function downloadWithYtDlp(url: string, outputPath: string): Promise<boolean> {
  try {
    await execFileAsync('yt-dlp', [
      '-f', 'best[ext=mp4]/best',
      '--no-playlist',
      '-o', outputPath,
      url,
    ], { timeout: 120_000 });
    return await fs.pathExists(outputPath);
  } catch (err) {
    logger.warn(`Video ref: yt-dlp download failed — ${String(err)}`);
    return false;
  }
}

/**
 * Extracts key frames from a video at evenly-spaced positions.
 * Saves as videoref-1.jpg through videoref-N.jpg in the project root.
 */
async function extractKeyFrames(videoPath: string, projectDir: string): Promise<string[]> {
  // Get video duration
  let duration: number;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoPath,
    ]);
    duration = parseFloat(stdout.trim());
    if (isNaN(duration) || duration <= 0) throw new Error('Invalid duration');
  } catch (err) {
    logger.warn(`Video ref: could not probe duration — ${String(err)}`);
    return [];
  }

  const extracted: string[] = [];

  for (let i = 0; i < FRAME_COUNT; i++) {
    const outPath = path.join(projectDir, `videoref-${i + 1}.jpg`);

    if (await fs.pathExists(outPath)) {
      extracted.push(outPath);
      continue;
    }

    const seekTime = duration * FRAME_POSITIONS[i]!;

    try {
      await execFileAsync('ffmpeg', [
        '-ss', seekTime.toFixed(2),
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '2',
        '-y',
        outPath,
      ]);
      extracted.push(outPath);
    } catch (err) {
      logger.warn(`Video ref: frame extraction failed at ${seekTime.toFixed(1)}s — ${String(err)}`);
    }
  }

  return extracted;
}

/**
 * Processes a videoRef config field: downloads the video (if URL), extracts key frames.
 * The existing video-analyzer.ts will auto-discover the downloaded .mp4 for Gemini analysis.
 *
 * @returns Path to the local video file, or null if processing failed.
 */
export async function processVideoRef(
  config: VideoConfig,
  projectDir: string,
  dryRun: boolean,
): Promise<string | null> {
  const ref = config.videoRef;
  if (!ref) return null;

  const videoPath = path.join(projectDir, 'reference-video.mp4');

  // ── Resolve video file ───────────────────────────────────────────────────
  if (isUrl(ref)) {
    if (await fs.pathExists(videoPath)) {
      logger.skip(`Video ref: reference-video.mp4 already exists — skipping download.`);
    } else if (dryRun) {
      logger.info(`Video ref: [dry-run] would download ${ref}`);
      return null;
    } else if (isSocialUrl(ref)) {
      if (await ytDlpAvailable()) {
        logger.step(`Video ref: downloading from social media via yt-dlp...`);
        const ok = await downloadWithYtDlp(ref, videoPath);
        if (!ok) {
          logger.warn('Video ref: yt-dlp download failed. Try a direct .mp4 URL instead.');
          return null;
        }
      } else {
        logger.warn(
          `Video ref: social media URLs need yt-dlp. Install with: brew install yt-dlp\n` +
          `  Or download the video manually and place it as reference-video.mp4 in the project folder,\n` +
          `  or use a direct .mp4 URL.`,
        );
        return null;
      }
    } else {
      logger.step(`Video ref: downloading ${ref}...`);
      const ok = await downloadDirect(ref, videoPath);
      if (!ok) {
        logger.warn('Video ref: download failed.');
        return null;
      }
    }
  } else {
    // Local path — resolve relative to project dir
    const resolved = path.isAbsolute(ref) ? ref : path.join(projectDir, ref);
    if (!(await fs.pathExists(resolved))) {
      logger.warn(`Video ref: file not found — ${resolved}`);
      return null;
    }
    // Copy/symlink to standard name if it's not already there
    if (resolved !== videoPath && !(await fs.pathExists(videoPath))) {
      await fs.copy(resolved, videoPath);
    }
  }

  if (!(await fs.pathExists(videoPath))) return null;

  // ── Extract key frames ───────────────────────────────────────────────────
  if (dryRun) {
    logger.info(`Video ref: [dry-run] would extract ${FRAME_COUNT} key frames from reference video.`);
    return videoPath;
  }

  const frames = await extractKeyFrames(videoPath, projectDir);
  if (frames.length > 0) {
    logger.success(`Video ref: extracted ${frames.length} key frames (videoref-1.jpg … videoref-${frames.length}.jpg)`);
  } else {
    logger.warn('Video ref: no key frames could be extracted — video analysis will still run.');
  }

  return videoPath;
}
