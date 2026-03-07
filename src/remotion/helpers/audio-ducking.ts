import type { CaptionWord } from '../../types/index.js';

interface Span {
  startFrame: number;
  endFrame: number;
}

/**
 * Creates a per-frame volume callback for the music track that ducks
 * when voiceover is speaking and returns to full level during silence.
 *
 * Uses Whisper word timestamps to detect speech regions.
 * Merges adjacent words with 2-frame padding to prevent rapid volume pumping.
 * Smooth 6-frame ramp between ducked/unducked levels.
 * Adds fade-in (15 frames) and fade-out (20 frames) on the music track.
 */
export function createMusicVolumeCallback(options: {
  captions: CaptionWord[];
  fps: number;
  baseVolume: number;
  totalFrames: number;
  duckRatio?: number;
  fadeInFrames?: number;
  fadeOutFrames?: number;
  rampFrames?: number;
}): (frame: number) => number {
  const {
    captions,
    fps,
    baseVolume,
    totalFrames,
    duckRatio = 0.3,
    fadeInFrames = 15,
    fadeOutFrames = 20,
    rampFrames = 6,
  } = options;

  const duckedVolume = baseVolume * duckRatio;

  // Build word spans with 2-frame padding, merge overlapping
  const PADDING = 2;
  const rawSpans: Span[] = captions.map((w) => ({
    startFrame: Math.max(0, Math.round(w.start * fps) - PADDING),
    endFrame: Math.round(w.end * fps) + PADDING,
  }));

  rawSpans.sort((a, b) => a.startFrame - b.startFrame);

  const spans: Span[] = [];
  for (const span of rawSpans) {
    const last = spans[spans.length - 1];
    if (last && span.startFrame <= last.endFrame) {
      last.endFrame = Math.max(last.endFrame, span.endFrame);
    } else {
      spans.push({ ...span });
    }
  }

  return (frame: number): number => {
    // Fade envelope (in/out)
    let envelope = 1.0;
    if (frame < fadeInFrames) {
      envelope = frame / fadeInFrames;
    }
    const framesFromEnd = totalFrames - frame;
    if (framesFromEnd < fadeOutFrames) {
      envelope = Math.min(envelope, framesFromEnd / fadeOutFrames);
    }

    // Check if we're in a speaking span
    const isSpeaking = spans.some(
      (s) => frame >= s.startFrame && frame <= s.endFrame,
    );

    if (isSpeaking) {
      return duckedVolume * envelope;
    }

    // Ramp: smooth transition near speech boundaries
    let distToNearest = rampFrames + 1;
    for (const s of spans) {
      if (frame < s.startFrame) {
        distToNearest = Math.min(distToNearest, s.startFrame - frame);
        break; // sorted, first future span is nearest
      }
      if (frame > s.endFrame) {
        distToNearest = Math.min(distToNearest, frame - s.endFrame);
      }
    }

    let vol = baseVolume;
    if (distToNearest <= rampFrames) {
      const t = distToNearest / rampFrames;
      vol = duckedVolume + (baseVolume - duckedVolume) * t;
    }

    return vol * envelope;
  };
}
