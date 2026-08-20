export type IdempotentJobRunner = {
  enqueue: (jobId: string) => boolean;
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
    enqueue(jobId) {
      if (jobs.has(jobId)) return false;
      let resolve!: () => void;
      let reject!: (error: unknown) => void;
      const running = new Promise<void>((done, failed) => {
        resolve = done;
        reject = failed;
      });
      jobs.set(jobId, running);
      queue.push({ jobId, resolve, reject });
      drain();
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
