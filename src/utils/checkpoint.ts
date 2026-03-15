import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import { logger } from './logger.js';
import type { VideoConfig, CaptionWord } from '../types/index.js';

export interface PipelineCheckpoint {
  configHash: string;
  phase: 'init' | 'storyboard' | 'video' | 'complete';
  timestamp: string;
  /** Scene indexes that completed storyboard generation */
  completedFrames: Record<number, string>;
  /** Scene indexes that completed video generation */
  completedClips: Record<number, string>;
  voiceoverPath?: string;
  captions?: CaptionWord[];
}

function checkpointPath(projectsRoot: string, projectName: string): string {
  return path.join(projectsRoot, projectName, 'cache', 'checkpoint.json');
}

/** Hash config to detect changes between runs. */
export function hashConfig(config: VideoConfig): string {
  const key = JSON.stringify({
    clips: config.clips,
    format: config.format,
    mode: config.mode,
    videoProvider: config.videoProvider,
    imageProvider: config.imageProvider,
    script: config.script,
    voiceId: config.voiceId,
  });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Save a checkpoint after completing a pipeline phase. */
export async function saveCheckpoint(
  checkpoint: PipelineCheckpoint,
  projectsRoot: string,
  projectName: string,
): Promise<void> {
  const p = checkpointPath(projectsRoot, projectName);
  await fs.ensureDir(path.dirname(p));
  await fs.outputJson(p, checkpoint, { spaces: 2 });
}

/**
 * Load a checkpoint if it exists and config hash matches.
 * Returns null if no valid checkpoint (first run or config changed).
 */
export async function loadCheckpoint(
  config: VideoConfig,
  projectsRoot: string,
  projectName: string,
): Promise<PipelineCheckpoint | null> {
  const p = checkpointPath(projectsRoot, projectName);
  if (!(await fs.pathExists(p))) return null;

  try {
    const checkpoint = (await fs.readJson(p)) as PipelineCheckpoint;
    const currentHash = hashConfig(config);

    if (checkpoint.configHash !== currentHash) {
      logger.info('Checkpoint exists but config changed — starting fresh.');
      await clearCheckpoint(projectsRoot, projectName);
      return null;
    }

    // Verify that referenced files still exist
    for (const [, framePath] of Object.entries(checkpoint.completedFrames)) {
      if (!(await fs.pathExists(framePath))) {
        logger.info('Checkpoint references missing files — starting fresh.');
        await clearCheckpoint(projectsRoot, projectName);
        return null;
      }
    }

    logger.info(`Resuming from checkpoint: phase=${checkpoint.phase}, ${Object.keys(checkpoint.completedFrames).length} frames, ${Object.keys(checkpoint.completedClips).length} clips.`);
    return checkpoint;
  } catch {
    return null;
  }
}

/** Remove checkpoint after successful completion. */
export async function clearCheckpoint(
  projectsRoot: string,
  projectName: string,
): Promise<void> {
  const p = checkpointPath(projectsRoot, projectName);
  if (await fs.pathExists(p)) {
    await fs.remove(p);
  }
}

/** Create a fresh checkpoint for a new run. */
export function createCheckpoint(config: VideoConfig): PipelineCheckpoint {
  return {
    configHash: hashConfig(config),
    phase: 'init',
    timestamp: new Date().toISOString(),
    completedFrames: {},
    completedClips: {},
  };
}
