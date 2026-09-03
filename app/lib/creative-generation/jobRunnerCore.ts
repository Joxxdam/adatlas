export type IdempotentJobRunner = {
  enqueue: (jobId: string, options?: { priority?: boolean }) => boolean;
  cancelQueued: (jobId: string) => boolean;
  isActive: (jobId: string) => boolean;
  wait: (jobId: string) => Promise<void>;
};

export type IdempotentJobRunnerOptions = {
  /** 실행 함수가 응답하지 않아도 큐 슬롯을 영구 점유하지 않게 하는 최종 상한입니다. */
  executionTimeoutMs?: number;
  onExecutionTimeout?: (jobId: string) => void | Promise<void>;
};

export function createIdempotentJobRunner(execute: (jobId: string) => Promise<void>, concurrency = 2, options: IdempotentJobRunnerOptions = {}): IdempotentJobRunner {
  const jobs = new Map<string, Promise<void>>();
  const queue: Array<{ jobId: string; resolve: () => void; reject: (error: unknown) => void }> = [];
  const limit = Math.max(1, Math.min(2, Math.floor(concurrency) || 2));
  let active = 0;

  async function executeWithWatchdog(jobId: string) {
    const timeoutMs = Number(options.executionTimeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return execute(jobId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const execution = Promise.resolve().then(() => execute(jobId));
    // timeout이 먼저 끝난 뒤 원래 실행이 늦게 실패해도 unhandled rejection을
    // 만들지 않는다. 저장 단계의 멱등성과 결과 lock이 중복 쓰기를 방지한다.
    void execution.catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`작업 ${jobId}이 ${Math.round(timeoutMs / 1000)}초 동안 완료되지 않아 실행 슬롯을 반환했습니다.`);
        error.name = "TimeoutError";
        reject(error);
      }, timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([execution, timeout]);
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") await options.onExecutionTimeout?.(jobId);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function drain() {
    while (active < limit && queue.length) {
      const item = queue.shift()!;
      active += 1;
      void Promise.resolve()
        .then(() => executeWithWatchdog(item.jobId))
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
      // 서버 호출자는 enqueue 결과만 사용하고 wait하지 않는 경우가 대부분이다.
      // 실행 오류는 wait 호출에는 그대로 전달하되 프로세스 전역의 미처리
      // rejection으로 개발 서버가 불안정해지지는 않게 한다.
      void running.catch(() => undefined);
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
