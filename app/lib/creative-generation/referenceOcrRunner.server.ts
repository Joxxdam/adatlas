import "server-only";

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { codexCreativeGate } from "./asyncConcurrencyGate";
import { creativeGenerationJobStore } from "./jobStore.server";
import { nativeReferenceLibraryRepository } from "./nativeReferenceLibraryRepository.server";
import { REFERENCE_NATIVE_COPY_ANALYSIS_VERSION } from "./referenceNativeCopy.server";
import { isApprovedReferenceNativeCopy } from "./referenceLibraryManagement";

export type ReferenceOcrRunStatus = "running" | "completed" | "partial" | "cancelled";

export type ReferenceOcrRun = {
  version: "reference-ocr-run-v1" | "reference-ocr-run-v2-auto-retry";
  id: string;
  status: ReferenceOcrRunStatus;
  targetIds: string[];
  completedIds: string[];
  readyIds: string[];
  reviewIds: string[];
  failedIds: string[];
  currentIds: string[];
  /** 레퍼런스별 전체 OCR 시도 횟수. 과거 v1 실행 파일은 completedIds를 1회로 간주한다. */
  attemptCounts?: Record<string, number>;
  maxAttempts?: number;
  force: boolean;
  errors: Array<{ referenceId: string; message: string }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
  afterCompleteAutoProductionAdvertiserId?: string;
  afterCompleteAutoProductionAdvertiserIds?: string[];
  afterCompleteAutoProductionStartedAt?: string;
  afterCompleteAutoProductionRunId?: string;
  afterCompleteAutoProductionRunIds?: string[];
  afterCompleteAutoProductionError?: string;
};

const runPath = path.resolve(process.cwd(), ".data", "creative-generation", "reference-ocr-run.json");
const storeLockKey = Symbol.for("daywiz.reference-ocr-store-lock-v1");
const runnerKey = Symbol.for("daywiz.reference-ocr-runner-v4-auto-retry-consensus");
const globalStore = globalThis as typeof globalThis & { [storeLockKey]?: Promise<unknown> };
const globalRunner = globalThis as typeof globalThis & { [runnerKey]?: { runId?: string; active?: Promise<void> } };
const runnerState = globalRunner[runnerKey] ?? {};
globalRunner[runnerKey] = runnerState;

async function readRun(): Promise<ReferenceOcrRun | null> {
  try {
    return JSON.parse(await fs.readFile(runPath, "utf8")) as ReferenceOcrRun;
  } catch {
    return null;
  }
}

async function writeRun(run: ReferenceOcrRun) {
  await fs.mkdir(path.dirname(runPath), { recursive: true });
  const temporary = `${runPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await fs.rename(temporary, runPath);
}

async function updateRun(update: (current: ReferenceOcrRun) => ReferenceOcrRun | Promise<ReferenceOcrRun>) {
  const previous = globalStore[storeLockKey] || Promise.resolve();
  const next = previous.then(async () => {
    const current = await readRun();
    if (!current) throw new Error("레퍼런스 OCR 실행 정보를 찾지 못했습니다.");
    const updated = await update(current);
    await writeRun(updated);
    return updated;
  }, async () => {
    const current = await readRun();
    if (!current) throw new Error("레퍼런스 OCR 실행 정보를 찾지 못했습니다.");
    const updated = await update(current);
    await writeRun(updated);
    return updated;
  });
  globalStore[storeLockKey] = next.catch(() => undefined);
  return next;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function resolveMaxAttempts() {
  const parsed = Number(process.env.ADATLAS_REFERENCE_OCR_MAX_ATTEMPTS);
  return Math.max(2, Math.min(5, Number.isFinite(parsed) ? Math.floor(parsed) : 3));
}

function attemptCountFor(run: ReferenceOcrRun, referenceId: string) {
  const recorded = run.attemptCounts?.[referenceId];
  if (Number.isFinite(recorded)) return Math.max(0, Math.floor(recorded!));
  // v1 진행 파일을 이어받을 때 이미 결과가 기록된 항목은 한 번 시도한 것으로 봅니다.
  return run.completedIds.includes(referenceId) ? 1 : 0;
}

function isCurrentApproved(item: ReturnType<typeof nativeReferenceLibraryRepository.list>["items"][number]) {
  return item.nativeCopy?.analysisVersion === REFERENCE_NATIVE_COPY_ANALYSIS_VERSION && isApprovedReferenceNativeCopy(item.nativeCopy);
}

function categoryPriority(categoryGroup: string) {
  if (categoryGroup === "food") return 0;
  if (categoryGroup === "beauty") return 1;
  if (categoryGroup === "fashion") return 2;
  return 3;
}

function prioritizeReferenceIds(ids: string[], items = nativeReferenceLibraryRepository.list().items) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  return ids
    .map((id, index) => ({ id, index, priority: categoryPriority(itemById.get(id)?.categoryGroup || "") }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ id }) => id);
}

function currentPendingIds() {
  const items = nativeReferenceLibraryRepository
    .list()
    .items;
  return prioritizeReferenceIds(
    items.filter((item) => item.nativeCopy?.approvalStatus !== "rejected" && !isCurrentApproved(item)).map((item) => item.id),
    items,
  );
}

async function waitForCreativeJobs(runId: string) {
  while (true) {
    const run = await readRun();
    if (!run || run.id !== runId || run.status !== "running") return false;
    const activeCreativeJobs = await creativeGenerationJobStore.active(50);
    if (!activeCreativeJobs.some((job) => ["pending", "running"].includes(job.status))) return true;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
}

async function startAfterCompleteAutoProduction(runId: string) {
  let advertiserIds: string[] = [];
  await updateRun((current) => {
    const queuedAdvertiserIds = unique([
      ...(current.afterCompleteAutoProductionAdvertiserIds || []),
      ...(current.afterCompleteAutoProductionAdvertiserId ? [current.afterCompleteAutoProductionAdvertiserId] : []),
    ]);
    if (
      current.id !== runId
      || !["completed", "partial"].includes(current.status)
      || !queuedAdvertiserIds.length
      || current.afterCompleteAutoProductionStartedAt
    ) return current;
    advertiserIds = queuedAdvertiserIds;
    return {
      ...current,
      afterCompleteAutoProductionAdvertiserIds: queuedAdvertiserIds,
      afterCompleteAutoProductionStartedAt: new Date().toISOString(),
      afterCompleteAutoProductionError: undefined,
      updatedAt: new Date().toISOString(),
    };
  });
  if (!advertiserIds.length) return;
  try {
    const [{ autoProductionAdvertiserRepository }, { runAutoProductionNow }] = await Promise.all([
      import("../auto-production/advertiserConfig.server"),
      import("../auto-production/scheduler.server"),
    ]);
    const configs = await autoProductionAdvertiserRepository.list();
    for (const advertiserId of advertiserIds) {
      const config = configs.find((candidate) => candidate.advertiserId === advertiserId);
      if (!config) throw new Error(`후속 자동제작 광고주 설정을 찾지 못했습니다: ${advertiserId}`);
      if (!config.enabled) throw new Error(`후속 자동제작 광고주가 비활성화되어 있습니다: ${config.advertiserName}`);
    }
    const productionRunIds: string[] = [];
    // 호출 순서대로 영속 예약 레코드를 만든다. 자동제작 스케줄러는 실행 중인
    // 몰이 끝나기 전 다음 몰을 시작하지 않으므로 이 배열 순서가 실제 처리 순서다.
    for (const advertiserId of advertiserIds) {
      const results = await runAutoProductionNow({ advertiserId, trigger: "manual", force: true });
      const productionRunId = results.find((result) => result.run)?.run?.id;
      if (!productionRunId) throw new Error(`후속 자동제작 실행을 만들지 못했습니다: ${advertiserId}`);
      productionRunIds.push(productionRunId);
    }
    await updateRun((current) => current.id === runId ? {
      ...current,
      afterCompleteAutoProductionRunId: productionRunIds[0],
      afterCompleteAutoProductionRunIds: productionRunIds,
      afterCompleteAutoProductionError: undefined,
      updatedAt: new Date().toISOString(),
    } : current);
  } catch (error) {
    await updateRun((current) => current.id === runId ? {
      ...current,
      afterCompleteAutoProductionStartedAt: undefined,
      afterCompleteAutoProductionError: error instanceof Error ? error.message : "후속 자동제작 실행에 실패했습니다.",
      updatedAt: new Date().toISOString(),
    } : current).catch(() => undefined);
  }
}

function publicStatus(run: ReferenceOcrRun | null) {
  const items = nativeReferenceLibraryRepository.list().items;
  const readyCount = items.filter((item) => item.nativeCopy?.analysisVersion === REFERENCE_NATIVE_COPY_ANALYSIS_VERSION && isApprovedReferenceNativeCopy(item.nativeCopy)).length;
  const reviewCount = items.filter((item) => item.nativeCopy?.analysisVersion === REFERENCE_NATIVE_COPY_ANALYSIS_VERSION && item.nativeCopy?.extractionSource === "codex-local" && !isApprovedReferenceNativeCopy(item.nativeCopy)).length;
  const unavailableCount = items.filter((item) => item.nativeCopy?.analysisVersion === REFERENCE_NATIVE_COPY_ANALYSIS_VERSION && item.nativeCopy?.extractionSource === "unavailable").length;
  const pendingCount = currentPendingIds().length;
  return {
    run,
    counts: {
      totalCount: items.length,
      readyCount,
      reviewCount,
      unavailableCount,
      pendingCount,
    },
    codexGate: {
      activeCount: codexCreativeGate.activeCount(),
      pendingCount: codexCreativeGate.pendingCount(),
    },
  };
}

async function executeRun(runId: string) {
  // 서버 재시작 중 current였던 항목도 저장 완료 여부를 기준으로 다시 잡습니다.
  await updateRun((current) => current.id === runId ? {
    ...current,
    version: "reference-ocr-run-v2-auto-retry",
    currentIds: [],
    maxAttempts: current.maxAttempts || resolveMaxAttempts(),
    updatedAt: new Date().toISOString(),
  } : current);
  while (true) {
    if (!(await waitForCreativeJobs(runId))) return;
    const current = await readRun();
    if (!current || current.id !== runId || current.status !== "running") return;
    const manifestItems = nativeReferenceLibraryRepository.list().items;
    const existingIds = new Set(manifestItems.map((item) => item.id));
    const approvedIds = new Set(manifestItems.filter(isCurrentApproved).map((item) => item.id));
    const maxAttempts = current.maxAttempts || resolveMaxAttempts();
    const batch = prioritizeReferenceIds(current.targetIds, manifestItems)
      .filter((id) => existingIds.has(id) && !approvedIds.has(id) && attemptCountFor(current, id) < maxAttempts)
      .slice(0, 3);
    if (!batch.length) {
      const unresolvedIds = current.targetIds.filter((id) => existingIds.has(id) && !approvedIds.has(id));
      const status = unresolvedIds.length ? "partial" : "completed";
      await updateRun((latest) => latest.id === runId ? {
        ...latest,
        version: "reference-ocr-run-v2-auto-retry",
        status,
        completedIds: unique([...latest.completedIds, ...latest.targetIds.filter((id) => existingIds.has(id))]),
        readyIds: unique([...latest.readyIds, ...latest.targetIds.filter((id) => approvedIds.has(id))]),
        currentIds: [],
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } : latest);
      await startAfterCompleteAutoProduction(runId);
      return;
    }
    await updateRun((latest) => latest.id === runId ? { ...latest, currentIds: batch, updatedAt: new Date().toISOString() } : latest);
    const outcomes = await Promise.all(
      batch.map(async (referenceId) => {
        const previousAttempts = attemptCountFor(current, referenceId);
        try {
          // 같은 분석 버전의 실패·검토 결과도 두 번째 시도부터는 캐시하지 않고 다시 읽습니다.
          const nativeCopy = await nativeReferenceLibraryRepository.extractNativeCopy(referenceId, { force: current.force || previousAttempts > 0 });
          if (isApprovedReferenceNativeCopy(nativeCopy)) return { referenceId, previousAttempts, kind: "ready" as const };
          if (nativeCopy.extractionSource === "codex-local" && nativeCopy.rawLines.some((line) => line.trim())) {
            return { referenceId, previousAttempts, kind: "review" as const, message: nativeCopy.analysisError || "자동 검증 기준을 통과하지 못했습니다." };
          }
          return { referenceId, previousAttempts, kind: "failed" as const, message: nativeCopy.analysisError || "이미지 문구를 읽지 못했습니다." };
        } catch (error) {
          return { referenceId, previousAttempts, kind: "failed" as const, message: error instanceof Error ? error.message : "레퍼런스 OCR에 실패했습니다." };
        }
      })
    );
    await updateRun((latest) => {
      if (latest.id !== runId) return latest;
      let readyIds = [...latest.readyIds];
      let reviewIds = [...latest.reviewIds];
      let failedIds = [...latest.failedIds];
      let completedIds = [...latest.completedIds];
      const attemptCounts = { ...(latest.attemptCounts || {}) };
      let errors = [...latest.errors];
      const maximum = latest.maxAttempts || resolveMaxAttempts();
      for (const outcome of outcomes) {
        const attempts = outcome.previousAttempts + 1;
        attemptCounts[outcome.referenceId] = attempts;
        readyIds = readyIds.filter((id) => id !== outcome.referenceId);
        reviewIds = reviewIds.filter((id) => id !== outcome.referenceId);
        failedIds = failedIds.filter((id) => id !== outcome.referenceId);
        completedIds = completedIds.filter((id) => id !== outcome.referenceId);
        errors = errors.filter((entry) => entry.referenceId !== outcome.referenceId);
        if (outcome.kind === "ready") {
          readyIds.push(outcome.referenceId);
          completedIds.push(outcome.referenceId);
        }
        if (outcome.kind === "review") reviewIds.push(outcome.referenceId);
        if (outcome.kind === "failed") failedIds.push(outcome.referenceId);
        if (outcome.kind !== "ready") {
          errors.push({ referenceId: outcome.referenceId, message: `${outcome.message} (자동 재시도 ${attempts}/${maximum})` });
          if (attempts >= maximum) completedIds.push(outcome.referenceId);
        }
      }
      return {
        ...latest,
        version: "reference-ocr-run-v2-auto-retry",
        completedIds: unique(completedIds),
        readyIds: unique(readyIds),
        reviewIds: unique(reviewIds),
        failedIds: unique(failedIds),
        currentIds: [],
        attemptCounts,
        maxAttempts: maximum,
        errors: errors.slice(-100),
        updatedAt: new Date().toISOString(),
      };
    });
  }
}

export function enqueueReferenceOcrRun(runId: string) {
  if (runnerState.active && runnerState.runId === runId) return;
  runnerState.runId = runId;
  runnerState.active = executeRun(runId)
    .catch(async (error) => {
      await updateRun((current) => current.id === runId ? {
        ...current,
        status: "partial",
        currentIds: [],
        errors: [...current.errors, { referenceId: "runner", message: error instanceof Error ? error.message : "OCR 러너가 중단됐습니다." }].slice(-100),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      } : current).catch(() => undefined);
    })
    .finally(() => {
      if (runnerState.runId === runId) {
        runnerState.runId = undefined;
        runnerState.active = undefined;
      }
    });
}

export async function startReferenceOcrRun(options: { ids?: string[]; retryFailed?: boolean; force?: boolean; afterCompleteAutoProductionAdvertiserId?: string; afterCompleteAutoProductionAdvertiserIds?: string[] } = {}) {
  const existing = await readRun();
  const existingIds = new Set(nativeReferenceLibraryRepository.list().items.map((item) => item.id));
  const requested = options.ids?.length
    ? options.ids
    : options.retryFailed && existing
      ? [...existing.failedIds, ...existing.reviewIds]
      : currentPendingIds();
  const targetIds = unique(requested.filter((id) => existingIds.has(id)));
  const requestedFollowUpIds = unique([
    ...(options.afterCompleteAutoProductionAdvertiserIds || []),
    ...(options.afterCompleteAutoProductionAdvertiserId ? [options.afterCompleteAutoProductionAdvertiserId] : []),
  ].map((id) => id.trim()).filter(Boolean));
  if (existing?.status === "running") {
    const merged = await updateRun((current) => ({
      ...current,
      targetIds: unique([...current.targetIds, ...targetIds]),
      force: current.force || Boolean(options.force),
      afterCompleteAutoProductionAdvertiserId: requestedFollowUpIds[0] || current.afterCompleteAutoProductionAdvertiserId,
      afterCompleteAutoProductionAdvertiserIds: requestedFollowUpIds.length ? requestedFollowUpIds : current.afterCompleteAutoProductionAdvertiserIds,
      afterCompleteAutoProductionStartedAt: requestedFollowUpIds.length ? undefined : current.afterCompleteAutoProductionStartedAt,
      afterCompleteAutoProductionRunId: requestedFollowUpIds.length ? undefined : current.afterCompleteAutoProductionRunId,
      afterCompleteAutoProductionRunIds: requestedFollowUpIds.length ? undefined : current.afterCompleteAutoProductionRunIds,
      afterCompleteAutoProductionError: requestedFollowUpIds.length ? undefined : current.afterCompleteAutoProductionError,
      updatedAt: new Date().toISOString(),
    }));
    enqueueReferenceOcrRun(merged.id);
    return publicStatus(merged);
  }
  const now = new Date().toISOString();
  const run: ReferenceOcrRun = {
    version: "reference-ocr-run-v2-auto-retry",
    id: `reference-ocr-${randomUUID()}`,
    status: targetIds.length ? "running" : "completed",
    targetIds,
    completedIds: [],
    readyIds: [],
    reviewIds: [],
    failedIds: [],
    currentIds: [],
    attemptCounts: {},
    maxAttempts: resolveMaxAttempts(),
    force: Boolean(options.force || options.retryFailed),
    errors: [],
    createdAt: now,
    updatedAt: now,
    completedAt: targetIds.length ? undefined : now,
    afterCompleteAutoProductionAdvertiserId: options.afterCompleteAutoProductionAdvertiserId,
    afterCompleteAutoProductionAdvertiserIds: requestedFollowUpIds,
  };
  await writeRun(run);
  if (targetIds.length) enqueueReferenceOcrRun(run.id);
  return publicStatus(run);
}

export async function getReferenceOcrStatus(options: { resume?: boolean } = {}) {
  const run = await readRun();
  if (options.resume && run?.status === "running") enqueueReferenceOcrRun(run.id);
  if (options.resume && run && ["completed", "partial"].includes(run.status) && (run.afterCompleteAutoProductionAdvertiserIds?.length || run.afterCompleteAutoProductionAdvertiserId) && !run.afterCompleteAutoProductionStartedAt) {
    void startAfterCompleteAutoProduction(run.id);
  }
  return publicStatus(run);
}

export async function cancelReferenceOcrRun() {
  const run = await readRun();
  if (!run || run.status !== "running") return publicStatus(run);
  const cancelled = await updateRun((current) => ({
    ...current,
    status: "cancelled",
    currentIds: [],
    cancelledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
  return publicStatus(cancelled);
}

export async function prioritizeReferenceOcrRun() {
  const run = await readRun();
  if (!run) return publicStatus(run);
  const items = nativeReferenceLibraryRepository.list().items;
  const prioritized = await updateRun((current) => ({
    ...current,
    targetIds: prioritizeReferenceIds(current.targetIds, items),
    updatedAt: new Date().toISOString(),
  }));
  if (prioritized.status === "running") enqueueReferenceOcrRun(prioritized.id);
  return publicStatus(prioritized);
}
