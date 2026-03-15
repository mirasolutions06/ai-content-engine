/**
 * Execute async tasks in parallel with a concurrency limit.
 *
 * Unlike Promise.all (which starts all tasks immediately), this queues
 * tasks and runs at most `concurrency` at a time. When a task completes,
 * the next in queue starts.
 *
 * @param tasks - Array of async factory functions
 * @param concurrency - Maximum concurrent executions (default: 3)
 * @returns Results in the same order as the input tasks
 */
export async function parallelWithLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number = 3,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length) as T[];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      const task = tasks[index];
      if (!task) continue;
      results[index] = await task();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );

  await Promise.all(workers);
  return results;
}
