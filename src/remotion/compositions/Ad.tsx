import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useVideoConfig,
} from 'remotion';
import { resolveSrc } from '../helpers/resolve-src.js';
import { loadProjectFont } from '../helpers/fonts.js';
import { TransitionSeries } from '@remotion/transitions';
import { resolveTransition } from '../helpers/transitions.js';
import { createMusicVolumeCallback } from '../helpers/audio-ducking.js';
import { VideoScene } from '../components/VideoScene.js';
import { CaptionTrack } from '../components/CaptionTrack.js';
import { Logo } from '../components/Logo.js';
import { LowerThird } from '../components/LowerThird.js';
import { Outro } from '../components/Outro.js';
import { FilmGrain } from '../components/FilmGrain.js';
import { Vignette } from '../components/Vignette.js';
import { secondsToFrames } from '../helpers/timing.js';
import type { CompositionProps } from '../../types/index.js';

const BRAND_FONT = 'BrandFont';

export const Ad: React.FC<CompositionProps> = ({
  config,
  assets,
  captions,
  clipPaths,
  voiceoverPath,
}) => {
  const { fps, durationInFrames } = useVideoConfig();

  // Load custom fonts from project brand folder (falls back to sans-serif if missing)
  loadProjectFont(assets.fontBold, BRAND_FONT, '700');
  loadProjectFont(assets.fontRegular, BRAND_FONT, '400');

  const hasCustomFont = assets.fontBold !== undefined || assets.fontRegular !== undefined;
  const fontFamily = hasCustomFont ? `${BRAND_FONT}, sans-serif` : 'sans-serif';

  const showCaptions = config.captions ?? false;
  const musicVolume = config.musicVolume ?? 0.15;
  const captionTheme = config.captionTheme ?? 'bold';
  const ctaDurationFrames = secondsToFrames(config.cta?.durationSeconds ?? 3, fps);
  const ctaStartFrame = durationInFrames - ctaDurationFrames;

  // Total clip duration in frames (for lower third timing)
  const mainContentFrames = durationInFrames - ctaDurationFrames;

  const transition = resolveTransition(config.transition);

  // Music volume automation: ducks under voiceover, fades in/out
  const musicVolumeCallback = useMemo(
    () =>
      createMusicVolumeCallback({
        captions,
        fps,
        baseVolume: musicVolume,
        totalFrames: durationInFrames,
      }),
    [captions, fps, musicVolume, durationInFrames],
  );

  // Global color grade CSS filter
  const colorGradeFilter = config.colorGrade !== false
    ? 'contrast(1.08) saturate(1.1) brightness(0.97) sepia(0.08)'
    : 'none';

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Video clips — wrapped in color grade filter */}
      <AbsoluteFill style={{ filter: colorGradeFilter }}>
        <TransitionSeries>
          {clipPaths.map((clipPath, i) => {
            const clip = config.clips[i];
            const clipDuration = secondsToFrames(clip?.duration ?? 5, fps);
            const isLastClip = i === clipPaths.length - 1;

            return (
              <React.Fragment key={clipPath}>
                <TransitionSeries.Sequence durationInFrames={clipDuration}>
                  <VideoScene clipPath={clipPath} volume={0} sceneIndex={i} />
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
      </AbsoluteFill>

      {/* Optional brand color unity overlay */}
      {config.colorUnify === true && assets.brandColors?.primary !== undefined && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: assets.brandColors.primary,
            opacity: config.colorUnifyOpacity ?? 0.06,
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}

      {/* Vignette + Film grain for visual coherence */}
      <Vignette intensity={0.4} />
      <FilmGrain opacity={0.05} />

      {/* Voiceover — primary audio track at full volume */}
      {voiceoverPath !== undefined && (
        <Audio src={resolveSrc(voiceoverPath)} volume={1} />
      )}

      {/* Background music with ducking */}
      {config.music === true && assets.backgroundMusic !== undefined && (
        <Audio src={resolveSrc(assets.backgroundMusic)} volume={musicVolumeCallback} />
      )}

      {/* Lower third — shows client name and optional tagline */}
      {config.client !== undefined && (
        <LowerThird
          title={config.client}
          subtitle={config.title}
          fontFamily={fontFamily}
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
          theme={captionTheme}
          colors={assets.brandColors}
          fontFamily={fontFamily}
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
            fontFamily={fontFamily}
            {...(assets.brandColors !== undefined ? { colors: assets.brandColors } : {})}
          />
        </Sequence>
      )}
    </AbsoluteFill>
  );
};
