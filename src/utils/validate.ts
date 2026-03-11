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
  const mode = config.mode ?? 'video';

  // format is required for video/full modes but not brand-images
  if (mode !== 'brand-images') {
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
  }

  if (!config.title) {
    throw new Error(`config.json is missing "title".`);
  }

  // brand-images mode does not require clips
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

  if (config.videoProvider !== undefined) {
    const VALID_PROVIDERS = ['kling-v2.1', 'kling-v3', 'veo-3.1', 'veo-3.1-fast'] as const;
    if (!VALID_PROVIDERS.includes(config.videoProvider as typeof VALID_PROVIDERS[number])) {
      throw new Error(
        `config.json "videoProvider" value "${config.videoProvider}" is not valid. ` +
        `Valid values: ${VALID_PROVIDERS.join(' | ')}`,
      );
    }
  }

  if (config.imageProvider !== undefined) {
    const VALID_IMAGE_PROVIDERS = ['gemini', 'gpt-image'] as const;
    if (!VALID_IMAGE_PROVIDERS.includes(config.imageProvider as typeof VALID_IMAGE_PROVIDERS[number])) {
      throw new Error(
        `config.json "imageProvider" value "${config.imageProvider}" is not valid. ` +
        `Valid values: ${VALID_IMAGE_PROVIDERS.join(' | ')}`,
      );
    }
  }

  if (Array.isArray(config.clips)) {
    for (let i = 0; i < config.clips.length; i++) {
      const clip = config.clips[i];
      if (!clip) continue;

      if (clip.outputType !== undefined) {
        const VALID_OUTPUT_TYPES = ['image', 'video', 'animation'] as const;
        if (!VALID_OUTPUT_TYPES.includes(clip.outputType as typeof VALID_OUTPUT_TYPES[number])) {
          throw new Error(
            `clips[${i}].outputType "${clip.outputType}" is not valid. ` +
            `Valid values: ${VALID_OUTPUT_TYPES.join(' | ')}`,
          );
        }
      }

      if (clip.duration !== undefined) {
        if (typeof clip.duration !== 'number' || clip.duration < 1 || clip.duration > 15) {
          throw new Error(
            `clips[${i}].duration must be a number between 1 and 15 seconds. Got: ${clip.duration}`,
          );
        }
      }
    }
  }
}
