import type { VideoFormat, FormatMeta } from '../../types/index.js';

/**
 * Returns canonical width/height/fps/aspectRatio for each video format.
 * Single source of truth used by all compositions and the pipeline orchestrator.
 */
export function getFormatMeta(format: VideoFormat): FormatMeta {
  const map: Record<VideoFormat, FormatMeta> = {
    'youtube-short': { width: 1080, height: 1920, fps: 30, aspectRatio: '9:16', defaultCaptions: true },
    'tiktok':        { width: 1080, height: 1920, fps: 30, aspectRatio: '9:16', defaultCaptions: true },
    'ad-16x9':       { width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', defaultCaptions: false },
    'ad-1x1':        { width: 1080, height: 1080, fps: 30, aspectRatio: '1:1',  defaultCaptions: false },
    'web-hero':      { width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', defaultCaptions: false },
  };
  return map[format];
}

/**
 * Converts seconds to Remotion frames given a frame rate.
 * All timing calculations in compositions should use this instead of magic numbers.
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * Converts Remotion frames to seconds.
 */
export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}
