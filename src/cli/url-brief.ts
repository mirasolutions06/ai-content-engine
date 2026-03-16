#!/usr/bin/env node
import 'dotenv/config';
import { program } from 'commander';
import path from 'path';
import { generateConfigFromUrl } from '../pipeline/url-to-brief.js';

const PROJECTS_ROOT = path.resolve(process.cwd(), 'projects');

program
  .requiredOption('--url <url>', 'Product page URL to extract brief from')
  .requiredOption('--name <name>', 'Project name (kebab-case)')
  .option('--mode <mode>', 'Pipeline mode: brand-images | video | full', 'brand-images')
  .parse();

const opts = program.opts<{ url: string; name: string; mode: string }>();

generateConfigFromUrl(opts.url, PROJECTS_ROOT, opts.name, opts.mode as 'brand-images' | 'video' | 'full')
  .then((config) => {
    console.log('\nGenerated config:');
    console.log(JSON.stringify(config, null, 2));
  })
  .catch((err: unknown) => {
    console.error('Failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
