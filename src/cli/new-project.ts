#!/usr/bin/env node
import { program } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import type { VideoConfig, BrandColors } from '../types/index.js';

const PROJECTS_ROOT = path.resolve(process.cwd(), 'projects');

const TEMPLATES_DIR = path.join(PROJECTS_ROOT, '_templates');

program
  .requiredOption('--name <name>', 'Project name (kebab-case, e.g. nike-summer-ad)')
  .option(
    '--format <format>',
    'Video format: youtube-short | tiktok | ad-16x9 | ad-1x1 | web-hero',
  )
  .option('--template <name>', 'Start from a template (product-launch, brand-story, before-after)')
  .option('--brand <brand>', 'Brand name (used with --template to customize)')
  .parse();

const opts = program.opts<{ name: string; format?: string; template?: string; brand?: string }>();
const projectName = opts.name.toLowerCase().replace(/\s+/g, '-');
const format = opts.format ?? 'youtube-short';

const VALID_FORMATS = ['youtube-short', 'tiktok', 'ad-16x9', 'ad-1x1', 'web-hero'];
if (opts.format && !VALID_FORMATS.includes(format)) {
  console.error(`Invalid format: "${format}". Valid: ${VALID_FORMATS.join(' | ')}`);
  process.exit(1);
}

const projectDir = path.join(PROJECTS_ROOT, projectName);

async function scaffold(): Promise<void> {
  if (await fs.pathExists(projectDir)) {
    console.error(`❌ Project "${projectName}" already exists at ${projectDir}`);
    process.exit(1);
  }

  // Create all directories
  const dirs = [
    'brand',
    'storyboard',
    'cache',
    'output',
  ];

  for (const dir of dirs) {
    await fs.mkdirp(path.join(projectDir, dir));
  }

  // ── Template loading ───────────────────────────────────────────────────
  let config: VideoConfig;

  if (opts.template) {
    const templatePath = path.join(TEMPLATES_DIR, `${opts.template}.json`);
    if (!(await fs.pathExists(templatePath))) {
      const available = (await fs.readdir(TEMPLATES_DIR))
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''));
      console.error(`❌ Template "${opts.template}" not found. Available: ${available.join(', ')}`);
      process.exit(1);
    }

    const template = (await fs.readJson(templatePath)) as VideoConfig;
    const brandName = opts.brand ?? projectName;

    config = {
      ...template,
      title: projectName,
      brand: brandName,
    };

    // Rewrite template prompts to include the brand name
    if (opts.brand && config.clips) {
      config.clips = config.clips.map((clip) => {
        if (!clip.prompt) return clip;
        return { ...clip, prompt: clip.prompt.replace(/the product/gi, brandName) };
      });
    }

    // Override format if explicitly provided
    if (opts.format) {
      config.format = opts.format as NonNullable<VideoConfig['format']>;
    }

    console.log(`Using template: ${opts.template}${opts.brand ? ` (brand: ${opts.brand})` : ''}`);
  } else {
    // Default config (no template)
    const defaultCaptions = format === 'youtube-short' || format === 'tiktok';
    config = {
      format: format as NonNullable<VideoConfig['format']>,
      title: projectName,
      script: '',
      voiceId: 'pNInz6obpgDQGcFmaJgB', // ElevenLabs Adam voice — change this
      clips: [
        {
          prompt: 'Describe your first scene here',
          duration: 5,
        },
      ],
      transition: 'crossfade',
      captions: defaultCaptions,
      captionStyle: 'word-by-word',
      captionPosition: 'bottom',
      hookText: '',
      music: false,
      musicVolume: 0.15,
    };
  }

  await fs.writeJson(path.join(projectDir, 'config.json'), config, { spaces: 2 });

  // Write brand.json template
  const brand: BrandColors = {
    primary: '#FFFFFF',
    secondary: '#000000',
    accent: '#FF0000',
  };
  await fs.writeJson(path.join(projectDir, 'brand/brand.json'), brand, { spaces: 2 });

  // Print next steps
  console.log(`
✅ Project "${projectName}" created!

Project structure:
  projects/${projectName}/
  ├── config.json          ← edit your brief here
  ├── product.jpg          ← drop product/subject photo here (optional)
  ├── style.jpg            ← visual mood reference (optional)
  ├── music.mp3            ← background music (optional)
  ├── brand/
  │   ├── brand.json       ← edit brand colors
  │   └── logo.png         ← add your logo (transparent PNG)
  ├── storyboard/          ← auto-generated frames go here
  ├── cache/               ← pipeline cache (auto-managed)
  └── output/              ← results

Next steps:
  1. Edit config.json with your brief, clips, and settings
  2. Drop any reference photos (product.jpg, style.jpg)
  3. Run: npm run pipeline -- --project ${projectName}
`);
}

scaffold().catch((err: unknown) => {
  console.error('❌ Scaffolding failed:', err);
  process.exit(1);
});
