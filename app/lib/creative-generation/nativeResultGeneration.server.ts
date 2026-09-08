import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import sharp from "sharp";
import { creativeGenerationJobStore } from "./jobStore.server";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server";
import { withNativeCreativeSession } from "./providers/CreativeGenerationProvider";
import { nativeHookDirectory, nativeResultImageUrl, optimizeNativeFinalImage, prepareDefaultCodexGenerationImages, writeNativeManifest } from "./nativeCreativeStorage.server";
import { createAssetFromGenerationResult } from "../creative-assets/fromGeneration.server";
import { toCreativeAssetSnapshot } from "../creative-assets/types";
import { creativePreferenceRepository, type CreativePreferenceState } from "./creativePreferenceRepository.server";
import { executionResults, isDefaultCodexGenerationJob } from "./jobRunnerPolicy";
import type { CopyPlan, GenerationJob } from "./types";
import { ensureNativeReferenceCopies, selectCategoryNativeAdReferences, type NativeAdReference } from "./referenceCreativeLibrary.server";
import { DEFAULT_CODEX_GENERATION_PROMPT_VERSION, DEFAULT_CODEX_GENERATION_STAGE_ORDER, DEFAULT_CODEX_GENERATION_WORKFLOW } from "./codexDirectTest";

type NativeResultInput = {
  jobId: string;
  resultId: string;
  requestId?: string;
  action?: "generate" | "regenerate" | "regenerate-new-reference" | "revise" | "revalidate" | "copy-update" | "approve" | "exclude" | "feedback" | "golden-reference";
  feedback?: string;
  /** 과거 API 요청 형태를 읽기 위한 호환 필드입니다. 신규 기본 제작에서는 사용하지 않습니다. */
  copy?: Partial<CopyPlan>;
};

type NativeResultLockMap = Map<string, Promise<void>>;

// 개발 서버 HMR과 서로 다른 route bundle에서도 같은 직접 수정 작업을
// 백그라운드 복구 러너가 유실된 작업으로 오인하지 않도록 전역 잠금을 공유한다.
const resultLocksKey = Symbol.for("daywiz.native-result-generation-locks-v1");
const resultLocksGlobal = globalThis as typeof globalThis & { [resultLocksKey]?: NativeResultLockMap };
const resultLocks = resultLocksGlobal[resultLocksKey] ?? new Map<string, Promise<void>>();
resultLocksGlobal[resultLocksKey] = resultLocks;

export function activeNativeResultGenerationIds(jobId: string) {
  const prefix = `${jobId}--`;
  return new Set(
    [...resultLocks.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
  );
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

async function updateNativeProgress(
  job: GenerationJob,
  resultId: string,
  generationStage: NonNullable<GenerationJob["results"][number]["generationStage"]>,
  mutate?: (result: GenerationJob["results"][number]) => Partial<GenerationJob["results"][number]>
) {
  return creativeGenerationJobStore.update(job.id, (active) => ({
    ...active,
    results: active.results.map((result) =>
      result.id === resultId
        ? { ...result, generationStage, ...(mutate?.(result) || {}) }
        : result
    ),
  }));
}

async function handlePreference(input: NativeResultInput, job: GenerationJob) {
  const initial = job.results.find((result) => result.id === input.resultId)!;
  const action = input.action!;
  if (action === "golden-reference") {
    if (!initial.nativeCreative?.finalPath || !["success", "approved"].includes(initial.status)) {
      throw new Error("완성된 광고만 골든 레퍼런스로 등록할 수 있습니다.");
    }
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

async function runDefaultCodexResult(
  input: NativeResultInput,
  initialJob: GenerationJob,
  initialResult: GenerationJob["results"][number],
  action: NonNullable<NativeResultInput["action"]>,
  started: number
) {
  let job = initialJob;
  let result = initialResult;
  if (action === "copy-update" || action === "revalidate") {
    throw new Error("기본 Codex 제작은 별도 문구 단계 없이 현재 프롬프트로 광고 전체를 다시 생성합니다.");
  }

  if (action === "regenerate-new-reference") {
    const excludedReferenceIds = new Set(job.results.map((item) => item.nativeCreative?.adReference?.id).filter((id): id is string => Boolean(id)));
    const [replacementReference] = await ensureNativeReferenceCopies(
      selectCategoryNativeAdReferences(job, 1, undefined, excludedReferenceIds)
    );
    if (!replacementReference) throw new Error("현재 상품과 호환되는 다른 레퍼런스가 없습니다.");
    job = await creativeGenerationJobStore.update(job.id, (current) => ({
      ...current,
      results: current.results.map((item) =>
        item.id === result.id
          ? {
              ...item,
              nativeCreative: {
                ...item.nativeCreative!,
                adReference: replacementReference,
                originalPath: undefined,
                finalPath: undefined,
                validation: undefined,
              },
              imagePath: undefined,
              creativeAsset: undefined,
              completedAt: undefined,
            }
          : item
      ),
    }));
    result = job.results.find((item) => item.id === result.id)!;
  }

  const selectedAdReference = result.nativeCreative?.adReference as NativeAdReference | undefined;
  if (!selectedAdReference?.path || !existsSync(selectedAdReference.path)) {
    throw new Error("작업에 고정된 광고 레퍼런스 파일을 읽을 수 없습니다.");
  }
  const productReferences = await prepareDefaultCodexGenerationImages(job, result);
  if (!productReferences[0]) throw new Error("선택한 상품 이미지를 준비하지 못했습니다.");

  const revisionCount = ["regenerate", "regenerate-new-reference", "revise"].includes(action)
    ? (result.nativeCreative?.revisionCount || 0) + 1
    : result.nativeCreative?.revisionCount || 0;
  const previousOriginal = result.nativeCreative?.originalPath;
  job = await creativeGenerationJobStore.update(job.id, (current) => ({
    ...current,
    status: "running",
    startedAt: current.startedAt || new Date().toISOString(),
    results: current.results.map((item) =>
      item.id === result.id
        ? {
            ...item,
            status: "running",
            generationStage: "codex-direct-generating",
            attempts: item.attempts + 1,
            error: undefined,
            startedAt: new Date().toISOString(),
            nativeCreative: {
              ...item.nativeCreative!,
              engine: "codex_local",
              workflow: DEFAULT_CODEX_GENERATION_WORKFLOW,
              stageOrder: DEFAULT_CODEX_GENERATION_STAGE_ORDER,
              adReference: selectedAdReference,
              referencePaths: productReferences,
              promptVersion: DEFAULT_CODEX_GENERATION_PROMPT_VERSION,
              revisionCount,
            },
          }
        : item
    ),
  }));
  result = job.results.find((item) => item.id === result.id)!;

  const directory = nativeHookDirectory(job.advertiserId || "unknown-advertiser", job.id, result.hookPlan.hookCode);
  await mkdir(directory, { recursive: true });
  const generatedPath = path.join(directory, `codex-direct-v1-${result.attempts}.png`);
  const provider = createCreativeGenerationProvider("codex_local");
  const directPrompt = [
    job.codexDirectTest!.prompt,
    action === "revise" && input.feedback?.trim() ? `추가 수정 요청:\n${input.feedback.trim()}` : "",
  ].filter(Boolean).join("\n\n");

  await withNativeCreativeSession(provider, async (session) => {
    await session.generate({
      job,
      result,
      outputPath: generatedPath,
      referencePaths: productReferences,
      productReferencePaths: productReferences,
      adReferencePath: selectedAdReference.path,
      stage: "codex-direct-test",
      directPrompt,
    });
  });
  await validateGeneratedFinal(generatedPath);

  const finalFile = path.join(directory, "final.jpg");
  job = await updateNativeProgress(job, result.id, "exporting");
  const exported = await optimizeNativeFinalImage(generatedPath, finalFile);
  const publicImage = nativeResultImageUrl(job.id, result.id);
  const latest = job.results.find((item) => item.id === result.id)!;
  const assetResult = await createAssetFromGenerationResult({
    job,
    result: latest,
    generatedImageUrl: publicImage,
    // 개별 수정은 같은 소재의 새 아카이브 카드가 아니라 현재 카드의
    // 최신 이미지로 반영한다. 생성 요청 자체는 매번 실행하되 자산 등록은
    // 작업·결과 단위의 안정적인 키로 멱등 처리한다.
    generationRequestKey: `codex-direct-v1:${job.id}:${latest.id}`,
    copy: {
      headline: latest.hookPlan.headline,
      body: latest.hookPlan.body,
      proof: latest.hookPlan.proof,
      offer: latest.hookPlan.offer,
    },
  });

  job = await creativeGenerationJobStore.update(job.id, (current) => ({
    ...current,
    results: current.results.map((item) =>
      item.id === result.id
        ? {
            ...item,
            status: "success",
            generationStage: "completed",
            imagePath: publicImage,
            downloadName: assetResult.asset.fileName,
            creativeAsset: toCreativeAssetSnapshot(assetResult.asset),
            nativeCreative: {
              ...item.nativeCreative!,
              engine: "codex_local",
              workflow: DEFAULT_CODEX_GENERATION_WORKFLOW,
              stageOrder: DEFAULT_CODEX_GENERATION_STAGE_ORDER,
              adReference: selectedAdReference,
              referencePaths: productReferences,
              originalPath: generatedPath,
              revisionPaths: previousOriginal && previousOriginal !== generatedPath
                ? [...(item.nativeCreative?.revisionPaths || []), previousOriginal]
                : item.nativeCreative?.revisionPaths || [],
              finalPath: finalFile,
              promptVersion: DEFAULT_CODEX_GENERATION_PROMPT_VERSION,
              revisionCount,
              validation: undefined,
              timing: {
                referenceMs: 0,
                generationMs: Date.now() - started,
                compositionMs: 0,
                validationMs: 0,
                exportMs: 0,
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
        : item
    ),
  }));

  if (executionResults(job).every((item) => !["pending", "running"].includes(item.status))) {
    job = await creativeGenerationJobStore.update(job.id, (current) => ({
      ...current,
      status: executionResults(current).every((item) => ["success", "approved"].includes(item.status)) ? "completed" : "partial",
      completedAt: new Date().toISOString(),
      timing: { ...current.timing, totalMs: Date.now() - new Date(current.createdAt).getTime() },
    }));
  }
  await writeNativeManifest(job);
  return { job, result: job.results.find((item) => item.id === result.id)! };
}

async function runNativeResultGeneration(input: NativeResultInput) {
  const started = Date.now();
  const job = await creativeGenerationJobStore.get(input.jobId);
  if (!job) throw new Error("작업을 찾지 못했습니다.");
  const result = job.results.find((item) => item.id === input.resultId);
  if (!result) throw new Error("결과 항목을 찾지 못했습니다.");
  const action = input.action || "generate";
  if (["approve", "exclude", "feedback", "golden-reference"].includes(action)) return handlePreference(input, job);
  if (job.status === "cancelled") throw new Error("취소된 작업입니다.");
  if (action === "generate" && ["success", "approved"].includes(result.status)) return { job, result };
  if (!isDefaultCodexGenerationJob(job)) {
    throw new Error("구버전 제작 결과는 조회·다운로드만 가능합니다. 현재 상품으로 새 기본 제작을 시작해 주세요.");
  }
  return runDefaultCodexResult(input, job, result, action, started);
}

function publicDirectGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : "Codex 광고 생성 중 알 수 없는 오류가 발생했습니다.";
  return message.replace(/(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s]+/g, "로컬 파일").slice(0, 600);
}

async function persistDirectGenerationFailure(input: NativeResultInput, error: unknown) {
  const message = publicDirectGenerationError(error);
  const failed = await creativeGenerationJobStore.update(input.jobId, (job) => ({
    ...job,
    errors: [...job.errors, message].slice(-20),
    results: job.results.map((result) =>
      result.id === input.resultId && result.status === "running"
        ? {
            ...result,
            status: "failed",
            error: message,
            completedAt: new Date().toISOString(),
          }
        : result
    ),
  }));
  await writeNativeManifest(failed).catch(() => undefined);
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
  } catch (error) {
    // 세션·생성·내보내기 중 실패해도 결과를 running으로 방치하지 않는다.
    // 생성 시작 전 검증 오류는 아직 running이 아니므로 원래 상태를 유지한다.
    const action = input.action || "generate";
    if (!["approve", "exclude", "feedback", "golden-reference"].includes(action)) {
      await persistDirectGenerationFailure(input, error).catch(() => undefined);
    }
    throw error;
  } finally {
    release();
    if (resultLocks.get(key) === queued) resultLocks.delete(key);
  }
}
