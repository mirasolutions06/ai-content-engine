import path from 'path';
import fs from 'fs-extra';
import { logger } from './logger.js';

interface PromptScore {
  prompt: string;
  score: number;
  format: string;
}

interface BrandRunEntry {
  timestamp: string;
  projectName: string;
  mode: string;
  clipCount: number;
  avgQAScore: number;
  provider: string;
  topPrompts: PromptScore[];
}

interface BrandMemoryData {
  brandName: string;
  lastUpdated: string;
  runs: BrandRunEntry[];
  topPrompts: PromptScore[];
  styleAnchors: string[];
  insights: {
    bestProvider: string;
    avgScore: number;
    runCount: number;
  };
}

const MEMORY_ROOT = path.resolve(process.cwd(), 'memory', 'brands');
const MAX_RUNS = 50;
const MAX_TOP_PROMPTS = 20;

function brandSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

function memoryPath(brandName: string): string {
  return path.join(MEMORY_ROOT, brandSlug(brandName), 'brand-memory.json');
}

/** Load brand memory for a given brand name. Returns null if no memory exists. */
export async function loadBrandMemory(brandName: string): Promise<BrandMemoryData | null> {
  const p = memoryPath(brandName);
  if (!(await fs.pathExists(p))) return null;
  try {
    return (await fs.readJson(p)) as BrandMemoryData;
  } catch {
    return null;
  }
}

/**
 * Record the results of a pipeline run into brand memory.
 * Updates running averages, top prompts, and style anchors.
 */
export async function recordBrandRun(
  brandName: string,
  projectName: string,
  mode: string,
  provider: string,
  qaResults: Array<{ scene: string; score: number; prompt?: string; format?: string }>,
  styleAnchorPaths?: string[],
): Promise<void> {
  const p = memoryPath(brandName);
  let data: BrandMemoryData;

  try {
    data = (await fs.pathExists(p))
      ? ((await fs.readJson(p)) as BrandMemoryData)
      : {
          brandName,
          lastUpdated: '',
          runs: [],
          topPrompts: [],
          styleAnchors: [],
          insights: { bestProvider: provider, avgScore: 0, runCount: 0 },
        };
  } catch {
    data = {
      brandName,
      lastUpdated: '',
      runs: [],
      topPrompts: [],
      styleAnchors: [],
      insights: { bestProvider: provider, avgScore: 0, runCount: 0 },
    };
  }

  // Calculate run stats
  const scores = qaResults.map((r) => r.score).filter((s) => s > 0);
  const avgQAScore = scores.length > 0
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;

  // Top prompts from this run (score >= 4.0)
  const runTopPrompts: PromptScore[] = qaResults
    .filter((r) => r.score >= 4.0 && r.prompt)
    .map((r) => ({ prompt: r.prompt!, score: r.score, format: r.format ?? 'unknown' }));

  const entry: BrandRunEntry = {
    timestamp: new Date().toISOString(),
    projectName,
    mode,
    clipCount: qaResults.length,
    avgQAScore: Math.round(avgQAScore * 100) / 100,
    provider,
    topPrompts: runTopPrompts,
  };

  data.runs.push(entry);
  if (data.runs.length > MAX_RUNS) {
    data.runs = data.runs.slice(-MAX_RUNS);
  }

  // Update global top prompts (merge and keep best)
  const allTopPrompts = [...data.topPrompts, ...runTopPrompts]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TOP_PROMPTS);
  data.topPrompts = allTopPrompts;

  // Update style anchors (add new ones from high-scoring images)
  if (styleAnchorPaths) {
    for (const anchor of styleAnchorPaths) {
      if (!data.styleAnchors.includes(anchor)) {
        data.styleAnchors.push(anchor);
      }
    }
    // Keep at most 10 anchors (most recent)
    if (data.styleAnchors.length > 10) {
      data.styleAnchors = data.styleAnchors.slice(-10);
    }
  }

  // Update insights
  const allScores = data.runs.map((r) => r.avgQAScore).filter((s) => s > 0);
  data.insights = {
    bestProvider: findBestProvider(data.runs),
    avgScore: allScores.length > 0
      ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 100) / 100
      : 0,
    runCount: data.runs.length,
  };

  data.lastUpdated = new Date().toISOString();

  await fs.ensureDir(path.dirname(p));
  await fs.outputJson(p, data, { spaces: 2 });
  logger.info(`Brand memory updated for "${brandName}" (run #${data.insights.runCount}, avg score: ${data.insights.avgScore})`);
}

/** Generate a text summary of brand memory for the Director to use as context. */
export function getDirectorContext(memory: BrandMemoryData): string {
  const lines: string[] = [];

  lines.push(`BRAND MEMORY for "${memory.brandName}" (${memory.insights.runCount} previous runs, avg QA: ${memory.insights.avgScore}/5):`);

  if (memory.topPrompts.length > 0) {
    lines.push('Top-scoring prompts from past campaigns:');
    for (const p of memory.topPrompts.slice(0, 5)) {
      lines.push(`  - [${p.score}/5, ${p.format}] ${p.prompt}`);
    }
  }

  if (memory.insights.bestProvider) {
    lines.push(`Best-performing image provider: ${memory.insights.bestProvider}`);
  }

  const recentRun = memory.runs[memory.runs.length - 1];
  if (recentRun) {
    lines.push(`Last run: ${recentRun.projectName} (${recentRun.clipCount} clips, avg ${recentRun.avgQAScore}/5)`);
  }

  lines.push('Use these patterns as a starting point — build on what worked, avoid what scored low.');

  return lines.join('\n');
}

function findBestProvider(runs: BrandRunEntry[]): string {
  const providerScores: Record<string, { total: number; count: number }> = {};
  for (const run of runs) {
    if (run.avgQAScore === 0) continue;
    const entry = providerScores[run.provider] ?? { total: 0, count: 0 };
    entry.total += run.avgQAScore;
    entry.count++;
    providerScores[run.provider] = entry;
  }

  let best = '';
  let bestAvg = 0;
  for (const [provider, stats] of Object.entries(providerScores)) {
    const avg = stats.total / stats.count;
    if (avg > bestAvg) {
      bestAvg = avg;
      best = provider;
    }
  }
  return best;
}
