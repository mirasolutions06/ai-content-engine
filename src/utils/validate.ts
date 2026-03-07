import type { VideoConfig } from '../types/index.js';

/**
 * Validates that required environment variables are set.
 * Call this at pipeline start before any API calls.
 */
export function validateEnv(keys: string[]): void {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Add them to your .env file and restart.`,
    );
  }
}

/**
 * Validates a VideoConfig object for required fields and logical consistency.
 * Throws descriptive errors so the user knows exactly what to fix.
 */
export function validateConfig(config: VideoConfig): void {
  if (!config.format) {
    throw new Error(
      `config.json is missing "format". ` +
      `Valid values: youtube-short | tiktok | ad-16x9 | ad-1x1 | web-hero`,
    );
  }

  const VALID_FORMATS = ['youtube-short', 'tiktok', 'ad-16x9', 'ad-1x1', 'web-hero'] as const;
  if (!VALID_FORMATS.includes(config.format as typeof VALID_FORMATS[number])) {
    throw new Error(
      `config.json "format" value "${config.format}" is not valid. ` +
      `Valid values: ${VALID_FORMATS.join(' | ')}`,
    );
  }

  if (!config.title) {
    throw new Error(`config.json is missing "title".`);
  }

  // brand-images mode does not require clips
  const mode = config.mode ?? 'video';
  if (mode !== 'brand-images') {
    if (!Array.isArray(config.clips) || config.clips.length === 0) {
      throw new Error(
        `config.json "clips" array is empty. ` +
        `Add at least one clip with a "prompt" or "imageReference".`,
      );
    }

    for (let i = 0; i < config.clips.length; i++) {
      const clip = config.clips[i];
      if (!clip) throw new Error(`clips[${i}] is undefined`);
      if (!clip.prompt && !clip.imageReference && !clip.url) {
        throw new Error(
          `clips[${i}] has no "prompt", "imageReference", or "url". ` +
          `Each clip needs at least one of these.`,
        );
      }
    }
  }

  if (config.musicVolume !== undefined) {
    if (isNaN(config.musicVolume) || config.musicVolume < 0 || config.musicVolume > 1) {
      throw new Error(`config.json "musicVolume" must be a number between 0 and 1.`);
    }
  }
}
