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
import { Outro } from '../components/Outro.js';
import { secondsToFrames } from '../helpers/timing.js';
import type { CompositionProps } from '../../types/index.js';

export const YoutubeShort: React.FC<CompositionProps> = ({
  config,
  assets,
  captions,
  clipPaths,
  voiceoverPath,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  const showCaptions = config.captions ?? true;
  const musicVolume = config.musicVolume ?? 0.15;
  const ctaDurationFrames = secondsToFrames(config.cta?.durationSeconds ?? 3, fps);
  const ctaStartFrame = durationInFrames - ctaDurationFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Video clips with crossfade transitions */}
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

      {/* Background music at low volume */}
      {config.music === true && assets.backgroundMusic !== undefined && (
        <Audio src={staticFile(assets.backgroundMusic)} volume={musicVolume} />
      )}

      {/* Hook text — shown for first 2 seconds */}
      {config.hookText !== undefined && config.hookText !== '' && (
        <Sequence durationInFrames={secondsToFrames(2, fps)}>
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
              fontFamily: 'sans-serif',
              WebkitTextStroke: '2px black',
              textShadow: '0 4px 12px rgba(0,0,0,0.8)',
              padding: '0 40px',
              zIndex: 5,
            }}
          >
            {config.hookText}
          </div>
        </Sequence>
      )}

      {/* Word-by-word captions */}
      {showCaptions && captions.length > 0 && (
        <CaptionTrack
          words={captions}
          style={config.captionStyle ?? 'word-by-word'}
          position={config.captionPosition ?? 'bottom'}
        />
      )}

      {/* Logo top-right */}
      {assets.logo !== undefined && (
        <Logo logoPath={assets.logo} position="top-right" />
      )}

      {/* CTA outro overlay */}
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
