import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { YoutubeShort } from './compositions/YoutubeShort.js';
import { TikTok } from './compositions/TikTok.js';
import { Ad } from './compositions/Ad.js';
import { WebHero } from './compositions/WebHero.js';
import type { CompositionProps } from '../types/index.js';

const DEFAULT_PROPS: CompositionProps = {
  config: {
    format: 'youtube-short',
    title: 'Preview',
    clips: [{ prompt: 'test', duration: 5 }],
    transition: 'crossfade',
    captions: false,
  },
  assets: { storyboardFrames: [] },
  captions: [],
  clipPaths: [],
};

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="YoutubeShort"
        component={YoutubeShort}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_PROPS}
      />
      <Composition
        id="TikTok"
        component={TikTok}
        durationInFrames={150}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={DEFAULT_PROPS}
      />
      <Composition
        id="Ad"
        component={Ad}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={DEFAULT_PROPS}
      />
      <Composition
        id="WebHero"
        component={WebHero}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={DEFAULT_PROPS}
      />
    </>
  );
};

registerRoot(RemotionRoot);
