import React from 'react';

/**
 * Radial vignette overlay — darkens edges to draw the eye toward center
 * and visually unify clips with different edge lighting.
 */
export const Vignette: React.FC<{ intensity?: number }> = ({ intensity = 0.45 }) => {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9,
        background: `radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${intensity}) 100%)`,
      }}
    />
  );
};
