import "server-only";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";
import { creativeGenerationJobStore } from "./jobStore.server";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server";
import { nativeHookDirectory, nativeResultImageUrl, optimizeNativeFinalImage, prepareNativeReferenceImages, writeNativeManifest } from "./nativeCreativeStorage.server";
import { NATIVE_FINAL_PROMPT_VERSION } from "./nativeCreativePrompt";
import { createAssetFromGenerationResult } from "../creative-assets/fromGeneration.server";
import { toCreativeAssetSnapshot } from "../creative-assets/types";
import { creativePreferenceRepository, type CreativePreferenceState } from "./creativePreferenceRepository.server";
import { executionResults } from "./jobRunnerPolicy";
import {
  hasExplicitPaidApiAuthorization,
  type CopyPlan,
  type GenerationJob,
  type NativeCreativeValidation,
} from "./types";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";
import { assertCreativeCopyAllowed } from "./bannedCreativePhrases";
import { validateCopyAgainstTruth } from "./productTruth";

type NativeResultInput = {
  jobId: string;
  resultId: string;
  requestId?: string;
  action?: "generate"|"regenerate"|"revise"|"revalidate"|"copy-update"|"approve"|"exclude"|"feedback"|"golden-reference";
  feedback?: string;
  copy?: Partial<CopyPlan>;
};

const resultLocks = new Map<string, Promise<void>>();
const referenceCacheKey = Symbol.for("daywiz.native-creative-reference-cache-v4-product-only");
const referenceGlobal = globalThis as typeof globalThis & { [referenceCacheKey]?: Map<string, Promise<string[]>> };
const referenceCache = referenceGlobal[referenceCacheKey] ?? new Map<string, Promise<string[]>>();
referenceGlobal[referenceCacheKey] = referenceCache;

async function preparedReferences(job: GenerationJob) {
  const cached = referenceCache.get(job.id);
  if (cached) return cached;
  const pending = prepareNativeReferenceImages(job);
  referenceCache.set(job.id, pending);
  try { return await pending; }
  catch (error) { if (referenceCache.get(job.id) === pending) referenceCache.delete(job.id); throw error; }
}

async function validateGeneratedFinal(file: string) {
  const buffer = await readFile(file);
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height || metadata.width < 768 || metadata.height < 768) {
    throw new Error("AI 완성 광고 이미지가 손상되었거나 해상도가 부족합니다.");
  }
}

function manualReviewValidation(message: string): NativeCreativeValidation {
  return {
    hookAlignment:70, productIdentity:70, factualAccuracy:70, koreanTextAccuracy:0,
    readability:0, composition:65, diversity:65, commercialQuality:65, exportCompliance:100,
    productVisibility:70, humanNaturalness:65, categoryFit:70, foodAppetiteAppeal:65,
    sensoryExpression:65, mobileReadability:0, observedKoreanText:[], failures:[message],
    recommendation:"manual-review", checkedAt:new Date().toISOString(),
  };
}

function conciseQaFeedback(validation: NativeCreativeValidation) {
  const failures = validation.failures.slice(0, 6).join("; ");
  return `AI quality review requested a complete remake. ${failures || "Improve product identity, exact Korean text, hierarchy and coherent hook-specific composition."}`;
}

async function updateCopy(job: GenerationJob, resultId: string, copy: Partial<CopyPlan>) {
  const current = job.results.find((result) => result.id === resultId);
  if (!current) throw new Error("결과 항목을 찾지 못했습니다.");
  const next = {
    headline:String(copy.headline ?? current.hookPlan.headline).trim(),
    body:String(copy.body ?? current.hookPlan.body).trim(),
    proof:String(copy.proof ?? current.hookPlan.proof).trim(),
    offer:String(copy.offer ?? current.hookPlan.offer).trim(),
    cta:String(copy.cta ?? current.hookPlan.cta).trim(),
  };
  assertCreativeCopyAllowed(Object.values(next).join(" "));
  const factual = validateCopyAgainstTruth(Object.values(next).join(" "), job.productTruth);
  if (!factual.valid) {
    throw new Error(`확인되지 않은 수치 또는 표현입니다: ${[...factual.unauthorizedNumericTokens,...factual.blockedClaims].join(", ")}`);
  }
  return creativeGenerationJobStore.update(job.id, (active) => ({
    ...active,
    results:active.results.map((result) => result.id === resultId ? {
      ...result,
      hookPlan:{
        ...result.hookPlan,
        ...next,
        creativeBrief:result.hookPlan.creativeBrief ? {
          ...result.hookPlan.creativeBrief,
          mainHook:next.headline,
          subCopy:next.body,
          textRendering:"ai-native-final",
        } : result.hookPlan.creativeBrief,
      },
    } : result),
  }));
}

async function handlePreference(input: NativeResultInput, job: GenerationJob) {
  const initial = job.results.find((result) => result.id === input.resultId)!;
  const action = input.action!;
  if (action === "golden-reference") {
    if (!initial.nativeCreative?.finalPath || !["success","approved"].includes(initial.status)) throw new Error("완성된 광고만 골든 레퍼런스로 등록할 수 있습니다.");
    await creativePreferenceRepository.saveGolden({
      advertiserId:job.advertiserId || "unknown-advertiser",
      sourceImagePath:initial.nativeCreative.finalPath,
      category:job.creativePlan.categoryCreativeProfile?.category || job.productTruth.product.category || "general",
      productId:job.productTruth.productId,
      mainHook:initial.hookPlan.headline,
      subCopy:initial.hookPlan.body,
      visualArchetype:initial.hookPlan.creativeBrief?.visualArchetype || "product-hero",
      approvalReason:input.feedback || "사용자가 골든 레퍼런스로 등록",
      reusableStyleTraits:[initial.hookPlan.creativeGrammarId || initial.hookPlan.performanceTemplateId || "product-hero"],
    });
  } else {
    const preferenceState: CreativePreferenceState = action === "approve" ? "approved" : action === "exclude" ? "rejected" : "feedback";
    await creativePreferenceRepository.record({
      advertiserId:job.advertiserId || "unknown-advertiser",
      productId:job.productTruth.productId,
      hookCode:initial.hookPlan.hookCode,
      state:preferenceState,
      reason:input.feedback || initial.hookPlan.headline,
    });
  }
  const updated = await creativeGenerationJobStore.update(job.id, (active) => ({
    ...active,
    representativeResultId:action === "approve" ? input.resultId : active.representativeResultId,
    results:active.results.map((result) => result.id === input.resultId ? {
      ...result,
      status:action === "approve" || action === "golden-reference" ? "approved" : action === "exclude" ? "excluded" : result.status,
      userFeedback:input.feedback || result.userFeedback,
    } : result),
  }));
  await writeNativeManifest(updated, (await creativePreferenceRepository.read(updated.advertiserId || "unknown-advertiser")).memory);
  return { job:updated, result:updated.results.find((result) => result.id === input.resultId)! };
}

async function runNativeResultGeneration(input: NativeResultInput) {
  const started = Date.now();
  let referenceMs = 0;
  let generationMs = 0;
  const compositionMs = 0;
  let validationMs = 0;
  let exportMs = 0;
  let job = await creativeGenerationJobStore.get(input.jobId);
  if (!job) throw new Error("작업을 찾지 못했습니다.");
  let initial = job.results.find((result) => result.id === input.resultId);
  if (!initial) throw new Error("결과 항목을 찾지 못했습니다.");
  const action = input.action || "generate";
  if (["approve","exclude","feedback","golden-reference"].includes(action)) return handlePreference(input,job);
  if (job.status === "cancelled") throw new Error("취소된 작업입니다.");
  if (action === "generate" && ["success","approved"].includes(initial.status)) return { job, result:initial };

  if (action === "copy-update") {
    job = await updateCopy(job,input.resultId,input.copy || {});
    initial = job.results.find((result) => result.id === input.resultId)!;
  }

  job = await creativeGenerationJobStore.update(job.id, (active) => ({
    ...active,
    status:"running",
    startedAt:active.startedAt || new Date().toISOString(),
    results:active.results.map((result) => result.id === input.resultId ? {
      ...result,status:"running",generationStage:"reference-preparing",attempts:result.attempts + 1,error:undefined,startedAt:new Date().toISOString(),
    } : result),
  }));

  const referenceStarted = Date.now();
  const references = await preparedReferences(job);
  if (!references[0]) throw new Error("AI 광고 제작에 사용할 상세페이지 원본 상품 이미지가 없습니다.");
  const supportingReferences = references.length > 1
    ? [references[1 + ((Math.max(1,initial.order)-1) % (references.length-1))], ...references.slice(1).filter((file)=>file !== references[1 + ((Math.max(1,initial.order)-1) % (references.length-1))])].slice(0,4)
    : [];
  const generationReferences = [references[0],...supportingReferences].filter(Boolean);
  referenceMs = Date.now() - referenceStarted;
  const directory = nativeHookDirectory(job.advertiserId || "unknown-advertiser",job.id,initial.hookPlan.hookCode);
  await mkdir(directory,{recursive:true});
  const runtime = resolveFastCreativeRuntime();
  const provider = createCreativeGenerationProvider(job.engine || "codex_local", {
    explicitPaidApiAuthorization: hasExplicitPaidApiAuthorization(job.paidApiAuthorization),
  });
  let generatedPath = action === "revalidate"
    ? initial.nativeCreative?.originalPath || initial.nativeCreative?.finalPath
    : undefined;
  let validation: NativeCreativeValidation | undefined;
  let lastError: unknown;
  let revisionFeedback = input.feedback;

  for (let attempt=0; attempt<=runtime.autoRevisionLimit; attempt += 1) {
    try {
      const shouldGenerate = action !== "revalidate" || !generatedPath;
      if (shouldGenerate) {
        job = await creativeGenerationJobStore.update(job.id,(active)=>({
          ...active,
          results:active.results.map((result)=>result.id===input.resultId?{...result,generationStage:attempt ? "ai-revising" : "ai-generating"}:result),
        }));
        generatedPath = path.join(directory,`ai-final-${Date.now()}-${attempt}.png`);
        const generationStarted = Date.now();
        await provider.generate({
          job,
          result:job.results.find((result)=>result.id===input.resultId)!,
          outputPath:generatedPath,
          referencePaths:generationReferences,
          sourceImagePath:generationReferences[0],
          feedback:revisionFeedback,
        });
        generationMs += Date.now() - generationStarted;
      }
      if (!generatedPath) throw new Error("AI 완성 광고 파일이 없습니다.");
      await validateGeneratedFinal(generatedPath);
      job = await creativeGenerationJobStore.update(job.id,(active)=>({
        ...active,
        results:active.results.map((result)=>result.id===input.resultId?{...result,generationStage:"quality-check"}:result),
      }));
      const validationStarted = Date.now();
      try {
        validation = await provider.validate({
          job,
          result:job.results.find((result)=>result.id===input.resultId)!,
          imagePath:generatedPath,
          referencePaths:generationReferences,
        });
      } catch {
        validation = manualReviewValidation("AI 완성 광고 검수 응답을 받지 못해 사람 검수가 필요합니다.");
      }
      validationMs += Date.now() - validationStarted;
      if (validation.recommendation === "revise" && attempt < runtime.autoRevisionLimit && action !== "revalidate") {
        revisionFeedback = conciseQaFeedback(validation);
        continue;
      }
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < runtime.autoRevisionLimit && action !== "revalidate") {
        revisionFeedback = `The previous complete-ad file was invalid. Regenerate the entire final advertisement from the authoritative product reference. ${input.feedback || ""}`;
      }
    }
  }
  if (lastError || !generatedPath) throw lastError instanceof Error ? lastError : new Error("AI 완성 광고 생성에 실패했습니다.");
  validation ||= manualReviewValidation("AI 완성 광고를 수동으로 검수해 주세요.");

  const finalFile = path.join(directory,"final.jpg");
  job = await creativeGenerationJobStore.update(job.id,(current)=>({
    ...current,
    results:current.results.map((result)=>result.id===input.resultId?{...result,generationStage:"exporting"}:result),
  }));
  const exportStarted = Date.now();
  const exported = await optimizeNativeFinalImage(generatedPath,finalFile);
  exportMs = Date.now() - exportStarted;
  const publicImage = nativeResultImageUrl(job.id,input.resultId);
  const latest = job.results.find((result)=>result.id===input.resultId)!;
  const assetResult = await createAssetFromGenerationResult({
    job,result:latest,generatedImageUrl:publicImage,
    generationRequestKey:`native-ai-final:${job.id}:${latest.id}:${input.requestId || Date.now()}`,
    copy:{headline:latest.hookPlan.headline,body:latest.hookPlan.body,proof:latest.hookPlan.proof,offer:latest.hookPlan.offer},
  });
  const previousOriginal = initial.nativeCreative?.originalPath;
  const isRevision = ["regenerate","revise","copy-update"].includes(action);
  const reviewRequired = validation.recommendation !== "approve";
  job = await creativeGenerationJobStore.update(job.id,(current)=>({
    ...current,
    paidApiUsed:current.engine === "openai_api",
    results:current.results.map((result)=>result.id===input.resultId?{
      ...result,
      status:reviewRequired ? "quality-review" : "success",
      generationStage:"completed",
      imagePath:publicImage,
      downloadName:assetResult.asset.fileName,
      creativeAsset:toCreativeAssetSnapshot(assetResult.asset),
      nativeCreative:{
        engine:current.engine || "codex_local",
        referencePaths:generationReferences,
        backgroundPath:undefined,
        originalPath:generatedPath,
        revisionPaths:isRevision && previousOriginal && previousOriginal !== generatedPath
          ? [...(result.nativeCreative?.revisionPaths || []), previousOriginal]
          : result.nativeCreative?.revisionPaths || [],
        finalPath:finalFile,
        promptVersion:NATIVE_FINAL_PROMPT_VERSION,
        revisionCount:isRevision ? (result.nativeCreative?.revisionCount || 0)+1 : result.nativeCreative?.revisionCount || 0,
        validation,
        timing:{referenceMs,generationMs,compositionMs,validationMs,exportMs,totalMs:Date.now()-started},
        export:{width:exported.width,height:exported.height,fileSizeBytes:exported.bytes,jpegQuality:exported.quality,colorSpace:exported.colorSpace,format:exported.format},
      },
      error:reviewRequired ? validation.failures.join(" · ") : undefined,
      completedAt:new Date().toISOString(),durationMs:Date.now()-started,
    }:result),
  }));
  const complete = executionResults(job).every((result)=>!["pending","running"].includes(result.status));
  if (complete) {
    job = await creativeGenerationJobStore.update(job.id,(current)=>({
      ...current,
      status:executionResults(current).every((result)=>["success","approved"].includes(result.status))?"completed":"partial",
      completedAt:new Date().toISOString(),
      timing:{...current.timing,totalMs:Date.now()-new Date(current.createdAt).getTime()},
    }));
  }
  await writeNativeManifest(job,(await creativePreferenceRepository.read(job.advertiserId || "unknown-advertiser")).memory);
  return { job,result:job.results.find((result)=>result.id===input.resultId)! };
}

export async function handleNativeResultGeneration(input: NativeResultInput) {
  const key = `${input.jobId}--${input.resultId}`;
  const previous = resultLocks.get(key) || Promise.resolve();
  let release!:()=>void;
  const current = new Promise<void>((resolve)=>{ release=resolve; });
  const queued = previous.then(()=>current);
  resultLocks.set(key,queued);
  await previous;
  try { return await runNativeResultGeneration(input); }
  finally { release(); if (resultLocks.get(key)===queued) resultLocks.delete(key); }
}
