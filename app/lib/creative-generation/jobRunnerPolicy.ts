import type { GenerationJob, GenerationResult } from "./types";

export function isServerRunnableGenerationJob(job: GenerationJob) {
  return Boolean(
    job.engine &&
    job.version === "generation-job-v6-ai-native-final" &&
    job.results.length === 6
  );
}

export function selectRunnableResult(job: GenerationJob, attempted: ReadonlySet<string>): GenerationResult | undefined {
  if (job.status === "cancelled" || !isServerRunnableGenerationJob(job)) return undefined;
  return job.results.find(
    (result) =>
      !attempted.has(result.id) &&
      (result.status === "pending" ||
        (result.status === "failed" && result.attempts <= Math.max(0, job.retryLimit)))
  );
}

export function cancelGenerationJob(job: GenerationJob, now = new Date().toISOString()): GenerationJob {
  return {
    ...job,
    status: "cancelled",
    cancelledAt: now,
    results: job.results.map((result) =>
      result.status === "pending" ? { ...result, status: "cancelled" } : result
    ),
  };
}

export function resumeGenerationJob(job: GenerationJob, runnerActive: boolean, now = new Date().toISOString()): GenerationJob {
  return {
    ...job,
    status: "running",
    cancelledAt: undefined,
    completedAt: undefined,
    startedAt: job.startedAt || now,
    results: job.results.map((result) =>
      result.status === "cancelled" ||
      result.status === "failed" ||
      (result.status === "running" && !runnerActive)
        ? { ...result, status: "pending", error: undefined, startedAt: undefined }
        : result
    ),
  };
}

export function staleRunningResultIds(job: GenerationJob, nowMs: number, staleMs: number, runnerActive: boolean) {
  if (runnerActive || job.status === "cancelled") return [];
  if (nowMs - new Date(job.updatedAt).getTime() < staleMs) return [];
  return job.results.filter((result) => result.status === "running").map((result) => result.id);
}
