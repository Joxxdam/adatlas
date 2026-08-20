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
import { getAdvertiserThread } from "./codexRegistry.server";
import { writeNativeManifest } from "./nativeCreativeStorage.server";
import { defaultAdBrief } from "../mvp/adBrief";
import type { AdBrief } from "../mvp/types";
import { matchCategoryProfile } from "./profiles";
import { readCategoryHookPrior } from "./hookLearning.server";
import { enqueueGenerationJob } from "./jobRunner.server";

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
  const originalProductReferencePaths = (originals.length ? originals : allPaths).slice(0, 12);
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
  const configuredConcurrency = Math.max(1, Math.min(3, Math.floor(Number(process.env.ADATLAS_CREATIVE_CONCURRENCY || input.concurrency || 2) || 2)));
  const experimentObjective = adBrief.adObjective === "awareness" ? "AWR" : adBrief.adObjective === "signup" ? "TRF" : "SLS";
  const categoryPrior = await readCategoryHookPrior({ categoryId: matchCategoryProfile(truth.product).id, objective: experimentObjective });
  const creativePlan = buildExplorationCreativePlan(truth, { logoPath: input.logoPath, adBrief, categoryPrior, testCode: input.testCode });
  const scenes = planAiScenes(creativePlan, paidImageGenerationEnabled);
  const productReferenceProfile = await analyzeProductReferences(truth);
  const configuredRetries = Number(process.env.ADATLAS_IMAGE_MAX_RETRIES || process.env.ADATLAS_CREATIVE_RETRIES || "2");
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
  const advertiser = resolveAdvertiserIdentity(product);
  job.engine = engine;
  job.paidApiUsed = engine === "openai_api";
  job.advertiserId = product.creativeContext?.advertiserId || advertiser.id;
  job.advertiserName = product.advertiserName || advertiser.name;
  job.codexThreadId = (await getAdvertiserThread(job.advertiserId))?.threadId;
  job.visualDiversityMatrix = buildVisualDiversityMatrix(job.results);
  const diversity = validateVisualDiversityMatrix(job.visualDiversityMatrix);
  if (!diversity.valid) throw new Error(diversity.errors.join(" "));
  job.version = "generation-job-v6-ai-native-final";
  job.sourceType = options.sourceType || "manual";
  job.autoProductionRunId = options.autoProductionRunId;
  job.autoProductionTaskId = options.autoProductionTaskId;
  job.hookLearningApplied = Object.keys(categoryPrior).length > 0;
  await creativeGenerationJobStore.create(job);
  await writeNativeManifest(job);
  if (options.autoStart !== false) enqueueGenerationJob(job.id);
  return job;
}
