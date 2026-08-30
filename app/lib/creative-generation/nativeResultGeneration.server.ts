import "server-only";
import path from "node:path";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import sharp from "sharp";
import { creativeGenerationJobStore } from "./jobStore.server";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server";
import { withNativeCreativeSession } from "./providers/CreativeGenerationProvider";
import { nativeHookDirectory, nativeResultImageUrl, optimizeNativeFinalImage, prepareNativeReferenceImages, selectProtectedProductSource, writeNativeManifest } from "./nativeCreativeStorage.server";
import { NATIVE_FINAL_PROMPT_VERSION } from "./nativeCreativePrompt";
import { createAssetFromGenerationResult } from "../creative-assets/fromGeneration.server";
import { toCreativeAssetSnapshot } from "../creative-assets/types";
import { creativePreferenceRepository, type CreativePreferenceState } from "./creativePreferenceRepository.server";
import { CURRENT_REFERENCE_EDIT_WORKFLOW, executionResults, REFERENCE_EDIT_STAGE_ORDER, usesCurrentReferenceEditPipeline } from "./jobRunnerPolicy";
import { hasExplicitPaidApiAuthorization, type CopyPlan, type GenerationJob, type NativeCreativeValidation } from "./types";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";
import { assertCreativeCopyAllowed } from "./bannedCreativePhrases";
import { buildProductTruth, extractNumericTokens, validateCopyAgainstTruth } from "./productTruth";
import { ensureNativeReferenceCopies, selectCategoryNativeAdReferences, selectNativeAdReference, type NativeAdReference } from "./referenceCreativeLibrary.server";
import { copyReferenceStructureLosslessly } from "./referenceStructureCopy.server";
import { buildReferenceAdaptedCreativePlan, buildReferenceScenes, createBestEffortReferenceCopyPlan, hasPublishableReferenceCopyContract, planReferenceAdaptedCopies } from "./referenceAdaptedPlanning.server";
import { enforceExactRenderedCopyValidation, enforceNoSourceDisclosureCopy, enforceOriginCopyPolicy, enforceReferenceCopyPlanValidity, enforceReferenceCopySlotCompleteness } from "./nativeCreativeValidation";
import { resolveProductRenderingPolicy, resolveProtectedProductPlacement } from "./productRenderingPolicy";
import { createIdentityLockedProductComposite } from "./protectedProductCompositor.server";

type NativeResultInput = {
  jobId: string;
  resultId: string;
  requestId?: string;
  action?: "generate" | "regenerate" | "regenerate-new-reference" | "revise" | "revalidate" | "copy-update" | "approve" | "exclude" | "feedback" | "golden-reference";
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
    standaloneLogoDetected: false,
    standaloneLogoFindings: [],
    failures: [message],
    recommendation: "manual-review",
    checkedAt: new Date().toISOString(),
  };
}

function conciseQaFeedback(validation: NativeCreativeValidation) {
  const failures = validation.failures.slice(0, 6).join("; ");
  return `AI quality review requested a complete remake. ${failures || "Improve product identity, exact Korean text, hierarchy and coherent hook-specific composition."}`;
}

export function hasCriticalNativeQaFailure(validation: NativeCreativeValidation, isMeat = false) {
  if (validation.standaloneLogoDetected) return true;
  if (validation.sourcePersonDetected && (!validation.sourcePersonReplaced || !validation.humanCompositionChanged || (validation.targetAudienceFit || 0) < 75)) return true;
  if (validation.sourcePersonDetected && validation.humanCopyAligned === false) return true;
  if (validation.sceneProductInteractionAligned === false) return true;
  if (validation.unrelatedFoodOrIngredientDetected) return true;
  if (validation.productIdentity < 75 || validation.factualAccuracy < 75 || validation.koreanTextAccuracy < 75) return true;
  if (isMeat && (validation.productIdentity < 82 || validation.foodAppetiteAppeal < 82)) return true;
  return validation.failures.some((failure) => /다른\s*상품|상품\s*왜곡|패키지|용기|라벨|로고|원본\s*광고주|원본\s*인물|같은\s*인물|인물\s*동일|인물\s*구도|타깃\s*(?:고객|인물)|포즈|시선|얼굴\s*복제|이전\s*문구|출처\s*문구|원산지|국내산|국산|연출\s*(?:이미지|사진)|예시\s*(?:이미지|사진)|이해를\s*돕기|(?:AI|인공지능)\s*(?:를|을)?\s*(?:활용|사용|생성)|가격|할인|수량|용량|한글|한국어|오탈자|비문|문법|주어|서술어|조사|문장\s*미완성|어색한\s*문구|깨진\s*글자|판독|OCR|잘림|가림|충돌|프라이팬|후라이팬|불판|그릴|정육\s*(?:트레이|용기)|고기\s*(?:트레이|용기)|김치\s*(?:통|용기|트레이)|벌크\s*(?:통|용기)|절임\s*(?:통|용기)|조리\s*(?:도구|용기)|주방\s*도구|의미\s*(?:소품|용기|배경|캐릭터|아이콘|장식)|무관한\s*(?:캐릭터|아이콘|일러스트|재료)|엉뚱한\s*(?:캐릭터|아이콘|일러스트|재료)|카테고리\s*(?:소품|용기|불일치)|source\s*(?:brand|copy|price|person)|same\s*(?:person|face|pose)|face\s*(?:cop|swap)|recognizable\s*(?:face|identity)|human\s*(?:composition|pose|framing)|target\s*audience|wrong\s*product|fake\s*(?:label|logo)|broken\s*hangul|clipp|overlap|semantic\s*(?:prop|carrier|container|vessel|motif)|decorative\s*(?:motif|character|icon|illustration)|unrelated\s*(?:character|mascot|icon|illustration|ingredient)|category[-\s]*(?:incompatible|mismatch)|cookware|frying\s*pan|meat\s*tray|kimchi\s*(?:tub|container)|마블링|육질|육섬유|두께|지방\s*(?:분포|층)|절단면|인위적|플라스틱|왁스|고무|거미줄|벌레|반복된\s*(?:결|무늬)|marbling|meat\s*texture|thickness|fat-to-lean/i.test(failure));
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

function isTimeoutLike(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) || /(?:operation was aborted|timed?\s*out|timeout|시간.*초과|진행 이벤트 없이)/i.test(message);
}

async function validStageFileWrittenSince(file: string, startedAt: number) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const info = await stat(file);
      // A full user-requested regeneration can reuse the same deterministic
      // pathname. Never mistake an older artifact for this attempt's output.
      if (info.isFile() && info.mtimeMs >= startedAt - 1_000 && (await validStageFile(file))) return true;
    } catch {
      // The image tool may still be completing its final atomic copy.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
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

  if (action === "regenerate" || action === "regenerate-new-reference") {
    const currentTruth = job.productTruth;
    const refreshedTruth = buildProductTruth({
      product: currentTruth.product,
      rawProductTitle: currentTruth.normalized.rawProductTitle,
      productImagePaths: currentTruth.imagePaths,
      imageAssets: currentTruth.imageAssets,
      source: currentTruth.product.landingUrl ? "landing-page" : "user-input",
    });
    job = await creativeGenerationJobStore.update(job.id, (active) => ({
      ...active,
      productTruth: refreshedTruth,
    }));
    initial = job.results.find((result) => result.id === input.resultId)!;
  }

  if (action === "regenerate-new-reference") {
    const excludedReferenceIds = new Set(job.results.map((result) => result.nativeCreative?.adReference?.id).filter((id): id is string => Boolean(id)));
    const [replacementReference] = await ensureNativeReferenceCopies(
      selectCategoryNativeAdReferences(job, 1, undefined, excludedReferenceIds)
    );
    if (!replacementReference) throw new Error("현재 상품과 호환되는 다른 레퍼런스가 없습니다.");
    const copyPlanning = await planReferenceAdaptedCopies({ truth: job.productTruth, references: [replacementReference] });
    const replacementCopy = copyPlanning.plans[0];
    const replacementCreativePlan = buildReferenceAdaptedCreativePlan({
      truth: job.productTruth,
      references: [replacementReference],
      copyPlans: [replacementCopy],
      provider: copyPlanning.provider,
      warnings: copyPlanning.warnings,
    });
    const projectedHook = replacementCreativePlan.hookPlans[0];
    const projectedScene = buildReferenceScenes([replacementReference], [replacementCopy])[0];
    const currentCode = initial.hookPlan.hookCode;
    job = await creativeGenerationJobStore.update(job.id, (active) => ({
      ...active,
      results: active.results.map((result) =>
        result.id === input.resultId
          ? {
              ...result,
              referenceAdaptedCopyPlan: { ...replacementCopy, id: result.referenceAdaptedCopyPlan?.id || replacementCopy.id, resultCode: currentCode },
              hookPlan: { ...projectedHook, id: result.hookPlan.id, hookCode: currentCode, title: result.hookPlan.title },
              scenePlan: { ...projectedScene, id: result.scenePlan.id, blueprintId: projectedHook.blueprintId },
              blueprintId: projectedHook.blueprintId,
              nativeCreative: {
                ...result.nativeCreative!,
                adReference: replacementReference,
                stagePaths: undefined,
                originalPath: undefined,
                finalPath: undefined,
                validation: undefined,
              },
              imagePath: undefined,
              creativeAsset: undefined,
              completedAt: undefined,
            }
          : result
      ),
    }));
    initial = job.results.find((result) => result.id === input.resultId)!;
  }

  const isRevision = ["regenerate", "regenerate-new-reference", "revise", "copy-update"].includes(action);
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
              workflow: result.nativeCreative?.workflow || CURRENT_REFERENCE_EDIT_WORKFLOW,
              stageOrder: result.nativeCreative?.stageOrder || REFERENCE_EDIT_STAGE_ORDER,
              adReference: result.nativeCreative?.adReference,
              // Old staged files may contain the removed local product-cutout
              // exception. Never reuse them after a full-AI prompt migration.
              stagePaths: action === "regenerate" || action === "regenerate-new-reference" || promptVersionChanged ? undefined : result.nativeCreative?.stagePaths,
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
  // 신규 수동·자동 작업은 생성 시 저장한 레퍼런스를 재시도·복구에서도 그대로 사용한다.
  // 최신 계약에서 누락값을 재추첨하면 같은 작업의 디자인 원본이 바뀌므로 즉시 중단한다.
  const selectedAdReferenceCandidate = initial.nativeCreative?.adReference || (usesCurrentReferenceEditPipeline(job) ? undefined : selectNativeAdReference(job, initial));
  if (!selectedAdReferenceCandidate) {
    throw new Error("이 작업에 고정된 광고 레퍼런스가 없습니다. 새 수동·자동 제작 작업을 시작해 주세요.");
  }
  const selectedAdReference = selectedAdReferenceCandidate as NativeAdReference;
  if (!(await validStageFile(selectedAdReference.path))) {
    throw new Error("선택된 고품질 광고 레퍼런스 파일을 읽을 수 없습니다.");
  }
  if (action === "regenerate" || action === "regenerate-new-reference" || !hasPublishableReferenceCopyContract(initial.referenceAdaptedCopyPlan)) {
    try {
      const replanning = await planReferenceAdaptedCopies({
        truth: job.productTruth,
        references: [selectedAdReference],
      });
      const replannedCopy = replanning.plans[0];
      if (replannedCopy && hasPublishableReferenceCopyContract(replannedCopy)) {
        const replannedCreative = buildReferenceAdaptedCreativePlan({
          truth: job.productTruth,
          references: [selectedAdReference],
          copyPlans: [replannedCopy],
          provider: replanning.provider,
          warnings: replanning.warnings,
        });
        const projectedHook = replannedCreative.hookPlans[0];
        const projectedScene = buildReferenceScenes([selectedAdReference], [replannedCopy])[0];
        const currentCode = initial.hookPlan.hookCode;
        job = await creativeGenerationJobStore.update(job.id, (active) => ({
          ...active,
          recoveryLog: [
            ...(active.recoveryLog || []),
            { at: new Date().toISOString(), message: "과거 품질 기준 미달 문구를 최신 레퍼런스 문구 계획으로 재생성", resultIds: [initial.id] },
          ].slice(-20),
          results: active.results.map((result) => result.id === initial.id
            ? {
                ...result,
                referenceAdaptedCopyPlan: {
                  ...replannedCopy,
                  id: result.referenceAdaptedCopyPlan?.id || replannedCopy.id,
                  resultCode: currentCode,
                },
                hookPlan: {
                  ...projectedHook,
                  id: result.hookPlan.id,
                  hookCode: currentCode,
                  title: result.hookPlan.title,
                },
                scenePlan: {
                  ...projectedScene,
                  id: result.scenePlan.id,
                  blueprintId: projectedHook.blueprintId,
                },
                blueprintId: projectedHook.blueprintId,
              }
            : result),
        }));
        initial = job.results.find((result) => result.id === input.resultId)!;
      }
    } catch {
      // 최신 AI 재기획이 실패해도 아래의 결정론적 최선 문구 복구를 계속 시도한다.
    }
  }
  if (!hasPublishableReferenceCopyContract(initial.referenceAdaptedCopyPlan)) {
    const bestEffortCopyPlan = await createBestEffortReferenceCopyPlan({
      truth: job.productTruth,
      reference: selectedAdReference,
      index: Math.max(0, initial.order - 1),
      previous: initial.referenceAdaptedCopyPlan,
    });
    if (!hasPublishableReferenceCopyContract(bestEffortCopyPlan)) {
      throw new Error(`소재 ${String(initial.order).padStart(2, "0")}의 문구가 품질 검수를 통과하지 못했습니다. 깨진 문구를 이미지에 넣지 않고 문구 계획을 다시 생성해야 합니다.`);
    }
    job = await creativeGenerationJobStore.update(job.id, (active) => ({
      ...active,
      errors: [...active.errors, `${initial.hookPlan.hookCode}의 품질 기준 미달 문구를 레퍼런스 구조 기반 최선 문구로 교체해 제작을 계속합니다.`].slice(-20),
      recoveryLog: [
        ...(active.recoveryLog || []),
        { at: new Date().toISOString(), message: "품질 기준 미달 레퍼런스 문구를 구조 기반 최선 문구로 교체", resultIds: [initial.id] },
      ].slice(-20),
      results: active.results.map((result) => result.id === initial.id
        ? {
            ...result,
            referenceAdaptedCopyPlan: bestEffortCopyPlan,
            hookPlan: {
              ...result.hookPlan,
              headline: bestEffortCopyPlan.headline,
              body: bestEffortCopyPlan.subCopy,
              proof: bestEffortCopyPlan.proof,
              offer: bestEffortCopyPlan.offer,
              cta: bestEffortCopyPlan.cta,
              factIds: bestEffortCopyPlan.factIds,
              numericTokens: extractNumericTokens([bestEffortCopyPlan.headline, bestEffortCopyPlan.subCopy, bestEffortCopyPlan.proof, bestEffortCopyPlan.offer, bestEffortCopyPlan.cta].join(" ")),
              validationStatus: "fallback",
              validationErrors: bestEffortCopyPlan.validationErrors,
              generationSource: "fallback",
            },
          }
        : result),
    }));
    initial = job.results.find((result) => result.id === input.resultId)!;
  }
  referenceMs = Date.now() - referenceStarted;
  const directory = nativeHookDirectory(job.advertiserId || "unknown-advertiser", job.id, initial.hookPlan.hookCode);
  await mkdir(directory, { recursive: true });
  const runtime = resolveFastCreativeRuntime();
  const productRenderingPolicy = resolveProductRenderingPolicy(job);
  const protectedProductSource = productRenderingPolicy === "protected-packaged-product" ? selectProtectedProductSource(job) : undefined;
  if (productRenderingPolicy === "protected-packaged-product" && !protectedProductSource) {
    throw new Error("포장 상품 원본을 보호할 실제 상품 이미지가 없습니다. 현재 상품 URL의 패키지 원본을 다시 분석해 주세요.");
  }
  let protectedCompositeIndex = 0;
  async function restoreProtectedProduct(scenePath: string) {
    if (!protectedProductSource) return scenePath;
    protectedCompositeIndex += 1;
    const outputPath = path.join(directory, `protected-product-${protectedCompositeIndex}.png`);
    await createIdentityLockedProductComposite({
      scenePath,
      productImagePath: protectedProductSource.path,
      productTransparent: protectedProductSource.transparent,
      placement: resolveProtectedProductPlacement(job.results.find((result) => result.id === input.resultId)!),
      outputPath,
    });
    await validateGeneratedFinal(outputPath);
    return outputPath;
  }
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
  if (action === "regenerate" || action === "regenerate-new-reference") {
    structurePath = undefined;
    productPath = undefined;
    copyPath = undefined;
    qaRepairPaths = [];
  } else if (action === "copy-update") {
    copyPath = undefined;
    qaRepairPaths = [];
  }

  // A Codex child turn can write its deterministic output and then miss the
  // final turn.completed event. Recover those valid files before opening a new
  // image session, but never do so for an explicit user regeneration or after
  // a prompt migration.
  if (action === "generate" && !promptVersionChanged) {
    const recoveredProductPath = path.join(directory, "02-product.png");
    const recoveredCopyPath = path.join(directory, "03-copy.png");
    const previousProductPath = productPath;
    const previousCopyPath = copyPath;
    if (!(await validStageFile(productPath)) && (await validStageFile(recoveredProductPath))) {
      productPath = recoveredProductPath;
    }
    if (await validStageFile(productPath)) {
      if (!(await validStageFile(copyPath)) && (await validStageFile(recoveredCopyPath))) {
        copyPath = recoveredCopyPath;
      }
    }
    if (productPath !== previousProductPath || copyPath !== previousCopyPath) {
      const recoveredStages = [productPath !== previousProductPath ? "상품 교체" : undefined, copyPath !== previousCopyPath ? "문구 교체" : undefined].filter(Boolean).join("·");
      job = await creativeGenerationJobStore.update(job.id, (current) => ({
        ...current,
        recoveryLog: [
          ...(current.recoveryLog || []),
          { at: new Date().toISOString(), message: `시간 초과 뒤 저장된 ${recoveredStages} 단계 파일을 복구`, resultIds: [input.resultId] },
        ].slice(-20),
        results: current.results.map((result) =>
          result.id === input.resultId
            ? {
                ...result,
                nativeCreative: {
                  ...result.nativeCreative!,
                  stagePaths: {
                    ...(result.nativeCreative?.stagePaths || {}),
                    ...(productPath ? { productPath } : {}),
                    ...(copyPath ? { copyPath } : {}),
                  },
                },
              }
            : result
        ),
      }));
    }
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
    async function requireActiveJob() {
      const activeJob = await creativeGenerationJobStore.get(input.jobId);
      if (!activeJob) throw new Error("작업을 찾지 못했습니다.");
      if (activeJob.status === "cancelled") throw new Error("취소된 작업입니다.");
      job = activeJob;
    }

    async function runStage(stage: "product-replacement" | "copy-replacement" | "qa-repair", generationStage: "product-replacing" | "copy-replacing" | "qa-repairing", outputPath: string, sourceImagePath: string, feedback?: string) {
      await requireActiveJob();
      job = await updateNativeProgress(job, input.resultId, generationStage);
      const generationStarted = Date.now();
      try {
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
      } catch (error) {
        if (!isTimeoutLike(error) || !(await validStageFileWrittenSince(outputPath, generationStarted))) throw error;
        job = await creativeGenerationJobStore.update(job.id, (current) => ({
          ...current,
          recoveryLog: [
            ...(current.recoveryLog || []),
            { at: new Date().toISOString(), message: `${generationStage} 완료 파일을 Codex 완료 이벤트 지연 뒤 복구`, resultIds: [input.resultId] },
          ].slice(-20),
        }));
      } finally {
        generationMs += Date.now() - generationStarted;
      }
      // Provider 호출은 즉시 중단할 수 없지만, 취소가 들어오면 그 결과를 다음
      // 문구 교체·QA 단계로 넘기지 않고 현재 생성 호출 경계에서 종료한다.
      await requireActiveJob();
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
    if (action !== "revalidate") generatedPath = await restoreProtectedProduct(generatedPath);
    await validateGeneratedFinal(generatedPath);

    // 수정 요청은 기존 결과를 재검수하는 데서 끝내지 않고, 사용자의 지시를 반영한
    // 완성 광고 전체 래스터 편집을 반드시 한 번 수행한다.
    if (action === "revise") {
      const repairedPath = path.join(directory, `04-qa-repair-user-${revisionCount}-${qaRepairPaths.length + 1}.png`);
      await runStage("qa-repair", "qa-repairing", repairedPath, generatedPath, input.feedback || "사용자 수정 요청을 반영해 상품·로고·가격·한국어를 포함한 광고 전체 래스터를 다시 완성해 주세요.");
      qaRepairPaths.push(repairedPath);
      generatedPath = await restoreProtectedProduct(repairedPath);
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
        const currentResult = job.results.find((result) => result.id === input.resultId)!;
        const requiredLines = currentResult.referenceAdaptedCopyPlan?.adaptedLines || [currentResult.hookPlan.headline, currentResult.hookPlan.body, currentResult.hookPlan.proof, currentResult.hookPlan.offer, currentResult.hookPlan.cta].filter(Boolean);
        validation = enforceExactRenderedCopyValidation(validation, requiredLines);
        validation = enforceReferenceCopyPlanValidity(validation, currentResult.referenceAdaptedCopyPlan);
        validation = enforceReferenceCopySlotCompleteness(validation, currentResult.referenceAdaptedCopyPlan?.copySlots);
        validation = enforceNoSourceDisclosureCopy(validation);
        validation = enforceOriginCopyPolicy(validation, job.productTruth.product);
      } catch {
        validation = manualReviewValidation("AI 완성 광고 검수 응답을 받지 못해 사람 검수가 필요합니다.");
      }
      validationMs += Date.now() - validationStarted;
      const criticalFailure = hasCriticalNativeQaFailure(validation, resolveProductRenderingPolicy(job) === "natural-meat-reference");
      if (validation.recommendation !== "revise" || !criticalFailure || action === "revalidate" || attempt >= Math.min(1, runtime.autoRevisionLimit)) break;
      const repairedPath = path.join(directory, `04-qa-repair-${attempt + 1}.png`);
      await runStage("qa-repair", "qa-repairing", repairedPath, generatedPath, [input.feedback, conciseQaFeedback(validation)].filter(Boolean).join("\n"));
      qaRepairPaths.push(repairedPath);
      generatedPath = await restoreProtectedProduct(repairedPath);
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
              // 결과 파일은 검수 실패 때도 다운로드 가능하게 보존하되, 승인되지
              // 않은 결과를 정상 성공으로 표시하지 않는다.
              status: validation.recommendation === "approve" ? "success" : "quality-review",
              generationStage: "completed",
              imagePath: publicImage,
              downloadName: assetResult.asset.fileName,
              creativeAsset: toCreativeAssetSnapshot(assetResult.asset),
              nativeCreative: {
                engine: current.engine || "codex_local",
                workflow: CURRENT_REFERENCE_EDIT_WORKFLOW,
                stageOrder: REFERENCE_EDIT_STAGE_ORDER,
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
                provenance: {
                  workflow: CURRENT_REFERENCE_EDIT_WORKFLOW,
                  stageOrder: REFERENCE_EDIT_STAGE_ORDER,
                  referenceId: selectedAdReference.id,
                  referenceSourcePath: selectedAdReference.path,
                  referenceRawCopy: result.referenceAdaptedCopyPlan?.referenceRawCopy || selectedAdReference.nativeCopy?.rawText,
                  adaptedCopy: [result.hookPlan.headline, result.hookPlan.body, result.hookPlan.proof, result.hookPlan.offer, result.hookPlan.cta].filter(Boolean).join("\n"),
                  productSourcePaths: generationReferences,
                  sourceProductImageIds: job.productTruth.imageAssets.filter((asset) => generationReferences.includes(asset.path)).map((asset) => asset.id),
                  finalImageId: result.id,
                  editableRegions: ["source-product", "source-person-identity", "incompatible-semantic-carrier", "incompatible-product-linked-character-or-icon", "source-brand-logo", "source-product-copy", "verified-price-offer", "reference-cta-when-present", "minimal-product-accent"],
                  lockedRegions: ["compatible-background", "animals", "compatible-props", "camera", "composition", "text-box-position", "neutral-non-product-graphics", ...(productRenderingPolicy === "protected-packaged-product" ? ["immutable-current-product-raster"] : [])],
                  productReplacementSummary: "선택 레퍼런스의 상품과 상품 의미가 충돌하는 용기·소품·캐릭터·아이콘을 URL 상품 근거에 맞게 교체",
                  copyReplacementSummary: "원문 줄·문장부호·말투를 기준으로 ProductTruth 상품 관련 표현만 교체",
                  finalOutputPath: finalFile,
                  productQa: { status: validation.productIdentity >= 75 ? "passed" : "manual-review", score: validation.productIdentity },
                  referencePreservationDetails: { status: validation.composition >= 75 ? "passed" : "manual-review", score: validation.composition },
                  copyQaDetails: { status: validation.factualAccuracy >= 75 && validation.koreanTextAccuracy >= 75 && validation.commercialQuality >= 75 ? "passed" : "manual-review", factualAccuracy: validation.factualAccuracy, koreanTextAccuracy: validation.koreanTextAccuracy },
                  sceneCopyAlignmentDetails: { status: validation.hookAlignment >= 70 ? "passed" : "manual-review", score: validation.hookAlignment },
                  referencePreservationQa: validation.recommendation === "approve" ? "passed" : "manual-review",
                  copyQa: validation.factualAccuracy >= 75 && validation.koreanTextAccuracy >= 75 && validation.commercialQuality >= 75 ? "passed" : "manual-review",
                  sceneCopyAlignmentQa: validation.hookAlignment >= 70 ? "passed" : "manual-review",
                  groupDiversityQa: current.groupValidation?.recommendation === "approve" ? "passed" : "manual-review",
                },
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
