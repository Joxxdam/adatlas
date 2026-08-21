import "server-only";
import { creativeGenerationJobStore } from "./jobStore.server";
import { buildExplorationCreativePlan, createGenerationJob, planAiScenes } from "./planner";
import { buildProductTruth } from "./productTruth";
import { assertNativeProductReferenceReady, inspectProductTruthImages } from "./productImages.server";
import { analyzeProductReferences } from "./referenceAnalyzer.server";
import type { CreateGenerationJobInput, GenerationJob } from "./types";
import { createCreativeGenerationProvider } from "./providers/providerFactory.server";
import { resolveAdvertiserIdentity } from "./advertiserIdentity";
import { buildVisualDiversityMatrix, validateVisualDiversityMatrix } from "./visualDiversity";
import { writeNativeManifest } from "./nativeCreativeStorage.server";
import { defaultAdBrief } from "../mvp/adBrief";
import type { AdBrief } from "../mvp/types";
import { matchCategoryProfile } from "./profiles";
import { readCategoryHookPrior } from "./hookLearning.server";
import { enqueueGenerationJob } from "./jobRunner.server";
import { planHooksWithCodexLocal } from "./CodexLocalHookPlanner.server";
import { resolveFastCreativeRuntime } from "./fastCreativeRuntime";
import { buildCreativePlanFingerprint, readCreativePlanCache, writeCreativePlanCache } from "./creativePlanCache.server";
import { PERFORMANCE_TEMPLATE_REGISTRY_VERSION, selectPerformanceTemplates, unusedPerformanceTemplates } from "./performanceTemplateRegistry";
import { assertCreativeCopyAllowed, repairBannedCreativeSentence } from "./bannedCreativePhrases";

const objectives = new Set<AdBrief["adObjective"]>(["purchase", "signup", "awareness", "retargeting"]);
const approaches = new Set<AdBrief["creativeIntensity"]>(["brand", "balanced", "performance"]);
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
  const mainBenefit = internalStrategyText.test(product.mainBenefit || "")
    ? conciseVerifiedBenefit(verifiedBenefits[0] || ingredients[0] || "")
    : product.mainBenefit;
  return {
    ...product,
    productName: product.productName.replace(/\s*\(\d+\)\s*$/, "").trim(),
    mainBenefit,
    targetCustomer: internalStrategyText.test(product.targetCustomer || "") ? "" : product.targetCustomer,
    verifiedBenefits,
    ingredients,
  };
}

function isAutomaticCutoutPath(value: string) {
  return /\/(?:processed-products|product-cutouts)\//i.test(value);
}

export async function createNativeGenerationJob(
  input: CreateGenerationJobInput,
  options: NativeGenerationJobOptions = {}
) {
  const started = Date.now();
  if (!input.product?.productName?.trim()) throw new Error("먼저 상품정보를 불러와 주세요.");
  const engine = input.engine === "openai_api" ? "openai_api" : "codex_local";
  const imageProvider = createCreativeGenerationProvider(engine);
  const providerStatus = await imageProvider.status();
  if (!providerStatus.available) {
    throw new Error(`${providerStatus.detail} 다른 엔진이나 기존 배경으로 자동 전환하지 않습니다.`);
  }
  const product = sanitizeProductForCreative(input.product);
  const allPaths = Array.from(new Set([
    ...(input.selectedAdImages || []).slice(0, 12),
    ...(input.productImagePaths || []).slice(0, 12),
    product.extractedMainImage,
    ...(product.productImagePaths || []),
    product.productImagePath,
    ...(product.extractedGalleryImages || []),
  ].map((value) => String(value || "").trim()).filter(Boolean)));
  const originals = allPaths.filter((value) => !isAutomaticCutoutPath(value));
  if (!originals.length) {
    throw new Error("광고 제작에는 자동 누끼가 아닌 상세페이지 원본 상품 이미지가 필요합니다.");
  }
  const originalProductReferencePaths = originals.slice(0, 12);
  const rawTruth = buildProductTruth({
    product,
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
  const categoryPrior = await readCategoryHookPrior({ categoryId: matchCategoryProfile(truth.product).id, objective: experimentObjective });
  const advertiser = resolveAdvertiserIdentity(product);
  const advertiserId = product.creativeContext?.advertiserId || advertiser.id;
  const advertiserName = product.advertiserName || advertiser.name;
  const planningFingerprint = buildCreativePlanFingerprint(truth);
  const cachedPlanning = await readCreativePlanCache(planningFingerprint);
  const hookPlanning = cachedPlanning || await planHooksWithCodexLocal({ truth, advertiserId, advertiserName, prior: categoryPrior });
  if (!cachedPlanning) await writeCreativePlanCache({ fingerprint: planningFingerprint, ...hookPlanning, createdAt:new Date().toISOString() });
  const creativePlan = buildExplorationCreativePlan(truth, {
    logoPath: input.logoPath,
    adBrief,
    categoryPrior,
    testCode: input.testCode,
    exploration: hookPlanning.exploration,
    copyGeneration: hookPlanning.copyGeneration,
  });
  creativePlan.hookPlans = creativePlan.hookPlans.slice(0, runtime.maxCreatives).map((hookPlan) => {
    const headline = repairBannedCreativeSentence(hookPlan.headline) || hookPlan.factIds.map((id) => truth.facts.find((fact) => fact.id === id)?.value).find(Boolean) || truth.product.productName;
    const body = repairBannedCreativeSentence(hookPlan.body) || truth.product.mainBenefit || truth.product.productName;
    assertCreativeCopyAllowed(`${headline} ${body} ${hookPlan.offer} ${hookPlan.cta}`);
    return {
      ...hookPlan,
      headline,
      body,
      creativeBrief: hookPlan.creativeBrief ? { ...hookPlan.creativeBrief, mainHook:headline, subCopy:body, textRendering:"post-render-exact-korean" as const } : hookPlan.creativeBrief,
    };
  });
  const selectedTemplates = selectPerformanceTemplates(truth, creativePlan.hookPlans, runtime.maxCreatives);
  creativePlan.hookPlans = creativePlan.hookPlans.map((hookPlan,index) => ({ ...hookPlan, performanceTemplateId:selectedTemplates[index]?.id }));
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
  job.paidApiUsed = engine === "openai_api";
  job.advertiserId = advertiserId;
  job.advertiserName = advertiserName;
  // 생성 컨텍스트는 상품·후킹별로 격리하며, 광고주 공용 대화는 재사용하지 않는다.
  job.codexThreadId = undefined;
  job.visualDiversityMatrix = buildVisualDiversityMatrix(job.results);
  const diversity = validateVisualDiversityMatrix(job.visualDiversityMatrix);
  if (!diversity.valid) throw new Error(diversity.errors.join(" "));
  job.version = "generation-job-v6-ai-native-final";
  job.sourceType = options.sourceType || "manual";
  job.autoProductionRunId = options.autoProductionRunId;
  job.autoProductionTaskId = options.autoProductionTaskId;
  job.hookLearningApplied = Object.keys(categoryPrior).length > 0;
  job.representativeResultId = job.results[0]?.id;
  job.planningFingerprint = planningFingerprint;
  job.templateRegistryVersion = PERFORMANCE_TEMPLATE_REGISTRY_VERSION;
  job.unusedPerformanceTemplateIds = unusedPerformanceTemplates(selectedTemplates.map((template) => template.id), truth).map((template) => template.id);
  job.version = "generation-job-v7-fast-local-composition";
  await creativeGenerationJobStore.create(job);
  await writeNativeManifest(job);
  if (options.autoStart !== false) enqueueGenerationJob(job.id);
  return job;
}
