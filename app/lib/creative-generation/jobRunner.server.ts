import "server-only";
import { creativeGenerationJobStore } from "./jobStore.server";
import { handleNativeResultGeneration } from "./nativeResultGeneration.server";
import { writeNativeManifest } from "./nativeCreativeStorage.server";
import type { GenerationJob } from "./types";
import { createIdempotentJobRunner, type IdempotentJobRunner } from "./jobRunnerCore";
import { executionResults, isServerRunnableGenerationJob, selectRunnableResults, staleRunningResultIds } from "./jobRunnerPolicy";
import { selectCategoryNativeAdReferences } from "./referenceCreativeLibrary.server";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";

// 실행 함수나 지원 작업 버전이 바뀌면 키도 갱신해 개발 서버 핫리로드가
// 이전 콜백을 가진 전역 러너를 재사용하지 않게 한다.
const runnerKey = Symbol.for("daywiz.creative-generation.server-runner-v4-quality-throughput");
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
  if (
    (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) ||
    /(?:operation was aborted|timed?\s*out|timeout)/i.test(message)
  ) {
    return "AI 광고 레퍼런스 편집이 제한시간을 초과했습니다. 해당 카드의 ‘다시 만들기’로 재시도해 주세요.";
  }
  return message.replace(/(?:\/Users|[A-Z]:\\)[^\s]+/g, "로컬 파일").slice(0, 600);
}

export function isGenerationJobRunnerActive(jobId: string) {
  return runner.isActive(jobId);
}

export async function recoverGenerationJob(jobId: string, ignoreRunner = false): Promise<GenerationJob | null> {
  let current = await creativeGenerationJobStore.get(jobId);
  const untouchedRandomJob = Boolean(
    current &&
    current.version === "generation-job-v11-random-reference-edit" &&
    ["pending", "running"].includes(current.status) &&
    current.results.every(
      (result) =>
        result.status === "pending" &&
        !result.startedAt &&
        !result.nativeCreative?.stagePaths?.structurePath
    )
  );
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
        nativeCreative: result.nativeCreative
          ? { ...result.nativeCreative, adReference: references[index] }
          : result.nativeCreative,
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
    recoveryLog: [
      ...(job.recoveryLog || []),
      { at, message: "stale running 결과를 pending으로 복구", resultIds: staleResults },
    ].slice(-20),
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
  const failed = await creativeGenerationJobStore.update(jobId, (job) => ({
    ...job,
    errors: [...job.errors, message].slice(-20),
    results: job.results.map((result) =>
      result.id === resultId
        ? {
            ...result,
            status: "failed",
            generationStage: "quality-check",
            error: message,
            completedAt: new Date().toISOString(),
          }
        : result
    ),
  }));
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
      if (executionResults(job).some((result) => result.status === "pending") && attempted.size) {
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
            action: next.attempts > 0 ? "regenerate" : "generate",
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
    await runGenerationJob(jobId);
  } catch (error) {
    const message = runnerErrorMessage(error);
    await creativeGenerationJobStore
      .update(jobId, (job) => ({ ...job, errors: [...job.errors, message].slice(-20) }))
      .catch(() => undefined);
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
