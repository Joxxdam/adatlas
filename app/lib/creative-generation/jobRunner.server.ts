import "server-only";
import { creativeGenerationJobStore } from "./jobStore.server";
import { handleNativeResultGeneration } from "./nativeResultGeneration.server";
import { createNativeContactSheet, writeNativeManifest } from "./nativeCreativeStorage.server";
import { hasExplicitPaidApiAuthorization, type GenerationJob } from "./types";
import { createIdempotentJobRunner, type IdempotentJobRunner } from "./jobRunnerCore";
import { CURRENT_REFERENCE_EDIT_JOB_VERSION, executionResults, isServerRunnableGenerationJob, selectRunnableResults, staleRunningResultIds } from "./jobRunnerPolicy";
import { selectCategoryNativeAdReferences } from "./referenceCreativeLibrary.server";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";
import { ensureProductAdCopy } from "../ad-copy/adCopyGenerator.server";
import { AD_COPY_PROMPT_VERSION } from "../ad-copy/adCopyPromptBuilder.server";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server";

// 실행 함수나 지원 작업 버전이 바뀌면 키도 갱신해 개발 서버 핫리로드가
// 이전 콜백을 가진 전역 러너를 재사용하지 않게 한다.
const runnerKey = Symbol.for("daywiz.creative-generation.server-runner-v13-always-render-copy");
const globalRunner = globalThis as typeof globalThis & { [runnerKey]?: IdempotentJobRunner };
const runner = globalRunner[runnerKey] ?? createIdempotentJobRunner(runSafely);
globalRunner[runnerKey] = runner;

const defaultStaleMs = 12 * 60 * 1000;

function staleAfterMs() {
  const configured = Number(process.env.ADATLAS_CREATIVE_STALE_MS || defaultStaleMs);
  return Number.isFinite(configured) && configured >= 60_000 ? configured : defaultStaleMs;
}

function runnerErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "AI 광고 생성 중 알 수 없는 오류가 발생했습니다.";
  if ((error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) || /(?:operation was aborted|timed?\s*out|timeout)/i.test(message)) {
    return "AI 광고 레퍼런스 편집의 진행 응답이 장시간 없어 중단되었습니다. 저장된 완료 단계부터 자동으로 재시도합니다.";
  }
  return message.replace(/(?:\/Users|[A-Z]:\\)[^\s]+/g, "로컬 파일").slice(0, 600);
}

export function isGenerationJobRunnerActive(jobId: string) {
  return runner.isActive(jobId);
}

export async function recoverGenerationJob(jobId: string, ignoreRunner = false): Promise<GenerationJob | null> {
  let current = await creativeGenerationJobStore.get(jobId);
  const preGenerationCopyBlocks =
    current?.version === CURRENT_REFERENCE_EDIT_JOB_VERSION
      ? current.results.filter(
          (result) =>
            result.status === "quality-review" &&
            !result.imagePath &&
            !result.startedAt &&
            result.attempts === 0 &&
            (result.generationStage || "planned") === "planned" &&
            result.referenceAdaptedCopyPlan?.validationStatus === "invalid"
        )
      : [];
  if (current && preGenerationCopyBlocks.length) {
    const blockedIds = new Set(preGenerationCopyBlocks.map((result) => result.id));
    current = await creativeGenerationJobStore.update(current.id, (job) => ({
      ...job,
      status: "pending",
      completedAt: undefined,
      errors: [...job.errors, "이전 문구 적합성 판정으로 제작 전 중단된 항목을 이미지 생성 대기로 복구했습니다."].slice(-20),
      recoveryLog: [
        ...(job.recoveryLog || []),
        { at: new Date().toISOString(), message: "사전 문구 검증 차단을 해제하고 pending으로 복구", resultIds: [...blockedIds] },
      ].slice(-20),
      results: job.results.map((result) =>
        blockedIds.has(result.id)
          ? { ...result, status: "pending" as const, error: undefined, completedAt: undefined, generationStage: "planned" as const }
          : result
      ),
    }));
  }
  const untouchedRandomJob = Boolean(current && current.version === "generation-job-v11-random-reference-edit" && ["pending", "running"].includes(current.status) && current.results.every((result) => result.status === "pending" && !result.startedAt && !result.nativeCreative?.stagePaths?.structurePath));
  if (current && untouchedRandomJob) {
    const references = selectCategoryNativeAdReferences(current, current.results.length);
    current = await creativeGenerationJobStore.update(current.id, (job) => ({
      ...job,
      version: "generation-job-v12-category-reference-edit",
      recoveryLog: [
        ...(job.recoveryLog || []),
        {
          at: new Date().toISOString(),
          message: "시작 전 v11 작업을 상품군 우선 ZIP 레퍼런스로 재배정",
          resultIds: job.results.map((result) => result.id),
        },
      ].slice(-20),
      results: job.results.map((result, index) => ({
        ...result,
        nativeCreative: result.nativeCreative ? { ...result.nativeCreative, adReference: references[index] } : result.nativeCreative,
      })),
    }));
  }
  if (!current || !isServerRunnableGenerationJob(current) || current.status === "cancelled" || (!ignoreRunner && isGenerationJobRunnerActive(jobId))) return current;
  const staleResults = staleRunningResultIds(current, Date.now(), staleAfterMs(), false);
  if (!staleResults.length) return current;
  const at = new Date().toISOString();
  return creativeGenerationJobStore.update(jobId, (job) => ({
    ...job,
    status: "running",
    completedAt: undefined,
    errors: [...job.errors, "서버 실행이 중단된 생성 항목을 대기 상태로 복구했습니다."].slice(-20),
    recoveryLog: [...(job.recoveryLog || []), { at, message: "stale running 결과를 pending으로 복구", resultIds: staleResults }].slice(-20),
    results: job.results.map((result) =>
      staleResults.includes(result.id)
        ? {
            ...result,
            status: "pending",
            generationStage: "planned",
            error: "개발 서버가 중단되어 이 항목부터 이어서 생성합니다.",
            startedAt: undefined,
          }
        : result
    ),
  }));
}

async function markResultFailed(jobId: string, resultId: string, error: unknown) {
  const message = runnerErrorMessage(error);
  const failed = await creativeGenerationJobStore.update(jobId, (job) => {
    if (job.status === "cancelled") {
      return {
        ...job,
        results: job.results.map((result) =>
          result.id === resultId && result.status === "running"
            ? {
                ...result,
                status: "cancelled",
                error: undefined,
                completedAt: new Date().toISOString(),
              }
            : result
        ),
      };
    }
    return {
      ...job,
      errors: [...job.errors, message].slice(-20),
      results: job.results.map((result) =>
        result.id === resultId
          ? {
              ...result,
              status: "failed",
              generationStage: result.generationStage || "planned",
              error: message,
              completedAt: new Date().toISOString(),
            }
          : result
      ),
    };
  });
  if (failed.engine) await writeNativeManifest(failed).catch(() => undefined);
}

async function validateCompletedReferenceGroup(jobId: string) {
  const current = await creativeGenerationJobStore.get(jobId);
  if (!current || current.groupValidation || executionResults(current).length !== 6) return;
  if (!executionResults(current).every((result) => ["success", "approved"].includes(result.status) && Boolean(result.nativeCreative?.finalPath))) return;
  try {
    const contactSheetPath = await createNativeContactSheet(current);
    const provider = createCreativeGenerationProvider(current.engine || "codex_local", {
      explicitPaidApiAuthorization: hasExplicitPaidApiAuthorization(current.paidApiAuthorization),
    });
    const groupValidation = await provider.validateGroup({ job: current, contactSheetPath });
    const passed = groupValidation.recommendation === "approve";
    const updated = await creativeGenerationJobStore.update(jobId, (job) => ({
      ...job,
      groupValidation,
      results: job.results.map((result) => ({
        ...result,
        nativeCreative: result.nativeCreative
          ? {
              ...result.nativeCreative,
              provenance: result.nativeCreative.provenance
                ? { ...result.nativeCreative.provenance, groupDiversityQa: passed ? "passed" : "manual-review" }
                : result.nativeCreative.provenance,
            }
          : result.nativeCreative,
      })),
    }));
    await writeNativeManifest(updated).catch(() => undefined);
  } catch (error) {
    const message = runnerErrorMessage(error);
    const updated = await creativeGenerationJobStore.update(jobId, (job) => ({
      ...job,
      errors: [...job.errors, `6장 묶음 검수: ${message}`].slice(-20),
    }));
    await writeNativeManifest(updated).catch(() => undefined);
  }
}

export async function runGenerationJob(jobId: string) {
  const attempted = new Set<string>();
  while (true) {
    let job = await creativeGenerationJobStore.get(jobId);
    if (!job || !isServerRunnableGenerationJob(job) || job.status === "cancelled") return;
    const configuredConcurrency = resolveFastCreativeRuntime().concurrency;
    if (job.concurrency !== configuredConcurrency) {
      job = await creativeGenerationJobStore.update(job.id, (current) => ({
        ...current,
        concurrency: configuredConcurrency,
      }));
    }
    const batch = selectRunnableResults(job, attempted, configuredConcurrency);
    if (!batch.length) {
      const hasRetryableWork = executionResults(job).some(
        (result) => result.status === "pending" || (result.status === "failed" && result.attempts <= Math.max(0, job.retryLimit))
      );
      if (hasRetryableWork && attempted.size) {
        attempted.clear();
        continue;
      }
      return;
    }
    batch.forEach((result) => attempted.add(result.id));
    await Promise.all(
      batch.map(async (next) => {
        try {
          await handleNativeResultGeneration({
            jobId,
            resultId: next.id,
            requestId: `server-runner:${jobId}:${next.id}:${next.attempts + 1}`,
            // Automatic retries resume valid structure/product/copy checkpoints.
            // Full regeneration is reserved for an explicit user action.
            action: "generate",
            feedback: next.userFeedback,
          });
        } catch (error) {
          await markResultFailed(jobId, next.id, error);
        }
      })
    );
    await validateCompletedReferenceGroup(jobId);
  }
}

async function runSafely(jobId: string) {
  try {
    const recovered = await recoverGenerationJob(jobId, true);
    if (!recovered || recovered.status === "cancelled") return;
    // 상품당 한 번 만드는 Meta 기본 문구·광고 제목은 완성 이미지를 기다리지
    // 않는다. ProductTruth와 이미 준비된 대표 후킹으로 즉시 시작하고, 이미지
    // 6장 서버 작업과 병렬로 저장한다.
    const copyTask =
      !recovered.adCopy || recovered.adCopy.status === "generating" || recovered.adCopy.promptVersion !== AD_COPY_PROMPT_VERSION
        ? ensureProductAdCopy(jobId)
        : Promise.resolve(recovered);
    const generationTask = runGenerationJob(jobId);
    const [copyOutcome, generationOutcome] = await Promise.allSettled([copyTask, generationTask]);
    if (copyOutcome.status === "rejected") {
      const copyMessage = runnerErrorMessage(copyOutcome.reason);
      await creativeGenerationJobStore.update(jobId, (job) => ({ ...job, errors: [...job.errors, `광고문구 생성: ${copyMessage}`].slice(-20) })).catch(() => undefined);
    }
    if (generationOutcome.status === "rejected") throw generationOutcome.reason;
  } catch (error) {
    const message = runnerErrorMessage(error);
    await creativeGenerationJobStore.update(jobId, (job) => ({ ...job, errors: [...job.errors, message].slice(-20) })).catch(() => undefined);
  }
}

export function enqueueGenerationJob(jobId: string, options: { priority?: boolean } = {}) {
  return runner.enqueue(jobId, options);
}

export function cancelQueuedGenerationJob(jobId: string) {
  return runner.cancelQueued(jobId);
}

export async function waitForGenerationJobForTests(jobId: string) {
  await runner.wait(jobId);
}
