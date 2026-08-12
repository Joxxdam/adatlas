import crypto from "node:crypto";
import { readBackgroundLibrary } from "../background-library/store.ts";
import {
  buildCreativePlan,
  createGenerationJob,
  planScenes,
} from "../creative-generation/planner.ts";
import { buildProductTruth } from "../creative-generation/productTruth.ts";
import type {
  CreativeBlueprintId,
  CreativePlan,
  GenerationJob,
  HookPlan,
} from "../creative-generation/types.ts";
import { isPaidImageGenerationEnabled } from "../image-generation/SceneGenerationProvider.ts";
import { createBrandCode } from "../creative-assets/code.ts";
import { createExperimentCode, createHookCategoryCode } from "./codes.ts";
import { HookDiscoveryService } from "./hookDiscovery.ts";
import type {
  CreateExperimentInput,
  CreateExperimentPlanResult,
  CreativeExperiment,
  ExperimentAsset,
  ExperimentRuleConfig,
  ExperimentStage,
  HookGroup,
  HookRecommendation,
  MetaTestPlan,
  VisualExpressionType,
} from "./types.ts";

const blueprintVariants: Array<{ blueprintId: CreativeBlueprintId; visual: VisualExpressionType }> =
  [
    { blueprintId: "proof-data", visual: "COPY_INFORMATION" },
    { blueprintId: "product-hero-lifestyle", visual: "SCENE_VISUAL" },
    { blueprintId: "product-hero-lifestyle", visual: "PRODUCT_HERO" },
    { blueprintId: "editorial-story", visual: "USAGE_SCENE" },
    { blueprintId: "proof-data", visual: "INFORMATION_FOCUS" },
    { blueprintId: "chat-ugc", visual: "TRUST_PROOF" },
    { blueprintId: "comparison-versus", visual: "PROMOTION_VISUAL" },
    { blueprintId: "problem-solution-split", visual: "PROBLEM_EMPATHY" },
  ];

export const defaultExperimentRuleConfig: ExperimentRuleConfig = {
  minimumSpend: 10,
  minimumImpressions: 1000,
  minimumClicks: 20,
  minimumLandingPageViews: 10,
  minimumPurchases: 1,
  maximumSpendImbalanceRatio: 3,
  maximumSingleAssetSpendShare: 0.7,
  minimumEligibleAssetsPerHook: 1,
};

function stageRound(stage: ExperimentStage) {
  return stage === "DISCOVERY" ? 1 : stage === "VALIDATION" ? 2 : 3;
}

function stageDefaults(stage: ExperimentStage) {
  if (stage === "DISCOVERY") return { hookCount: 8, variantsPerHook: 2 };
  if (stage === "VALIDATION") return { hookCount: 3, variantsPerHook: 6 };
  return { hookCount: 1, variantsPerHook: 6 };
}

function visualVariants(stage: ExperimentStage, count: number) {
  const start = stage === "DISCOVERY" ? 0 : 2;
  return Array.from(
    { length: count },
    (_, index) => blueprintVariants[(start + index) % blueprintVariants.length]
  );
}

function metaPlan(
  input: CreateExperimentInput,
  hooks: HookRecommendation[],
  assetsPerHook: number
): MetaTestPlan {
  const batches =
    hooks.length > 4
      ? [
          { label: "배치 A", hookCodes: hooks.slice(0, 4).map((hook) => hook.hookCode) },
          { label: "배치 B", hookCodes: hooks.slice(4).map((hook) => hook.hookCode) },
        ]
      : [{ label: "배치 A", hookCodes: hooks.map((hook) => hook.hookCode) }];
  const defaults: MetaTestPlan = {
    campaignObjective: input.objective,
    campaignName: "",
    adsetName: "",
    target: input.product.targetCustomer || "운영자가 실제 Meta 타깃을 입력하세요.",
    placements: "Advantage+ 게재 위치 또는 실험 간 동일 조건",
    attributionSetting: "실험 간 동일한 기여 설정",
    assetsPerHook,
    testMode: "BALANCED_BATCH",
    batches,
  };
  return {
    ...defaults,
    ...input.metaTestPlan,
    campaignObjective: input.objective,
    assetsPerHook,
    batches: input.metaTestPlan?.batches || batches,
  };
}

export function buildExperimentPlan(input: CreateExperimentInput): CreateExperimentPlanResult {
  const stage = input.stage || "DISCOVERY";
  const round = stageRound(stage);
  const defaults = stageDefaults(stage);
  const variantsPerHook =
    stage === "DISCOVERY"
      ? Math.max(1, Math.min(3, input.variantsPerHook || defaults.variantsPerHook))
      : 6;
  const truth = buildProductTruth({
    product: input.product,
    productImagePaths:
      input.product.productImagePaths || [input.product.productImagePath].filter(Boolean),
    source: input.product.landingUrl ? "landing-page" : "user-input",
  });
  const discovery = HookDiscoveryService.recommend(truth, {
    selectedHookCodes: input.selectedHookCodes,
    useControl: input.useControl,
    limit: (input.selectedHookCodes?.length || defaults.hookCount) + (input.useControl ? 1 : 0),
  });
  const recommendations = discovery.recommendations.slice(
    0,
    defaults.hookCount + (input.useControl ? 1 : 0)
  );
  if (recommendations.length < (stage === "DISCOVERY" ? 4 : defaults.hookCount)) {
    throw new Error("이 상품에 안전하게 적용할 수 있는 후킹이 부족합니다.");
  }
  const now = new Date().toISOString();
  const brandName =
    input.brandName || input.product.brandName || input.product.advertiserName || "브랜드 미지정";
  const brandCode = createBrandCode(brandName, input.brandId);
  const experimentId = crypto.randomUUID();
  const advertiserId =
    input.advertiserId ||
    input.product.creativeContext?.advertiserId ||
    `advertiser-${brandCode.toLowerCase()}`;
  const productId =
    input.productId ||
    input.product.creativeContext?.productId ||
    `product-${input.originalHostProductNo}`;
  const experiment: CreativeExperiment = {
    id: experimentId,
    experimentCode: createExperimentCode({
      brandCode,
      originalHostProductNo: input.originalHostProductNo,
      objective: input.objective,
      testRound: round,
    }),
    advertiserId,
    advertiserName: input.advertiserName || input.product.advertiserName || brandName,
    brandId: input.brandId || brandCode.toLowerCase(),
    brandName,
    brandCode,
    categoryId: input.categoryId || input.product.category || "기타",
    productId,
    originalHostProductNo: input.originalHostProductNo,
    product: input.product,
    objective: input.objective,
    stage,
    testRound: round,
    status: "draft",
    parentExperimentId: input.parentExperimentId,
    hookCount: recommendations.length,
    variantsPerHook,
    totalAssetCount: recommendations.length * variantsPerHook,
    useControl: Boolean(input.useControl),
    contentNoteIds:
      input.product.creativeContext?.appliedContentNotes?.map((note) => note.id) || [],
    ruleConfig: {
      ...defaultExperimentRuleConfig,
      ...input.ruleConfig,
      minimumEligibleAssetsPerHook: Math.max(
        input.ruleConfig?.minimumEligibleAssetsPerHook || 1,
        stage === "VALIDATION" ? 3 : 1
      ),
    },
    metaTestPlan: metaPlan(input, recommendations, variantsPerHook),
    createdAt: now,
    updatedAt: now,
  };
  const groups: HookGroup[] = recommendations.map((recommendation) => ({
    id: crypto.randomUUID(),
    experimentId,
    hookType: recommendation.hookType,
    hookCode: recommendation.hookCode,
    categoryCode: createHookCategoryCode({
      brandCode,
      originalHostProductNo: input.originalHostProductNo,
      objective: input.objective,
      testRound: round,
      hookCode: recommendation.hookCode,
    }),
    hypothesis: recommendation.hypothesis,
    recommendationReason: recommendation.recommendationReason,
    status: "planned",
    isWinner: false,
    createdAt: now,
    updatedAt: now,
  }));
  const variants = visualVariants(stage, variantsPerHook);
  const assets: ExperimentAsset[] = recommendations.flatMap((recommendation, hookIndex) => {
    const group = groups[hookIndex];
    return variants.map((variant, variantIndex) => ({
      id: crypto.randomUUID(),
      experimentId,
      generationResultId: `result-${hookIndex * variantsPerHook + variantIndex + 1}-${variant.blueprintId}`,
      hookGroupId: group.id,
      hookCode: recommendation.hookCode,
      hookType: recommendation.hookType,
      mainMessage: recommendation.mainMessage,
      variant: String.fromCharCode(65 + variantIndex),
      visualDirection: variant.visual,
      isControl: recommendation.hookCode === "CTL",
      hostingRegistrationStatus: "not_registered",
      cremaCollectionStatus: "not_requested",
      productMatchStatus: "not_checked",
      createdAt: now,
      updatedAt: now,
    }));
  });
  return { experiment, hookGroups: groups, experimentAssets: assets, recommendations };
}

function hookPlans(plan: CreateExperimentPlanResult): HookPlan[] {
  const variants = visualVariants(plan.experiment.stage, plan.experiment.variantsPerHook);
  return plan.recommendations.flatMap((recommendation, hookIndex) =>
    variants.map((variant, variantIndex) => {
      const asset = plan.experimentAssets[hookIndex * variants.length + variantIndex];
      const offer =
        recommendation.hookCode === "PRC" || recommendation.hookCode === "VAL"
          ? [plan.experiment.product.discountInfo, plan.experiment.product.price]
              .filter(Boolean)
              .join(" · ")
          : "";
      const proof =
        recommendation.hookCode === "REV"
          ? plan.experiment.product.creativeContext?.reviewInsightSummaries?.[0] ||
            "실제 리뷰 인사이트 확인"
          : recommendation.hookCode === "USP"
            ? plan.experiment.product.verifiedBenefits?.[0] || plan.experiment.product.mainBenefit
            : "";
      return {
        id: `hook-experiment-${recommendation.hookCode}-${asset.variant}`,
        blueprintId: variant.blueprintId,
        hookType: recommendation.hookType,
        title: `${recommendation.label} ${asset.variant}안`,
        headline: recommendation.mainMessage,
        body:
          variant.visual === "COPY_INFORMATION"
            ? plan.experiment.product.mainBenefit || recommendation.recommendationReason
            : recommendation.recommendationReason,
        proof,
        offer,
        cta: "상품 정보 보기",
        audience: plan.experiment.product.targetCustomer || "상품이 필요한 고객",
        sceneIntent: `${asset.visualDirection} · 같은 후킹의 핵심 주장을 유지하고 표현 방식만 다르게 구성`,
        factIds: recommendation.factIds,
        numericTokens: [],
        experimentVariant: asset.variant,
        visualDirection: asset.visualDirection,
        hookCode: recommendation.hookCode,
        mainMessage: recommendation.mainMessage,
        hookGroupId: asset.hookGroupId,
      };
    })
  );
}

async function createExperimentGenerationJob(plan: CreateExperimentPlanResult) {
  const started = Date.now();
  const truth = buildProductTruth({
    product: plan.experiment.product,
    productImagePaths:
      plan.experiment.product.productImagePaths ||
      [plan.experiment.product.productImagePath].filter(Boolean),
    source: plan.experiment.product.landingUrl ? "landing-page" : "user-input",
  });
  if (!truth.imagePaths.length)
    throw new Error("실험 콘텐츠에 사용할 실제 상품 이미지가 필요합니다.");
  const base = buildCreativePlan(truth);
  const creativePlan: CreativePlan = {
    ...base,
    hookPlans: hookPlans(plan),
    blueprintIds: hookPlans(plan).map((item) => item.blueprintId),
    experimentContext: {
      experimentId: plan.experiment.id,
      experimentCode: plan.experiment.experimentCode,
      originalHostProductNo: plan.experiment.originalHostProductNo,
      generationRound: plan.experiment.testRound,
    },
  };
  const library = await readBackgroundLibrary();
  const paidImageGenerationEnabled = isPaidImageGenerationEnabled();
  const scenes = planScenes(creativePlan, library, paidImageGenerationEnabled);
  return createGenerationJob({
    truth,
    creativePlan,
    scenes,
    concurrency: 2,
    paidImageGenerationEnabled,
    planningMs: Date.now() - started,
  });
}

export const DiscoveryCreativeGenerationService = { createJob: createExperimentGenerationJob };
export const HookValidationService = { createJob: createExperimentGenerationJob };
export const RefinementCreativeGenerationService = { createJob: createExperimentGenerationJob };

export async function buildGenerationJobForExperiment(
  plan: CreateExperimentPlanResult
): Promise<GenerationJob> {
  return createExperimentGenerationJob(plan);
}
