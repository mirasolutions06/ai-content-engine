import path from 'path';
import fs from 'fs-extra';
import { logger } from './logger.js';

export interface StepRecord {
  step: string;
  provider?: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  cached: boolean;
  cacheReason?: string;
  estimatedCost: number;
  inputHash?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface RunLog {
  projectName: string;
  runId: string;
  startTime: string;
  endTime?: string;
  totalDurationMs?: number;
  steps: StepRecord[];
  summary: {
    totalCost: number;
    totalSaved: number;
    cacheHitRate: number;
    stepCount: number;
    errorCount: number;
  };
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
  'kling-5s': 0.49,
  'kling-10s': 0.90,
  'kling-v3-5s': 1.12,
  'kling-v3-10s': 2.24,
  'veo-3.1-6s': 4.50,
  'veo-3.1-8s': 6.00,
  'veo-3.1-fast-6s': 2.25,
  'veo-3.1-fast-8s': 3.00,
  'gemini-video-analysis': 0.05,
  'gemini-frame-variation': 0.08,
  'gpt-image-standard': 0.04,
  'gpt-image-hd': 0.08,
  'haiku-image-qa': 0.02,
  'haiku-ref-eval': 0.01,
};

/**
 * Structured run logger — tracks timing, costs, cache hits, and errors per step.
 *
 * Replaces the simpler CostTracker with full observability.
 * Backward-compatible: still tracks costs, but adds duration, provider, cache reasons.
 */
export class RunLogger {
  private steps: StepRecord[] = [];
  private runStartTime: string;
  private runLogPath: string;
  private runId: string;
  private activeStep: { step: string; startTime: number } | null = null;

  constructor(
    private projectName: string,
    projectsRoot: string,
  ) {
    this.runStartTime = new Date().toISOString();
    this.runId = `${new Date().toISOString().replace(/[:.]/g, '-')}`;
    this.runLogPath = path.join(projectsRoot, projectName, 'cache', 'run-log.json');
  }

  /** Begin timing a step. Call endStep() when it completes. */
  startStep(step: string): void {
    this.activeStep = { step, startTime: Date.now() };
  }

  /**
   * Record a completed step.
   * If startStep() was called, duration is calculated automatically.
   * Otherwise, pass the step name and it records as instant.
   */
  endStep(opts: {
    step: string;
    cached: boolean;
    cacheReason?: string;
    provider?: string;
    inputHash?: string;
    error?: string;
    metadata?: Record<string, unknown>;
  }): void {
    const now = Date.now();
    const startTime = this.activeStep?.step === opts.step
      ? this.activeStep.startTime
      : now;

    const cost = COST_MAP[opts.step] ?? 0;

    const record: StepRecord = {
      step: opts.step,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(now).toISOString(),
      durationMs: now - startTime,
      cached: opts.cached,
      estimatedCost: opts.cached ? 0 : cost,
    };
    if (opts.provider) record.provider = opts.provider;
    if (opts.cacheReason) record.cacheReason = opts.cacheReason;
    if (opts.inputHash) record.inputHash = opts.inputHash;
    if (opts.error) record.error = opts.error;
    if (opts.metadata) record.metadata = opts.metadata;

    this.steps.push(record);
    this.activeStep = null;

    // Also log to console (preserves existing CLI behavior)
    const savedLabel = opts.cached ? ` (cached${opts.cacheReason ? ': ' + opts.cacheReason : ''})` : '';
    const costLabel = opts.cached ? '$0.00' : `$${cost.toFixed(2)}`;
    const durationLabel = record.durationMs > 100 ? ` [${(record.durationMs / 1000).toFixed(1)}s]` : '';
    logger.info(`  Cost: ~${costLabel} for ${opts.step}${savedLabel}${durationLabel}`);
  }

  /** Convenience: record a step that was fully cached (no timing needed). */
  logCached(step: string, reason?: string): void {
    const opts: Parameters<RunLogger['endStep']>[0] = { step, cached: true };
    if (reason) opts.cacheReason = reason;
    this.endStep(opts);
  }

  /** Convenience: record a step with timing in one call (for simple steps). */
  async timeStep<T>(
    step: string,
    fn: () => Promise<T>,
    opts?: { provider?: string; inputHash?: string },
  ): Promise<T> {
    this.startStep(step);
    try {
      const result = await fn();
      this.endStep({ step, cached: false, ...opts });
      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.endStep({ step, cached: false, error: errMsg, ...opts });
      throw err;
    }
  }

  /** Get computed summary. */
  getSummary(): RunLog['summary'] {
    let totalCost = 0;
    let totalSaved = 0;
    let cacheHits = 0;
    let errorCount = 0;

    for (const s of this.steps) {
      const fullCost = COST_MAP[s.step] ?? 0;
      if (s.cached) {
        totalSaved += fullCost;
        cacheHits++;
      } else {
        totalCost += s.estimatedCost;
      }
      if (s.error) errorCount++;
    }

    return {
      totalCost,
      totalSaved,
      cacheHitRate: this.steps.length > 0 ? cacheHits / this.steps.length : 0,
      stepCount: this.steps.length,
      errorCount,
    };
  }

  /** Print a CLI summary at end of run. */
  printSummary(): void {
    const s = this.getSummary();
    const totalDuration = this.steps.reduce((sum, step) => sum + step.durationMs, 0);

    logger.info('');
    logger.info('─── Run Summary ───────────────────────────────────────');
    logger.info(`  Steps: ${s.stepCount} (${s.errorCount} errors)`);
    logger.info(`  Cache hit rate: ${(s.cacheHitRate * 100).toFixed(0)}%`);
    logger.info(`  Estimated cost: $${s.totalCost.toFixed(2)} (saved $${s.totalSaved.toFixed(2)} from cache)`);
    logger.info(`  Total time: ${(totalDuration / 1000).toFixed(1)}s`);
    logger.info('──────────────────────────────────────────────────────');
  }

  /** Save full run log to disk. */
  async save(): Promise<void> {
    const now = new Date().toISOString();
    const totalDurationMs = this.steps.reduce((sum, step) => sum + step.durationMs, 0);

    const log: RunLog = {
      projectName: this.projectName,
      runId: this.runId,
      startTime: this.runStartTime,
      endTime: now,
      totalDurationMs,
      steps: this.steps,
      summary: this.getSummary(),
    };

    await fs.ensureDir(path.dirname(this.runLogPath));

    // Append to existing log array, or create new one
    let history: RunLog[] = [];
    if (await fs.pathExists(this.runLogPath)) {
      try {
        history = await fs.readJson(this.runLogPath);
        if (!Array.isArray(history)) history = [history as RunLog];
      } catch {
        history = [];
      }
    }
    history.push(log);

    // Keep last 50 runs
    if (history.length > 50) {
      history = history.slice(-50);
    }

    await fs.outputJson(this.runLogPath, history, { spaces: 2 });
  }

  /** Backward-compatible: pre-calculate estimated total cost for a pipeline run. */
  static estimateRun(config: { mode?: string; script?: string; voiceId?: string; videoProvider?: string; klingVersion?: string; imageProvider?: string; clips: { outputType?: string; duration?: number }[]; imageFormats?: string[] }): number {
    const mode = config.mode ?? 'video';
    let total = 0;

    if (mode === 'video' || mode === 'full') {
      total += COST_MAP['director']!;
      if (config.script && config.voiceId) {
        total += COST_MAP['elevenlabs']!;
        total += COST_MAP['whisper']!;
      }

      const provider = config.videoProvider
        ?? (config.klingVersion === 'v3' ? 'kling-v3' : 'kling-v2.1');
      const frameCostKey = config.imageProvider === 'gpt-image' ? 'gpt-image-standard' : 'gemini-frame';

      for (const clip of config.clips) {
        total += COST_MAP[frameCostKey]!;
        if (clip.outputType === 'image') continue;

        const dur = (clip.duration ?? 5) > 5;
        let videoKey: string;
        if (provider === 'veo-3.1') videoKey = dur ? 'veo-3.1-8s' : 'veo-3.1-6s';
        else if (provider === 'veo-3.1-fast') videoKey = dur ? 'veo-3.1-fast-8s' : 'veo-3.1-fast-6s';
        else if (provider === 'kling-v3') videoKey = dur ? 'kling-v3-10s' : 'kling-v3-5s';
        else videoKey = dur ? 'kling-10s' : 'kling-5s';
        total += COST_MAP[videoKey]!;
      }
    }

    if (mode === 'brand-images' || mode === 'full') {
      const formats = config.imageFormats ?? ['story', 'square', 'landscape'];
      total += config.clips.length * formats.length * COST_MAP['gemini-brand-image']!;
    }

    return total;
  }
}
