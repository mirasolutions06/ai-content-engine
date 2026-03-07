import { springTiming, type TransitionPresentation } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { wipe } from '@remotion/transitions/wipe';
import type { TransitionType } from '../../types/index.js';

interface ResolvedTransition {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presentation: TransitionPresentation<any>;
  timing: ReturnType<typeof springTiming>;
}

/**
 * Resolves a config transition type to the correct Remotion presentation + timing.
 * - crossfade: fade() with springTiming for organic feel
 * - wipe: wipe(from-left) with springTiming
 * - cut: returns null (no TransitionSeries.Transition rendered)
 */
export function resolveTransition(type: TransitionType | undefined): ResolvedTransition | null {
  const t = type ?? 'crossfade';

  if (t === 'cut') return null;

  const timing = springTiming({
    config: { damping: 200 },
    durationInFrames: 20,
  });

  if (t === 'wipe') {
    return { presentation: wipe({ direction: 'from-left' }), timing };
  }

  return { presentation: fade(), timing };
}
