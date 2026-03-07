import path from 'path';
import fs from 'fs-extra';
import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import type { WhisperResult, CaptionWord } from '../types/index.js';

/**
 * Transcribes an audio file using OpenAI Whisper with word-level timestamps.
 * Caches result to avoid re-transcribing on pipeline re-runs.
 *
 * @param audioPath - Absolute path to the audio file (MP3, WAV, etc.)
 * @param projectsRoot - Root folder containing all projects
 * @param projectName - Name of current project
 * @returns WhisperResult with word-level timing data
 */
export async function transcribeAudio(
  audioPath: string,
  projectsRoot: string,
  projectName: string,
): Promise<WhisperResult> {
  const cachePath = path.join(projectsRoot, projectName, 'cache/captions.json');

  if (await fs.pathExists(cachePath)) {
    logger.skip('Caption cache found — skipping Whisper transcription.');
    return fs.readJson(cachePath) as Promise<WhisperResult>;
  }

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not set in .env. ' +
      'Get your key at: https://platform.openai.com/api-keys',
    );
  }

  const client = new OpenAI({ apiKey });

  logger.step('Transcribing voiceover with Whisper (word-level timestamps)...');

  const audioStream = fs.createReadStream(audioPath);

  // verbose_json with word timestamps gives us exact per-word timing
  // This is the only Whisper response format that includes word-level start/end times
  const transcription = await client.audio.transcriptions.create({
    file: audioStream,
    model: 'whisper-1',
    response_format: 'verbose_json',
    timestamp_granularities: ['word'],
  });

  const words: CaptionWord[] = (transcription.words ?? []).map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
  }));

  const result: WhisperResult = {
    words,
    fullText: transcription.text,
    language: transcription.language ?? 'en',
  };

  await fs.ensureDir(path.dirname(cachePath));
  await fs.writeJson(cachePath, result, { spaces: 2 });

  logger.success(
    `Transcription complete: ${words.length} words, language: ${result.language}`,
  );
  return result;
}
