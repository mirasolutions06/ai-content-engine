import path from 'path';
import fs from 'fs-extra';
import crypto from 'crypto';
import { logger } from './logger.js';
import type { VideoConfig, VideoClip } from '../types/index.js';

export interface ClipDiff {
  index: number;
  changed: boolean;
  reasons: string[];
}

export interface ConfigDiffResult {
  isFirstRun: boolean;
  changedClips: number[];
  unchangedClips: number[];
  diffs: ClipDiff[];
}

function hashClip(clip: VideoClip): string {
  const key = JSON.stringify({
    prompt: clip.prompt,
    shotType: clip.shotType,
    imageReference: clip.imageReference,
    duration: clip.duration,
    outputType: clip.outputType,
    imageProvider: clip.imageProvider,
    imageFormat: clip.imageFormat,
    imageSource: clip.imageSource,
    editPrompt: clip.editPrompt,
    sourceImage: clip.sourceImage,
  });
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * Compares current config against the last-run snapshot.
 * Returns which clips changed, which are unchanged (can use cache).
 */
export async function diffConfig(
  config: VideoConfig,
  projectsRoot: string,
  projectName: string,
): Promise<ConfigDiffResult> {
  const cachePath = path.join(projectsRoot, projectName, 'cache', 'last-config.json');

  if (!(await fs.pathExists(cachePath))) {
    return { isFirstRun: true, changedClips: [], unchangedClips: [], diffs: [] };
  }

  let oldConfig: VideoConfig;
  try {
    oldConfig = (await fs.readJson(cachePath)) as VideoConfig;
  } catch {
    return { isFirstRun: true, changedClips: [], unchangedClips: [], diffs: [] };
  }

  const diffs: ClipDiff[] = [];
  const changedClips: number[] = [];
  const unchangedClips: number[] = [];

  const maxClips = Math.max(config.clips.length, oldConfig.clips.length);

  for (let i = 0; i < maxClips; i++) {
    const newClip = config.clips[i];
    const oldClip = oldConfig.clips[i];
    const clipNum = i + 1;

    if (!newClip) {
      diffs.push({ index: clipNum, changed: true, reasons: ['removed'] });
      changedClips.push(clipNum);
      continue;
    }
    if (!oldClip) {
      diffs.push({ index: clipNum, changed: true, reasons: ['new clip'] });
      changedClips.push(clipNum);
      continue;
    }

    const reasons: string[] = [];
    if (hashClip(newClip) !== hashClip(oldClip)) {
      if (newClip.prompt !== oldClip.prompt) reasons.push('prompt');
      if (newClip.duration !== oldClip.duration) reasons.push('duration');
      if (newClip.imageProvider !== oldClip.imageProvider) reasons.push('provider');
      if (newClip.outputType !== oldClip.outputType) reasons.push('output type');
      if (newClip.imageSource !== oldClip.imageSource) reasons.push('image source');
      if (newClip.editPrompt !== oldClip.editPrompt) reasons.push('edit prompt');
      if (reasons.length === 0) reasons.push('config');
    }

    if (reasons.length > 0) {
      diffs.push({ index: clipNum, changed: true, reasons });
      changedClips.push(clipNum);
    } else {
      diffs.push({ index: clipNum, changed: false, reasons: [] });
      unchangedClips.push(clipNum);
    }
  }

  // Log global config changes
  const globalChanges: string[] = [];
  if (config.videoProvider !== oldConfig.videoProvider) globalChanges.push('videoProvider');
  if (config.imageProvider !== oldConfig.imageProvider) globalChanges.push('imageProvider');
  if (config.brief !== oldConfig.brief) globalChanges.push('brief');
  if (globalChanges.length > 0) {
    logger.info(`Global config changed: ${globalChanges.join(', ')}`);
  }

  return { isFirstRun: false, changedClips, unchangedClips, diffs };
}

/** Save current config as snapshot for future diff comparison. */
export async function saveConfigSnapshot(
  config: VideoConfig,
  projectsRoot: string,
  projectName: string,
): Promise<void> {
  const cachePath = path.join(projectsRoot, projectName, 'cache', 'last-config.json');
  await fs.ensureDir(path.dirname(cachePath));
  await fs.outputJson(cachePath, config, { spaces: 2 });
}
