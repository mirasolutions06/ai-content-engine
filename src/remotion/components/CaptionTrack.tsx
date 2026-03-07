import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { groupWordsIntoLines, getActiveWordIndex } from '../../pipeline/captions.js';
import type { CaptionLine } from '../../pipeline/captions.js';
import type { CaptionWord, CaptionStyle } from '../../types/index.js';

interface CaptionTrackProps {
  words: CaptionWord[];
  style?: CaptionStyle;
  position?: 'bottom' | 'center' | 'top';
  /** Maximum characters per caption line. Default: 25 */
  maxCharsPerLine?: number;
}

const BASE_TEXT_STYLE: React.CSSProperties = {
  fontFamily: 'sans-serif',
  fontSize: 68,
  fontWeight: 800,
  lineHeight: 1.2,
  textAlign: 'center',
  color: 'white',
  WebkitTextStroke: '3px black',
  textShadow: '0 4px 12px rgba(0,0,0,0.8)',
  padding: '0 40px',
  wordBreak: 'break-word',
};

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
 * Word-by-word mode:
 *   - Finds the line containing the currently-active word
 *   - Renders all words on that line
 *   - Active word: full opacity + slightly larger scale
 *   - Inactive words on same line: 60% opacity
 *
 * Line-by-line mode:
 *   - Renders the full active line as a single string
 *   - Fades in at line start, fades out at line end
 *
 * Emoji in captions are handled automatically by the browser's Unicode renderer.
 */
export const CaptionTrack: React.FC<CaptionTrackProps> = ({
  words,
  style = 'word-by-word',
  position = 'bottom',
  maxCharsPerLine = 25,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeSec = frame / fps;

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
  // Fade in over 0.1s at line start, fade out over 0.1s at line end
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
      <div style={{ ...BASE_TEXT_STYLE, opacity: lineOpacity }}>{lineText}</div>
    </div>
  );
};

// ─── Word-by-Word Sub-component ─────────────────────────────────────────────

interface WordByWordCaptionProps {
  words: CaptionWord[];
  lines: CaptionLine[];
  currentTimeSec: number;
}

const WordByWordCaption: React.FC<WordByWordCaptionProps> = ({
  words,
  lines,
  currentTimeSec,
}) => {
  const activeWordIndex = getActiveWordIndex(words, currentTimeSec);

  // Find the line that contains the active word
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
        ...BASE_TEXT_STYLE,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        columnGap: 8,
        rowGap: 4,
      }}
    >
      {activeLine.words.map((word, idx) => {
        // Find the global index of this word to compare with activeWordIndex
        const globalIdx = words.findIndex(
          (w) => w.start === word.start && w.word === word.word,
        );
        const isActive = globalIdx === activeWordIndex;

        return (
          <span
            key={`${word.word}-${word.start}-${idx}`}
            style={{
              display: 'inline-block',
              opacity: isActive ? 1 : 0.6,
              fontWeight: isActive ? 900 : 700,
              // Subtle scale emphasis on active word — avoids layout shift by using transform
              transform: isActive ? 'scale(1.06)' : 'scale(1)',
            }}
          >
            {word.word}
          </span>
        );
      })}
    </div>
  );
};
