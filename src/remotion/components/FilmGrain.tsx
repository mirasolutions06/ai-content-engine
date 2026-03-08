import React, { useMemo } from 'react';
import { useCurrentFrame } from 'remotion';

/**
 * CSS-based animated film grain overlay.
 * Uses a large random SVG noise pattern that shifts position each frame,
 * creating the look of consistent film stock across all clips.
 */
export const FilmGrain: React.FC<{ opacity?: number }> = ({ opacity = 0.06 }) => {
  const frame = useCurrentFrame();

  // Shift the noise pattern position each frame for animation
  const offsetX = useMemo(() => (frame * 17) % 200 - 100, [frame]);
  const offsetY = useMemo(() => (frame * 23) % 200 - 100, [frame]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        opacity,
        mixBlendMode: 'overlay',
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        backgroundSize: '256px 256px',
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      }}
    />
  );
};
