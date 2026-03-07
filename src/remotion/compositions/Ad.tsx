import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  staticFile,
  useVideoConfig,
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { VideoScene } from '../components/VideoScene.js';
import { CaptionTrack } from '../components/CaptionTrack.js';
import { Logo } from '../components/Logo.js';
import { LowerThird } from '../components/LowerThird.js';
import { Outro } from '../components/Outro.js';
import { secondsToFrames } from '../helpers/timing.js';
import type { CompositionProps } from '../../types/index.js';

export const Ad: React.FC<CompositionProps> = ({
  config,
  assets,
  captions,
  clipPaths,
  voiceoverPath,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  const showCaptions = config.captions ?? false;
  const musicVolume = config.musicVolume ?? 0.15;
  const ctaDurationFrames = secondsToFrames(config.cta?.durationSeconds ?? 3, fps);
  const ctaStartFrame = durationInFrames - ctaDurationFrames;

  // Total clip duration in frames (for lower third timing)
  const mainContentFrames = durationInFrames - ctaDurationFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Video clips */}
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
              {!isLastClip && config.transition !== 'cut' && (
                <TransitionSeries.Transition
                  timing={linearTiming({ durationInFrames: 15 })}
                  presentation={fade()}
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>

      {/* Voiceover — primary audio track at full volume */}
      {voiceoverPath !== undefined && (
        <Audio src={staticFile(voiceoverPath)} volume={1} />
      )}

      {/* Background music */}
      {config.music === true && assets.backgroundMusic !== undefined && (
        <Audio src={staticFile(assets.backgroundMusic)} volume={musicVolume} />
      )}

      {/* Lower third — shows client name and optional tagline */}
      {config.client !== undefined && (
        <LowerThird
          title={config.client}
          subtitle={config.title}
          {...(assets.brandColors !== undefined ? { colors: assets.brandColors } : {})}
          startFrame={secondsToFrames(1, fps)}
          endFrame={mainContentFrames - secondsToFrames(1, fps)}
        />
      )}

      {/* Optional captions */}
      {showCaptions && captions.length > 0 && (
        <CaptionTrack
          words={captions}
          style={config.captionStyle ?? 'word-by-word'}
          position={config.captionPosition ?? 'bottom'}
        />
      )}

      {/* Logo — top-left for horizontal formats */}
      {assets.logo !== undefined && (
        <Logo logoPath={assets.logo} position="top-left" />
      )}

      {/* CTA outro */}
      {config.cta !== undefined && (
        <Sequence from={ctaStartFrame} durationInFrames={ctaDurationFrames}>
          <Outro
            cta={config.cta}
            {...(assets.brandColors !== undefined ? { colors: assets.brandColors } : {})}
          />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
