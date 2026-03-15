import path from 'path';
import fs from 'fs-extra';
import { logger } from './logger.js';

interface PromptPattern {
  pattern: string;
  avgScore: number;
  count: number;
}

interface ProviderInsight {
  avgScore: number;
  totalImages: number;
}

interface SkillMemoryData {
  lastUpdated: string;
  totalRuns: number;
  promptPatterns: PromptPattern[];
  providerInsights: Record<string, ProviderInsight>;
  formatInsights: Record<string, { avgScore: number; count: number }>;
}

const MEMORY_PATH = path.resolve(process.cwd(), 'memory', 'skills', 'skill-memory.json');
const MAX_PATTERNS = 50;

/** Load cross-brand skill memory. Returns null if none exists. */
export async function loadSkillMemory(): Promise<SkillMemoryData | null> {
  if (!(await fs.pathExists(MEMORY_PATH))) return null;
  try {
    return (await fs.readJson(MEMORY_PATH)) as SkillMemoryData;
  } catch {
    return null;
  }
}

/**
 * Record run results into cross-brand skill memory.
 * Aggregates prompt patterns, provider performance, and format insights.
 */
export async function recordSkillRun(
  provider: string,
  qaResults: Array<{ scene: string; score: number; prompt?: string; format?: string }>,
): Promise<void> {
  let data: SkillMemoryData;
  try {
    data = (await fs.pathExists(MEMORY_PATH))
      ? ((await fs.readJson(MEMORY_PATH)) as SkillMemoryData)
      : { lastUpdated: '', totalRuns: 0, promptPatterns: [], providerInsights: {}, formatInsights: {} };
  } catch {
    data = { lastUpdated: '', totalRuns: 0, promptPatterns: [], providerInsights: {}, formatInsights: {} };
  }

  data.totalRuns++;

  // Update provider insights
  const scores = qaResults.map((r) => r.score).filter((s) => s > 0);
  if (scores.length > 0) {
    const existing = data.providerInsights[provider] ?? { avgScore: 0, totalImages: 0 };
    const totalScore = existing.avgScore * existing.totalImages + scores.reduce((a, b) => a + b, 0);
    const totalCount = existing.totalImages + scores.length;
    data.providerInsights[provider] = {
      avgScore: Math.round((totalScore / totalCount) * 100) / 100,
      totalImages: totalCount,
    };
  }

  // Update format insights
  for (const result of qaResults) {
    if (!result.format || result.score === 0) continue;
    const existing = data.formatInsights[result.format] ?? { avgScore: 0, count: 0 };
    const totalScore = existing.avgScore * existing.count + result.score;
    const totalCount = existing.count + 1;
    data.formatInsights[result.format] = {
      avgScore: Math.round((totalScore / totalCount) * 100) / 100,
      count: totalCount,
    };
  }

  // Extract and aggregate prompt patterns (key phrases from high-scoring prompts)
  for (const result of qaResults) {
    if (!result.prompt || result.score < 3.5) continue;
    const keywords = extractPromptKeywords(result.prompt);
    for (const kw of keywords) {
      const existing = data.promptPatterns.find((p) => p.pattern === kw);
      if (existing) {
        existing.avgScore = Math.round(
          ((existing.avgScore * existing.count + result.score) / (existing.count + 1)) * 100,
        ) / 100;
        existing.count++;
      } else {
        data.promptPatterns.push({ pattern: kw, avgScore: result.score, count: 1 });
      }
    }
  }

  // Keep top patterns by score (prune low-count patterns)
  data.promptPatterns = data.promptPatterns
    .filter((p) => p.count >= 2) // at least 2 observations
    .sort((a, b) => b.avgScore - a.avgScore)
    .slice(0, MAX_PATTERNS);

  data.lastUpdated = new Date().toISOString();

  await fs.ensureDir(path.dirname(MEMORY_PATH));
  await fs.outputJson(MEMORY_PATH, data, { spaces: 2 });
}

/** Generate Director context from cross-brand patterns. */
export function getSkillDirectorContext(memory: SkillMemoryData): string {
  const lines: string[] = [];
  lines.push(`CROSS-BRAND INSIGHTS (${memory.totalRuns} runs total):`);

  // Provider performance
  const providers = Object.entries(memory.providerInsights)
    .sort(([, a], [, b]) => b.avgScore - a.avgScore);
  if (providers.length > 0) {
    lines.push('Provider performance:');
    for (const [name, stats] of providers) {
      lines.push(`  - ${name}: avg ${stats.avgScore}/5 (${stats.totalImages} images)`);
    }
  }

  // Top prompt patterns
  const topPatterns = memory.promptPatterns.slice(0, 8);
  if (topPatterns.length > 0) {
    lines.push('Highest-scoring prompt patterns:');
    for (const p of topPatterns) {
      lines.push(`  - "${p.pattern}" → avg ${p.avgScore}/5 (${p.count}x)`);
    }
  }

  return lines.join('\n');
}

/** Extract key photography phrases from a prompt. */
function extractPromptKeywords(prompt: string): string[] {
  const patterns = [
    /dramatic lighting/i,
    /golden hour/i,
    /natural light/i,
    /studio lighting/i,
    /shallow depth of field/i,
    /macro photography/i,
    /top-down/i,
    /flat lay/i,
    /lifestyle/i,
    /close-up/i,
    /hero shot/i,
    /editorial/i,
    /cinematic/i,
    /warm[\s-]tone/i,
    /cool[\s-]tone/i,
    /minimalist/i,
    /dark background/i,
    /bokeh/i,
    /rim light/i,
    /split lighting/i,
  ];

  return patterns
    .filter((p) => p.test(prompt))
    .map((p) => {
      const match = p.exec(prompt);
      return match ? match[0].toLowerCase() : '';
    })
    .filter(Boolean);
}
