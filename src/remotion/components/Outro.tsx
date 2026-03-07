import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, Easing, spring } from 'remotion';
import type { CTAConfig, BrandColors } from '../../types/index.js';

interface OutroProps {
  cta: CTAConfig;
  colors?: BrandColors | undefined;
  fontFamily?: string;
  /** Frame within the enclosing Sequence at which to start fading in */
  startFrame?: number;
}

/**
 * Full-overlay CTA end screen with animated text reveal.
 *
 * Background fades in, then CTA text slides up with a staggered subtext reveal.
 * A subtle scale pulse draws attention to the main CTA after it settles.
 */
export const Outro: React.FC<OutroProps> = ({ cta, colors, fontFamily = 'sans-serif', startFrame = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const primary = colors?.primary ?? '#FFFFFF';
  const bg = colors?.secondary ?? '#000000';

  // Background fade-in: 15 frames (~0.5s)
  const bgOpacity = interpolate(frame, [startFrame, startFrame + 15], [0, 0.92], {
    extrapolateRight: 'clamp',
  });

  // Main CTA text: slide up from 60px, starting 5 frames after bg
  const textDelay = startFrame + 5;
  const textSlideY = interpolate(frame, [textDelay, textDelay + 18], [60, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const textOpacity = interpolate(frame, [textDelay, textDelay + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Subtle scale pulse after slide settles
  const pulseStart = textDelay + 18;
  const pulseProgress = spring({
    frame: Math.max(0, frame - pulseStart),
    fps,
    config: { damping: 8, stiffness: 150, mass: 0.5 },
    durationInFrames: 20,
  });
  const ctaScale = frame >= pulseStart
    ? 1.0 + 0.05 * Math.sin(pulseProgress * Math.PI)
    : 1.0;

  // Subtext: slide up, staggered 12 frames after main text
  const subtextDelay = textDelay + 12;
  const subtextSlideY = interpolate(frame, [subtextDelay, subtextDelay + 18], [40, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
  const subtextOpacity = interpolate(frame, [subtextDelay, subtextDelay + 12], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backgroundColor: bg,
        opacity: bgOpacity,
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
          fontFamily,
          textAlign: 'center',
          padding: '0 40px',
          transform: `translateY(${textSlideY}px) scale(${ctaScale})`,
          opacity: textOpacity,
        }}
      >
        {cta.text}
      </div>
      {cta.subtext !== undefined && (
        <div
          style={{
            color: primary,
            fontSize: 28,
            opacity: subtextOpacity * 0.75,
            fontFamily,
            marginTop: 16,
            textAlign: 'center',
            padding: '0 40px',
            transform: `translateY(${subtextSlideY}px)`,
          }}
        >
          {cta.subtext}
        </div>
      )}
    </div>
  );
};
