import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";
import { creativeGenerationJobStore } from "./jobStore.server";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server";
import { withNativeCreativeSession } from "./providers/CreativeGenerationProvider";
import { nativeHookDirectory, nativeResultImageUrl, optimizeNativeFinalImage, prepareNativeReferenceImages, writeNativeManifest } from "./nativeCreativeStorage.server";
import { NATIVE_FINAL_PROMPT_VERSION } from "./nativeCreativePrompt";
import { createAssetFromGenerationResult } from "../creative-assets/fromGeneration.server";
import { toCreativeAssetSnapshot } from "../creative-assets/types";
import { creativePreferenceRepository, type CreativePreferenceState } from "./creativePreferenceRepository.server";
import { executionResults } from "./jobRunnerPolicy";
import { hasExplicitPaidApiAuthorization, type CopyPlan, type GenerationJob, type NativeCreativeValidation } from "./types";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";
import { assertCreativeCopyAllowed } from "./bannedCreativePhrases";
import { validateCopyAgainstTruth } from "./productTruth";
import { selectNativeAdReference } from "./referenceCreativeLibrary.server";
import { copyReferenceStructureLosslessly } from "./referenceStructureCopy.server";

type NativeResultInput = {
  jobId: string;
  resultId: string;
  requestId?: string;
  action?: "generate" | "regenerate" | "revise" | "revalidate" | "copy-update" | "approve" | "exclude" | "feedback" | "golden-reference";
  feedback?: string;
  copy?: Partial<CopyPlan>;
};

const resultLocks = new Map<string, Promise<void>>();
const referenceCacheKey = Symbol.for("daywiz.native-creative-reference-cache-v5-staged-reference-edit");
const referenceGlobal = globalThis as typeof globalThis & {
  [referenceCacheKey]?: Map<string, Promise<string[]>>;
};
const referenceCache = referenceGlobal[referenceCacheKey] ?? new Map<string, Promise<string[]>>();
referenceGlobal[referenceCacheKey] = referenceCache;

async function preparedReferences(job: GenerationJob) {
  const cached = referenceCache.get(job.id);
  if (cached) return cached;
  const pending = prepareNativeReferenceImages(job);
  referenceCache.set(job.id, pending);
  try {
    return await pending;
  } catch (error) {
    if (referenceCache.get(job.id) === pending) referenceCache.delete(job.id);
    throw error;
  }
}

async function validateGeneratedFinal(file: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const buffer = await readFile(file);
      const metadata = await sharp(buffer).metadata();
      if (!metadata.width || !metadata.height || metadata.width < 768 || metadata.height < 768) {
        throw new Error("AI 완성 광고 이미지가 손상되었거나 해상도가 부족합니다.");
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw lastError;
}

function manualReviewValidation(message: string): NativeCreativeValidation {
  return {
    hookAlignment: 70,
    productIdentity: 70,
    factualAccuracy: 70,
    koreanTextAccuracy: 0,
    readability: 0,
    composition: 65,
    diversity: 65,
    commercialQuality: 65,
    exportCompliance: 100,
    productVisibility: 70,
    humanNaturalness: 65,
    categoryFit: 70,
    foodAppetiteAppeal: 65,
    sensoryExpression: 65,
    mobileReadability: 0,
    observedKoreanText: [],
    failures: [message],
    recommendation: "manual-review",
    checkedAt: new Date().toISOString(),
  };
}

function conciseQaFeedback(validation: NativeCreativeValidation) {
  const failures = validation.failures.slice(0, 6).join("; ");
  return `AI quality review requested a complete remake. ${failures || "Improve product identity, exact Korean text, hierarchy and coherent hook-specific composition."}`;
}

export function hasCriticalNativeQaFailure(validation: NativeCreativeValidation) {
  if (validation.productIdentity < 75 || validation.factualAccuracy < 75 || validation.koreanTextAccuracy < 75) return true;
  return validation.failures.some((failure) => /다른\s*상품|상품\s*왜곡|패키지|용기|라벨|로고|원본\s*광고주|이전\s*문구|출처\s*문구|가격|할인|수량|용량|한글|한국어|오탈자|깨진\s*글자|잘림|가림|충돌|source\s*(?:brand|copy|price)|wrong\s*product|fake\s*(?:label|logo)|broken\s*hangul|clipp|overlap/i.test(failure));
}

async function updateCopy(job: GenerationJob, resultId: string, copy: Partial<CopyPlan>) {
  const current = job.results.find((result) => result.id === resultId);
  if (!current) throw new Error("결과 항목을 찾지 못했습니다.");
  const next = {
    headline: String(copy.headline ?? current.hookPlan.headline).trim(),
    body: String(copy.body ?? current.hookPlan.body).trim(),
    proof: String(copy.proof ?? current.hookPlan.proof).trim(),
    offer: String(copy.offer ?? current.hookPlan.offer).trim(),
    cta: String(copy.cta ?? current.hookPlan.cta).trim(),
  };
  assertCreativeCopyAllowed(Object.values(next).join(" "));
  const factual = validateCopyAgainstTruth(Object.values(next).join(" "), job.productTruth);
  if (!factual.valid) {
    throw new Error(`확인되지 않은 수치 또는 표현입니다: ${[...factual.unauthorizedNumericTokens, ...factual.blockedClaims].join(", ")}`);
  }
  return creativeGenerationJobStore.update(job.id, (active) => ({
    ...active,
    results: active.results.map((result) =>
      result.id === resultId
        ? {
            ...result,
            referenceAdaptedCopyPlan: result.referenceAdaptedCopyPlan
              ? {
                  ...result.referenceAdaptedCopyPlan,
                  headline: next.headline,
                  subCopy: next.body,
                  proof: next.proof,
                  offer: next.offer,
                  cta: next.cta,
                  validationStatus: "valid",
                  validationErrors: [],
                }
              : result.referenceAdaptedCopyPlan,
            hookPlan: {
              ...result.hookPlan,
              ...next,
              creativeBrief: result.hookPlan.creativeBrief
                ? {
                    ...result.hookPlan.creativeBrief,
                    mainHook: next.headline,
                    subCopy: next.body,
                    textRendering: "ai-native-final",
                  }
                : result.hookPlan.creativeBrief,
            },
          }
        : result
    ),
  }));
}

async function handlePreference(input: NativeResultInput, job: GenerationJob) {
  const initial = job.results.find((result) => result.id === input.resultId)!;
  const action = input.action!;
  if (action === "golden-reference") {
    if (!initial.nativeCreative?.finalPath || !["success", "approved"].includes(initial.status)) throw new Error("완성된 광고만 골든 레퍼런스로 등록할 수 있습니다.");
    await creativePreferenceRepository.saveGolden({
      advertiserId: job.advertiserId || "unknown-advertiser",
      sourceImagePath: initial.nativeCreative.finalPath,
      category: job.creativePlan.categoryCreativeProfile?.category || job.productTruth.product.category || "general",
      productId: job.productTruth.productId,
      mainHook: initial.hookPlan.headline,
      subCopy: initial.hookPlan.body,
      visualArchetype: initial.hookPlan.creativeBrief?.visualArchetype || "product-hero",
      approvalReason: input.feedback || "사용자가 골든 레퍼런스로 등록",
      reusableStyleTraits: [initial.hookPlan.creativeGrammarId || initial.hookPlan.performanceTemplateId || "product-hero"],
    });
  } else {
    const preferenceState: CreativePreferenceState = action === "approve" ? "approved" : action === "exclude" ? "rejected" : "feedback";
    await creativePreferenceRepository.record({
      advertiserId: job.advertiserId || "unknown-advertiser",
      productId: job.productTruth.productId,
      hookCode: initial.hookPlan.hookCode,
      state: preferenceState,
      reason: input.feedback || initial.hookPlan.headline,
    });
  }
  const updated = await creativeGenerationJobStore.update(job.id, (active) => ({
    ...active,
    representativeResultId: action === "approve" ? input.resultId : active.representativeResultId,
    results: active.results.map((result) =>
      result.id === input.resultId
        ? {
            ...result,
            status: action === "approve" || action === "golden-reference" ? "approved" : action === "exclude" ? "excluded" : result.status,
            userFeedback: input.feedback || result.userFeedback,
          }
        : result
    ),
  }));
  await writeNativeManifest(updated, (await creativePreferenceRepository.read(updated.advertiserId || "unknown-advertiser")).memory);
  return { job: updated, result: updated.results.find((result) => result.id === input.resultId)! };
}

async function validStageFile(file: string | undefined) {
  if (!file || !existsSync(file)) return false;
  try {
    await validateGeneratedFinal(file);
    return true;
  } catch {
    return false;
  }
}

async function updateNativeProgress(job: GenerationJob, resultId: string, generationStage: NonNullable<GenerationJob["results"][number]["generationStage"]>, mutate?: (result: GenerationJob["results"][number]) => Partial<GenerationJob["results"][number]>) {
  return creativeGenerationJobStore.update(job.id, (active) => ({
    ...active,
    results: active.results.map((result) =>
      result.id === resultId
        ? {
            ...result,
            generationStage,
            ...(mutate?.(result) || {}),
          }
        : result
    ),
  }));
}

async function runNativeResultGeneration(input: NativeResultInput) {
  const started = Date.now();
  let referenceMs = 0;
  let generationMs = 0;
  let validationMs = 0;
  let exportMs = 0;
  const loadedJob = await creativeGenerationJobStore.get(input.jobId);
  if (!loadedJob) throw new Error("작업을 찾지 못했습니다.");
  let job: GenerationJob = loadedJob;
  const loadedResult = job.results.find((result) => result.id === input.resultId);
  if (!loadedResult) throw new Error("결과 항목을 찾지 못했습니다.");
  let initial: GenerationJob["results"][number] = loadedResult;
  const action = input.action || "generate";
  if (["approve", "exclude", "feedback", "golden-reference"].includes(action)) return handlePreference(input, job);
  if (job.status === "cancelled") throw new Error("취소된 작업입니다.");
  if (action === "generate" && ["success", "approved"].includes(initial.status)) return { job, result: initial };

  if (action === "copy-update") {
    job = await updateCopy(job, input.resultId, input.copy || {});
    initial = job.results.find((result) => result.id === input.resultId)!;
  }

  const isRevision = ["regenerate", "revise", "copy-update"].includes(action);
  const previousArtifact = initial.nativeCreative;
  const promptVersionChanged = Boolean(previousArtifact && previousArtifact.promptVersion !== NATIVE_FINAL_PROMPT_VERSION);
  const revisionCount = isRevision ? (previousArtifact?.revisionCount || 0) + 1 : previousArtifact?.revisionCount || 0;
  job = await creativeGenerationJobStore.update(job.id, (active) => ({
    ...active,
    status: "running",
    startedAt: active.startedAt || new Date().toISOString(),
    results: active.results.map((result) =>
      result.id === input.resultId
        ? {
            ...result,
            status: "running",
            generationStage: "reference-preparing",
            attempts: result.attempts + 1,
            error: undefined,
            startedAt: new Date().toISOString(),
            nativeCreative: {
              engine: active.engine || "codex_local",
              adReference: result.nativeCreative?.adReference,
              // Old staged files may contain the removed local product-cutout
              // exception. Never reuse them after a full-AI prompt migration.
              stagePaths: action === "regenerate" || promptVersionChanged ? undefined : result.nativeCreative?.stagePaths,
              referencePaths: result.nativeCreative?.referencePaths || [],
              backgroundPath: undefined,
              originalPath: result.nativeCreative?.originalPath,
              revisionPaths: result.nativeCreative?.revisionPaths || [],
              finalPath: result.nativeCreative?.finalPath,
              promptVersion: NATIVE_FINAL_PROMPT_VERSION,
              revisionCount,
              validation: result.nativeCreative?.validation,
              timing: result.nativeCreative?.timing,
              export: result.nativeCreative?.export,
            },
          }
        : result
    ),
  }));

  const referenceStarted = Date.now();
  const references = await preparedReferences(job);
  if (!references[0]) throw new Error("AI 광고 제작에 사용할 상세페이지 원본 상품 이미지가 없습니다.");
  const supportingReferences = references.length > 1 ? [references[1 + ((Math.max(1, initial.order) - 1) % (references.length - 1))], ...references.slice(1).filter((file) => file !== references[1 + ((Math.max(1, initial.order) - 1) % (references.length - 1))])].slice(0, 4) : [];
  const generationReferences = [references[0], ...supportingReferences].filter(Boolean);
  initial = job.results.find((result) => result.id === input.resultId)!;
  // 새 작업 생성 시 무작위로 배정한 레퍼런스는 재시도·재생성에서도 고정한다.
  // 과거 작업에 배정값이 없을 때만 결정적 fallback을 사용한다.
  const selectedAdReference = initial.nativeCreative?.adReference || selectNativeAdReference(job, initial);
  if (!(await validStageFile(selectedAdReference.path))) {
    throw new Error("선택된 고품질 광고 레퍼런스 파일을 읽을 수 없습니다.");
  }
  referenceMs = Date.now() - referenceStarted;
  const directory = nativeHookDirectory(job.advertiserId || "unknown-advertiser", job.id, initial.hookPlan.hookCode);
  await mkdir(directory, { recursive: true });
  const runtime = resolveFastCreativeRuntime();
  const provider = createCreativeGenerationProvider(job.engine || "codex_local", {
    explicitPaidApiAuthorization: hasExplicitPaidApiAuthorization(job.paidApiAuthorization),
  });
  job = await updateNativeProgress(job, input.resultId, "reference-selecting", (result) => ({
    nativeCreative: {
      ...result.nativeCreative!,
      adReference: selectedAdReference,
      referencePaths: generationReferences,
    },
  }));

  const active = job.results.find((result) => result.id === input.resultId)!;
  const existingStages = active.nativeCreative?.stagePaths || {};
  let structurePath = existingStages.structurePath;
  let productPath = existingStages.productPath;
  let copyPath = existingStages.copyPath;
  let qaRepairPaths = [...(existingStages.qaRepairPaths || [])];
  if (action === "regenerate") {
    structurePath = undefined;
    productPath = undefined;
    copyPath = undefined;
    qaRepairPaths = [];
  } else if (action === "copy-update") {
    copyPath = undefined;
    qaRepairPaths = [];
  }

  // The structure copy is byte-for-byte local work. Do it before opening the
  // H-specific image session so this non-generative stage cannot create a
  // Codex thread.
  if (action !== "revalidate") {
    if (!(await validStageFile(structurePath))) {
      const sourceExtension = path.extname(selectedAdReference.path).toLowerCase();
      structurePath = path.join(directory, `01-structure${sourceExtension === ".jpeg" ? ".jpg" : sourceExtension || ".jpg"}`);
      job = await updateNativeProgress(job, input.resultId, "structure-recreating");
      await copyReferenceStructureLosslessly(selectedAdReference.path, structurePath);
      await validateGeneratedFinal(structurePath);
      job = await updateNativeProgress(job, input.resultId, "structure-recreating", (result) => ({
        nativeCreative: {
          ...result.nativeCreative!,
          stagePaths: { ...(result.nativeCreative?.stagePaths || {}), structurePath },
        },
      }));
    }
    if (!structurePath) throw new Error("광고 레퍼런스 원본 복사 결과가 없습니다.");
  }

  return withNativeCreativeSession(provider, async (session) => {
    async function runStage(stage: "product-replacement" | "copy-replacement" | "qa-repair", generationStage: "product-replacing" | "copy-replacing" | "qa-repairing", outputPath: string, sourceImagePath: string, feedback?: string) {
      job = await updateNativeProgress(job, input.resultId, generationStage);
      const generationStarted = Date.now();
      await session.generate({
        job,
        result: job.results.find((result) => result.id === input.resultId)!,
        outputPath,
        referencePaths: generationReferences,
        productReferencePaths: generationReferences,
        adReferencePath: selectedAdReference.path,
        sourceImagePath,
        feedback,
        stage,
      });
      generationMs += Date.now() - generationStarted;
      await validateGeneratedFinal(outputPath);
      return outputPath;
    }

    let generatedPath: string | undefined;
    let validation: NativeCreativeValidation | undefined;
    let validatedExport: Awaited<ReturnType<typeof optimizeNativeFinalImage>> | undefined;
    let validatedExportSource: string | undefined;

    if (action === "revalidate") {
      generatedPath = active.nativeCreative?.finalPath || copyPath || active.nativeCreative?.originalPath;
      if (!(await validStageFile(generatedPath))) throw new Error("다시 검수할 AI 완성 광고가 없습니다.");
    } else {
      const sourceStructurePath = structurePath;
      if (!sourceStructurePath) throw new Error("광고 레퍼런스 원본 복사 결과가 없습니다.");
      if (!(await validStageFile(productPath))) {
        productPath = path.join(directory, "02-product.png");
        await runStage("product-replacement", "product-replacing", productPath, sourceStructurePath, input.feedback);
        job = await updateNativeProgress(job, input.resultId, "product-replacing", (result) => ({
          nativeCreative: {
            ...result.nativeCreative!,
            stagePaths: {
              ...(result.nativeCreative?.stagePaths || {}),
              structurePath,
              productPath,
            },
          },
        }));
      }
      if (!productPath) throw new Error("실제 상품 교체 결과가 없습니다.");

      if (!(await validStageFile(copyPath))) {
        copyPath = path.join(directory, "03-copy.png");
        await runStage("copy-replacement", "copy-replacing", copyPath, productPath, input.feedback);
        job = await updateNativeProgress(job, input.resultId, "copy-replacing", (result) => ({
          nativeCreative: {
            ...result.nativeCreative!,
            stagePaths: {
              ...(result.nativeCreative?.stagePaths || {}),
              structurePath,
              productPath,
              copyPath,
              qaRepairPaths,
            },
          },
        }));
      }
      generatedPath = copyPath;
    }

    if (!generatedPath) throw new Error("ProductTruth 문구 교체 결과가 없습니다.");
    await validateGeneratedFinal(generatedPath);

    // 수정 요청은 기존 결과를 재검수하는 데서 끝내지 않고, 사용자의 지시를 반영한
    // 완성 광고 전체 래스터 편집을 반드시 한 번 수행한다.
    if (action === "revise") {
      const repairedPath = path.join(directory, `04-qa-repair-user-${revisionCount}-${qaRepairPaths.length + 1}.png`);
      await runStage("qa-repair", "qa-repairing", repairedPath, generatedPath, input.feedback || "사용자 수정 요청을 반영해 상품·로고·가격·한국어를 포함한 광고 전체 래스터를 다시 완성해 주세요.");
      qaRepairPaths.push(repairedPath);
      generatedPath = repairedPath;
      job = await updateNativeProgress(job, input.resultId, "qa-repairing", (result) => ({
        nativeCreative: {
          ...result.nativeCreative!,
          stagePaths: {
            ...(result.nativeCreative?.stagePaths || {}),
            structurePath,
            productPath,
            copyPath,
            qaRepairPaths,
          },
        },
      }));
    }

    for (let attempt = 0; attempt <= runtime.autoRevisionLimit; attempt += 1) {
      job = await updateNativeProgress(job, input.resultId, "quality-check");
      const qaPreviewPath = path.join(directory, `qa-preview-${attempt + 1}.jpg`);
      const qaExportStarted = Date.now();
      validatedExport = await optimizeNativeFinalImage(generatedPath, qaPreviewPath);
      validatedExportSource = generatedPath;
      exportMs += Date.now() - qaExportStarted;
      const validationStarted = Date.now();
      try {
        validation = await session.validate({
          job,
          result: job.results.find((result) => result.id === input.resultId)!,
          imagePath: qaPreviewPath,
          referencePaths: generationReferences,
          adReferencePath: selectedAdReference.path,
          exportComplianceVerified: true,
        });
      } catch {
        validation = manualReviewValidation("AI 완성 광고 검수 응답을 받지 못해 사람 검수가 필요합니다.");
      }
      validationMs += Date.now() - validationStarted;
      const criticalFailure = hasCriticalNativeQaFailure(validation);
      if (validation.recommendation !== "revise" || !criticalFailure || action === "revalidate" || attempt >= Math.min(1, runtime.autoRevisionLimit)) break;
      const repairedPath = path.join(directory, `04-qa-repair-${attempt + 1}.png`);
      await runStage("qa-repair", "qa-repairing", repairedPath, generatedPath, [input.feedback, conciseQaFeedback(validation)].filter(Boolean).join("\n"));
      qaRepairPaths.push(repairedPath);
      generatedPath = repairedPath;
      job = await updateNativeProgress(job, input.resultId, "qa-repairing", (result) => ({
        nativeCreative: {
          ...result.nativeCreative!,
          stagePaths: {
            ...(result.nativeCreative?.stagePaths || {}),
            structurePath,
            productPath,
            copyPath,
            qaRepairPaths,
          },
        },
      }));
    }
    validation ||= manualReviewValidation("AI 완성 광고를 수동으로 검수해 주세요.");

    const finalFile = path.join(directory, "final.jpg");
    job = await creativeGenerationJobStore.update(job.id, (current) => ({
      ...current,
      results: current.results.map((result) => (result.id === input.resultId ? { ...result, generationStage: "exporting" } : result)),
    }));
    const exportStarted = Date.now();
    const exported = validatedExport && validatedExportSource === generatedPath ? (await copyFile(validatedExport.file, finalFile), { ...validatedExport, file: finalFile }) : await optimizeNativeFinalImage(generatedPath, finalFile);
    exportMs += Date.now() - exportStarted;
    const publicImage = nativeResultImageUrl(job.id, input.resultId);
    const latest = job.results.find((result) => result.id === input.resultId)!;
    const assetResult = await createAssetFromGenerationResult({
      job,
      result: latest,
      generatedImageUrl: publicImage,
      generationRequestKey: `native-ai-final:${job.id}:${latest.id}:${input.requestId || Date.now()}`,
      copy: {
        headline: latest.hookPlan.headline,
        body: latest.hookPlan.body,
        proof: latest.hookPlan.proof,
        offer: latest.hookPlan.offer,
      },
    });
    const previousOriginal = initial.nativeCreative?.originalPath;
    job = await creativeGenerationJobStore.update(job.id, (current) => ({
      ...current,
      paidApiUsed: current.engine === "openai_api",
      results: current.results.map((result) =>
        result.id === input.resultId
          ? {
              ...result,
              // 검수는 치명 오류 1회 보정에만 사용한다. 최종 JPEG가 만들어졌다면
              // 사용자가 직접 판단·삭제할 수 있도록 항상 다운로드 가능한 성공으로 저장한다.
              status: "success",
              generationStage: "completed",
              imagePath: publicImage,
              downloadName: assetResult.asset.fileName,
              creativeAsset: toCreativeAssetSnapshot(assetResult.asset),
              nativeCreative: {
                engine: current.engine || "codex_local",
                adReference: selectedAdReference,
                stagePaths: { structurePath, productPath, copyPath, qaRepairPaths },
                referencePaths: generationReferences,
                backgroundPath: undefined,
                originalPath: generatedPath,
                revisionPaths: isRevision && previousOriginal && previousOriginal !== generatedPath ? [...(result.nativeCreative?.revisionPaths || []), previousOriginal] : result.nativeCreative?.revisionPaths || [],
                finalPath: finalFile,
                promptVersion: NATIVE_FINAL_PROMPT_VERSION,
                revisionCount,
                validation,
                timing: {
                  referenceMs,
                  generationMs,
                  compositionMs: 0,
                  validationMs,
                  exportMs,
                  totalMs: Date.now() - started,
                },
                export: {
                  width: exported.width,
                  height: exported.height,
                  fileSizeBytes: exported.bytes,
                  jpegQuality: exported.quality,
                  colorSpace: exported.colorSpace,
                  format: exported.format,
                },
              },
              error: undefined,
              completedAt: new Date().toISOString(),
              durationMs: Date.now() - started,
            }
          : result
      ),
    }));
    const complete = executionResults(job).every((result) => !["pending", "running"].includes(result.status));
    if (complete) {
      job = await creativeGenerationJobStore.update(job.id, (current) => ({
        ...current,
        status: executionResults(current).every((result) => ["success", "approved"].includes(result.status)) ? "completed" : "partial",
        completedAt: new Date().toISOString(),
        timing: { ...current.timing, totalMs: Date.now() - new Date(current.createdAt).getTime() },
      }));
    }
    await writeNativeManifest(job, (await creativePreferenceRepository.read(job.advertiserId || "unknown-advertiser")).memory);
    return { job, result: job.results.find((result) => result.id === input.resultId)! };
  });
}

export async function handleNativeResultGeneration(input: NativeResultInput) {
  const key = `${input.jobId}--${input.resultId}`;
  const previous = resultLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  resultLocks.set(key, queued);
  await previous;
  try {
    return await runNativeResultGeneration(input);
  } finally {
    release();
    if (resultLocks.get(key) === queued) resultLocks.delete(key);
  }
}
