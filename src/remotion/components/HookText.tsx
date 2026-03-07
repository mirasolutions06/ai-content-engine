import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';

interface HookTextProps {
  text: string;
  fontFamily?: string;
}

/**
 * Animated hook text with a punch-in entrance and fade-out exit.
 * Rendered inside a <Sequence> that defines the visible duration (typically 2s).
 *
 * Entrance (8 frames): scale 1.4→1.0 with back-easing overshoot, opacity 0→1
 * Exit (last 10 frames): opacity 1→0 with quad easing
 */
export const HookText: React.FC<HookTextProps> = ({
  text,
  fontFamily = 'sans-serif',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entranceDur = 8;
  const exitDur = 10;
  const totalFrames = fps * 2; // matches the 2-second Sequence

  // Punch-in scale: 1.4 → 1.0 with slight overshoot
  const scale = interpolate(frame, [0, entranceDur], [1.4, 1.0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.back(1.7)),
  });

  // Entrance fade
  const fadeIn = interpolate(frame, [0, entranceDur], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Exit fade
  const fadeOut = interpolate(
    frame,
    [totalFrames - exitDur, totalFrames],
    [1, 0],
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.quad),
    },
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 80,
        left: 0,
        right: 0,
        textAlign: 'center',
        color: 'white',
        fontSize: 52,
        fontWeight: 800,
        fontFamily,
        textShadow: '0 2px 12px rgba(0,0,0,0.8), 0 0 4px rgba(0,0,0,0.9)',
        padding: '0 40px',
        zIndex: 5,
        transform: `scale(${scale})`,
        opacity: Math.min(fadeIn, fadeOut),
      }}
    >
      {text}
    </div>
  );
};
