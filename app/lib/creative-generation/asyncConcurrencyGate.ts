export type AsyncConcurrencyGate = {
  run<T>(task: () => Promise<T>): Promise<T>;
  activeCount(): number;
  pendingCount(): number;
};

export function resolveCodexCreativeParallelLimit(
  env: NodeJS.ProcessEnv = process.env
) {
  const parsed = Number(env.ADATLAS_CODEX_MAX_PARALLEL_RUNS);
  return Math.max(1, Math.min(3, Number.isFinite(parsed) ? Math.floor(parsed) : 3));
}

export function createAsyncConcurrencyGate(limit: number): AsyncConcurrencyGate {
  const maximum = Math.max(1, Math.floor(limit) || 1);
  const queue: Array<() => void> = [];
  let active = 0;

  async function acquire() {
    if (active < maximum) {
      active += 1;
      return;
    }
    await new Promise<void>((resolve) => queue.push(resolve));
  }

  function release() {
    const next = queue.shift();
    if (next) {
      next();
      return;
    }
    active = Math.max(0, active - 1);
  }

  return {
    async run<T>(task: () => Promise<T>) {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
    activeCount: () => active,
    pendingCount: () => queue.length,
  };
}
