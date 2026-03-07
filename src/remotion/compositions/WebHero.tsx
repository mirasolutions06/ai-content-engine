import React from 'react';
import { AbsoluteFill, useVideoConfig } from 'remotion';
import { TransitionSeries } from '@remotion/transitions';
import { resolveTransition } from '../helpers/transitions.js';
import { VideoScene } from '../components/VideoScene.js';
import { secondsToFrames } from '../helpers/timing.js';
import type { CompositionProps } from '../../types/index.js';

export const WebHero: React.FC<CompositionProps> = ({
  config,
  assets,
  clipPaths,
}) => {
  const { fps } = useVideoConfig();

  const transition = resolveTransition(config.transition);

  // Color overlay uses brand primary color at low opacity for text readability
  const overlayColor = assets.brandColors?.primary ?? null;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Video clips — no audio, no captions for ambient web hero */}
      <TransitionSeries>
        {clipPaths.map((clipPath, i) => {
          const clip = config.clips[i];
          const clipDuration = secondsToFrames(clip?.duration ?? 5, fps);
          const isLastClip = i === clipPaths.length - 1;

          return (
            <React.Fragment key={clipPath}>
              <TransitionSeries.Sequence durationInFrames={clipDuration}>
                <VideoScene clipPath={clipPath} volume={0} />
              </TransitionSeries.Sequence>
              {!isLastClip && transition !== null && (
                <TransitionSeries.Transition
                  timing={transition.timing}
                  presentation={transition.presentation}
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>

      {/* Optional semi-transparent brand color overlay for text readability */}
      {overlayColor !== null && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: overlayColor,
            opacity: 0.35,
            pointerEvents: 'none',
          }}
        />
      )}
    </AbsoluteFill>
  );
};
