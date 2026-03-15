import path from 'path';
import fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger.js';
import type { ImageOverlay } from '../types/index.js';

const execAsync = promisify(exec);

/**
 * Composites a text overlay on an image using ffmpeg drawtext filter.
 * No additional dependencies — ffmpeg is installed with Remotion.
 *
 * Always runs (not cached) since it's a fast local operation.
 * Writes to outputPath, which can be the same as imagePath (in-place).
 */
export async function compositeOverlay(
  imagePath: string,
  overlay: ImageOverlay,
  outputPath: string,
  fontPath?: string,
): Promise<string> {
  if (!(await fs.pathExists(imagePath))) {
    throw new Error(`Source image not found for overlay: ${imagePath}`);
  }

  // Escape special characters for ffmpeg drawtext
  const text = overlay.text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%');

  const fontSize = overlay.fontSize ?? 48;
  const color = overlay.color ?? 'white';
  const bgColor = overlay.background ?? 'black@0.6';

  // Y position based on overlay.position
  let yExpr: string;
  switch (overlay.position) {
    case 'top':
      yExpr = String(fontSize);
      break;
    case 'center':
      yExpr = '(h-text_h)/2';
      break;
    case 'bottom':
    default:
      yExpr = `h-text_h-${fontSize}`;
      break;
  }

  // Build drawtext filter components
  const filterParts = [
    `drawtext=text='${text}'`,
    `fontsize=${fontSize}`,
    `fontcolor=${color}`,
    `x=(w-text_w)/2`,
    `y=${yExpr}`,
    `box=1`,
    `boxcolor=${bgColor}`,
    `boxborderw=16`,
  ];

  if (fontPath && (await fs.pathExists(fontPath))) {
    filterParts.splice(1, 0, `fontfile='${fontPath}'`);
  }

  const filter = filterParts.join(':');

  // If in-place edit, use a temp file
  const inPlace = path.resolve(imagePath) === path.resolve(outputPath);
  const tempPath = inPlace
    ? outputPath.replace(/(\.\w+)$/, '-overlay-tmp$1')
    : outputPath;

  await fs.ensureDir(path.dirname(tempPath));

  const cmd = `ffmpeg -y -i "${imagePath}" -vf "${filter}" "${tempPath}" 2>/dev/null`;

  try {
    await execAsync(cmd, { timeout: 30_000 });
  } catch (err) {
    logger.warn(`ffmpeg overlay failed: ${String(err)}. Returning original image.`);
    return imagePath;
  }

  if (inPlace) {
    await fs.move(tempPath, outputPath, { overwrite: true });
  }

  logger.success(`Overlay applied: ${path.basename(outputPath)}`);
  return outputPath;
}
