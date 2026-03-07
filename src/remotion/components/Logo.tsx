import React from 'react';
import { Img, interpolate, useCurrentFrame, staticFile } from 'remotion';

interface LogoProps {
  /** Path to logo PNG (transparent background recommended) */
  logoPath: string;
  position?: 'top-left' | 'top-right';
  /** Maximum opacity after fade-in. Default: 0.85 */
  opacity?: number;
  /** Logo size in pixels. Default: 80 */
  sizePx?: number;
}

/**
 * Displays a client logo with a gentle fade-in over the first 20 frames (~0.67s at 30fps).
 * Positioned in a corner at subtle opacity for branding without distraction.
 */
export const Logo: React.FC<LogoProps> = ({
  logoPath,
  position = 'top-right',
  opacity = 0.85,
  sizePx = 80,
}) => {
  const frame = useCurrentFrame();

  // Fade in over first 20 frames
  const fadeIn = interpolate(frame, [0, 20], [0, opacity], {
    extrapolateRight: 'clamp',
  });

  const posStyle: React.CSSProperties =
    position === 'top-right'
      ? { top: 24, right: 24 }
      : { top: 24, left: 24 };

  return (
    <div style={{ position: 'absolute', ...posStyle, opacity: fadeIn, zIndex: 10 }}>
      <Img
        src={staticFile(logoPath)}
        style={{ width: sizePx, height: sizePx, objectFit: 'contain' }}
      />
    </div>
  );
};
