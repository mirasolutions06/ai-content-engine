import crypto from 'crypto';
import path from 'path';
import fs from 'fs-extra';
import type { ClipCacheManifest, ClipCacheEntry } from '../types/index.js';

/**
 * Generates a deterministic SHA-256 hash from a prompt + options object.
 * Used to identify whether a clip has already been generated.
 */
export function hashVideoRequest(
  prompt: string,
  options: Record<string, unknown>,
): string {
  const payload = JSON.stringify({ ...options, prompt });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

/**
 * Returns the path to the clip cache manifest for a given project.
 */
export function getCacheManifestPath(projectsRoot: string, projectName: string): string {
  return path.join(projectsRoot, projectName, 'cache', 'fal-cache.json');
}

/**
 * Loads the clip cache manifest for a project. Returns empty object if none exists.
 */
export async function loadCacheManifest(manifestPath: string): Promise<ClipCacheManifest> {
  if (!(await fs.pathExists(manifestPath))) return {};
  try {
    return await fs.readJson(manifestPath) as ClipCacheManifest;
  } catch {
    throw new Error(
      `Failed to parse cache manifest at ${manifestPath}. ` +
      `The file may be corrupt. Delete it to reset the cache.`,
    );
  }
}

/**
 * Saves an entry to the clip cache manifest.
 */
export async function saveCacheEntry(
  manifestPath: string,
  hash: string,
  clipPath: string,
): Promise<void> {
  const manifest = await loadCacheManifest(manifestPath);
  const entry: ClipCacheEntry = {
    hash,
    clipPath,
    createdAt: new Date().toISOString(),
  };
  manifest[hash] = entry;
  await fs.outputJson(manifestPath, manifest, { spaces: 2 });
}
