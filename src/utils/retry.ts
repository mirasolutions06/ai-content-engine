import { logger } from './logger.js';

/**
 * Retries an async function with exponential backoff.
 *
 * @param fn - Async function to retry
 * @param opts - Configuration: max attempts, base delay, label for logging
 * @returns The result of the first successful call
 * @throws The error from the final failed attempt
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const { attempts = 3, delayMs = 3000, label = 'operation' } = opts;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts) throw err;

      const wait = delayMs * Math.pow(2, i - 1);
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.warn(`${label} failed (attempt ${i}/${attempts}): ${errMsg}. Retrying in ${wait}ms...`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  // TypeScript: unreachable, but satisfies the compiler
  throw new Error('retryWithBackoff: unreachable');
}
