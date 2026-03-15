import crypto from 'crypto';
import path from 'path';
import fs from 'fs-extra';
import { ElevenLabsClient } from 'elevenlabs';
import { logger } from '../utils/logger.js';
import type { ElevenLabsOptions } from '../types/index.js';

// ── Hash-based caching ──────────────────────────────────────────────────────

function hashVoiceRequest(script: string, options: ElevenLabsOptions): string {
  const payload = JSON.stringify({
    script,
    voiceId: options.voiceId,
    stability: options.stability ?? 0.5,
    similarityBoost: options.similarityBoost ?? 0.75,
    style: options.style ?? 0,
    modelId: options.modelId ?? 'eleven_multilingual_v2',
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Generates a voiceover MP3 using ElevenLabs text-to-speech.
 * Uses content-hash caching: script + voice settings are hashed to detect
 * when regeneration is needed even if other config fields changed.
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
  const cacheDir = path.join(projectsRoot, projectName, 'cache');
  const hash = hashVoiceRequest(script, options);
  const cachedPath = path.join(cacheDir, `voiceover-${hash}.mp3`);

  // Check hash-based cache first
  if (await fs.pathExists(cachedPath)) {
    logger.skip(`Voiceover cache hit (hash: ${hash}) — copying to output.`);
    await fs.ensureDir(path.dirname(outputPath));
    await fs.copy(cachedPath, outputPath);
    return outputPath;
  }

  // Backward compatibility: check if output exists from a pre-hash run
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

  // Save to hash-based cache for future runs
  await fs.ensureDir(cacheDir);
  await fs.copy(outputPath, cachedPath);
  logger.info(`Voiceover cached as voiceover-${hash}.mp3`);

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
