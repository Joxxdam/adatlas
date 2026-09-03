import type { GenerationJob, GenerationResult } from "./types";
import { hasCurrentImageCreativePremiseSet } from "./imageCreativePremise.ts";

export const terminalGenerationResultStatuses = new Set<GenerationResult["status"]>(["success", "failed", "korean-review", "product-review", "quality-review", "group-review", "approved", "excluded"]);

export const failedGenerationResultStatuses = new Set<GenerationResult["status"]>(["failed", "korean-review", "product-review", "quality-review", "group-review"]);
/**
 * 수동·자동 제작이 함께 사용하는 유일한 신규 제작 계약입니다.
 * AUTO 별칭은 저장된 자동제작 코드와 테스트의 하위 호환을 위해 유지합니다.
 */
export const CURRENT_REFERENCE_COPY_POLICY_VERSION = "reference-native-copy-adapter-v29-everyday-reference-rhetoric";
export const CURRENT_REFERENCE_EDIT_JOB_VERSION = "generation-job-v17-deferred-copy-zero-overlay";
export const CURRENT_REFERENCE_EDIT_PIPELINE = "reference-first-adapted-copy";
export const CURRENT_REFERENCE_EDIT_WORKFLOW = "reference-lock-product-then-copy" as const;
export const REFERENCE_EDIT_STAGE_ORDER = ["reference-copy", "product-replacement", "copy-replacement", "qa-repair"] as const;
export const CURRENT_AUTO_PRODUCTION_JOB_VERSION = CURRENT_REFERENCE_EDIT_JOB_VERSION;
export const CURRENT_AUTO_PRODUCTION_PIPELINE = CURRENT_REFERENCE_EDIT_PIPELINE;

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
  // 과거 작업은 아카이브 조회·다운로드만 허용한다. 재개·개별 재생성까지
  // 허용하면 이전 프롬프트/문구 정책이 다시 실행되어 품질이 회귀할 수 있다.
  return isCurrentReferenceEditGenerationJob(job);
}

export function usesCurrentReferenceEditPipeline(job: Pick<GenerationJob, "version" | "pipeline">) {
  return job.version === CURRENT_REFERENCE_EDIT_JOB_VERSION && job.pipeline === CURRENT_REFERENCE_EDIT_PIPELINE;
}

/** 새 수동·자동 작업은 작업 생성 시 서로 다른 레퍼런스 6장을 고정합니다. */
export function isCurrentReferenceEditGenerationJob(job: GenerationJob) {
  if (
    !usesCurrentReferenceEditPipeline(job) ||
    job.copyPlanMode !== "reference-adapted" ||
    job.templateRegistryVersion !== CURRENT_REFERENCE_COPY_POLICY_VERSION ||
    job.results.length !== 6
  ) return false;
  const references = job.results.map((result) => result.nativeCreative?.adReference?.id).filter(Boolean);
  const premisesAreCurrent = hasCurrentImageCreativePremiseSet(job.results.map((result) => result.referenceAdaptedCopyPlan?.creativePremise));
  return references.length === 6 && new Set(references).size === 6 && premisesAreCurrent;
}

export function assertCurrentReferenceEditGenerationJob(job: GenerationJob) {
  if (!isCurrentReferenceEditGenerationJob(job)) {
    throw new Error("레퍼런스 원본 → 상품 교체 → 문구 교체 공통 제작 계약과 고정 레퍼런스 6장을 확인해 주세요.");
  }
  return job;
}

export function isCurrentAutoProductionGenerationJob(job: GenerationJob) {
  if (job.sourceType !== "auto-production" || !isCurrentReferenceEditGenerationJob(job)) return false;
  const requested = job.executionResultIds || [];
  const resultIds = new Set(job.results.map((result) => result.id));
  return requested.length === 6 && new Set(requested).size === 6 && requested.every((id) => resultIds.has(id));
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

/**
 * A dev-server reload can happen after one or more results finished with an
 * older prompt while the rest of the six-image job is still active.  Reset
 * only those outdated results so manual and auto-production jobs cannot finish
 * as a mixed-policy set.  Old files stay on disk as history; active pointers
 * are cleared and regenerated by the common runner.
 */
export function migrateActiveJobToPromptVersion(job: GenerationJob, promptVersion: string, now = new Date().toISOString()): GenerationJob {
  if (!usesCurrentReferenceEditPipeline(job) || !["pending", "running"].includes(job.status)) return job;
  const scopedIds = new Set(executionResults(job).map((result) => result.id));
  const outdatedIds = new Set(
    job.results
      .filter((result) => scopedIds.has(result.id) && result.nativeCreative?.promptVersion !== promptVersion)
      .map((result) => result.id)
  );
  if (!outdatedIds.size) return job;
  return {
    ...job,
    status: "pending",
    completedAt: undefined,
    groupValidation: undefined,
    recoveryLog: [
      ...(job.recoveryLog || []),
      { at: now, message: `구버전 이미지 결과를 최신 공통 프롬프트 ${promptVersion} 대기로 전환`, resultIds: [...outdatedIds] },
    ].slice(-20),
    results: job.results.map((result) => {
      if (!outdatedIds.has(result.id)) return result;
      const previousFinal = result.nativeCreative?.finalPath;
      return {
        ...result,
        status: "pending",
        generationStage: "planned",
        attempts: 0,
        error: undefined,
        startedAt: undefined,
        completedAt: undefined,
        imagePath: undefined,
        downloadName: undefined,
        creativeAsset: undefined,
        deliveryBranding: undefined,
        durationMs: undefined,
        nativeCreative: result.nativeCreative
          ? {
              ...result.nativeCreative,
              promptVersion,
              stagePaths: undefined,
              referencePaths: [],
              originalPath: undefined,
              finalPath: undefined,
              validation: undefined,
              export: undefined,
              timing: undefined,
              revisionPaths: previousFinal
                ? [...new Set([...(result.nativeCreative.revisionPaths || []), previousFinal])]
                : result.nativeCreative.revisionPaths || [],
            }
          : result.nativeCreative,
      };
    }),
  };
}
