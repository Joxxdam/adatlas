export type IdempotentJobRunner = {
  enqueue: (jobId: string, options?: { priority?: boolean }) => boolean;
  cancelQueued: (jobId: string) => boolean;
  isActive: (jobId: string) => boolean;
  wait: (jobId: string) => Promise<void>;
};

export function createIdempotentJobRunner(execute: (jobId: string) => Promise<void>, concurrency = 2): IdempotentJobRunner {
  const jobs = new Map<string, Promise<void>>();
  const queue: Array<{ jobId: string; resolve: () => void; reject: (error: unknown) => void }> = [];
  const limit = Math.max(1, Math.min(2, Math.floor(concurrency) || 2));
  let active = 0;

  function drain() {
    while (active < limit && queue.length) {
      const item = queue.shift()!;
      active += 1;
      void Promise.resolve()
        .then(() => execute(item.jobId))
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          jobs.delete(item.jobId);
          drain();
        });
    }
  }
  return {
    enqueue(jobId, options = {}) {
      if (jobs.has(jobId)) return false;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const running = new Promise<void>((done, failed) => {
        resolve = done;
        reject = failed;
      });
      jobs.set(jobId, running);
      const queued = { jobId, resolve, reject };
      if (options.priority) queue.unshift(queued);
      else queue.push(queued);
      drain();
      return true;
    },
    cancelQueued(jobId) {
      const index = queue.findIndex((item) => item.jobId === jobId);
      if (index < 0) return false;
      const [cancelled] = queue.splice(index, 1);
      jobs.delete(jobId);
      cancelled.resolve();
      return true;
    },
    isActive(jobId) {
      return jobs.has(jobId);
    },
    async wait(jobId) {
      await jobs.get(jobId);
    },
  };
}
