export type IdempotentJobRunner = {
  enqueue: (jobId: string) => boolean;
  isActive: (jobId: string) => boolean;
  wait: (jobId: string) => Promise<void>;
};

export function createIdempotentJobRunner(execute: (jobId: string) => Promise<void>): IdempotentJobRunner {
  const jobs = new Map<string, Promise<void>>();
  return {
    enqueue(jobId) {
      if (jobs.has(jobId)) return false;
      const running = Promise.resolve()
        .then(() => execute(jobId))
        .finally(() => {
          if (jobs.get(jobId) === running) jobs.delete(jobId);
        });
      jobs.set(jobId, running);
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
