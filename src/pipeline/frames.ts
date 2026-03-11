import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Extracts the very last frame of a video clip as a high-quality PNG.
 * This image is shown to Gemini to generate the next scene with visual continuity.
 *
 * Uses ffmpeg's "-sseof -0.1" to seek 0.1s before the end and capture one frame,
 * which is far more efficient than decoding the entire video.
 *
 * @param clipPath - Absolute path to the .mp4 clip
 * @param sceneIndex - 1-based scene number (determines output filename)
 * @param projectsRoot - Root folder containing all projects
 * @param projectName - Name of current project
 * @returns Absolute path to the saved last-frame PNG
 */
export async function extractLastFrame(
  clipPath: string,
  sceneIndex: number,
  projectsRoot: string,
  projectName: string,
): Promise<string> {
  const outputPath = path.join(
    projectsRoot,
    projectName,
    'storyboard',
    `scene-${sceneIndex}-lastframe.png`,
  );

  await fs.ensureDir(path.dirname(outputPath));

  // -sseof -0.1: seek to 0.1s before end of file (efficient — no full decode)
  // -vframes 1: capture exactly one frame
  // -q:v 1: highest quality for the output encoder
  // -y: overwrite output file if it exists
  await execFileAsync('ffmpeg', [
    '-sseof', '-0.1',
    '-i', clipPath,
    '-vframes', '1',
    '-q:v', '1',
    '-y',
    outputPath,
  ]);

  logger.success(
    `Last frame saved to storyboard/scene-${sceneIndex}-lastframe.png` +
    ` — open in Antigravity for scene ${sceneIndex + 1} prompt`,
  );

  return outputPath;
}

/**
 * Gets the duration of a video file in seconds using ffprobe.
 * Used to calculate total composition duration before Remotion rendering.
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    videoPath,
  ]);

  const data = JSON.parse(stdout) as { format: { duration: string } };
  return parseFloat(data.format.duration);
}
