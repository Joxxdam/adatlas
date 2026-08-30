import "server-only";
import { randomUUID } from "node:crypto";
import { createNativeGenerationJob } from "../creative-generation/createNativeGenerationJob.server";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { enqueueGenerationJob, recoverGenerationJob } from "../creative-generation/jobRunner.server";
import { CURRENT_AUTO_PRODUCTION_JOB_VERSION, CURRENT_AUTO_PRODUCTION_PIPELINE, executionResults, isCurrentAutoProductionGenerationJob } from "../creative-generation/jobRunnerPolicy";
import type { GenerationJob, HookMessageCode } from "../creative-generation/types";
import { autoProductionAdvertiserRepository } from "./advertiserConfig.server";
import { recentTasks } from "./duplicateGuard";
import { allHookCodes, hookHypothesesFromJob, resultIdsForHookCodes } from "./hookSelector";
import { AUTO_PRODUCTION_CREATIVES_PER_PRODUCT, AUTO_PRODUCTION_MANUAL_QUEUE_LIMIT } from "./policy";
import { enrichAutoProductionCandidateFromLandingPage, loadAutoProductionCandidates } from "./productSource.server";
import { selectAutoProductionCandidates } from "./productSelector";
import { autoProductionRepository } from "./productionRepository.server";
import { nextScheduledAt, scheduledRunKey, seoulClock } from "./schedule";
import { createAutoProductionTaskId } from "./taskIdentity";
import { candidateIdentityKeys } from "./productIdentity";
import { buildAutoProductionPackage } from "./package.server";
import type { AutoProductionAdvertiserConfig, AutoProductionPreview, AutoProductionProductTask, AutoProductionResult, AutoProductionRun } from "./types";

const monitorKey = Symbol.for("daywiz.auto-production.monitors-v2-current-contract");
const globalState = globalThis as typeof globalThis & { [monitorKey]?: Map<string, Promise<void>> };
const monitors = globalState[monitorKey] ?? new Map<string, Promise<void>>();
globalState[monitorKey] = monitors;
const processingStatuses = ["selecting-products", "analyzing-products", "generating-hooks", "queued", "generating-creatives"];
const terminalProductStatuses = new Set(["completed", "failed", "cancelled", "skipped-duplicate", "skipped-insufficient-data", "skipped-unavailable"]);

class AutoProductionRunCancelledError extends Error {
  constructor() {
    super("자동 제작 실행이 취소되었습니다.");
    this.name = "AutoProductionRunCancelledError";
  }
}

function isCancellationError(error: unknown) {
  return error instanceof AutoProductionRunCancelledError;
}

async function ensureRunActive(runId: string) {
  const current = await autoProductionRepository.get(runId);
  if (!current || current.status === "cancelled") throw new AutoProductionRunCancelledError();
  return current;
}

async function cancelPreparedGenerationJob(jobId: string) {
  await creativeGenerationJobStore.update(jobId, (job) => ({
    ...job,
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    results: job.results.map((result) =>
      ["pending", "running"].includes(result.status) ? { ...result, status: "cancelled" as const, error: undefined } : result
    ),
  })).catch(() => undefined);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeMessage(error: unknown, fallback: string) {
  return (error instanceof Error ? error.message : fallback).replace(/(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s]+/g, "로컬 파일").slice(0, 500);
}

function productTask(runId: string, candidate: Awaited<ReturnType<typeof loadAutoProductionCandidates>>["candidates"][number]): AutoProductionProductTask {
  const now = new Date().toISOString();
  return {
    id: createAutoProductionTaskId(runId, candidate.id),
    candidate,
    status: "selected",
    selectedRole: candidate.recommendationRole,
    selectedReason: candidate.recommendationReason,
    hookHypotheses: [],
    results: [],
    createdAt: now,
    updatedAt: now,
  };
}

function adBrief(config: AutoProductionAdvertiserConfig, task: AutoProductionProductTask) {
  const product = task.candidate.productInfo;
  return {
    productName: product.productName,
    category: product.category,
    price: product.price,
    originalPrice: product.originalPrice,
    discountInfo: product.discountInfo,
    mainBenefit: product.mainBenefit,
    targetCustomer: product.targetCustomer,
    landingUrl: product.landingUrl,
    adObjective: config.adObjective,
    creativeIntensity: "performance" as const,
    mandatoryInfo: [],
    prohibitedClaims: ["확인되지 않은 가격·수량·후기·효과를 생성하지 않기"],
  };
}

function resultsFromJob(job: GenerationJob): AutoProductionResult[] {
  const scoped = new Set(job.executionResultIds || job.results.map((result) => result.id));
  return job.results
    .filter((result) => scoped.has(result.id))
    .map((result) => ({
      generationResultId: result.id,
      hookCode: result.hookPlan.hookCode as HookMessageCode,
      status: result.status,
      imageUrl: result.imagePath,
      downloadUrl: result.imagePath ? `/api/creative-generation/jobs/${job.id}/results/${result.id}/download` : undefined,
      assetCode: result.creativeAsset?.assetCode,
      adName: result.creativeAsset?.recommendedAdName,
      utm: result.creativeAsset?.utmContent,
      createdAt: result.completedAt,
    }));
}

export async function previewAutoProduction(config: AutoProductionAdvertiserConfig, now = new Date()): Promise<AutoProductionPreview> {
  const source = await loadAutoProductionCandidates(config);
  const runs = await autoProductionRepository.list({ advertiserId: config.advertiserId, limit: 100 });
  const recent = recentTasks(runs, config.advertiserId, config.productCooldownDays, now).filter((task) => task.status === "completed");
  const recentFamilies = recentTasks(runs, config.advertiserId, config.productFamilyCooldownDays, now).filter((task) => task.status === "completed");
  const recentIds = new Set(recent.flatMap((task) => [task.candidate.id, task.candidate.externalId || "", ...candidateIdentityKeys(task.candidate).filter((key) => !key.startsWith("family:"))]).filter(Boolean));
  for (const task of recentFamilies) {
    for (const key of candidateIdentityKeys(task.candidate)) if (key.startsWith("family:")) recentIds.add(key);
  }
  // 사용자가 화면에서 확정한 예정 상품은 입력 순서와 구성을 그대로 유지한다.
  // 확정 목록이 없을 때만 성과·중복 방지 정책으로 자동 후보를 선정한다.
  const candidates = config.adminProductUrls.length
    ? source.candidates.slice(0, AUTO_PRODUCTION_MANUAL_QUEUE_LIMIT)
    : selectAutoProductionCandidates(source.candidates, config, recentIds);
  const imageWarnings = source.candidates.filter((candidate) => candidate.imageVerificationStatus && candidate.imageVerificationStatus !== "verified").map((candidate) => `${candidate.productName}: 상품 이미지 확인 필요 · ${candidate.imageVerificationReasons?.[0] || "정확한 판매 구성 이미지를 확인하지 못했습니다."}`);
  const expectedImages = candidates.length * AUTO_PRODUCTION_CREATIVES_PER_PRODUCT;
  return {
    advertiserId: config.advertiserId,
    advertiserName: config.advertiserName,
    source: candidates[0]?.source || "none",
    fallbackUsed: source.fallbackUsed,
    fallbackReason: source.fallbackReason,
    expectedImages: config.adminProductUrls.length ? expectedImages : Math.min(config.maxImagesPerRun, expectedImages),
    candidates,
    warnings: [...source.warnings, ...imageWarnings],
  };
}

function runRecord(config: AutoProductionAdvertiserConfig, trigger: AutoProductionRun["trigger"], now: Date): AutoProductionRun {
  const timestamp = now.toISOString();
  const date = seoulClock(now).date;
  return {
    id: `auto-run-${randomUUID()}`,
    runKey: scheduledRunKey(config, now),
    trigger,
    businessDate: date,
    advertiserId: config.advertiserId,
    advertiserName: config.advertiserName,
    status: "scheduled",
    fallbackUsed: false,
    automaticExpectedImages: 0,
    expectedImages: 0,
    completedImages: 0,
    failedImages: 0,
    packageStatus: "pending",
    tasks: [],
    warnings: [],
    errors: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function directRunRecord(config: AutoProductionAdvertiserConfig, now: Date): AutoProductionRun {
  return {
    ...runRecord(config, "manual", now),
    runKey: `${seoulClock(now).date}:direct-product:${randomUUID()}`,
    startedAt: now.toISOString(),
  };
}

async function prepareTask(run: AutoProductionRun, config: AutoProductionAdvertiserConfig, task: AutoProductionProductTask) {
  await ensureRunActive(run.id);
  const analyzingRun = await autoProductionRepository.update(run.id, (current) =>
    current.status === "cancelled"
      ? current
      : { ...current, status: "generating-hooks", tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, status: "analyzing", updatedAt: new Date().toISOString() } : item)) }
  );
  if (analyzingRun.status === "cancelled") throw new AutoProductionRunCancelledError();
  let productionCandidate = task.candidate;
  const productUrl = task.candidate.productUrl || task.candidate.canonicalProductUrl || task.candidate.productInfo.landingUrl;
  if (productUrl) {
    try {
      productionCandidate = await enrichAutoProductionCandidateFromLandingPage(config, task.candidate);
      await autoProductionRepository.update(run.id, (current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, candidate: productionCandidate, updatedAt: new Date().toISOString() } : item)),
      }));
    } catch (error) {
      await autoProductionRepository.update(run.id, (current) => ({
        ...current,
        warnings: [...current.warnings, `상품 상세 OCR 갱신 실패로 기존 검증 정보로 계속합니다: ${error instanceof Error ? error.message : "랜딩페이지 분석 실패"}`].slice(-30),
      }));
    }
  }
  const productionTask = { ...task, candidate: productionCandidate };
  const job = await createNativeGenerationJob(
    {
      product: productionCandidate.productInfo,
      productImagePaths: productionCandidate.productInfo.productImagePaths,
      selectedAdImages: productionCandidate.productInfo.productImagePaths,
      source: "landing-page",
      adBrief: adBrief(config, productionTask),
      engine: "codex_local",
    },
    {
      autoStart: false,
      sourceType: "auto-production",
      autoProductionRunId: run.id,
      autoProductionTaskId: task.id,
    }
  );
  try {
    await ensureRunActive(run.id);
  } catch (error) {
    await cancelPreparedGenerationJob(job.id);
    throw error;
  }
  const hooks = hookHypothesesFromJob(job);
  const executionResultIds = job.results.map((result) => result.id);
  const assignedReferences = job.results.map((result) => result.nativeCreative?.adReference?.id).filter(Boolean);
  if (job.version !== CURRENT_AUTO_PRODUCTION_JOB_VERSION || job.pipeline !== CURRENT_AUTO_PRODUCTION_PIPELINE || executionResultIds.length !== AUTO_PRODUCTION_CREATIVES_PER_PRODUCT || new Set(executionResultIds).size !== AUTO_PRODUCTION_CREATIVES_PER_PRODUCT || assignedReferences.length !== AUTO_PRODUCTION_CREATIVES_PER_PRODUCT || new Set(assignedReferences).size !== AUTO_PRODUCTION_CREATIVES_PER_PRODUCT) {
    await creativeGenerationJobStore.update(job.id, (current) => ({
      ...current,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      errors: [...current.errors, "최신 자동제작 6장 계약을 충족하지 않아 실행을 차단했습니다."].slice(-20),
      results: current.results.map((result) => (result.status === "pending" ? { ...result, status: "cancelled" as const } : result)),
    }));
    throw new Error("자동제작은 최신 공통 레퍼런스 편집 경로와 서로 다른 카테고리 레퍼런스 6장이 모두 준비된 경우에만 실행합니다.");
  }
  const queuedJob = await creativeGenerationJobStore.update(job.id, (current) => ({
    ...current,
    executionResultIds,
    representativeResultId: executionResultIds[0],
    status: "pending",
  }));
  if (!isCurrentAutoProductionGenerationJob(queuedJob)) {
    throw new Error("자동제작 작업의 공통 레퍼런스 편집·6장 실행 계약 검증에 실패했습니다.");
  }
  let registered = false;
  await autoProductionRepository.update(run.id, (current) => {
    if (current.status === "cancelled") return current;
    registered = true;
    return {
      ...current,
      status: "queued",
      tasks: current.tasks.map((item) =>
        item.id === task.id
          ? {
              ...item,
              status: "queued",
              hookHypotheses: hooks,
              generationJobId: queuedJob.id,
              results: resultsFromJob(queuedJob),
              updatedAt: new Date().toISOString(),
            }
          : item
      ),
    };
  });
  if (!registered) {
    await cancelPreparedGenerationJob(queuedJob.id);
    throw new AutoProductionRunCancelledError();
  }
  try {
    await ensureRunActive(run.id);
  } catch (error) {
    await cancelPreparedGenerationJob(queuedJob.id);
    throw error;
  }
  enqueueGenerationJob(queuedJob.id);
}

export async function runAutoProductionForProduct(config: AutoProductionAdvertiserConfig, candidate: AutoProductionProductTask["candidate"], options: { now?: Date } = {}) {
  const now = options.now || new Date();
  const initial = directRunRecord(config, now);
  const created = await autoProductionRepository.createUnique(initial);
  if (!created.run) return { run: null, created: false };
  const task = productTask(initial.id, candidate);
  let run = await autoProductionRepository.update(initial.id, (current) => ({
    ...current,
    status: "analyzing-products",
    dataSourceUsed: "admin",
    automaticExpectedImages: 0,
    expectedImages: AUTO_PRODUCTION_CREATIVES_PER_PRODUCT,
    tasks: [task],
  }));
  try {
    await prepareTask(run, config, task);
    run = await autoProductionRepository.update(initial.id, (current) => ({
      ...current,
      status: current.status === "cancelled" ? "cancelled" : "generating-creatives",
    }));
    if (run.status === "cancelled") return { run, created: true };
    ensureAutoProductionRunMonitor(run.id);
    return { run, created: true };
  } catch (error) {
    if (isCancellationError(error)) {
      const cancelled = await autoProductionRepository.get(initial.id);
      return { run: cancelled ?? initial, created: true };
    }
    const message = safeMessage(error, "상품 광고 준비에 실패했습니다.");
    const failed = await autoProductionRepository.update(initial.id, (current) => ({
      ...current,
      status: "failed",
      errors: [...current.errors, message],
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, status: "failed", error: message, updatedAt: new Date().toISOString() } : item)),
      completedAt: new Date().toISOString(),
    }));
    return { run: failed, created: true };
  }
}

export async function scheduleAutoProductionForAdvertiser(config: AutoProductionAdvertiserConfig, options: { trigger?: AutoProductionRun["trigger"]; now?: Date } = {}) {
  const now = options.now || new Date();
  const initial = runRecord(config, options.trigger || "scheduled", now);
  const created = await autoProductionRepository.createUnique(initial);
  // 사용자가 명시한 수동 재실행은 같은 날 취소된 예약의 runKey에 막히지 않는다.
  // 완료·진행 중 실행은 그대로 중복 방지하고, 취소 기록만 보존한 채 새 대기열을 만든다.
  if (options.trigger === "manual" && !created.created && created.run?.status === "cancelled") {
    return autoProductionRepository.createUnique({
      ...initial,
      id: `auto-run-${randomUUID()}`,
      runKey: `${initial.runKey}:manual-retry:${randomUUID()}`,
    });
  }
  return created;
}

export async function startScheduledAutoProductionRun(runId: string, config: AutoProductionAdvertiserConfig, options: { now?: Date } = {}) {
  const now = options.now || new Date();
  let claimed = false;
  const initial = await autoProductionRepository.update(runId, (run) => {
    if (run.status !== "scheduled") return run;
    claimed = true;
    return { ...run, status: "selecting-products", startedAt: now.toISOString() };
  });
  if (!claimed) return { run: initial, started: false };
  try {
    const settings = await autoProductionAdvertiserRepository.settings();
    const alreadyReserved = await autoProductionRepository.reservedImageCount(initial.businessDate);
    const remainingDaily = Math.max(0, settings.maxImagesPerDay - alreadyReserved);
    if (!remainingDaily) {
      const skipped = await autoProductionRepository.update(initial.id, (run) => ({ ...run, status: "skipped", completedAt: new Date().toISOString(), warnings: [...run.warnings, "오늘의 자동 제작 이미지 한도에 도달해 실행하지 않았습니다."] }));
      return { run: skipped, started: true };
    }
    const preview = await previewAutoProduction(config, now);
    const plannedRunQuota = config.adminProductUrls.length
      ? Math.min(config.adminProductUrls.length, AUTO_PRODUCTION_MANUAL_QUEUE_LIMIT) * AUTO_PRODUCTION_CREATIVES_PER_PRODUCT
      : config.maxImagesPerRun;
    const runQuota = Math.min(remainingDaily, plannedRunQuota);
    let selectedExpectedImages = 0;
    const selected = preview.candidates.filter(() => {
      const count = AUTO_PRODUCTION_CREATIVES_PER_PRODUCT;
      if (selectedExpectedImages + count > runQuota) return false;
      selectedExpectedImages += count;
      return true;
    });
    const tasks = selected.map((candidate) => productTask(initial.id, candidate));
    const automaticExpectedImages = selectedExpectedImages;
    let run = await autoProductionRepository.update(initial.id, (current) => ({
      ...current,
      status: selected.length ? "analyzing-products" : "skipped",
      dataSourceUsed: preview.source === "none" ? undefined : preview.source,
      fallbackUsed: preview.fallbackUsed,
      fallbackReason: preview.fallbackReason,
      automaticExpectedImages,
      expectedImages: automaticExpectedImages,
      tasks,
      warnings: [...current.warnings, ...preview.warnings, ...(selected.length ? [] : ["제작 가능한 상품 후보가 없어 실행하지 않았습니다."])],
      completedAt: selected.length ? undefined : new Date().toISOString(),
    }));
    if (!selected.length) return { run, started: true };
    for (const task of tasks) {
      const current = await autoProductionRepository.get(run.id);
      if (!current || current.status === "cancelled") break;
      try {
        await prepareTask(run, config, task);
      } catch (error) {
        if (isCancellationError(error)) break;
        const message = safeMessage(error, "상품 광고 준비에 실패했습니다.");
        await autoProductionRepository.update(run.id, (current) => ({
          ...current,
          errors: [...current.errors, message],
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, status: /이미지|상품정보|후킹/.test(message) ? "skipped-insufficient-data" : "failed", error: message, updatedAt: new Date().toISOString() } : item)),
        }));
      }
    }
    run = await autoProductionRepository.update(run.id, (current) => ({
      ...current,
      status: current.status === "cancelled" ? "cancelled" : current.tasks.some((task) => task.generationJobId) ? "generating-creatives" : current.tasks.some((task) => task.status === "failed") ? "failed" : "skipped",
      completedAt: current.status === "cancelled" ? current.completedAt : current.tasks.some((task) => task.generationJobId) ? undefined : new Date().toISOString(),
    }));
    await autoProductionAdvertiserRepository.update(config.advertiserId, { lastRunAt: now.toISOString(), nextRunAt: nextScheduledAt(config, now) });
    if (run.status === "generating-creatives") ensureAutoProductionRunMonitor(run.id);
    return { run, started: true };
  } catch (error) {
    if (isCancellationError(error)) {
      const cancelled = await autoProductionRepository.get(initial.id);
      return { run: cancelled ?? initial, started: true };
    }
    const message = safeMessage(error, "자동 제작 실행에 실패했습니다.");
    const failed = await autoProductionRepository.update(initial.id, (run) => ({ ...run, status: "failed", errors: [...run.errors, message], completedAt: new Date().toISOString() }));
    return { run: failed, started: true };
  }
}

export async function runAutoProductionForAdvertiser(config: AutoProductionAdvertiserConfig, options: { trigger?: AutoProductionRun["trigger"]; now?: Date } = {}) {
  const now = options.now || new Date();
  const created = await scheduleAutoProductionForAdvertiser(config, { trigger: options.trigger || "manual", now });
  if (!created.created || !created.run) return { run: created.run, created: false };
  const started = await startScheduledAutoProductionRun(created.run.id, config, { now });
  return { run: started.run, created: true };
}

export async function syncAutoProductionRun(runId: string) {
  const run = await autoProductionRepository.get(runId);
  if (!run) return null;
  // 취소된 실행은 연결된 작업의 늦은 완료/동기화 결과로 되살리지 않습니다.
  // 취소 직전에 running이던 결과가 남아 있어도 run 상태가 사용자 의도보다 우선합니다.
  if (run.status === "cancelled") return run;
  const tasks = await Promise.all(
    run.tasks.map(async (task) => {
      if (!task.generationJobId || (terminalProductStatuses.has(task.status) && task.adCopy && task.adCopy.status !== "generating")) return task;
      const job = await creativeGenerationJobStore.get(task.generationJobId);
      if (!job) return { ...task, status: "failed" as const, error: "연결된 광고 생성 작업을 찾지 못했습니다.", updatedAt: new Date().toISOString() };
      if (job.status === "cancelled") {
        return {
          ...task,
          status: "cancelled" as const,
          results: resultsFromJob(job),
          adCopy: job.adCopy,
          error: undefined,
          updatedAt: new Date().toISOString(),
        };
      }
      const scoped = executionResults(job);
      const generated = scoped.filter((result) => Boolean(result.imagePath)).length;
      const failed = scoped.filter((result) => result.status === "failed" && !result.imagePath).length;
      const imagePending = scoped.some((result) => ["pending", "running"].includes(result.status));
      // 상품 설명 문구는 러너가 상품당 한 번 별도로 생성한다. 문구 생성 지연이나
      // 내부 진단은 이미 만들어진 광고 이미지의 완료·다운로드를 막지 않는다.
      const pending = imagePending;
      return {
        ...task,
        status: pending ? (scoped.some((result) => result.status === "running") ? ("generating" as const) : ("queued" as const)) : generated ? ("completed" as const) : failed ? ("failed" as const) : task.status,
        results: resultsFromJob(job),
        adCopy: job.adCopy,
        error: failed && !generated ? scoped.find((result) => result.error)?.error : task.error,
        updatedAt: new Date().toISOString(),
      };
    })
  );
  const completedImages = tasks.flatMap((task) => task.results).filter((result) => Boolean(result.imageUrl)).length;
  const failedImages = tasks.flatMap((task) => task.results).filter((result) => result.status === "failed" && !result.imageUrl).length;
  const allTerminal = tasks.every((task) => terminalProductStatuses.has(task.status));
  const status = allTerminal ? (completedImages && failedImages ? "partial" : completedImages ? "completed" : tasks.every((task) => task.status.startsWith("skipped")) ? "skipped" : "failed") : "generating-creatives";
  let updated = await autoProductionRepository.update(runId, (current) => ({
    ...current,
    tasks,
    completedImages,
    failedImages,
    status,
    packageStatus: allTerminal && completedImages > 0 && current.packageImageCount === completedImages ? current.packageStatus : "pending",
    packageReadyAt: current.packageImageCount === completedImages ? current.packageReadyAt : undefined,
    packageFileName: current.packageImageCount === completedImages ? current.packageFileName : undefined,
    packageImageCount: current.packageImageCount === completedImages ? current.packageImageCount : undefined,
    packageError: undefined,
    completedAt: allTerminal ? current.completedAt || new Date().toISOString() : undefined,
  }));
  if (allTerminal && completedImages > 0 && updated.packageStatus !== "ready") {
    updated = await autoProductionRepository.update(runId, (current) => ({
      ...current,
      packageStatus: "building",
      packageError: undefined,
    }));
    try {
      const artifact = await buildAutoProductionPackage(runId);
      updated = await autoProductionRepository.update(runId, (current) => ({
        ...current,
        packageStatus: "ready",
        packageReadyAt: artifact.generatedAt,
        packageFileName: artifact.fileName,
        packageImageCount: artifact.imageCount,
        packageError: undefined,
      }));
    } catch (error) {
      updated = await autoProductionRepository.update(runId, (current) => ({
        ...current,
        packageStatus: "failed",
        packageError: safeMessage(error, "다운로드 패키지를 준비하지 못했습니다."),
      }));
    }
  }
  return updated;
}

export function ensureAutoProductionRunMonitor(runId: string) {
  if (monitors.has(runId)) return false;
  const monitor = (async () => {
    while (true) {
      const run = await syncAutoProductionRun(runId);
      if (!run || !processingStatuses.includes(run.status)) return;
      await wait(4_000);
    }
  })().finally(() => monitors.delete(runId));
  monitors.set(runId, monitor);
  return true;
}

export async function recoverAutoProductionRuns() {
  // scheduled는 영속 대기열이다. 아직 task가 없는 대기 작업을 동기화하면
  // 빈 작업을 실패로 오인하므로 실제 처리가 시작된 run만 복구한다.
  const runs = await autoProductionRepository.list({ statuses: processingStatuses as AutoProductionRun["status"][], limit: 100 });
  for (const run of runs) {
    for (const task of run.tasks) {
      if (!task.generationJobId || terminalProductStatuses.has(task.status)) continue;
      const stored = await creativeGenerationJobStore.get(task.generationJobId);
      if (stored && stored.sourceType === "auto-production" && !isCurrentAutoProductionGenerationJob(stored)) {
        const message = "구형 자동제작 작업은 재개하지 않았습니다. 다음 예약부터 최신 레퍼런스 원본 → 상품 교체 → 문구 교체 6장 경로로 새로 제작합니다.";
        await creativeGenerationJobStore.update(stored.id, (current) => ({
          ...current,
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
          errors: [...current.errors, message].slice(-20),
          results: current.results.map((result) => (["pending", "running"].includes(result.status) ? { ...result, status: "cancelled" as const, error: undefined } : result)),
        }));
        await autoProductionRepository.update(run.id, (current) => ({
          ...current,
          warnings: [...current.warnings, message].slice(-50),
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, status: "failed" as const, error: message, updatedAt: new Date().toISOString() } : item)),
        }));
        continue;
      }
      const recovered = await recoverGenerationJob(task.generationJobId);
      if (recovered && ["pending", "running"].includes(recovered.status)) enqueueGenerationJob(recovered.id);
    }
    ensureAutoProductionRunMonitor(run.id);
  }
  return runs;
}

export async function queueAutoProductionHooks(runId: string, taskIdValue: string, hookCodes: HookMessageCode[]) {
  const run = await autoProductionRepository.get(runId);
  const task = run?.tasks.find((item) => item.id === taskIdValue);
  if (!run || !task?.generationJobId) throw new Error("자동 제작 상품 작업을 찾지 못했습니다.");
  const job = await creativeGenerationJobStore.get(task.generationJobId);
  if (!job) throw new Error("연결된 광고 생성 작업을 찾지 못했습니다.");
  const requestedCodes = hookCodes.length ? hookCodes : allHookCodes(job);
  const requestedIds = resultIdsForHookCodes(job, requestedCodes);
  if (!requestedIds.length) throw new Error("제작할 후킹을 찾지 못했습니다.");
  const alreadyRequested = new Set(job.executionResultIds || []);
  const additionalIds = requestedIds.filter((id) => !alreadyRequested.has(id));
  const updated = await creativeGenerationJobStore.update(job.id, (current) => ({
    ...current,
    executionResultIds: Array.from(new Set([...(current.executionResultIds || []), ...requestedIds])),
    representativeResultId: requestedIds[0] || current.representativeResultId,
    status: "running",
    completedAt: undefined,
    results: current.results.map((result) => (requestedIds.includes(result.id) && ["cancelled", "failed"].includes(result.status) ? { ...result, status: "pending", error: undefined, startedAt: undefined } : result)),
  }));
  await autoProductionRepository.update(runId, (current) => ({
    ...current,
    status: "generating-creatives",
    expectedImages: current.expectedImages + additionalIds.length,
    completedAt: undefined,
    packageStatus: "pending",
    packageReadyAt: undefined,
    packageFileName: undefined,
    packageImageCount: undefined,
    packageError: undefined,
    tasks: current.tasks.map((item) => (item.id === taskIdValue ? { ...item, status: "queued", results: resultsFromJob(updated), updatedAt: new Date().toISOString() } : item)),
  }));
  enqueueGenerationJob(updated.id);
  ensureAutoProductionRunMonitor(runId);
  return updated;
}

export async function cancelAutoProductionRun(runId: string) {
  const run = await autoProductionRepository.get(runId);
  if (!run) throw new Error("자동 제작 실행 기록을 찾지 못했습니다.");
  for (const task of run.tasks) {
    if (!task.generationJobId) continue;
    await creativeGenerationJobStore.update(task.generationJobId, (job) => ({
      ...job,
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
      results: job.results.map((result) => (["pending", "running"].includes(result.status) ? { ...result, status: "cancelled", error: undefined } : result)),
    })).catch(() => undefined);
  }
  return autoProductionRepository.update(runId, (current) => ({
    ...current,
    status: "cancelled",
    completedAt: new Date().toISOString(),
    tasks: current.tasks.map((task) => ({
      ...task,
      status: terminalProductStatuses.has(task.status) ? task.status : "cancelled",
      results: task.results.map((result) => (["pending", "running"].includes(result.status) ? { ...result, status: "cancelled" as const } : result)),
      updatedAt: new Date().toISOString(),
    })),
  }));
}
