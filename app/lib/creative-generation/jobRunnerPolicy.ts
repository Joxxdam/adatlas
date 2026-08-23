import type { GenerationJob, GenerationResult } from "./types";

export const terminalGenerationResultStatuses = new Set<GenerationResult["status"]>(["success", "failed", "korean-review", "product-review", "quality-review", "group-review", "approved", "excluded"]);

export const failedGenerationResultStatuses = new Set<GenerationResult["status"]>(["failed", "korean-review", "product-review", "quality-review", "group-review"]);
export const CURRENT_AUTO_PRODUCTION_JOB_VERSION = "generation-job-v13-reference-first-adapted-copy";
export const CURRENT_AUTO_PRODUCTION_PIPELINE = "reference-first-adapted-copy";

export function normalizeCreativeProductUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    [...url.searchParams.keys()].filter((key) => /^utm_|^(?:fbclid|gclid)$/i.test(key)).forEach((key) => url.searchParams.delete(key));
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/$/, "");
  }
}

export function isServerRunnableGenerationJob(job: GenerationJob) {
  const compatible = Boolean(job.engine && ["generation-job-v6-ai-native-final", "generation-job-v7-fast-local-composition", "generation-job-v8-adaptive-reference-grammar", "generation-job-v9-ai-native-complete-ad", "generation-job-v10-staged-reference-edit", "generation-job-v11-random-reference-edit", "generation-job-v12-category-reference-edit", CURRENT_AUTO_PRODUCTION_JOB_VERSION].includes(job.version) && job.results.length === 6);
  if (!compatible) return false;
  // 과거 수동 작업은 조회·수정 호환을 유지하지만 자동제작은 구형 4장 경로나
  // 레퍼런스 없는 작업을 절대 복구하지 않는다.
  return job.sourceType !== "auto-production" || isCurrentAutoProductionGenerationJob(job);
}

export function isCurrentAutoProductionGenerationJob(job: GenerationJob) {
  if (job.sourceType !== "auto-production" || job.version !== CURRENT_AUTO_PRODUCTION_JOB_VERSION || job.pipeline !== CURRENT_AUTO_PRODUCTION_PIPELINE || job.results.length !== 6) return false;
  const requested = job.executionResultIds || [];
  const resultIds = new Set(job.results.map((result) => result.id));
  const references = job.results.map((result) => result.nativeCreative?.adReference?.id).filter(Boolean);
  return requested.length === 6 && new Set(requested).size === 6 && requested.every((id) => resultIds.has(id)) && references.length === 6 && new Set(references).size === 6;
}

export function executionResults(job: GenerationJob) {
  const requested = job.executionResultIds?.length ? new Set(job.executionResultIds) : null;
  return requested ? job.results.filter((result) => requested.has(result.id)) : job.results;
}

/**
 * 제작 화면에서 복원할 수 있는 작업은 실제로 아직 진행할 결과가 남은 작업뿐입니다.
 * 완료·부분 완료·실패 이력은 JSON 저장소와 아카이브에는 남지만 제작 UI로 되돌리지 않습니다.
 */
export function isRestorableGenerationJob(job: GenerationJob) {
  return Boolean(["pending", "running"].includes(job.status) && executionResults(job).some((result) => ["pending", "running"].includes(result.status)));
}

export function selectRunnableResult(job: GenerationJob, attempted: ReadonlySet<string>): GenerationResult | undefined {
  if (job.status === "cancelled" || !isServerRunnableGenerationJob(job)) return undefined;
  return executionResults(job).find((result) => !attempted.has(result.id) && (result.status === "pending" || (result.status === "failed" && result.attempts <= Math.max(0, job.retryLimit))));
}

export function selectRunnableResults(job: GenerationJob, attempted: ReadonlySet<string>, limit = job.concurrency): GenerationResult[] {
  if (job.status === "cancelled" || !isServerRunnableGenerationJob(job)) return [];
  const maximum = Math.max(1, Math.min(3, Math.floor(limit) || 1));
  return executionResults(job)
    .filter((result) => !attempted.has(result.id) && (result.status === "pending" || (result.status === "failed" && result.attempts <= Math.max(0, job.retryLimit))))
    .slice(0, maximum);
}

export function cancelGenerationJob(job: GenerationJob, now = new Date().toISOString()): GenerationJob {
  return {
    ...job,
    status: "cancelled",
    cancelledAt: now,
    results: job.results.map((result) => (result.status === "pending" ? { ...result, status: "cancelled" } : result)),
  };
}

export function resumeGenerationJob(job: GenerationJob, runnerActive: boolean, now = new Date().toISOString()): GenerationJob {
  return {
    ...job,
    status: "running",
    cancelledAt: undefined,
    completedAt: undefined,
    startedAt: job.startedAt || now,
    results: job.results.map((result) => (result.status === "cancelled" || result.status === "failed" || (result.status === "running" && !runnerActive) ? { ...result, status: "pending", error: undefined, startedAt: undefined } : result)),
  };
}

export function hasOrphanedRunningResult(job: GenerationJob, runnerActive: boolean) {
  return Boolean(!runnerActive && job.status !== "cancelled" && executionResults(job).some((result) => result.status === "running"));
}

export function staleRunningResultIds(job: GenerationJob, nowMs: number, staleMs: number, runnerActive: boolean) {
  if (runnerActive || job.status === "cancelled") return [];
  if (nowMs - new Date(job.updatedAt).getTime() < staleMs) return [];
  return executionResults(job)
    .filter((result) => result.status === "running")
    .map((result) => result.id);
}
