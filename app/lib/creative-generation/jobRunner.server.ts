import "server-only";
import { creativeGenerationJobStore } from "./jobStore.server";
import { handleNativeResultGeneration } from "./nativeResultGeneration.server";
import { createNativeContactSheet, writeNativeManifest } from "./nativeCreativeStorage.server";
import { hasExplicitPaidApiAuthorization, type GenerationJob } from "./types";
import { createIdempotentJobRunner, type IdempotentJobRunner } from "./jobRunnerCore";
import { CURRENT_REFERENCE_COPY_POLICY_VERSION, CURRENT_REFERENCE_EDIT_JOB_VERSION, executionResults, hasOrphanedRunningResult, isServerRunnableGenerationJob, migrateActiveJobToPromptVersion, resumeGenerationJob, selectRunnableResults, staleRunningResultIds } from "./jobRunnerPolicy";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";
import { ensureProductAdCopy } from "../ad-copy/adCopyGenerator.server";
import { AD_COPY_PROMPT_VERSION } from "../ad-copy/adCopyPromptBuilder.server";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server";
import { NATIVE_FINAL_PROMPT_VERSION } from "./nativeCreativePrompt";
import { buildReferenceAdaptedCreativePlan, buildReferenceScenes, planReferenceAdaptedCopies, REFERENCE_ADAPTED_PLANNER_VERSION } from "./referenceAdaptedPlanning.server";
import { buildVisualDiversityMatrix } from "./visualDiversity";
import type { NativeAdReference } from "./referenceCreativeLibrary.server";

// 개발 서버 HMR은 globalThis를 보존하므로 고정 키를 쓰면 새 프롬프트 코드가
// 이전 runSafely 콜백을 가진 러너를 재사용할 수 있다. 실제 실행 계약 버전을
// 키에 포함해 이미지/문구/작업 정책 중 하나라도 바뀌면 새 러너를 만들고,
// 구버전 러너가 최신 작업을 다시 이전 버전으로 되돌리는 일을 막는다.
const runnerPolicySignature = [
  CURRENT_REFERENCE_EDIT_JOB_VERSION,
  CURRENT_REFERENCE_COPY_POLICY_VERSION,
  NATIVE_FINAL_PROMPT_VERSION,
].join(":");
const runnerKey = Symbol.for(`daywiz.creative-generation.server-runner:${runnerPolicySignature}`);
const globalRunner = globalThis as typeof globalThis & { [runnerKey]?: IdempotentJobRunner };
// 한 작업은 최대 6장 × 여러 편집·검수 단계를 포함하므로 개별 이미지 turn의
// 40분 hard timeout보다 충분히 길게 둡니다. 목적은 정상 장기 작업 제한이
// 아니라 수일간 남는 유령 Promise가 큐 전체를 막지 않게 하는 것입니다.
const defaultRunnerWatchdogMs = 3 * 60 * 60 * 1000;

function runnerWatchdogMs() {
  const configured = Number(process.env.ADATLAS_CREATIVE_RUNNER_TIMEOUT_MS || defaultRunnerWatchdogMs);
  return Number.isFinite(configured) && configured >= 30 * 60 * 1000 ? configured : defaultRunnerWatchdogMs;
}

const runner = globalRunner[runnerKey] ?? createIdempotentJobRunner(runSafely, 2, {
  executionTimeoutMs: runnerWatchdogMs(),
  onExecutionTimeout: async (jobId) => {
    await creativeGenerationJobStore.update(jobId, (job) => ({
      ...job,
      errors: [...job.errors, "생성 실행의 최종 시간 상한을 넘어 서버 슬롯을 반환했습니다. 저장된 완료 단계부터 자동 복구합니다."].slice(-20),
      recoveryLog: [
        ...(job.recoveryLog || []),
        { at: new Date().toISOString(), message: "무응답 생성 러너 슬롯 자동 반환", resultIds: executionResults(job).filter((result) => result.status === "running").map((result) => result.id) },
      ].slice(-20),
    })).catch(() => undefined);
  },
});
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

/**
 * Node 서버가 재시작되면 메모리 러너는 사라지지만 JSON 작업은 남아 있다.
 * 자동제작 관리 화면을 열어야만 복구되는 의존성을 제거하고, 수동·자동
 * 공통 신규 계약의 미완료 작업을 새 러너에 멱등한 방식으로 재등록한다.
 */
export async function recoverPersistedGenerationJobs(limit = 200) {
  const candidates = await creativeGenerationJobStore.active(limit);
  const recoveredIds: string[] = [];
  for (const candidate of candidates) {
    if (!isServerRunnableGenerationJob(candidate)) continue;
    let job = await recoverGenerationJob(candidate.id);
    if (!job || !["pending", "running"].includes(job.status)) continue;
    const runnerWasActive = isGenerationJobRunnerActive(job.id);
    if (hasOrphanedRunningResult(job, runnerWasActive)) {
      job = await creativeGenerationJobStore.update(job.id, (current) => resumeGenerationJob(current, false));
    }
    if (!isGenerationJobRunnerActive(job.id) && enqueueGenerationJob(job.id)) recoveredIds.push(job.id);
  }
  return recoveredIds;
}

export async function recoverGenerationJob(jobId: string, ignoreRunner = false): Promise<GenerationJob | null> {
  let current = await creativeGenerationJobStore.get(jobId);
  if (current) {
    const migrated = migrateActiveJobToPromptVersion(current, NATIVE_FINAL_PROMPT_VERSION);
    if (migrated !== current) {
      current = await creativeGenerationJobStore.update(jobId, () => migrated);
      await writeNativeManifest(current).catch(() => undefined);
    }
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

/**
 * 작업 생성 HTTP 요청에서는 빠른 scaffold만 저장하고, 실제 최신 문구 기획과
 * 독립 품질 검수는 서버 러너가 이미지 생성 전에 한 번 수행한다. 따라서 수동
 * 버튼은 즉시 작업 ID를 돌려받으면서도 수동·자동 모두 같은 최종 문구를 쓴다.
 */
async function ensureReferenceCopyPlanning(jobId: string) {
  let current = await creativeGenerationJobStore.get(jobId);
  if (!current || !isServerRunnableGenerationJob(current) || current.status === "cancelled") return current;
  if (current.referenceCopyPlanning?.status === "ready") return current;

  current = await creativeGenerationJobStore.update(jobId, (job) => ({
    ...job,
    referenceCopyPlanning: {
      status: "running",
      updatedAt: new Date().toISOString(),
    },
  }));

  const references = current.results.map((result) => result.nativeCreative?.adReference);
  if (
    references.length !== 6 ||
    references.some((reference) => !reference?.publicPath || !reference.sourceFile || !reference.categoryGroup || !reference.categoryLabel || !reference.selectionReason)
  ) {
    throw new Error("최신 문구 기획에 필요한 고정 레퍼런스 6장을 찾지 못했습니다.");
  }
  const verifiedReferences = references as NativeAdReference[];

  try {
    const planning = await planReferenceAdaptedCopies({
      truth: current.productTruth,
      references: verifiedReferences,
    });
    const plannedCreative = buildReferenceAdaptedCreativePlan({
      truth: current.productTruth,
      references: verifiedReferences,
      copyPlans: planning.plans,
      adBrief: current.creativePlan.adBrief,
      testCode: current.creativePlan.testCode,
      provider: planning.provider,
      warnings: planning.warnings,
    });
    const plannedScenes = buildReferenceScenes(
      verifiedReferences,
      planning.plans
    );
    const readyAt = new Date().toISOString();
    current = await creativeGenerationJobStore.update(jobId, (job) => {
      const nextResults = job.results.map((result, index) => {
        const plannedHook = plannedCreative.hookPlans[index];
        const plannedScene = plannedScenes[index];
        const plannedCopy = planning.plans[index];
        return {
          ...result,
          blueprintId: plannedHook.blueprintId,
          hookPlan: {
            ...plannedHook,
            id: result.hookPlan.id,
            hookCode: result.hookPlan.hookCode,
            title: result.hookPlan.title,
          },
          scenePlan: {
            ...plannedScene,
            id: result.scenePlan.id,
            blueprintId: plannedHook.blueprintId,
          },
          referenceAdaptedCopyPlan: {
            ...plannedCopy,
            resultCode: result.hookPlan.hookCode,
          },
        };
      });
      return {
        ...job,
        creativePlan: {
          ...plannedCreative,
          id: job.creativePlan.id,
          brandProfile: job.creativePlan.brandProfile,
          hookPlans: nextResults.map((result) => result.hookPlan),
          createdAt: job.creativePlan.createdAt,
        },
        referenceCopyProfiles: planning.profiles,
        templateRegistryVersion: REFERENCE_ADAPTED_PLANNER_VERSION,
        visualDiversityMatrix: buildVisualDiversityMatrix(nextResults),
        referenceCopyPlanning: {
          status: "ready",
          provider: planning.provider,
          error: planning.warnings.length ? planning.warnings.join(" · ").slice(0, 1000) : undefined,
          updatedAt: readyAt,
        },
        recoveryLog: [
          ...(job.recoveryLog || []),
          { at: readyAt, message: `최신 레퍼런스 문구 기획 완료 (${planning.provider})`, resultIds: nextResults.map((result) => result.id) },
        ].slice(-20),
        results: nextResults,
      };
    });
    await writeNativeManifest(current).catch(() => undefined);
    return current;
  } catch (error) {
    const message = runnerErrorMessage(error);
    // 예상 밖 기획 오류에도 클릭해 둔 6장 제작을 버리지 않는다. 작업 생성 때
    // 저장한 검증 가능한 scaffold를 사용하되 실패 사실을 UI/manifest에 남긴다.
    current = await creativeGenerationJobStore.update(jobId, (job) => ({
      ...job,
      errors: [...job.errors, `최신 문구 기획: ${message}`].slice(-20),
      referenceCopyPlanning: {
        status: "ready",
        provider: "fallback",
        error: message,
        updatedAt: new Date().toISOString(),
      },
    }));
    await writeNativeManifest(current).catch(() => undefined);
    return current;
  }
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
    let recovered = await recoverGenerationJob(jobId, true);
    if (!recovered || recovered.status === "cancelled") return;
    recovered = await ensureReferenceCopyPlanning(jobId);
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
