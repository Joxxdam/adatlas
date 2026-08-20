import "server-only";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { creativeGenerationJobStore } from "./jobStore.server.ts";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server.ts";
import { createNativeContactSheet, nativeHookDirectory, nativeResultImageUrl, optimizeNativeFinalImage, prepareNativeReferenceImages, writeNativeManifest } from "./nativeCreativeStorage.server.ts";
import { NATIVE_FINAL_PROMPT_VERSION } from "./nativeCreativePrompt.ts";
import { createAssetFromGenerationResult } from "../creative-assets/fromGeneration.server.ts";
import { toCreativeAssetSnapshot } from "../creative-assets/types.ts";
import { readBrandMemory, saveGoldenReference, selectGoldenReferences, updateBrandMemory } from "./codexRegistry.server.ts";
import { passesNativeCreativeValidation, passesNativeGroupValidation } from "./nativeCreativeValidation.ts";
import { executionResults } from "./jobRunnerPolicy.ts";
import type { CreativeGenerationProvider } from "./providers/CreativeGenerationProvider.ts";
import type { GenerationJob } from "./types.ts";
import { ensureProductAdCopy } from "../ad-copy/adCopyGenerator.server.ts";

type NativeResultInput = { jobId: string; resultId: string; requestId?: string; action?: "generate"|"regenerate"|"revise"|"revalidate"|"approve"|"exclude"|"feedback"|"golden-reference"; feedback?: string };
const advertiserLocks = new Map<string, Promise<void>>();

async function applyNativeGroupValidation(job: GenerationJob, provider: CreativeGenerationProvider) {
  const scoped = executionResults(job);
  if (scoped.length !== 6 || !scoped.every((result) => ["success", "approved"].includes(result.status))) return job;
  let validation;
  try {
    const contactSheetPath = await createNativeContactSheet(job);
    validation = await provider.validateGroup({ job, contactSheetPath });
  } catch {
    return creativeGenerationJobStore.update(job.id, (current) => ({
      ...current,
      groupValidation: {
        sceneDiversity: 0,
        productPlacementDiversity: 0,
        cameraDiversity: 0,
        colorMoodDiversity: 0,
        messageSeparation: 0,
        hookSceneAlignment: 0,
        typographyDiversity: 0,
        visualArchetypeDiversity: 0,
        categoryFit: 0,
        duplicatePairs: [],
        reviseHookCodes: [],
        failures: ["독립 그룹 검수를 완료하지 못했습니다."],
        recommendation: "manual-review",
        checkedAt: new Date().toISOString(),
      },
      results: current.results.map((result) => ["success", "approved"].includes(result.status)
        ? { ...result, status: "group-review", error: "6장 전체 비교 검토가 필요합니다." }
        : result),
    }));
  }
  const passed = passesNativeGroupValidation(validation);
  if (passed) return creativeGenerationJobStore.update(job.id, (current) => ({ ...current, groupValidation: validation }));
  const duplicateCodes = validation.duplicatePairs.map((pair) => pair.rightHookCode);
  const reviseCodes = new Set<string>([...validation.reviseHookCodes, ...duplicateCodes]);
  if ((job.groupRevisionCount || 0) < 1 && reviseCodes.size) {
    return creativeGenerationJobStore.update(job.id, (current) => ({
      ...current,
      status: "running",
      completedAt: undefined,
      groupValidation: validation,
      groupRevisionCount: (current.groupRevisionCount || 0) + 1,
      results: current.results.map((result) => reviseCodes.has(result.hookPlan.hookCode)
        ? { ...result, status: "pending", generationStage: "planned", error: undefined, userFeedback: `그룹 중복 검수 수정: ${validation.failures.join(" · ") || "다른 5장과 확실히 구분되는 장면·카메라·상품 배치로 다시 제작"}`, completedAt: undefined }
        : result),
    }));
  }
  const reviewCodes = reviseCodes.size
    ? reviseCodes
    : new Set(scoped.map((result) => result.hookPlan.hookCode));
  return creativeGenerationJobStore.update(job.id, (current) => ({
    ...current,
    groupValidation: validation,
    results: current.results.map((result) => reviewCodes.has(result.hookPlan.hookCode)
      ? { ...result, status: "group-review", error: "그룹 다양성 검토가 필요합니다." }
      : result),
  }));
}

async function runNativeResultGeneration(input: NativeResultInput) {
  const started = Date.now();
  let job = await creativeGenerationJobStore.get(input.jobId);
  if (!job) throw new Error("작업을 찾지 못했습니다.");
  const initial = job.results.find((item) => item.id === input.resultId);
  if (!initial) throw new Error("결과 항목을 찾지 못했습니다.");
  const action = input.action || "generate";
  if (["approve","exclude","feedback","golden-reference"].includes(action)) {
    if (action === "golden-reference") {
      if (!initial.nativeCreative?.finalPath || !["success", "approved"].includes(initial.status)) {
        throw new Error("검수된 완성 광고만 골든 레퍼런스로 등록할 수 있습니다.");
      }
      const brief = initial.hookPlan.creativeBrief;
      await saveGoldenReference({
        advertiserId: job.advertiserId || "unknown-advertiser",
        sourceImagePath: initial.nativeCreative.finalPath,
        category: job.creativePlan.categoryCreativeProfile?.category || job.productTruth.product.category || "general",
        productId: job.productTruth.productId,
        mainHook: initial.hookPlan.headline,
        subCopy: initial.hookPlan.body,
        visualArchetype: brief?.visualArchetype || "product-hero",
        approvalReason: input.feedback || "사용자가 골든 레퍼런스로 등록",
        reusableStyleTraits: [
          brief?.visualArchetype,
          brief?.composition,
          brief?.colorPalette || brief?.colorDirection,
          brief?.typographyDirection || brief?.typographyStyle,
          brief?.productRole,
          brief?.humanRole,
        ].filter((value): value is string => Boolean(value)),
      });
      job = await creativeGenerationJobStore.update(job.id, (current) => ({
        ...current,
        results: current.results.map((result) => result.id === input.resultId ? { ...result, status: "approved", userFeedback: input.feedback || result.userFeedback } : result),
      }));
      await writeNativeManifest(job, await readBrandMemory(job.advertiserId || "unknown-advertiser"));
      return { job, result: job.results.find((item) => item.id === input.resultId)! };
    }
    const kind = action === "approve" ? "approve" : action === "exclude" ? "reject" : "feedback";
    await updateBrandMemory(job.advertiserId || "unknown-advertiser", { kind, value: input.feedback || `${initial.hookPlan.hookCode}: ${initial.hookPlan.headline}` });
    job = await creativeGenerationJobStore.update(job.id, (current) => ({
      ...current,
      representativeResultId: action === "approve" ? input.resultId : current.representativeResultId,
      results: current.results.map((result) => result.id === input.resultId ? { ...result, status: action === "approve" ? "approved" : action === "exclude" ? "excluded" : result.status, userFeedback: input.feedback || result.userFeedback } : result),
    }));
    if (action === "approve") job = await ensureProductAdCopy(job.id, { force: job.adCopy?.representativeResultId !== input.resultId });
    await writeNativeManifest(job, await readBrandMemory(job.advertiserId || "unknown-advertiser"));
    return { job, result: job.results.find((item) => item.id === input.resultId)! };
  }

  if (job.status === "cancelled") throw new Error("사용자가 취소한 작업이므로 새 광고 생성을 시작하지 않습니다.");
  if (action === "generate" && ["success", "approved"].includes(initial.status)) {
    return { job, result: initial };
  }

  job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, status: "running", startedAt: current.startedAt || new Date().toISOString(), results: current.results.map((result) => result.id === input.resultId ? { ...result, status: "running", generationStage: "reference-preparing", attempts: result.attempts + 1, error: undefined, startedAt: new Date().toISOString() } : result) }));
  const provider = createCreativeGenerationProvider(job.engine || "codex_local");
  const references = await prepareNativeReferenceImages(job);
  const memory = await readBrandMemory(job.advertiserId || "unknown-advertiser");
  const goldenReferences = selectGoldenReferences(memory, {
    category: job.creativePlan.categoryCreativeProfile?.category || job.productTruth.product.category || "general",
    productId: job.productTruth.productId,
  });
  const directory = nativeHookDirectory(job.advertiserId || "unknown-advertiser", job.id, initial.hookPlan.hookCode);
  await mkdir(directory, { recursive: true });
  let sourceImagePath = action === "revise" ? initial.nativeCreative?.finalPath : undefined;
  let originalPath = action === "regenerate" ? undefined : initial.nativeCreative?.originalPath;
  const revisionPaths: string[] = action === "regenerate" ? [] : [...(initial.nativeCreative?.revisionPaths || [])];
  let validation = initial.nativeCreative?.validation;
  let generatedPath = "";
  let threadId = job.codexThreadId;
  const creativeCategory = job.creativePlan.categoryCreativeProfile?.category || "general";
  if (action === "revalidate" && initial.nativeCreative?.finalPath) {
    generatedPath = initial.nativeCreative.finalPath;
    const active = job.results.find((item) => item.id === input.resultId)!;
    job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, results: current.results.map((result) => result.id === input.resultId ? { ...result, generationStage: "quality-check" } : result) }));
    validation = await provider.validate({ job, result: active, imagePath: generatedPath, referencePaths: references });
  } else for (let revision = 0; revision <= 2; revision += 1) {
    const isRevision = revision > 0 || action === "revise";
    job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, results: current.results.map((result) => result.id === input.resultId ? { ...result, generationStage: isRevision ? "ai-revising" : "ai-generating" } : result) }));
    generatedPath = path.join(directory, isRevision ? `revision-${Date.now()}-${revision}.png` : `original-${Date.now()}.png`);
    const active = job.results.find((item) => item.id === input.resultId)!;
    const generated = await provider.generate({ job, result: active, outputPath: generatedPath, referencePaths: references, goldenReferencePaths: goldenReferences.map((reference) => reference.imagePath), sourceImagePath, feedback: isRevision ? input.feedback || validation?.failures.join(" · ") || "한국어 문구와 제품 동일성을 정확히 수정" : input.feedback });
    if (!isRevision) originalPath = generatedPath;
    threadId = generated.threadId || threadId;
    if (isRevision) revisionPaths.push(generatedPath);
    job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, codexThreadId: threadId, results: current.results.map((result) => result.id === input.resultId ? { ...result, generationStage: "quality-check" } : result) }));
    validation = await provider.validate({ job, result: active, imagePath: generatedPath, referencePaths: references });
    if (passesNativeCreativeValidation(validation, creativeCategory)) break;
    sourceImagePath = generatedPath;
  }
  if (!validation) throw new Error("AI 광고 검수 결과가 없습니다.");
  const finalFile = path.join(directory, "final.jpg");
  job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, results: current.results.map((result) => result.id === input.resultId ? { ...result, generationStage: "exporting" } : result) }));
  const exported = await optimizeNativeFinalImage(generatedPath, finalFile);
  const successful = passesNativeCreativeValidation(validation, creativeCategory);
  const status = successful ? "success" : validation.koreanTextAccuracy < 95 ? "korean-review" : validation.productIdentity < 80 ? "product-review" : "quality-review";
  const publicImage = nativeResultImageUrl(job.id, input.resultId);
  const latest = job.results.find((item) => item.id === input.resultId)!;
  const assetResult = successful ? await createAssetFromGenerationResult({ job, result: latest, generatedImageUrl: publicImage, generationRequestKey: `native:${job.id}:${latest.id}:${input.requestId || Date.now()}`, copy: { headline: latest.hookPlan.headline, body: latest.hookPlan.body, proof: latest.hookPlan.proof, offer: latest.hookPlan.offer } }) : undefined;
  job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, paidApiUsed: current.engine === "openai_api", results: current.results.map((result) => result.id === input.resultId ? { ...result, status, generationStage: successful ? "completed" : "quality-check", imagePath: publicImage, downloadName: assetResult?.asset.fileName || `${current.advertiserId}-${result.hookPlan.hookCode}.jpg`, creativeAsset: assetResult ? toCreativeAssetSnapshot(assetResult.asset) : result.creativeAsset, nativeCreative: { engine: current.engine || "codex_local", originalPath, revisionPaths, finalPath: finalFile, promptVersion: NATIVE_FINAL_PROMPT_VERSION, revisionCount: revisionPaths.length, validation, export: { width: exported.width, height: exported.height, fileSizeBytes: exported.bytes, jpegQuality: exported.quality, colorSpace: exported.colorSpace, format: exported.format } }, error: successful ? undefined : validation.failures.join(" · ") || "AI 품질 기준을 통과하지 못했습니다.", completedAt: new Date().toISOString(), durationMs: Date.now() - started } : result) }));
  const complete = executionResults(job).every((result) => !["pending","running"].includes(result.status));
  if (complete) job = await creativeGenerationJobStore.update(job.id, (current) => ({ ...current, status: executionResults(current).every((result) => ["success","approved"].includes(result.status)) ? "completed" : "partial", completedAt: new Date().toISOString(), timing: { ...current.timing, totalMs: Date.now() - new Date(current.createdAt).getTime() } }));
  if (complete) job = await applyNativeGroupValidation(job, provider);
  if (complete) job = await ensureProductAdCopy(job.id);
  await writeNativeManifest(job, await readBrandMemory(job.advertiserId || "unknown-advertiser"));
  return { job, result: job.results.find((item) => item.id === input.resultId)! };
}

export async function handleNativeResultGeneration(input: NativeResultInput) {
  const job = await creativeGenerationJobStore.get(input.jobId);
  const key = job?.advertiserId || input.jobId;
  const previous = advertiserLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  advertiserLocks.set(key, queued);
  await previous;
  try { return await runNativeResultGeneration(input); }
  finally { release(); if (advertiserLocks.get(key) === queued) advertiserLocks.delete(key); }
}
