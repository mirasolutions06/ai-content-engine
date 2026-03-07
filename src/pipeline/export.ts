import path from 'path';
import fs from 'fs-extra';
import { logger } from '../utils/logger.js';

/**
 * Packages the final rendered video with a timestamped filename.
 * Copies from the temp render path to the project's output/final/ folder.
 * Returns the final output path with a timestamp to prevent overwrites.
 *
 * @param renderedVideoPath - Absolute path to the Remotion render output
 * @param projectsRoot - Root folder containing all projects
 * @param projectName - Name of current project
 * @param title - Video title (used in filename)
 * @param format - Video format (used in filename)
 * @returns Absolute path to the final packaged video
 */
export async function packageFinalVideo(
  renderedVideoPath: string,
  projectsRoot: string,
  projectName: string,
  title: string,
  format: string,
): Promise<string> {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
  const safeTitle = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').toLowerCase();
  const safeFormat = format.replace(/[^a-zA-Z0-9-]/g, '');
  const fileName = `${safeTitle}-${safeFormat}-${timestamp}.mp4`;
  const finalDir = path.join(projectsRoot, projectName, 'output/final');
  const finalPath = path.join(finalDir, fileName);

  await fs.ensureDir(finalDir);
  await fs.copy(renderedVideoPath, finalPath);

  const stats = await fs.stat(finalPath);
  const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

  logger.success(`
╔════════════════════════════════════════════════════╗
║              VIDEO DELIVERY COMPLETE               ║
╠════════════════════════════════════════════════════╣
║ File: ${fileName.padEnd(46)} ║
║ Size: ${(fileSizeMB + ' MB').padEnd(46)} ║
╚════════════════════════════════════════════════════╝`);

  logger.info(`Final video: ${finalPath}`);

  return finalPath;
}
