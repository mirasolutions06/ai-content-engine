import path from 'path';
import fs from 'fs-extra';
import { ElevenLabsClient } from 'elevenlabs';
import { logger } from '../utils/logger.js';
import type { ElevenLabsOptions } from '../types/index.js';

/**
 * Generates a voiceover MP3 using ElevenLabs text-to-speech.
 * Idempotent — skips generation if the output file already exists.
 *
 * @param script - Narration text
 * @param options - Voice ID and generation settings
 * @param projectsRoot - Root folder containing all projects
 * @param projectName - Name of current project
 * @returns Absolute path to the generated voiceover.mp3
 */
export async function generateVoiceover(
  script: string,
  options: ElevenLabsOptions,
  projectsRoot: string,
  projectName: string,
): Promise<string> {
  const outputPath = path.join(projectsRoot, projectName, 'output/audio/voiceover.mp3');

  if (await fs.pathExists(outputPath)) {
    logger.skip(`Voiceover already exists: ${outputPath}`);
    return outputPath;
  }

  const apiKey = process.env['ELEVENLABS_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'ELEVENLABS_API_KEY is not set in .env. ' +
      'Get your key at: https://elevenlabs.io/app/settings/api-keys',
    );
  }

  const client = new ElevenLabsClient({ apiKey });

  logger.step(`Generating voiceover with voice ID: ${options.voiceId}...`);

  // SDK v0.16.x: convert() returns Promise<stream.Readable>
  const audioStream = await client.textToSpeech.convert(options.voiceId, {
    text: script,
    model_id: options.modelId ?? 'eleven_multilingual_v2',
    voice_settings: {
      stability: options.stability ?? 0.5,
      similarity_boost: options.similarityBoost ?? 0.75,
      style: options.style ?? 0,
    },
  });

  await fs.ensureDir(path.dirname(outputPath));

  // Collect chunks from the Node.js Readable stream and write to file
  await new Promise<void>((resolve, reject) => {
    const writeStream = fs.createWriteStream(outputPath);
    audioStream.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    audioStream.on('error', reject);
  });

  logger.success(`Voiceover saved: ${outputPath}`);
  return outputPath;
}

/**
 * Lists all available ElevenLabs voices for the authenticated account.
 * Run: npm run pipeline -- --project <name> --list-voices
 */
export async function listVoices(): Promise<void> {
  const apiKey = process.env['ELEVENLABS_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'ELEVENLABS_API_KEY is not set in .env. ' +
      'Get your key at: https://elevenlabs.io/app/settings/api-keys',
    );
  }

  const client = new ElevenLabsClient({ apiKey });
  const response = await client.voices.getAll();

  console.log('\nAvailable ElevenLabs voices:\n');
  for (const voice of response.voices) {
    const name = voice.name ?? '(unnamed)';
    console.log(`  ${name.padEnd(30)} ID: ${voice.voice_id}`);
  }
  console.log('');
}
