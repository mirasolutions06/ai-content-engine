#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import { runPipeline } from '../pipeline/index.js';
import { listVoices } from '../pipeline/elevenlabs.js';
import { logger } from '../utils/logger.js';
import type { RunOptions } from '../types/index.js';

program
  .requiredOption('--project <name>', 'Project name to run the pipeline for')
  .option('--list-voices', 'List available ElevenLabs voices and exit')
  .option('--storyboard-only', 'Generate Gemini storyboard frames and stop for review')
  .option('--dry-run', 'Preview pipeline without calling paid APIs')
  .option('--json-output', 'Print JSON summary of pipeline results')
  .parse();

const opts = program.opts<{
  project: string;
  listVoices?: boolean;
  storyboardOnly?: boolean;
  dryRun?: boolean;
  jsonOutput?: boolean;
}>();

async function main(): Promise<void> {
  if (opts.listVoices === true) {
    await listVoices();
    return;
  }

  logger.step(`Starting pipeline for project: ${opts.project}`);

  const runOpts: RunOptions = {};
  if (opts.storyboardOnly === true) runOpts.storyboardOnly = true;
  if (opts.dryRun === true) runOpts.dryRun = true;
  if (opts.jsonOutput === true) runOpts.jsonOutput = true;

  const result = await runPipeline(opts.project, runOpts);

  if (typeof result !== 'string') {
    // --json-output: print only JSON to stdout for piping
    console.log(JSON.stringify(result, null, 2));
  } else if (opts.storyboardOnly === true) {
    logger.success(`Storyboard ready — review images at: ${result}`);
    logger.info('Delete any you want regenerated, then re-run without --storyboard-only.');
  } else if (opts.dryRun === true) {
    logger.success(`Dry run complete for project: ${opts.project}`);
  } else {
    logger.success(`Pipeline complete! Final video: ${result}`);
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
