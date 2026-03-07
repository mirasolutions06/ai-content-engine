import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { CTAConfig, BrandColors } from '../../types/index.js';

interface OutroProps {
  cta: CTAConfig;
  colors?: BrandColors;
  /** Frame within the enclosing Sequence at which to start fading in */
  startFrame?: number;
}

/**
 * Full-overlay CTA end screen that fades in over the last few seconds of the video.
 * Designed to be rendered inside a <Sequence> starting at ctaStartFrame.
 */
export const Outro: React.FC<OutroProps> = ({ cta, colors, startFrame = 0 }) => {
  const frame = useCurrentFrame();
  const primary = colors?.primary ?? '#FFFFFF';
  const bg = colors?.secondary ?? '#000000';

  // Fade in over 15 frames (~0.5s) from startFrame
  const opacity = interpolate(frame, [startFrame, startFrame + 15], [0, 0.92], {
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: bg,
        opacity,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 20,
      }}
    >
      <div
        style={{
          color: primary,
          fontSize: 52,
          fontWeight: 800,
          fontFamily: 'sans-serif',
          textAlign: 'center',
          padding: '0 40px',
        }}
      >
        {cta.text}
      </div>
      {cta.subtext !== undefined && (
        <div
          style={{
            color: primary,
            fontSize: 28,
            opacity: 0.75,
            fontFamily: 'sans-serif',
            marginTop: 16,
            textAlign: 'center',
            padding: '0 40px',
          }}
        >
          {cta.subtext}
        </div>
      )}
    </div>
  );
};
