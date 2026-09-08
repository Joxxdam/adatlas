import "server-only";
import { creativeGenerationJobStore } from "./jobStore.server";
import { createGenerationJob } from "./planner";
import { buildProductTruth, cleanProductTitle, isPlausibleTargetCustomer, isPromotionLike } from "./productTruth";
import { type CreateGenerationJobInput, type GenerationJob, type ReferenceCategoryOverride } from "./types";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server";
import { canonicalAdvertiserDisplayName, resolveAdvertiserIdentity } from "./advertiserIdentity";
import { writeNativeManifest } from "./nativeCreativeStorage.server";
import { defaultAdBrief } from "../mvp/adBrief";
import type { AdBrief } from "../mvp/types";
import { cancelQueuedGenerationJob, enqueueGenerationJob } from "./jobRunner.server";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";
import { buildCreativePlanFingerprint } from "./creativePlanCache.server";
import { ensureNativeReferenceCopies, selectCategoryNativeAdReferences } from "./referenceCreativeLibrary.server";
import { assertDefaultCodexGenerationJob, CURRENT_REFERENCE_EDIT_JOB_VERSION } from "./jobRunnerPolicy";
import { isMalformedProductSignal, isMerchantCredentialCreativeSignal, isNonDomesticOriginCreativeSignal, isPriceOnlyCreativeSignal, isProhibitedAdCopySignal, isShippingCreativeSignal, isVagueStandaloneSensoryClaim } from "./productSignalHygiene.ts";
import { isDifferentProductImage } from "../mvp/productImageIdentity.ts";
import { applyOriginalSourceVendorResearch } from "../product-research/originalSourceResearch.ts";
import { appendCodexGenerationAdditionalInstructions, buildDefaultCodexGenerationPrompt, DEFAULT_CODEX_GENERATION_PIPELINE, DEFAULT_CODEX_GENERATION_PROMPT_VERSION, DEFAULT_CODEX_GENERATION_STAGE_ORDER, DEFAULT_CODEX_GENERATION_WORKFLOW, normalizeCodexGenerationAdditionalInstructions, normalizeDefaultCodexGenerationPrompt } from "./codexDirectTest.ts";
import { buildDefaultCodexGenerationPlan } from "./defaultCodexGenerationPlan.server";

const objectives = new Set<AdBrief["adObjective"]>(["purchase", "signup", "awareness", "retargeting"]);
const approaches = new Set<AdBrief["creativeIntensity"]>(["brand", "balanced", "performance"]);
const referenceCategoryOverrides = new Set<ReferenceCategoryOverride>(["all", "fashion", "food", "food-meat", "food-snack", "food-other", "food-produce", "beauty", "beauty-design", "beauty-hook"]);
const internalStrategyText = /(?:T0\d|주력\s*상품|우승\s*소재|판매[·ㆍ,\s-]*노출[·ㆍ,\s-]*구매\s*근거|기존\s*우수\s*소재|광고\s*가설|성과\s*학습|USP[·ㆍ,\s-]*가격[·ㆍ,\s-]*랜딩\s*조건\s*점검|랜딩\s*(?:조건|페이지)\s*(?:점검|확인)|내부\s*(?:전략|점검|검토))/i;

export type NativeGenerationJobOptions = {
  autoStart?: boolean;
  sourceType?: GenerationJob["sourceType"];
  manualQueue?: GenerationJob["manualQueue"];
  requestedBy?: GenerationJob["requestedBy"];
  autoProductionRunId?: string;
  autoProductionTaskId?: string;
};

function resolveAdBrief(value: Partial<AdBrief> | undefined): AdBrief {
  return {
    ...defaultAdBrief,
    ...value,
    adObjective: value?.adObjective && objectives.has(value.adObjective) ? value.adObjective : defaultAdBrief.adObjective,
    creativeIntensity: value?.creativeIntensity && approaches.has(value.creativeIntensity) ? value.creativeIntensity : defaultAdBrief.creativeIntensity,
    mandatoryInfo: Array.isArray(value?.mandatoryInfo) ? value.mandatoryInfo.slice(0, 20) : [],
    prohibitedClaims: Array.isArray(value?.prohibitedClaims) ? value.prohibitedClaims.slice(0, 20) : [],
  };
}

function conciseVerifiedBenefit(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/[★☆*✅⚡💥]+/gu, " ")
    .replace(/마블링\s*적당해요\s*\(\s*육이\s*숙성되어\s*감칠맛\s*2배\s*\)/giu, "적당한 마블링과 숙성으로 살린 감칠맛")
    .replace(/설록우\s*\(\s*찰진\s*등심\s*\)/giu, "설록우 찰진등심")
    .replace(/국내산\s*\/\s*/giu, "국내산 ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(?:마블링|향|식감|구성)\s*(?:정도|정보)$/u.test(normalized)) return "";
  const matchedCue = normalized.match(/(?:쿨링감|보습감|사용감|세정력|흡수력|지속력|휴대성|식감|향|구성)(?:으로|로|이|가|은|는)?[^,.!?]{0,34}/u)?.[0];
  const cue = matchedCue && !isVagueStandaloneSensoryClaim(matchedCue) ? matchedCue : "";
  const segment = normalized
    .split(/\s*[·•|]\s*|[.!?]+\s*|\s*[★☆*]\s*/u)
    .map((candidate) => candidate.trim())
    .find((candidate) => Array.from(candidate.replace(/\s/g, "")).length >= 4 && Array.from(candidate.replace(/\s/g, "")).length <= 62);
  return (cue || segment || (Array.from(normalized.replace(/\s/g, "")).length <= 62 ? normalized : "")).trim();
}

function sanitizeProductForCreative(product: CreateGenerationJobInput["product"]) {
  const unsafe = (value: string | undefined) => Boolean(value && (internalStrategyText.test(value) || isProhibitedAdCopySignal(value) || isMerchantCredentialCreativeSignal(value) || isMalformedProductSignal(value) || isPriceOnlyCreativeSignal(value) || isShippingCreativeSignal(value) || isNonDomesticOriginCreativeSignal(value) || isPromotionLike(value)));
  const cleanList = (values?: string[]) => (values || []).map((value) => value.trim()).filter((value) => value && !unsafe(value));
  const ingredients = cleanList(product.ingredients);
  const verifiedBenefits = Array.from(new Set(cleanList(product.verifiedBenefits).map(conciseVerifiedBenefit).filter(Boolean)));
  const mainBenefitCandidate = unsafe(product.mainBenefit) ? verifiedBenefits[0] || ingredients[0] || "" : product.mainBenefit || "";
  const mainBenefit = conciseVerifiedBenefit(mainBenefitCandidate);
  const extractedDescription = (product.extractedDescription || "")
    .split(/\s*[·•|]\s*|[.!?]\s+/)
    .map((value) => value.trim())
    .filter((value) => value && !unsafe(value))
    .map(conciseVerifiedBenefit)
    .filter(Boolean)
    .slice(0, 6)
    .join(" · ");
  return {
    ...product,
    productName: cleanProductTitle(product.productName.replace(/\s*\(\d+\)\s*$/, "").trim(), product.brandName || product.advertiserName || ""),
    mainBenefit,
    targetCustomer: !unsafe(product.targetCustomer) && isPlausibleTargetCustomer(product.targetCustomer, [mainBenefit, ...verifiedBenefits]) ? product.targetCustomer : "",
    extractedDescription,
    verifiedBenefits,
    ingredients,
    discountInfo: isShippingCreativeSignal(product.discountInfo) ? "" : product.discountInfo,
  };
}

function isAutomaticCutoutPath(value: string) {
  return /\/(?:processed-products|product-cutouts)\//i.test(value);
}

function normalizedImagePath(value: unknown) {
  return String(value || "").trim();
}

/**
 * 새 URL 분석 뒤에도 클라이언트의 이전 선택 배열이 잠깐 남을 수 있습니다.
 * 서버에서는 현재 ProductInfo가 직접 소유한 경로만 상품 원본으로 승격해,
 * 다른 상품의 이미지가 새 작업의 user-confirmed 자산으로 복사되지 않게 합니다.
 */
function currentProductImagePaths(input: CreateGenerationJobInput, product: CreateGenerationJobInput["product"]) {
  const declared = [
    product.extractedMainImage,
    ...(product.confirmedProductImagePaths || []),
    ...(product.productImagePaths || []),
    product.productImagePath,
    product.secondaryProductImagePath,
    product.selectedSourceImagePath,
    ...(product.extractedGalleryImages || []),
    ...(product.sourceImageCandidates || []).map((candidate) => candidate.imagePath),
  ].map(normalizedImagePath).filter((imagePath) => Boolean(imagePath) && !isDifferentProductImage(product.landingUrl, imagePath));
  const declaredSet = new Set(declared);
  // 분석 결과가 아직 별도 필드로 승격되지 않은 업로드 흐름만 요청 경로를
  // 기준으로 허용합니다. 현재 상품 경로가 하나라도 있으면 교집합만 받습니다.
  const requested = (input.productImagePaths || []).map(normalizedImagePath).filter((imagePath) => Boolean(imagePath) && !isDifferentProductImage(product.landingUrl, imagePath));
  const acceptedRequested = declaredSet.size ? requested.filter((imagePath) => declaredSet.has(imagePath)) : requested;
  const acceptedSelected = (input.selectedAdImages || [])
    .map(normalizedImagePath)
    .filter((imagePath) => !isDifferentProductImage(product.landingUrl, imagePath) && (declaredSet.has(imagePath) || acceptedRequested.includes(imagePath)));
  return {
    allPaths: Array.from(new Set([...acceptedSelected, ...acceptedRequested, ...declared])),
    // 사용자가 상품 카드에서 제작을 확정한 뒤 클라이언트가 전달한 경로는
    // 현재 ProductInfo가 소유한 경로와 교집합을 통과한 경우에만 제작 근거로
    // 승격합니다. 이렇게 하면 다른 상품 이미지는 막으면서도 대표·상세 원본이
    // 별도 이미지 선택 UI를 거치지 않았다는 이유로 제작이 차단되지 않습니다.
    userConfirmedPaths: Array.from(new Set([...acceptedSelected, ...acceptedRequested])),
  };
}

function normalizeReferenceCategoryOverride(value: unknown): ReferenceCategoryOverride | undefined {
  return typeof value === "string" && referenceCategoryOverrides.has(value as ReferenceCategoryOverride) ? (value as ReferenceCategoryOverride) : undefined;
}

export async function createNativeGenerationJob(input: CreateGenerationJobInput, options: NativeGenerationJobOptions = {}) {
  const started = Date.now();
  if (!input.product?.productName?.trim()) throw new Error("먼저 상품정보를 불러와 주세요.");
  if (input.engine === "openai_api") {
    throw new Error("기본 이미지 제작은 로컬 Codex 로그인 엔진만 사용합니다.");
  }
  const engine = "codex_local" as const;
  const imageProvider = createCreativeGenerationProvider(engine);
  const providerStatus = await imageProvider.status();
  if (!providerStatus.available) {
    throw new Error(`${providerStatus.detail} 다른 엔진이나 기존 배경으로 자동 전환하지 않습니다.`);
  }
  // 장시간 떠 있는 자동 러너나 이전 화면 상태가 오래된 상품 분석 payload를
  // 넘겨도 작업 생성 직전에 최신 업체 조사본을 다시 결합한다. 수동·자동 모두
  // 이 한 지점을 통과하므로 OCR/시트 근거가 생성 작업에서 누락되지 않는다.
  const researchedProduct = applyOriginalSourceVendorResearch(input.product, input.product.landingUrl);
  // 수동 URL 분석은 광고주명이 비어 들어오는 경우가 많습니다. 도메인에 이미
  // 등록된 광고주명은 ProductTruth를 만들기 전에 결합해야 상세 OCR의 쇼핑몰명·
  // 브랜드명이 상품 USP나 헤드라인으로 승격되지 않습니다.
  const resolvedAdvertiser = resolveAdvertiserIdentity(researchedProduct);
  const canonicalAdvertiserName = canonicalAdvertiserDisplayName({
    advertiserId: researchedProduct.creativeContext?.advertiserId || resolvedAdvertiser.id,
    advertiserName: researchedProduct.advertiserName,
    brandName: researchedProduct.brandName,
    landingUrl: researchedProduct.landingUrl,
  });
  const identifiedProduct = researchedProduct.advertiserName?.trim()
    ? researchedProduct
    : { ...researchedProduct, advertiserName: canonicalAdvertiserName };
  const rawProductTitle = identifiedProduct.productName;
  const product = sanitizeProductForCreative(identifiedProduct);
  const resolvedPaths = currentProductImagePaths(input, product);
  const originals = resolvedPaths.allPaths.filter((value) => !isAutomaticCutoutPath(value));
  if (!originals.length) {
    throw new Error("광고 제작에 사용할 상세페이지 원본 상품 이미지가 없습니다. 상품을 다시 분석하거나 위 원본 이미지에서 실제 상품 사진을 선택해 주세요.");
  }
  const directProductImagePath = normalizedImagePath(input.codexDirectTest?.productImagePath);
  const directSupportingImagePath = normalizedImagePath(input.codexDirectTest?.supportingImagePath);
  const directPackagingImagePath = normalizedImagePath(input.codexDirectTest?.packagingImagePath);
  const directBasePrompt = normalizeDefaultCodexGenerationPrompt(input.codexDirectTest?.prompt) || buildDefaultCodexGenerationPrompt({
    landingUrl: product.landingUrl,
    hasSupportingImage: Boolean(directSupportingImagePath),
    hasPackagingImage: Boolean(directPackagingImagePath),
  });
  const directAdditionalInstructions = normalizeCodexGenerationAdditionalInstructions(input.codexDirectTest?.additionalInstructions);
  const directPrompt = appendCodexGenerationAdditionalInstructions(directBasePrompt, directAdditionalInstructions);
  // 화면에서 선택한 2·3·4번 첨부는 자동 역할 분류·점수화 없이 그대로 사용합니다.
  // 전체 상세페이지 후보를 기준으로 검증하므로 뒤쪽 이미지를 골라도 잘리지 않습니다.
  const currentPathSet = new Set(resolvedPaths.allPaths);
  if (!directProductImagePath || !currentPathSet.has(directProductImagePath)) {
    throw new Error("상품 이미지는 현재 선택한 상품의 상세페이지 이미지에서 골라 주세요.");
  }
  if (directSupportingImagePath && (!currentPathSet.has(directSupportingImagePath) || directSupportingImagePath === directProductImagePath)) {
    throw new Error("라벨·추가 참고 이미지는 같은 상품의 다른 상세페이지 이미지에서 골라 주세요.");
  }
  if (directPackagingImagePath && (
    !currentPathSet.has(directPackagingImagePath)
    || directPackagingImagePath === directProductImagePath
    || directPackagingImagePath === directSupportingImagePath
  )) {
    throw new Error("포장상품 이미지는 같은 상품의 다른 상세페이지 이미지에서 골라 주세요.");
  }
  const directReferencePaths = [directProductImagePath, directSupportingImagePath, directPackagingImagePath].filter((value): value is string => Boolean(value));
  const productReferencePaths = directReferencePaths;
  const allowedProductPaths = new Set(productReferencePaths);
  const currentProductAssets = (input.imageAssets || []).filter((asset) =>
    allowedProductPaths.has(normalizedImagePath(asset.path)) && asset.role !== "ad-reference"
  );
  const rawTruth = buildProductTruth({
    product,
    rawProductTitle,
    // 다른 상품 번호를 배제하고 현재 ProductInfo 소유 경로와 교집합을 통과한
    // 대표·상세 원본만 제작 근거로 전달합니다.
    productImagePaths: directReferencePaths,
    selectedAdImages: [],
    imageAssets: currentProductAssets,
    source: input.source === "landing-page" ? "landing-page" : "user-input",
  });
  // 사용자가 고른 원본을 그대로 첨부한다. 기존 합성용 자동 역할·텍스트·세로
  // 비율 검사를 다시 적용하면 명시적으로 고른 라벨/상세 원본이 탈락할 수 있다.
  const truth = rawTruth;
  const adBrief = resolveAdBrief(input.adBrief);
  const paidImageGenerationEnabled = false;
  const runtime = resolveFastCreativeRuntime();
  const configuredConcurrency = runtime.concurrency;
  const advertiser = resolveAdvertiserIdentity(product);
  const advertiserId = product.creativeContext?.advertiserId || advertiser.id;
  const advertiserName = product.advertiserName || advertiser.name;
  const planningFingerprint = buildCreativePlanFingerprint(truth);
  const referenceCategoryOverride = normalizeReferenceCategoryOverride(input.referenceCategoryOverride);
  const selectedAdReferences = await ensureNativeReferenceCopies(
    selectCategoryNativeAdReferences({ productTruth: truth, referenceCategoryOverride }, 6)
  );
  const { creativePlan, scenes } = buildDefaultCodexGenerationPlan({
    truth,
    references: selectedAdReferences,
    logoPath: input.logoPath,
    adBrief,
  });
  const configuredRetries = runtime.autoRevisionLimit;
  const job = createGenerationJob({
    truth,
    creativePlan,
    scenes,
    concurrency: configuredConcurrency,
    retryLimit: configuredRetries,
    paidImageGenerationEnabled,
    productReferenceProfile: undefined,
    planningMs: Date.now() - started,
  });
  job.engine = engine;
  job.referenceCategoryOverride = referenceCategoryOverride;
  job.results = job.results.map((result, index) => ({
    ...result,
    materialCode: `M${String(index + 1).padStart(2, "0")}`,
    status: result.status,
    error: undefined,
    completedAt: undefined,
    referenceAdaptedCopyPlan: undefined,
    nativeCreative: {
      engine,
      workflow: DEFAULT_CODEX_GENERATION_WORKFLOW,
      stageOrder: DEFAULT_CODEX_GENERATION_STAGE_ORDER,
      adReference: selectedAdReferences[index],
      referencePaths: [],
      revisionPaths: [],
      promptVersion: DEFAULT_CODEX_GENERATION_PROMPT_VERSION,
      revisionCount: 0,
    },
  }));
  job.paidApiAuthorization = undefined;
  job.paidApiUsed = false;
  job.advertiserId = advertiserId;
  job.advertiserName = advertiserName;
  job.visualDiversityMatrix = undefined;
  job.sourceType = options.sourceType || "manual";
  job.requestedBy = job.sourceType === "manual" ? options.requestedBy : undefined;
  job.manualQueue = job.sourceType === "manual"
    ? options.manualQueue || {
        requestedAt: job.createdAt,
        sequence: new Date(job.createdAt).getTime() * 1_000,
      }
    : undefined;
  job.autoProductionRunId = options.autoProductionRunId;
  job.autoProductionTaskId = options.autoProductionTaskId;
  job.hookLearningApplied = false;
  job.representativeResultId = job.results[0]?.id;
  job.planningFingerprint = planningFingerprint;
  job.templateRegistryVersion = CURRENT_REFERENCE_EDIT_JOB_VERSION;
  job.unusedPerformanceTemplateIds = [];
  job.referenceCopyProfiles = [];
  job.referenceCopyPlanning = undefined;
  job.copyPlanMode = undefined;
  job.version = CURRENT_REFERENCE_EDIT_JOB_VERSION;
  job.pipeline = DEFAULT_CODEX_GENERATION_PIPELINE;
  job.codexDirectTest = {
    prompt: directPrompt,
    productImagePath: directProductImagePath,
    supportingImagePath: directSupportingImagePath || undefined,
    packagingImagePath: directPackagingImagePath || undefined,
    additionalInstructions: directAdditionalInstructions || undefined,
  };
  assertDefaultCodexGenerationJob(job);
  if (job.sourceType === "manual") {
    // 수동 새 작업은 같은 상품의 이전 수동 작업만 교체한다. 자정 자동 제작과
    // 수동 제작이 겹쳐도 서로의 서버 작업을 취소하지 않는다.
    const superseded = await creativeGenerationJobStore.supersedeActiveForProduct(
      job.productTruth.product.landingUrl,
      undefined,
      "manual",
      job.requestedBy?.subject ?? null
    );
    superseded.forEach((previous) => cancelQueuedGenerationJob(previous.id));
  }
  await creativeGenerationJobStore.create(job);
  await writeNativeManifest(job);
  if (options.autoStart !== false) {
    enqueueGenerationJob(job.id, { priority: job.sourceType === "manual" });
  }
  return job;
}
