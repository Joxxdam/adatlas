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
  version: "reference-ocr-run-v1";
  id: string;
  status: ReferenceOcrRunStatus;
  targetIds: string[];
  completedIds: string[];
  readyIds: string[];
  reviewIds: string[];
  failedIds: string[];
  currentIds: string[];
  force: boolean;
  errors: Array<{ referenceId: string; message: string }>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
};

const runPath = path.resolve(process.cwd(), ".data", "creative-generation", "reference-ocr-run.json");
const storeLockKey = Symbol.for("daywiz.reference-ocr-store-lock-v1");
const runnerKey = Symbol.for("daywiz.reference-ocr-runner-v1");
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

function currentPendingIds() {
  return nativeReferenceLibraryRepository
    .list()
    .items.filter((item) => item.nativeCopy?.approvalStatus !== "rejected" && item.nativeCopy?.analysisVersion !== REFERENCE_NATIVE_COPY_ANALYSIS_VERSION)
    .map((item) => item.id);
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

function publicStatus(run: ReferenceOcrRun | null) {
  const items = nativeReferenceLibraryRepository.list().items;
  const readyCount = items.filter((item) => isApprovedReferenceNativeCopy(item.nativeCopy)).length;
  const reviewCount = items.filter((item) => item.nativeCopy?.extractionSource === "codex-local" && !isApprovedReferenceNativeCopy(item.nativeCopy)).length;
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
  await updateRun((current) => current.id === runId ? { ...current, currentIds: [], updatedAt: new Date().toISOString() } : current);
  while (true) {
    if (!(await waitForCreativeJobs(runId))) return;
    const current = await readRun();
    if (!current || current.id !== runId || current.status !== "running") return;
    const completed = new Set(current.completedIds);
    const existingIds = new Set(nativeReferenceLibraryRepository.list().items.map((item) => item.id));
    const batch = current.targetIds.filter((id) => existingIds.has(id) && !completed.has(id)).slice(0, 3);
    if (!batch.length) {
      const status = current.failedIds.length || current.reviewIds.length ? "partial" : "completed";
      await updateRun((latest) => latest.id === runId ? { ...latest, status, currentIds: [], completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : latest);
      return;
    }
    await updateRun((latest) => latest.id === runId ? { ...latest, currentIds: batch, updatedAt: new Date().toISOString() } : latest);
    const outcomes = await Promise.all(
      batch.map(async (referenceId) => {
        try {
          const nativeCopy = await nativeReferenceLibraryRepository.extractNativeCopy(referenceId, { force: current.force });
          if (isApprovedReferenceNativeCopy(nativeCopy)) return { referenceId, kind: "ready" as const };
          if (nativeCopy.extractionSource === "codex-local" && nativeCopy.rawLines.some((line) => line.trim())) {
            return { referenceId, kind: "review" as const, message: nativeCopy.analysisError || "자동 검증 기준을 통과하지 못했습니다." };
          }
          return { referenceId, kind: "failed" as const, message: nativeCopy.analysisError || "이미지 문구를 읽지 못했습니다." };
        } catch (error) {
          return { referenceId, kind: "failed" as const, message: error instanceof Error ? error.message : "레퍼런스 OCR에 실패했습니다." };
        }
      })
    );
    await updateRun((latest) => {
      if (latest.id !== runId) return latest;
      const readyIds = [...latest.readyIds];
      const reviewIds = [...latest.reviewIds];
      const failedIds = [...latest.failedIds];
      const errors = [...latest.errors];
      for (const outcome of outcomes) {
        if (outcome.kind === "ready") readyIds.push(outcome.referenceId);
        if (outcome.kind === "review") reviewIds.push(outcome.referenceId);
        if (outcome.kind === "failed") failedIds.push(outcome.referenceId);
        if (outcome.kind !== "ready") errors.push({ referenceId: outcome.referenceId, message: outcome.message });
      }
      return {
        ...latest,
        completedIds: unique([...latest.completedIds, ...outcomes.map((outcome) => outcome.referenceId)]),
        readyIds: unique(readyIds),
        reviewIds: unique(reviewIds),
        failedIds: unique(failedIds),
        currentIds: [],
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

export async function startReferenceOcrRun(options: { ids?: string[]; retryFailed?: boolean; force?: boolean } = {}) {
  const existing = await readRun();
  const existingIds = new Set(nativeReferenceLibraryRepository.list().items.map((item) => item.id));
  const requested = options.ids?.length
    ? options.ids
    : options.retryFailed && existing
      ? [...existing.failedIds, ...existing.reviewIds]
      : currentPendingIds();
  const targetIds = unique(requested.filter((id) => existingIds.has(id)));
  if (existing?.status === "running") {
    const merged = await updateRun((current) => ({
      ...current,
      targetIds: unique([...current.targetIds, ...targetIds]),
      force: current.force || Boolean(options.force),
      updatedAt: new Date().toISOString(),
    }));
    enqueueReferenceOcrRun(merged.id);
    return publicStatus(merged);
  }
  const now = new Date().toISOString();
  const run: ReferenceOcrRun = {
    version: "reference-ocr-run-v1",
    id: `reference-ocr-${randomUUID()}`,
    status: targetIds.length ? "running" : "completed",
    targetIds,
    completedIds: [],
    readyIds: [],
    reviewIds: [],
    failedIds: [],
    currentIds: [],
    force: Boolean(options.force || options.retryFailed),
    errors: [],
    createdAt: now,
    updatedAt: now,
    completedAt: targetIds.length ? undefined : now,
  };
  await writeRun(run);
  if (targetIds.length) enqueueReferenceOcrRun(run.id);
  return publicStatus(run);
}

export async function getReferenceOcrStatus(options: { resume?: boolean } = {}) {
  const run = await readRun();
  if (options.resume && run?.status === "running") enqueueReferenceOcrRun(run.id);
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
