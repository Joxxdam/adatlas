import "server-only";
import { creativeGenerationJobStore } from "./jobStore.server";
import { buildExplorationCreativePlan, createGenerationJob, planAiScenes } from "./planner";
import { buildProductTruth, cleanProductTitle } from "./productTruth";
import { assertNativeProductReferenceReady, inspectProductTruthImages } from "./productImages.server";
import { analyzeProductReferences } from "./referenceAnalyzer.server";
import { hasExplicitPaidApiAuthorization, type CreateGenerationJobInput, type GenerationJob, type ReferenceCategoryOverride } from "./types";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server";
import { resolveAdvertiserIdentity } from "./advertiserIdentity";
import { buildVisualDiversityMatrix, validateVisualDiversityMatrix } from "./visualDiversity";
import { writeNativeManifest } from "./nativeCreativeStorage.server";
import { defaultAdBrief } from "../mvp/adBrief";
import type { AdBrief } from "../mvp/types";
import { matchCategoryProfile } from "./profiles";
import { readCategoryHookPrior } from "./hookLearning.server";
import { cancelQueuedGenerationJob, enqueueGenerationJob } from "./jobRunner.server";
import { planHooksWithCodexLocal } from "./CodexLocalHookPlanner.server";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";
import { buildCreativePlanFingerprint, readCreativePlanCache, writeCreativePlanCache } from "./creativePlanCache.server";
import { REFERENCE_CREATIVE_GRAMMAR_VERSION, selectCreativeGrammar } from "./referenceCreativeGrammar";
import { assertCreativeCopyAllowed, looksLikeGenericOrRepetitiveCopy, repairBannedCreativeSentence } from "./bannedCreativePhrases";
import { NATIVE_FINAL_PROMPT_VERSION } from "./nativeCreativePrompt";
import { selectCategoryNativeAdReferences } from "./referenceCreativeLibrary.server";

const objectives = new Set<AdBrief["adObjective"]>(["purchase", "signup", "awareness", "retargeting"]);
const approaches = new Set<AdBrief["creativeIntensity"]>(["brand", "balanced", "performance"]);
const referenceCategoryOverrides = new Set<ReferenceCategoryOverride>(["fashion", "food", "food-produce", "beauty"]);
const internalStrategyText = /(?:T0\d|주력\s*상품|우승\s*소재|판매[·ㆍ,\s-]*노출[·ㆍ,\s-]*구매\s*근거|기존\s*우수\s*소재|광고\s*가설|성과\s*학습|USP[·ㆍ,\s-]*가격[·ㆍ,\s-]*랜딩\s*조건\s*점검|랜딩\s*(?:조건|페이지)\s*(?:점검|확인)|내부\s*(?:전략|점검|검토))/i;

export type NativeGenerationJobOptions = {
  autoStart?: boolean;
  sourceType?: GenerationJob["sourceType"];
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
  const normalized = value.replace(/\s+/g, " ").trim();
  const cue = normalized.match(/(?:쿨링감|보습감|사용감|세정력|흡수력|지속력|휴대성|식감|향|구성)(?:으로|로|이|가|은|는)?[^,.!?]{0,34}/u)?.[0];
  return (cue || normalized.split(/[,\n]/)[0] || normalized).trim();
}

function sanitizeProductForCreative(product: CreateGenerationJobInput["product"]) {
  const cleanList = (values?: string[]) => (values || []).map((value) => value.trim()).filter((value) => value && !internalStrategyText.test(value));
  const verifiedBenefits = cleanList(product.verifiedBenefits);
  const ingredients = cleanList(product.ingredients);
  const mainBenefit = internalStrategyText.test(product.mainBenefit || "") ? conciseVerifiedBenefit(verifiedBenefits[0] || ingredients[0] || "") : product.mainBenefit;
  return {
    ...product,
    productName: cleanProductTitle(product.productName.replace(/\s*\(\d+\)\s*$/, "").trim(), product.brandName || product.advertiserName || ""),
    mainBenefit,
    targetCustomer: internalStrategyText.test(product.targetCustomer || "") ? "" : product.targetCustomer,
    verifiedBenefits,
    ingredients,
  };
}

function isAutomaticCutoutPath(value: string) {
  return /\/(?:processed-products|product-cutouts)\//i.test(value);
}

function normalizeReferenceCategoryOverride(value: unknown): ReferenceCategoryOverride | undefined {
  return typeof value === "string" && referenceCategoryOverrides.has(value as ReferenceCategoryOverride) ? (value as ReferenceCategoryOverride) : undefined;
}

export async function createNativeGenerationJob(input: CreateGenerationJobInput, options: NativeGenerationJobOptions = {}) {
  const started = Date.now();
  if (!input.product?.productName?.trim()) throw new Error("먼저 상품정보를 불러와 주세요.");
  const engine = input.engine === "openai_api" ? "openai_api" : "codex_local";
  const explicitPaidApiAuthorization = hasExplicitPaidApiAuthorization(input.paidApiAuthorization);
  const imageProvider = createCreativeGenerationProvider(engine, {
    explicitPaidApiAuthorization,
  });
  const providerStatus = await imageProvider.status();
  if (!providerStatus.available) {
    throw new Error(`${providerStatus.detail} 다른 엔진이나 기존 배경으로 자동 전환하지 않습니다.`);
  }
  const rawProductTitle = input.product.productName;
  const product = sanitizeProductForCreative(input.product);
  const allPaths = Array.from(new Set([...(input.selectedAdImages || []).slice(0, 12), ...(input.productImagePaths || []).slice(0, 12), product.extractedMainImage, ...(product.productImagePaths || []), product.productImagePath, ...(product.extractedGalleryImages || [])].map((value) => String(value || "").trim()).filter(Boolean)));
  const originals = allPaths.filter((value) => !isAutomaticCutoutPath(value));
  if (!originals.length) {
    throw new Error("광고 제작에는 자동 누끼가 아닌 상세페이지 원본 상품 이미지가 필요합니다.");
  }
  const originalProductReferencePaths = originals.slice(0, 12);
  const rawTruth = buildProductTruth({
    product,
    rawProductTitle,
    productImagePaths: originalProductReferencePaths,
    selectedAdImages: [],
    imageAssets: input.imageAssets || [],
    source: input.source === "landing-page" ? "landing-page" : "user-input",
  });
  const truth = await inspectProductTruthImages(rawTruth);
  assertNativeProductReferenceReady(truth);
  const adBrief = resolveAdBrief(input.adBrief);
  const paidImageGenerationEnabled = engine === "openai_api";
  const runtime = resolveFastCreativeRuntime();
  const configuredConcurrency = runtime.concurrency;
  const experimentObjective = adBrief.adObjective === "awareness" ? "AWR" : adBrief.adObjective === "signup" ? "TRF" : "SLS";
  const categoryPrior = await readCategoryHookPrior({
    categoryId: matchCategoryProfile(truth.product).id,
    objective: experimentObjective,
  });
  const advertiser = resolveAdvertiserIdentity(product);
  const advertiserId = product.creativeContext?.advertiserId || advertiser.id;
  const advertiserName = product.advertiserName || advertiser.name;
  const planningFingerprint = buildCreativePlanFingerprint(truth);
  const cachedPlanning = await readCreativePlanCache(planningFingerprint);
  const hookPlanning = cachedPlanning || (await planHooksWithCodexLocal({ truth, advertiserId, advertiserName, prior: categoryPrior }));
  if (!cachedPlanning)
    await writeCreativePlanCache({
      fingerprint: planningFingerprint,
      ...hookPlanning,
      createdAt: new Date().toISOString(),
    });
  const creativePlan = buildExplorationCreativePlan(truth, {
    logoPath: input.logoPath,
    adBrief,
    categoryPrior,
    testCode: input.testCode,
    exploration: hookPlanning.exploration,
    copyGeneration: hookPlanning.copyGeneration,
  });
  const nonBlockingPlanningWarnings: string[] = [];
  creativePlan.hookPlans = creativePlan.hookPlans.slice(0, runtime.maxCreatives).map((hookPlan) => {
    const verifiedHeadlineFallback = hookPlan.factIds
      .map((id) => truth.facts.find((fact) => fact.id === id)?.value)
      .map((value) => repairBannedCreativeSentence(value || ""))
      .find(Boolean);
    const headline = repairBannedCreativeSentence(hookPlan.headline) || verifiedHeadlineFallback || "지금 눈여겨볼 상품 포인트";
    const body = repairBannedCreativeSentence(hookPlan.body) || repairBannedCreativeSentence(truth.product.mainBenefit || "") || "실제 상품 이미지로 형태와 구성을 확인해보세요";
    const proof = repairBannedCreativeSentence(hookPlan.proof || "");
    const offer = repairBannedCreativeSentence(hookPlan.offer || "");
    const cta = repairBannedCreativeSentence(hookPlan.cta || "") || "상품 보기";
    assertCreativeCopyAllowed(`${headline} ${body} ${proof} ${offer} ${cta}`);
    if (looksLikeGenericOrRepetitiveCopy(headline, body)) {
      nonBlockingPlanningWarnings.push(`${hookPlan.hookCode} 메인·서브 문구 유사도가 높지만 이미지 제작은 계속 진행했습니다.`);
    }
    return {
      ...hookPlan,
      headline,
      body,
      proof,
      offer,
      cta,
      creativeBrief: hookPlan.creativeBrief
        ? {
            ...hookPlan.creativeBrief,
            mainHook: headline,
            subCopy: body,
            textRendering: "ai-native-final" as const,
          }
        : hookPlan.creativeBrief,
    };
  });
  if (nonBlockingPlanningWarnings.length) {
    creativePlan.copyGeneration = {
      ...(creativePlan.copyGeneration || { provider: "fallback" as const }),
      warnings: [...(creativePlan.copyGeneration?.warnings || []), ...nonBlockingPlanningWarnings],
    };
  }
  creativePlan.hookPlans = creativePlan.hookPlans.map((hookPlan) => ({
    ...hookPlan,
    performanceTemplateId: undefined,
    creativeGrammarId: selectCreativeGrammar(hookPlan),
  }));
  creativePlan.blueprintIds = creativePlan.hookPlans.map((hookPlan) => hookPlan.blueprintId);
  const scenes = planAiScenes(creativePlan, paidImageGenerationEnabled);
  const productReferenceProfile = await analyzeProductReferences(truth);
  const configuredRetries = runtime.autoRevisionLimit;
  const job = createGenerationJob({
    truth,
    creativePlan,
    scenes,
    concurrency: configuredConcurrency,
    retryLimit: configuredRetries,
    paidImageGenerationEnabled,
    productReferenceProfile,
    planningMs: Date.now() - started,
  });
  job.engine = engine;
  // 자동 제작은 ProductTruth 자동 분류를 그대로 사용하고, 수동 제작에서만
  // 사용자가 고른 레퍼런스 풀을 작업에 고정합니다.
  job.referenceCategoryOverride = options.sourceType === "auto-production" ? undefined : normalizeReferenceCategoryOverride(input.referenceCategoryOverride);
  const selectedAdReferences = selectCategoryNativeAdReferences(job, job.results.length);
  job.results = job.results.map((result, index) => ({
    ...result,
    nativeCreative: {
      engine,
      adReference: selectedAdReferences[index],
      referencePaths: [],
      revisionPaths: [],
      promptVersion: NATIVE_FINAL_PROMPT_VERSION,
      revisionCount: 0,
    },
  }));
  job.paidApiAuthorization = engine === "openai_api" && explicitPaidApiAuthorization ? input.paidApiAuthorization : undefined;
  job.paidApiUsed = engine === "openai_api";
  job.advertiserId = advertiserId;
  job.advertiserName = advertiserName;
  job.visualDiversityMatrix = buildVisualDiversityMatrix(job.results);
  const diversity = validateVisualDiversityMatrix(job.visualDiversityMatrix);
  if (!diversity.valid) {
    job.errors = [...job.errors, `광고 구성 다양성 참고: ${diversity.errors.join(" ")} 제작은 중단하지 않았습니다.`].slice(-20);
  }
  job.sourceType = options.sourceType || "manual";
  job.autoProductionRunId = options.autoProductionRunId;
  job.autoProductionTaskId = options.autoProductionTaskId;
  job.hookLearningApplied = Object.keys(categoryPrior).length > 0;
  job.representativeResultId = job.results[0]?.id;
  job.planningFingerprint = planningFingerprint;
  job.templateRegistryVersion = REFERENCE_CREATIVE_GRAMMAR_VERSION;
  job.unusedPerformanceTemplateIds = [];
  job.version = "generation-job-v12-category-reference-edit";
  job.pipeline = "reference-staged-edit";
  if (job.sourceType === "manual") {
    // 수동 새 작업은 같은 상품의 이전 수동 작업만 교체한다. 자정 자동 제작과
    // 수동 제작이 겹쳐도 서로의 서버 작업을 취소하지 않는다.
    const superseded = await creativeGenerationJobStore.supersedeActiveForProduct(job.productTruth.product.landingUrl, undefined, "manual");
    superseded.forEach((previous) => cancelQueuedGenerationJob(previous.id));
  }
  await creativeGenerationJobStore.create(job);
  await writeNativeManifest(job);
  if (options.autoStart !== false) {
    enqueueGenerationJob(job.id, { priority: job.sourceType === "manual" });
  }
  return job;
}
