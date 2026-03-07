import type { CaptionWord } from '../types/index.js';

export interface CaptionLine {
  words: CaptionWord[];
  /** Start time of the first word in this line (seconds) */
  lineStart: number;
  /** End time of the last word in this line (seconds) */
  lineEnd: number;
}

/**
 * Groups CaptionWords into display lines based on a maximum character limit.
 * Used for line-by-line caption mode.
 *
 * @param words - Word-level timing data from Whisper
 * @param maxCharsPerLine - Maximum characters before wrapping (default: 25)
 * @returns Array of CaptionLine objects ready for Remotion rendering
 */
export function groupWordsIntoLines(
  words: CaptionWord[],
  maxCharsPerLine = 25,
): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let currentLine: CaptionWord[] = [];
  let currentLength = 0;

  for (const word of words) {
    // +1 for the space between words (except for the first word on a line)
    const wordLength = word.word.length + (currentLine.length > 0 ? 1 : 0);

    if (currentLength + wordLength > maxCharsPerLine && currentLine.length > 0) {
      // Flush current line
      const firstWord = currentLine[0];
      const lastWord = currentLine[currentLine.length - 1];
      if (firstWord && lastWord) {
        lines.push({
          words: currentLine,
          lineStart: firstWord.start,
          lineEnd: lastWord.end,
        });
      }
      currentLine = [word];
      currentLength = word.word.length;
    } else {
      currentLine.push(word);
      currentLength += wordLength;
    }
  }

  // Push remaining words as the last line
  if (currentLine.length > 0) {
    const firstWord = currentLine[0];
    const lastWord = currentLine[currentLine.length - 1];
    if (firstWord && lastWord) {
      lines.push({
        words: currentLine,
        lineStart: firstWord.start,
        lineEnd: lastWord.end,
      });
    }
  }

  return lines;
}

/**
 * Finds the index of the word currently being spoken at a given time.
 * Returns -1 if no word is active at that time (between words or before/after speech).
 */
export function getActiveWordIndex(words: CaptionWord[], currentTimeSeconds: number): number {
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;
    if (currentTimeSeconds >= word.start && currentTimeSeconds <= word.end) {
      return i;
    }
  }
  return -1;
}

/**
 * Finds the index of the active caption line at a given time.
 * Returns -1 if no line is active.
 */
export function getActiveLineIndex(lines: CaptionLine[], currentTimeSeconds: number): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (currentTimeSeconds >= line.lineStart && currentTimeSeconds <= line.lineEnd) {
      return i;
    }
  }
  return -1;
}
