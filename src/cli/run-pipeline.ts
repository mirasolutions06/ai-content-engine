#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import { runPipeline } from '../pipeline/index.js';
import { listVoices } from '../pipeline/elevenlabs.js';
import { logger } from '../utils/logger.js';

program
  .requiredOption('--project <name>', 'Project name to run the pipeline for')
  .option('--list-voices', 'List available ElevenLabs voices and exit')
  .option('--storyboard-only', 'Generate Gemini storyboard frames and stop for review')
  .parse();

const opts = program.opts<{ project: string; listVoices?: boolean; storyboardOnly?: boolean }>();

async function main(): Promise<void> {
  if (opts.listVoices === true) {
    await listVoices();
    return;
  }

  logger.step(`Starting pipeline for project: ${opts.project}`);

  const finalPath = await runPipeline(
    opts.project,
    opts.storyboardOnly === true ? { storyboardOnly: true } : undefined,
  );

  if (opts.storyboardOnly === true) {
    logger.success(`Storyboard ready — review images at: ${finalPath}`);
    logger.info('Delete any you want regenerated, then re-run without --storyboard-only.');
  } else {
    logger.success(`Pipeline complete! Final video: ${finalPath}`);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error(`Pipeline failed: ${message}`);
  if (err instanceof Error && err.stack) {
    logger.info(err.stack);
  }
  process.exit(1);
});
