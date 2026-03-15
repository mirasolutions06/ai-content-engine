/**
 * Central registry for all AI model identifiers.
 *
 * When Google/Anthropic deprecate a model ID, update it here — not in 10 scattered files.
 * Each entry has a primary model and an optional fallback.
 */

export interface ModelEntry {
  id: string;
  fallback?: string;
}

const MODELS = {
  // ── Image generation ───────────────────────────────────────────────────────
  'gemini-image': {
    id: 'gemini-3-pro-image-preview',
    fallback: 'gemini-2.0-flash-preview-image-generation',
  },

  // ── Video generation ───────────────────────────────────────────────────────
  'veo-3.1': {
    id: 'veo-3.1-generate-preview',
  },
  'veo-3.1-fast': {
    id: 'veo-3.1-fast-generate-preview',
  },

  // ── Kling (fal.ai endpoints, not model IDs) ────────────────────────────────
  'kling-v2.1-i2v': {
    id: 'fal-ai/kling-video/v2.1/pro/image-to-video',
  },
  'kling-v2.1-t2v': {
    id: 'fal-ai/kling-video/v2.1/master/text-to-video',
  },
  'kling-v3-i2v': {
    id: 'fal-ai/kling-video/v3/pro/image-to-video',
  },
  'kling-v3-t2v': {
    id: 'fal-ai/kling-video/v3/pro/text-to-video',
  },

  // ── Text / reasoning ───────────────────────────────────────────────────────
  'claude-sonnet': {
    id: 'claude-sonnet-4-6-20250514',
  },
  'claude-haiku': {
    id: 'claude-haiku-4-5-20251001',
  },
  'claude-opus': {
    id: 'claude-opus-4-6-20250610',
  },

  // ── Speech ─────────────────────────────────────────────────────────────────
  'elevenlabs-tts': {
    id: 'eleven_multilingual_v2',
  },

  // ── Transcription ──────────────────────────────────────────────────────────
  'whisper': {
    id: 'whisper-1',
  },
} as const satisfies Record<string, ModelEntry>;

export type ModelKey = keyof typeof MODELS;

/**
 * Get a model ID by key. Returns the primary ID.
 *
 * @example
 * ```ts
 * import { getModel } from '../utils/model-registry.js';
 * const modelId = getModel('gemini-image'); // 'gemini-3-pro-image-preview'
 * ```
 */
export function getModel(key: ModelKey): string {
  return MODELS[key].id;
}

/**
 * Get fallback model ID, if one exists.
 */
export function getModelFallback(key: ModelKey): string | undefined {
  return 'fallback' in MODELS[key] ? (MODELS[key] as { fallback: string }).fallback : undefined;
}

/**
 * Get the full model entry (id + fallback).
 */
export function getModelEntry(key: ModelKey): ModelEntry {
  return MODELS[key];
}
