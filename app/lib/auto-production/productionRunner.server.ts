import "server-only";
import { randomUUID } from "node:crypto";
import { createNativeGenerationJob } from "../creative-generation/createNativeGenerationJob.server";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { enqueueGenerationJob, recoverGenerationJob } from "../creative-generation/jobRunner.server";
import { executionResults } from "../creative-generation/jobRunnerPolicy";
import type { GenerationJob, HookMessageCode } from "../creative-generation/types";
import { autoProductionAdvertiserRepository } from "./advertiserConfig.server";
import { recentTasks } from "./duplicateGuard";
import { allHookCodes, hookHypothesesFromJob, resultIdsForHookCodes } from "./hookSelector";
import { AUTO_PRODUCTION_CREATIVES_PER_PRODUCT } from "./policy";
import { loadAutoProductionCandidates } from "./productSource.server";
import { selectAutoProductionCandidates } from "./productSelector";
import { autoProductionRepository } from "./productionRepository.server";
import { nextScheduledAt, scheduledRunKey, seoulClock } from "./schedule";
import { createAutoProductionTaskId } from "./taskIdentity";
import { candidateIdentityKeys } from "./productIdentity";
import { buildAutoProductionPackage } from "./package.server";
import type {
  AutoProductionAdvertiserConfig,
  AutoProductionPreview,
  AutoProductionProductTask,
  AutoProductionResult,
  AutoProductionRun,
} from "./types";

const monitorKey = Symbol.for("daywiz.auto-production.monitors-v1");
const globalState = globalThis as typeof globalThis & { [monitorKey]?: Map<string, Promise<void>> };
const monitors = globalState[monitorKey] ?? new Map<string, Promise<void>>();
globalState[monitorKey] = monitors;
const activeStatuses = ["scheduled", "selecting-products", "analyzing-products", "generating-hooks", "queued", "generating-creatives"];
const terminalProductStatuses = new Set(["completed", "failed", "skipped-duplicate", "skipped-insufficient-data", "skipped-unavailable"]);

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeMessage(error: unknown, fallback: string) {
  return (error instanceof Error ? error.message : fallback)
    .replace(/(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s]+/g, "로컬 파일")
    .slice(0, 500);
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
  const recent = recentTasks(runs, config.advertiserId, config.productCooldownDays, now)
    .filter((task) => task.status === "completed");
  const recentFamilies = recentTasks(runs, config.advertiserId, config.productFamilyCooldownDays, now)
    .filter((task) => task.status === "completed");
  const recentIds = new Set(recent.flatMap((task) => [
    task.candidate.id,
    task.candidate.externalId || "",
    ...candidateIdentityKeys(task.candidate).filter((key) => !key.startsWith("family:")),
  ]).filter(Boolean));
  for (const task of recentFamilies) {
    for (const key of candidateIdentityKeys(task.candidate)) if (key.startsWith("family:")) recentIds.add(key);
  }
  const candidates = selectAutoProductionCandidates(source.candidates, config, recentIds);
  const imageWarnings = source.candidates
    .filter((candidate) => candidate.imageVerificationStatus && candidate.imageVerificationStatus !== "verified")
    .map((candidate) => `${candidate.productName}: 상품 이미지 확인 필요 · ${candidate.imageVerificationReasons?.[0] || "정확한 판매 구성 이미지를 확인하지 못했습니다."}`);
  const expectedImages = candidates.length * AUTO_PRODUCTION_CREATIVES_PER_PRODUCT;
  return {
    advertiserId: config.advertiserId,
    advertiserName: config.advertiserName,
    source: candidates[0]?.source || "none",
    fallbackUsed: source.fallbackUsed,
    fallbackReason: source.fallbackReason,
    expectedImages: Math.min(config.maxImagesPerRun, expectedImages),
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
    startedAt: timestamp,
  };
}

async function prepareTask(run: AutoProductionRun, config: AutoProductionAdvertiserConfig, task: AutoProductionProductTask) {
  await autoProductionRepository.update(run.id, (current) => ({ ...current, status: "generating-hooks", tasks: current.tasks.map((item) => item.id === task.id ? { ...item, status: "analyzing", updatedAt: new Date().toISOString() } : item) }));
  const job = await createNativeGenerationJob({
    product: task.candidate.productInfo,
    productImagePaths: task.candidate.productInfo.productImagePaths,
    selectedAdImages: task.candidate.productInfo.productImagePaths,
    source: "landing-page",
    adBrief: adBrief(config, task),
    engine: "codex_local",
  }, {
    autoStart: false,
    sourceType: "auto-production",
    autoProductionRunId: run.id,
    autoProductionTaskId: task.id,
  });
  const hooks = hookHypothesesFromJob(job);
  if (hooks.length !== 6) throw new Error("상품별 후킹 가설 6개를 구성하지 못했습니다.");
  const executionResultIds = job.results.map((result) => result.id);
  if (executionResultIds.length !== AUTO_PRODUCTION_CREATIVES_PER_PRODUCT) {
    throw new Error("수동 제작과 동일한 광고 레퍼런스 6장을 배정하지 못했습니다.");
  }
  const queuedJob = await creativeGenerationJobStore.update(job.id, (current) => ({
    ...current,
    executionResultIds,
    representativeResultId: executionResultIds[0],
    status: "pending",
  }));
  await autoProductionRepository.update(run.id, (current) => ({
    ...current,
    status: "queued",
    tasks: current.tasks.map((item) => item.id === task.id ? {
      ...item,
      status: "queued",
      hookHypotheses: hooks,
      generationJobId: queuedJob.id,
      results: resultsFromJob(queuedJob),
      updatedAt: new Date().toISOString(),
    } : item),
  }));
  enqueueGenerationJob(queuedJob.id);
}

export async function runAutoProductionForAdvertiser(
  config: AutoProductionAdvertiserConfig,
  options: { trigger?: AutoProductionRun["trigger"]; now?: Date } = {}
) {
  const now = options.now || new Date();
  const created = await autoProductionRepository.createUnique(runRecord(config, options.trigger || "manual", now));
  if (!created.created || !created.run) return { run: created.run, created: false };
  const initial = created.run;
  try {
    await autoProductionRepository.update(initial.id, (run) => ({ ...run, status: "selecting-products" }));
    const settings = await autoProductionAdvertiserRepository.settings();
    const alreadyReserved = await autoProductionRepository.reservedImageCount(initial.businessDate);
    const remainingDaily = Math.max(0, settings.maxImagesPerDay - alreadyReserved);
    if (!remainingDaily) {
      const skipped = await autoProductionRepository.update(initial.id, (run) => ({ ...run, status: "skipped", completedAt: new Date().toISOString(), warnings: [...run.warnings, "오늘의 자동 제작 이미지 한도에 도달해 실행하지 않았습니다."] }));
      return { run: skipped, created: true };
    }
    const preview = await previewAutoProduction(config, now);
    const runQuota = Math.min(remainingDaily, config.maxImagesPerRun);
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
    if (!selected.length) return { run, created: true };
    for (const task of tasks) {
      try {
        await prepareTask(run, config, task);
      } catch (error) {
        const message = safeMessage(error, "상품 광고 준비에 실패했습니다.");
        await autoProductionRepository.update(run.id, (current) => ({ ...current, errors: [...current.errors, message], tasks: current.tasks.map((item) => item.id === task.id ? { ...item, status: /이미지|상품정보|후킹/.test(message) ? "skipped-insufficient-data" : "failed", error: message, updatedAt: new Date().toISOString() } : item) }));
      }
    }
    run = await autoProductionRepository.update(run.id, (current) => ({ ...current, status: current.tasks.some((task) => task.generationJobId) ? "generating-creatives" : current.tasks.some((task) => task.status === "failed") ? "failed" : "skipped", completedAt: current.tasks.some((task) => task.generationJobId) ? undefined : new Date().toISOString() }));
    await autoProductionAdvertiserRepository.update(config.advertiserId, { lastRunAt: now.toISOString(), nextRunAt: nextScheduledAt(config, now) });
    if (run.status === "generating-creatives") ensureAutoProductionRunMonitor(run.id);
    return { run, created: true };
  } catch (error) {
    const message = safeMessage(error, "자동 제작 실행에 실패했습니다.");
    const failed = await autoProductionRepository.update(initial.id, (run) => ({ ...run, status: "failed", errors: [...run.errors, message], completedAt: new Date().toISOString() }));
    return { run: failed, created: true };
  }
}

export async function syncAutoProductionRun(runId: string) {
  const run = await autoProductionRepository.get(runId);
  if (!run) return null;
  const tasks = await Promise.all(run.tasks.map(async (task) => {
    if (!task.generationJobId || (terminalProductStatuses.has(task.status) && task.adCopy && task.adCopy.status !== "generating")) return task;
    const job = await creativeGenerationJobStore.get(task.generationJobId);
    if (!job) return { ...task, status: "failed" as const, error: "연결된 광고 생성 작업을 찾지 못했습니다.", updatedAt: new Date().toISOString() };
    const scoped = executionResults(job);
    const successful = scoped.filter((result) => ["success", "approved"].includes(result.status)).length;
    const failed = scoped.filter((result) => ["failed", "korean-review", "product-review", "quality-review", "group-review"].includes(result.status)).length;
    const imagePending = scoped.some((result) => ["pending", "running"].includes(result.status));
    const copyPending = successful > 0 && (!job.adCopy || job.adCopy.status === "generating");
    const pending = imagePending || copyPending;
    return {
      ...task,
      status: pending ? (scoped.some((result) => result.status === "running") ? "generating" as const : "queued" as const) : successful ? "completed" as const : failed ? "failed" as const : task.status,
      results: resultsFromJob(job),
      adCopy: job.adCopy,
      error: failed && !successful ? scoped.find((result) => result.error)?.error : task.error,
      updatedAt: new Date().toISOString(),
    };
  }));
  const completedImages = tasks.flatMap((task) => task.results).filter((result) => ["success", "approved"].includes(result.status)).length;
  const failedImages = tasks.flatMap((task) => task.results).filter((result) => ["failed", "korean-review", "product-review", "quality-review", "group-review"].includes(result.status)).length;
  const allTerminal = tasks.every((task) => terminalProductStatuses.has(task.status));
  const status = allTerminal
    ? completedImages && failedImages ? "partial" : completedImages ? "completed" : tasks.every((task) => task.status.startsWith("skipped")) ? "skipped" : "failed"
    : "generating-creatives";
  let updated = await autoProductionRepository.update(runId, (current) => ({
    ...current,
    tasks,
    completedImages,
    failedImages,
    status,
    packageStatus:
      allTerminal && completedImages > 0 && current.packageImageCount === completedImages
        ? current.packageStatus
        : "pending",
    packageReadyAt:
      current.packageImageCount === completedImages ? current.packageReadyAt : undefined,
    packageFileName:
      current.packageImageCount === completedImages ? current.packageFileName : undefined,
    packageImageCount:
      current.packageImageCount === completedImages ? current.packageImageCount : undefined,
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
    for (let index = 0; index < 900; index += 1) {
      const run = await syncAutoProductionRun(runId);
      if (!run || !activeStatuses.includes(run.status)) return;
      await wait(4_000);
    }
  })().finally(() => monitors.delete(runId));
  monitors.set(runId, monitor);
  return true;
}

export async function recoverAutoProductionRuns() {
  const runs = await autoProductionRepository.list({ statuses: activeStatuses as AutoProductionRun["status"][], limit: 100 });
  for (const run of runs) {
    for (const task of run.tasks) {
      if (!task.generationJobId || terminalProductStatuses.has(task.status)) continue;
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
    results: current.results.map((result) => requestedIds.includes(result.id) && ["cancelled", "failed"].includes(result.status) ? { ...result, status: "pending", error: undefined, startedAt: undefined } : result),
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
    tasks: current.tasks.map((item) => item.id === taskIdValue ? { ...item, status: "queued", results: resultsFromJob(updated), updatedAt: new Date().toISOString() } : item),
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
    await creativeGenerationJobStore.update(task.generationJobId, (job) => ({ ...job, status: "cancelled", cancelledAt: new Date().toISOString(), results: job.results.map((result) => result.status === "pending" ? { ...result, status: "cancelled" } : result) })).catch(() => undefined);
  }
  return autoProductionRepository.update(runId, (current) => ({ ...current, status: "cancelled", completedAt: new Date().toISOString() }));
}
