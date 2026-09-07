import "server-only";
import { creativeGenerationJobStore } from "./jobStore.server";
import { handleNativeResultGeneration } from "./nativeResultGeneration.server";
import { writeNativeManifest } from "./nativeCreativeStorage.server";
import type { GenerationJob, ManualGenerationQueueInfo } from "./types";
import { createIdempotentJobRunner, type IdempotentJobRunner } from "./jobRunnerCore";
import { executionResults, hasOrphanedRunningResult, isDefaultCodexGenerationJob, isServerRunnableGenerationJob, resumeGenerationJob, selectRunnableResults, staleRunningResultIds } from "./jobRunnerPolicy";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";
import { DEFAULT_CODEX_GENERATION_PROMPT_VERSION } from "./codexDirectTest";

// 개발 서버 HMR은 globalThis를 보존하므로 고정 키를 쓰면 새 프롬프트 코드가
// 이전 runSafely 콜백을 가진 러너를 재사용할 수 있다. 실제 실행 계약 버전을
// 키에 포함해 이미지/문구/작업 정책 중 하나라도 바뀌면 새 러너를 만들고,
// 구버전 러너가 최신 작업을 다시 이전 버전으로 되돌리는 일을 막는다.
const runnerPolicySignature = DEFAULT_CODEX_GENERATION_PROMPT_VERSION;
const runnerKey = Symbol.for(`daywiz.creative-generation.server-runner:${runnerPolicySignature}:manual-fifo-v1`);
const globalRunner = globalThis as typeof globalThis & { [runnerKey]?: IdempotentJobRunner };
const manualQueueClockKey = Symbol.for("daywiz.creative-generation.manual-queue-clock-v1");
const queueClockGlobal = globalThis as typeof globalThis & {
  [manualQueueClockKey]?: { millisecond: number; offset: number };
};
const manualQueueClock = queueClockGlobal[manualQueueClockKey] ?? { millisecond: 0, offset: 0 };
queueClockGlobal[manualQueueClockKey] = manualQueueClock;
// 한 작업은 서로 다른 Codex 세션으로 광고 6장을 생성하므로 개별 이미지 turn의
// hard timeout보다 충분히 길게 둡니다. 목적은 정상 장기 작업 제한이
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
    return "Codex 광고 생성의 진행 응답이 장시간 없어 중단되었습니다. 완료된 이미지는 유지하고 해당 소재만 자동으로 재시도합니다.";
  }
  return message.replace(/(?:\/Users|[A-Z]:\\)[^\s]+/g, "로컬 파일").slice(0, 600);
}

export function isGenerationJobRunnerActive(jobId: string) {
  return runner.isActive(jobId);
}

export function createManualGenerationQueueMetadata(now = Date.now()) {
  if (manualQueueClock.millisecond === now) manualQueueClock.offset += 1;
  else {
    manualQueueClock.millisecond = now;
    manualQueueClock.offset = 0;
  }
  return {
    requestedAt: new Date(now).toISOString(),
    sequence: now * 1_000 + manualQueueClock.offset,
  };
}

function manualQueueSequence(job: GenerationJob) {
  return job.manualQueue?.sequence ?? new Date(job.createdAt).getTime() * 1_000;
}

function queueRecoveryOrder(left: GenerationJob, right: GenerationJob) {
  const leftPriority = left.sourceType === "auto-production" ? 1 : 0;
  const rightPriority = right.sourceType === "auto-production" ? 1 : 0;
  return leftPriority - rightPriority || manualQueueSequence(left) - manualQueueSequence(right) || left.id.localeCompare(right.id);
}

export async function getManualGenerationQueueSnapshot() {
  const activeJobs = (await creativeGenerationJobStore.active(500))
    .filter((job) => job.sourceType !== "auto-production" && isServerRunnableGenerationJob(job) && ["pending", "running"].includes(job.status))
    .sort(queueRecoveryOrder);
  const runnerSnapshot = runner.snapshot();
  const runningIds = new Set(runnerSnapshot.running.map((entry) => entry.jobId));
  const waitingJobs = activeJobs.filter((job) => !runningIds.has(job.id));
  const runningCount = activeJobs.length - waitingJobs.length;
  const byJobId: Record<string, ManualGenerationQueueInfo> = {};
  activeJobs.forEach((job, index) => {
    const running = runningIds.has(job.id);
    const waitingIndex = running ? -1 : waitingJobs.findIndex((candidate) => candidate.id === job.id);
    byJobId[job.id] = {
      state: running ? "running" : "waiting",
      waitingPosition: waitingIndex >= 0 ? waitingIndex + 1 : undefined,
      aheadCount: index,
      totalCount: activeJobs.length,
      runningCount,
      requestedAt: job.manualQueue?.requestedAt || job.createdAt,
    };
  });
  return { byJobId, totalCount: activeJobs.length, runningCount, waitingCount: waitingJobs.length };
}

/**
 * Node 서버가 재시작되면 메모리 러너는 사라지지만 JSON 작업은 남아 있다.
 * 자동제작 관리 화면을 열어야만 복구되는 의존성을 제거하고, 수동·자동
 * 공통 신규 계약의 미완료 작업을 새 러너에 멱등한 방식으로 재등록한다.
 */
export async function recoverPersistedGenerationJobs(limit = 200) {
  const candidates = (await creativeGenerationJobStore.active(limit)).sort(queueRecoveryOrder);
  const recoveredIds: string[] = [];
  for (const candidate of candidates) {
    if (!isServerRunnableGenerationJob(candidate)) continue;
    let job = await recoverGenerationJob(candidate.id);
    if (!job || !["pending", "running"].includes(job.status)) continue;
    const runnerWasActive = isGenerationJobRunnerActive(job.id);
    if (hasOrphanedRunningResult(job, runnerWasActive)) {
      job = await creativeGenerationJobStore.update(job.id, (current) => resumeGenerationJob(current, false));
    }
    if (!isGenerationJobRunnerActive(job.id) && enqueueGenerationJob(job.id, { priority: job.sourceType !== "auto-production" })) recoveredIds.push(job.id);
  }
  return recoveredIds;
}

export async function recoverGenerationJob(jobId: string, ignoreRunner = false): Promise<GenerationJob | null> {
  const current = await creativeGenerationJobStore.get(jobId);
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
    const target = job.results.find((result) => result.id === resultId);
    // 생성 함수가 이미 실패 상태와 공개용 오류를 기록했다면 같은 오류를
    // 두 번 누적하지 않는다. 여기서는 생성 시작 전 예외만 보완한다.
    if (target?.status === "failed") return job;
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
      const scopedResults = executionResults(job);
      if (scopedResults.length && scopedResults.every((result) => !["pending", "running"].includes(result.status))) {
        const successCount = scopedResults.filter((result) => ["success", "approved"].includes(result.status)).length;
        const finalized = await creativeGenerationJobStore.update(job.id, (current) => ({
          ...current,
          status: successCount === scopedResults.length ? "completed" : successCount > 0 ? "partial" : "failed",
          completedAt: new Date().toISOString(),
          timing: { ...current.timing, totalMs: Date.now() - new Date(current.createdAt).getTime() },
        }));
        await writeNativeManifest(finalized).catch(() => undefined);
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
            // 자동 재시도도 같은 고정 레퍼런스·상품·참고 이미지·프롬프트를
            // 새 세션에 다시 전달하며, 다른 제작 방식으로 전환하지 않습니다.
            action: "generate",
            feedback: next.userFeedback,
          });
        } catch (error) {
          await markResultFailed(jobId, next.id, error);
        }
      })
    );
  }
}

async function runSafely(jobId: string) {
  try {
    const recovered = await recoverGenerationJob(jobId, true);
    if (!recovered || recovered.status === "cancelled") return;
    if (!isDefaultCodexGenerationJob(recovered)) return;
    await runGenerationJob(jobId);
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
