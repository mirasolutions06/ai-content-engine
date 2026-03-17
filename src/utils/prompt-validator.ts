import { logger } from './logger.js';
import type { VideoConfig } from '../types/index.js';

export interface ValidationWarning {
  sceneIndex: number;
  field: string;
  message: string;
}

const TEXT_PATTERNS = /\b(text|logo|typography|font|write|writing|saying|reads|letter|word|headline)\b/i;

const STYLE_KEYWORDS = /\b(lighting|light|shadow|cinematic|mood|tone|color|colour|warm|cool|dark|bright|soft|dramatic|golden|neon|pastel|muted|vibrant|editorial|minimal|luxury|gritty|bokeh|ambient|backlit|silhouette)\b/i;

const LENS_KEYWORDS = /\b(\d+mm|macro|wide|telephoto|overhead|flat lay|low angle|eye level)\b/i;

const LIGHTING_DIRECTION = /\b(camera-left|camera-right|from above|from below|backlight|rim light|key light|window light|side light|overhead light|directional|from the left|from the right)\b/i;

/** Validate a single scene prompt for common issues. */
export function validateScenePrompt(prompt: string, sceneIndex: number): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  if (prompt.length < 200) {
    warnings.push({
      sceneIndex,
      field: 'prompt',
      message: `Scene ${sceneIndex} prompt is short (${prompt.length} chars). Aim for 200-600 chars with lens, lighting, and material detail.`,
    });
  }

  if (prompt.length > 700) {
    warnings.push({
      sceneIndex,
      field: 'prompt',
      message: `Scene ${sceneIndex} prompt exceeds 700 chars (${prompt.length}). May get truncated.`,
    });
  }

  if (TEXT_PATTERNS.test(prompt)) {
    warnings.push({
      sceneIndex,
      field: 'prompt',
      message: `Scene ${sceneIndex} prompt mentions text/logo/typography. AI video cannot render readable text.`,
    });
  }

  if (!STYLE_KEYWORDS.test(prompt)) {
    warnings.push({
      sceneIndex,
      field: 'prompt',
      message: `Scene ${sceneIndex} prompt has no visual style cues (lighting, color, mood). Add style direction for better results.`,
    });
  }

  if (!LENS_KEYWORDS.test(prompt)) {
    warnings.push({
      sceneIndex,
      field: 'prompt',
      message: `Scene ${sceneIndex} prompt has no camera language (lens, focal length, shot distance). Add "85mm f/1.4", "35mm wide", "macro", etc.`,
    });
  }

  if (!LIGHTING_DIRECTION.test(prompt)) {
    warnings.push({
      sceneIndex,
      field: 'prompt',
      message: `Scene ${sceneIndex} prompt has no lighting direction. Add "from camera-left", "backlight", "rim light", "window light from above", etc.`,
    });
  }

  return warnings;
}

/** Validate script length against format time limits. */
export function validateScriptLength(script: string, format: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const wordCount = script.trim().split(/\s+/).length;

  // ~2.5 words per second spoken pace
  if ((format === 'youtube-short' || format === 'tiktok') && wordCount > 150) {
    warnings.push({
      sceneIndex: 0,
      field: 'script',
      message: `Script has ${wordCount} words — likely too long for ${format} (aim for ≤150 words / ~60s).`,
    });
  }

  if ((format === 'ad-16x9' || format === 'ad-1x1') && wordCount > 75) {
    warnings.push({
      sceneIndex: 0,
      field: 'script',
      message: `Script has ${wordCount} words — likely too long for ${format} ads (aim for ≤75 words / ~30s).`,
    });
  }

  return warnings;
}

/** Validate full config and return all warnings. */
export function validatePrompts(config: VideoConfig): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Validate each clip prompt
  for (let i = 0; i < config.clips.length; i++) {
    const clip = config.clips[i];
    if (clip?.prompt) {
      warnings.push(...validateScenePrompt(clip.prompt, i + 1));
    }
  }

  // Validate script length
  if (config.script && config.format) {
    warnings.push(...validateScriptLength(config.script, config.format));
  }

  // Clip count cost warning
  const clipCount = config.clips.length;
  const avgCostPerClip = 1.05; // gemini-frame ($0.05) + kling-5s ($1.00)
  if (clipCount * avgCostPerClip > 5) {
    warnings.push({
      sceneIndex: 0,
      field: 'clips',
      message: `${clipCount} clips will cost ~$${(clipCount * avgCostPerClip).toFixed(2)} for storyboard + Kling. Consider fewer clips or shorter durations.`,
    });
  }

  // Log all warnings
  for (const w of warnings) {
    logger.warn(w.message);
  }

  return warnings;
}
