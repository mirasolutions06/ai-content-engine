import { staticFile } from 'remotion';

/**
 * Resolves a file path to a src URL for Remotion components.
 * All paths should be relative to publicDir by the time they reach Remotion.
 */
export function resolveSrc(filePath: string): string {
  return staticFile(filePath);
}
