import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { BrandColors } from '../../types/index.js';

interface LowerThirdProps {
  title: string;
  subtitle?: string;
  colors?: BrandColors;
  fontFamily?: string;
  /** Frame at which the lower third starts appearing. Default: 30 */
  startFrame?: number;
  /** Frame at which the lower third finishes disappearing. Default: 120 */
  endFrame?: number;
}

/**
 * Animated lower-third graphic that slides up from below the frame.
 * Used in Ad compositions to display client/product name and tagline.
 * Fades and slides in at startFrame, fades and slides out at endFrame.
 */
export const LowerThird: React.FC<LowerThirdProps> = ({
  title,
  subtitle,
  colors,
  fontFamily = 'sans-serif',
  startFrame = 30,
  endFrame = 120,
}) => {
  const frame = useCurrentFrame();
  const primary = colors?.primary ?? '#FFFFFF';
  const secondary = colors?.secondary ?? '#000000';

  // Slide up from 40px below while fading in, then reverse on exit
  const translateY = interpolate(
    frame,
    [startFrame, startFrame + 20, endFrame - 20, endFrame],
    [40, 0, 0, 40],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const opacity = interpolate(
    frame,
    [startFrame, startFrame + 20, endFrame - 20, endFrame],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 80,
        left: 0,
        right: 0,
        padding: '16px 32px',
        backgroundColor: secondary,
        borderLeft: `6px solid ${primary}`,
        transform: `translateY(${translateY}px)`,
        opacity,
        zIndex: 10,
      }}
    >
      <div
        style={{
          color: primary,
          fontSize: 32,
          fontWeight: 700,
          fontFamily,
        }}
      >
        {title}
      </div>
      {subtitle !== undefined && (
        <div
          style={{
            color: primary,
            fontSize: 20,
            opacity: 0.8,
            fontFamily,
            marginTop: 4,
          }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
};
