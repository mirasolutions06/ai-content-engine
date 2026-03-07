import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { groupWordsIntoLines, getActiveWordIndex } from '../../pipeline/captions.js';
import type { CaptionLine } from '../../pipeline/captions.js';
import type { CaptionWord, CaptionStyle, CaptionTheme, BrandColors } from '../../types/index.js';

interface CaptionTrackProps {
  words: CaptionWord[];
  style?: CaptionStyle;
  position?: 'bottom' | 'center' | 'top';
  theme?: CaptionTheme;
  colors?: BrandColors | undefined;
  fontFamily?: string;
  /** Maximum characters per caption line. Default: 25 */
  maxCharsPerLine?: number;
}

// ─── Theme definitions ─────────────────────────────────────────────────────

interface ThemeStyles {
  container: React.CSSProperties;
  activeWord: (colors?: BrandColors) => React.CSSProperties;
  inactiveWord: React.CSSProperties;
  lineText: React.CSSProperties;
}

function getTheme(theme: CaptionTheme, fontFamily: string): ThemeStyles {
  switch (theme) {
    case 'bold':
      return {
        container: {
          fontFamily,
          fontSize: 64,
          fontWeight: 900,
          lineHeight: 1.3,
          textAlign: 'center',
          textTransform: 'uppercase' as const,
          padding: '0 24px',
          wordBreak: 'break-word' as const,
        },
        activeWord: (colors) => ({
          display: 'inline-block',
          color: '#000',
          backgroundColor: colors?.primary ?? '#FACC15',
          padding: '4px 12px',
          borderRadius: 8,
          margin: '2px 3px',
          transform: 'scale(1.05)',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))',
        }),
        inactiveWord: {
          display: 'inline-block',
          color: 'white',
          padding: '4px 12px',
          borderRadius: 8,
          margin: '2px 3px',
          backgroundColor: 'rgba(0,0,0,0.6)',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))',
        },
        lineText: {
          color: 'white',
          backgroundColor: 'rgba(0,0,0,0.6)',
          padding: '8px 20px',
          borderRadius: 12,
          display: 'inline-block',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.5))',
        },
      };

    case 'editorial':
      return {
        container: {
          fontFamily,
          fontSize: 48,
          fontWeight: 500,
          lineHeight: 1.4,
          textAlign: 'center',
          letterSpacing: '0.02em',
          padding: '0 60px',
          wordBreak: 'break-word' as const,
        },
        activeWord: (colors) => ({
          display: 'inline-block',
          color: 'white',
          borderBottom: `3px solid ${colors?.primary ?? '#FACC15'}`,
          paddingBottom: 2,
          margin: '0 4px',
          fontWeight: 700,
          filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))',
        }),
        inactiveWord: {
          display: 'inline-block',
          color: 'rgba(255,255,255,0.85)',
          margin: '0 4px',
          filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.5))',
        },
        lineText: {
          color: 'rgba(255,255,255,0.9)',
          filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.6))',
        },
      };

    case 'minimal':
    default:
      return {
        container: {
          fontFamily,
          fontSize: 52,
          fontWeight: 600,
          lineHeight: 1.3,
          textAlign: 'center',
          padding: '0 40px',
          wordBreak: 'break-word' as const,
        },
        activeWord: () => ({
          display: 'inline-block',
          color: 'white',
          margin: '0 4px',
          opacity: 1,
          fontWeight: 700,
          textShadow: '0 2px 8px rgba(0,0,0,0.7)',
        }),
        inactiveWord: {
          display: 'inline-block',
          color: 'white',
          margin: '0 4px',
          opacity: 0.5,
          textShadow: '0 1px 4px rgba(0,0,0,0.5)',
        },
        lineText: {
          color: 'white',
          textShadow: '0 2px 8px rgba(0,0,0,0.7)',
        },
      };
  }
}

const POSITION_STYLES: Record<'bottom' | 'center' | 'top', React.CSSProperties> = {
  bottom: { position: 'absolute', bottom: 120, left: 0, right: 0 },
  center: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    transform: 'translateY(-50%)',
  },
  top: { position: 'absolute', top: 80, left: 0, right: 0 },
};

/**
 * CaptionTrack renders animated captions synced to Whisper word timestamps.
 *
 * Supports three visual themes:
 *   - 'bold': TikTok/CapCut style — pill backgrounds, brand color highlight on active word
 *   - 'editorial': Clean luxury — subtle shadow, brand-colored underline on active word
 *   - 'minimal': Simple white text with opacity-based word highlighting
 *
 * Word-by-word mode:
 *   - Finds the line containing the currently-active word
 *   - Renders all words on that line with theme-specific active/inactive styles
 *
 * Line-by-line mode:
 *   - Renders the full active line as a single string
 *   - Fades in at line start, fades out at line end
 */
export const CaptionTrack: React.FC<CaptionTrackProps> = ({
  words,
  style = 'word-by-word',
  position = 'bottom',
  theme = 'bold',
  colors,
  fontFamily = 'sans-serif',
  maxCharsPerLine = 25,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeSec = frame / fps;

  const themeStyles = useMemo(() => getTheme(theme, fontFamily), [theme, fontFamily]);

  const lines = useMemo(
    () => groupWordsIntoLines(words, maxCharsPerLine),
    [words, maxCharsPerLine],
  );

  if (words.length === 0) return null;

  const posStyle = POSITION_STYLES[position];

  if (style === 'word-by-word') {
    return (
      <div style={posStyle}>
        <WordByWordCaption
          words={words}
          lines={lines}
          currentTimeSec={currentTimeSec}
          themeStyles={themeStyles}
          colors={colors}
        />
      </div>
    );
  }

  // Line-by-line mode
  const activeLine = lines.find(
    (l) => currentTimeSec >= l.lineStart && currentTimeSec <= l.lineEnd,
  );

  if (!activeLine) return null;

  const lineText = activeLine.words.map((w) => w.word).join(' ');
  const lineOpacity = interpolate(
    currentTimeSec,
    [
      activeLine.lineStart,
      activeLine.lineStart + 0.1,
      activeLine.lineEnd - 0.1,
      activeLine.lineEnd,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  return (
    <div style={posStyle}>
      <div style={{ ...themeStyles.container, ...themeStyles.lineText, opacity: lineOpacity }}>
        {lineText}
      </div>
    </div>
  );
};

// ─── Word-by-Word Sub-component ─────────────────────────────────────────────

interface WordByWordCaptionProps {
  words: CaptionWord[];
  lines: CaptionLine[];
  currentTimeSec: number;
  themeStyles: ThemeStyles;
  colors?: BrandColors | undefined;
}

const WordByWordCaption: React.FC<WordByWordCaptionProps> = ({
  words,
  lines,
  currentTimeSec,
  themeStyles,
  colors,
}) => {
  const activeWordIndex = getActiveWordIndex(words, currentTimeSec);

  const activeLine = useMemo(() => {
    if (activeWordIndex === -1) return null;
    const activeWord = words[activeWordIndex];
    if (!activeWord) return null;

    return (
      lines.find((l) =>
        l.words.some(
          (w) => w.start === activeWord.start && w.word === activeWord.word,
        ),
      ) ?? null
    );
  }, [activeWordIndex, words, lines]);

  if (!activeLine) return null;

  return (
    <div
      style={{
        ...themeStyles.container,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}
    >
      {activeLine.words.map((word, idx) => {
        const globalIdx = words.findIndex(
          (w) => w.start === word.start && w.word === word.word,
        );
        const isActive = globalIdx === activeWordIndex;

        return (
          <span
            key={`${word.word}-${word.start}-${idx}`}
            style={isActive ? themeStyles.activeWord(colors) : themeStyles.inactiveWord}
          >
            {word.word}
          </span>
        );
      })}
    </div>
  );
};
