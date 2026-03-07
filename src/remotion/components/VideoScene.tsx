import React from 'react';
import { OffthreadVideo } from 'remotion';
import { resolveSrc } from '../helpers/resolve-src.js';

interface VideoSceneProps {
  /** Absolute path to the Kling-generated .mp4 clip */
  clipPath: string;
  /** Volume 0-1. Default: 0 (voiceover is the primary audio track) */
  volume?: number;
}

/**
 * Renders a single Kling-generated video clip using OffthreadVideo.
 * OffthreadVideo decodes in a separate thread for smoother rendering performance
 * compared to the standard <Video> component.
 */
export const VideoScene: React.FC<VideoSceneProps> = ({ clipPath, volume = 0 }) => {
  return (
    <OffthreadVideo
      src={resolveSrc(clipPath)}
      volume={volume}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
};
