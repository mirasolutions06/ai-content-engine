import path from 'path';
import fs from 'fs-extra';
import { logger } from './logger.js';
import type { VideoConfig } from '../types/index.js';

export interface CostEntry {
  step: string;
  estimatedCost: number;
  cached: boolean;
  timestamp: string;
}

export interface CostLog {
  projectName: string;
  runStarted: string;
  entries: CostEntry[];
  totalEstimated: number;
  totalSaved: number;
}

/** Estimated USD cost per API call */
const COST_MAP: Record<string, number> = {
  director: 0.10,
  elevenlabs: 0.50,
  whisper: 0.02,
  'gemini-frame': 0.08,
  'gemini-brand-image': 0.08,
  'gemini-style-ref': 0.08,
  'gemini-location-ref': 0.08,
  'gemini-color-extract': 0.02,
  'haiku-color-gen': 0.01,
  // Kling v2.1 Pro
  'kling-5s': 0.49,
  'kling-10s': 0.90,
  // Kling v3 Pro (no audio)
  'kling-v3-5s': 1.12,
  'kling-v3-10s': 2.24,
  // Veo 3.1 (Google, ~$0.75/s output)
  'veo-3.1-6s': 4.50,
  'veo-3.1-8s': 6.00,
  'veo-3.1-fast-6s': 2.25,
  'veo-3.1-fast-8s': 3.00,
  // Video reference analysis
  'gemini-video-analysis': 0.05,
  // Storyboard variation (same cost as primary frame)
  'gemini-frame-variation': 0.08,
  // GPT Image (gpt-image-1)
  'gpt-image-standard': 0.04,
  'gpt-image-hd': 0.08,
  // QA and evaluation (Haiku vision)
  'haiku-image-qa': 0.02,
  'haiku-ref-eval': 0.01,
};

export class CostTracker {
  private entries: CostEntry[] = [];
  private runStarted: string;
  private costLogPath: string;

  constructor(
    private projectName: string,
    projectsRoot: string,
  ) {
    this.runStarted = new Date().toISOString();
    this.costLogPath = path.join(projectsRoot, projectName, 'cache', 'cost-log.json');
  }

  /** Pre-calculate estimated total cost for a pipeline run. */
  estimateRun(config: VideoConfig): number {
    const mode = config.mode ?? 'video';
    let total = 0;

    if (mode === 'video' || mode === 'full') {
      total += COST_MAP['director']!;

      if (config.script && config.voiceId) {
        total += COST_MAP['elevenlabs']!;
        total += COST_MAP['whisper']!;
      }

      // Resolve video provider from config
      const provider = config.videoProvider
        ?? (config.klingVersion === 'v3' ? 'kling-v3' : 'kling-v2.1');

      const frameCostKey = config.imageProvider === 'gpt-image' ? 'gpt-image-standard' : 'gemini-frame';

      for (const clip of config.clips) {
        total += COST_MAP[frameCostKey]!;

        // Image-only clips don't incur video generation costs
        if (clip.outputType === 'image') continue;

        const dur = (clip.duration ?? 5) > 5;
        let videoKey: string;
        if (provider === 'veo-3.1') {
          videoKey = dur ? 'veo-3.1-8s' : 'veo-3.1-6s';
        } else if (provider === 'veo-3.1-fast') {
          videoKey = dur ? 'veo-3.1-fast-8s' : 'veo-3.1-fast-6s';
        } else if (provider === 'kling-v3') {
          videoKey = dur ? 'kling-v3-10s' : 'kling-v3-5s';
        } else {
          videoKey = dur ? 'kling-10s' : 'kling-5s';
        }
        total += COST_MAP[videoKey]!;
      }
    }

    if (mode === 'brand-images' || mode === 'full') {
      const formats = config.imageFormats ?? ['story', 'square', 'landscape'];
      const sceneCount = config.clips.length;
      total += sceneCount * formats.length * COST_MAP['gemini-brand-image']!;
    }

    return total;
  }

  /** Record that a pipeline step ran (or was cached). */
  logStep(step: string, cached: boolean): void {
    const cost = COST_MAP[step] ?? 0;
    this.entries.push({
      step,
      estimatedCost: cached ? 0 : cost,
      cached,
      timestamp: new Date().toISOString(),
    });

    const savedLabel = cached ? ' (cached — saved)' : '';
    logger.info(`  Cost: ~$${cached ? '0.00' : cost.toFixed(2)} for ${step}${savedLabel}`);
  }

  /** Save the full cost log to disk. */
  async save(): Promise<void> {
    const { totalEstimated, totalSaved } = this.getSummary();
    const log: CostLog = {
      projectName: this.projectName,
      runStarted: this.runStarted,
      entries: this.entries,
      totalEstimated,
      totalSaved,
    };
    await fs.ensureDir(path.dirname(this.costLogPath));
    await fs.outputJson(this.costLogPath, log, { spaces: 2 });
  }

  /** Get summary of costs for JSON output. */
  getSummary(): { totalEstimated: number; totalSaved: number; entries: CostEntry[] } {
    let totalEstimated = 0;
    let totalSaved = 0;
    for (const e of this.entries) {
      const fullCost = COST_MAP[e.step] ?? 0;
      totalEstimated += fullCost;
      if (e.cached) totalSaved += fullCost;
    }
    return { totalEstimated, totalSaved, entries: this.entries };
  }
}
