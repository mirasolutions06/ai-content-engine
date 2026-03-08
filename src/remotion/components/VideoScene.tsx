import React from 'react';
import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { resolveSrc } from '../helpers/resolve-src.js';

interface VideoSceneProps {
  /** Absolute path to the Kling-generated .mp4 clip */
  clipPath: string;
  /** Volume 0-1. Default: 0 (voiceover is the primary audio track) */
  volume?: number;
  /** Enable subtle Ken Burns zoom. Default: true */
  kenBurns?: boolean;
  /** Scene index — used to alternate zoom direction for variety */
  sceneIndex?: number;
}

/**
 * Renders a single Kling-generated video clip using OffthreadVideo.
 * OffthreadVideo decodes in a separate thread for smoother rendering performance
 * compared to the standard <Video> component.
 *
 * When kenBurns is enabled, applies a subtle slow zoom (1.0 → 1.05 or 1.05 → 1.0)
 * that adds life to clips and normalizes motion across independently generated scenes.
 */
export const VideoScene: React.FC<VideoSceneProps> = ({
  clipPath,
  volume = 0,
  kenBurns = true,
  sceneIndex = 0,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Alternate between zoom-in and zoom-out per scene for variety
  const zoomIn = sceneIndex % 2 === 0;
  const startScale = zoomIn ? 1.0 : 1.05;
  const endScale = zoomIn ? 1.05 : 1.0;

  const scale = kenBurns
    ? interpolate(frame, [0, durationInFrames], [startScale, endScale], {
        extrapolateRight: 'clamp',
      })
    : 1;

  return (
    <AbsoluteFill>
      <OffthreadVideo
        src={resolveSrc(clipPath)}
        volume={volume}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale})`,
        }}
      />
    </AbsoluteFill>
  );
};
