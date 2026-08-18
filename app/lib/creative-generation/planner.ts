import type { BackgroundLibraryItem } from "../background-library/types";
import { recommendBackgrounds } from "../background-library/recommender.ts";
import { objectiveCta } from "../mvp/adObjective.ts";
import type { AdBrief, CreativeStrategy, ProductInfoForPrompt } from "../mvp/types";
import { matchKnownProductAsset } from "../creative/knownProductAssets.ts";
import { getCreativeBlueprint } from "./blueprints.ts";
import { buildFallbackHookMessages } from "./hookMessages.server.ts";
import { selectMasterCreativeDirection } from "./masterDesign.ts";
import { matchBrandProfile, matchCategoryProfile, withRequestedLogo } from "./profiles.ts";
import { extractNumericTokens } from "./productTruth.ts";
import {
  CREATIVE_PLANNER_VERSION,
  type BrandProfile,
  type CreativeBlueprintId,
  type CreativePlan,
  type GenerationJob,
  type GenerationResult,
  type HookMessageHypothesis,
  type HookPlan,
  type ProductTruth,
  type SceneAsset,
  type ScenePlan,
} from "./types.ts";

export const SCENE_PROMPT_VERSION = "scene-safe-zone-v1";

function id(prefix: string, index = 0) {
  return `${prefix}-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function exactOffer(truth: ProductTruth) {
  return [truth.product.discountInfo, truth.product.price].filter(Boolean).join(" · ");
}
export function buildHookPlans(
  truth: ProductTruth,
  adBrief?: AdBrief,
  hypotheses: HookMessageHypothesis[] = buildFallbackHookMessages(truth),
  blueprintId: CreativeBlueprintId = "product-hero-lifestyle"
): HookPlan[] {
  const offer = exactOffer(truth);
  const cta = objectiveCta(adBrief?.adObjective, Boolean(offer));
  const proof = truth.facts.find(
    (fact) =>
      /^(verified-benefit|ingredient)/.test(fact.key) && fact.numericTokens.length > 0
  )?.value || "";
  return hypotheses.map((hypothesis) => {
    const text = [hypothesis.mainHook, hypothesis.subCopy, proof, offer, cta].join(" ");
    return {
      id: `hook-${hypothesis.code}-${blueprintId}`,
      blueprintId,
      hookType: hypothesis.hookType,
      title: hypothesis.hypothesis,
      hypothesis: hypothesis.hypothesis,
      confidence: hypothesis.confidence,
      headline: hypothesis.mainHook,
      body: hypothesis.subCopy,
      proof,
      offer,
      cta,
      audience: truth.product.targetCustomer || "확인된 상품 고객",
      sceneIntent: "고정된 마스터 디자인에서 메시지 가설만 비교",
      factIds: hypothesis.factIds,
      numericTokens: extractNumericTokens(text),
      experimentVariant: hypothesis.code,
      hookCode: hypothesis.code,
      mainMessage: hypothesis.mainHook,
      hookGroupId: `hook-experiment-${truth.productId}`,
      visualDirection: blueprintId,
    };
  });
}

export function buildCreativePlan(
  truth: ProductTruth,
  options: {
    logoPath?: string;
    adBrief?: AdBrief;
    hypotheses?: HookMessageHypothesis[];
    copyGeneration?: CreativePlan["copyGeneration"];
    preserveMasterDesignId?: string;
    excludedMasterDesignIds?: CreativeBlueprintId[];
    testCode?: `T${string}`;
  } = {}
): CreativePlan {
  const brandProfile = withRequestedLogo(matchBrandProfile(truth.product), options.logoPath);
  const categoryProfile = matchCategoryProfile(truth.product);
  const masterDesign = selectMasterCreativeDirection({
    truth,
    brand: brandProfile,
    category: categoryProfile,
    preserveMasterDesignId: options.preserveMasterDesignId,
    excludedMasterDesignIds: options.excludedMasterDesignIds,
  });
  const hookPlans = buildHookPlans(
    truth,
    options.adBrief,
    options.hypotheses,
    masterDesign.layoutFamily
  );
  const fixedCta = hookPlans[0]?.cta || masterDesign.fixedFacts.cta;
  return {
    id: id("creative-plan"),
    productTruth: truth,
    brandProfile,
    categoryProfile,
    hookPlans,
    blueprintIds: [masterDesign.layoutFamily],
    masterDesign: {
      ...masterDesign,
      fixedFacts: { ...masterDesign.fixedFacts, cta: fixedCta },
    },
    testCode: options.testCode || "T01",
    copyGeneration: options.copyGeneration || {
      provider: "fallback",
      warnings: [],
    },
    adBrief: options.adBrief,
    createdAt: new Date().toISOString(),
    plannerVersion: CREATIVE_PLANNER_VERSION,
  };
}

function strategyFor(plan: HookPlan, product: ProductInfoForPrompt): CreativeStrategy {
  const map: Record<CreativeBlueprintId, Pick<CreativeStrategy, "hookType" | "backgroundHookType">> = {
    "problem-solution-split": { hookType: "problem-solution", backgroundHookType: "problem_solution" },
    "editorial-story": { hookType: "lifestyle", backgroundHookType: "situation" },
    "chat-ugc": { hookType: "social-proof", backgroundHookType: "review_ugc" },
    "comparison-versus": { hookType: "problem-solution", backgroundHookType: "problem_solution" },
    "product-hero-lifestyle": { hookType: "feature-usp", backgroundHookType: "usp_proof" },
    "proof-data": { hookType: "feature-usp", backgroundHookType: "usp_proof" },
  };
  return {
    id: plan.id,
    title: plan.title,
    ...map[plan.blueprintId],
    headline: plan.headline,
    subCopy: plan.body,
    keyAppeal: product.mainBenefit,
    sceneDescription: plan.sceneIntent,
    mood: ["고대비", "상품 중심", "광고 집행형"],
    textSafeArea: "top-left",
    productPosition: "center-right",
    backgroundTags: [plan.hookType, product.category, product.mainBenefit].filter(Boolean),
    appeal: plan.body,
    mainCopy: plan.headline,
    audience: plan.audience,
    explanation: plan.sceneIntent,
    mainHookAngle: plan.hookType,
    coreAppealPoint: plan.body,
    audienceFit: plan.audience,
    referenceFit: plan.blueprintId,
    suggestedVisualEmphasis: "actual-product-large",
    risk: "검증되지 않은 수치 사용 금지",
    expectedCustomerProblem: product.mainBenefit,
    purchaseBarrierResponse: "상품 사실과 실제 이미지를 우선 표시",
    recommendedTone: "사실 중심",
    inferredEvidence: plan.factIds,
    matchedReferenceIds: [],
    matchedReferencePatterns: [plan.blueprintId],
  };
}

function toSceneAsset(item: BackgroundLibraryItem): SceneAsset {
  return {
    id: item.id,
    file: item.file,
    sourceType: "library",
    assetType: item.assetType,
    scene: item.scene,
    category: item.category,
    includesPerson: item.includesPerson,
    textSafeArea: item.textSafeArea,
    productPosition: item.productPosition,
    license: {
      sourceName: item.sourceName,
      sourcePageUrl: item.sourcePageUrl,
      licenseUrl: item.licenseUrl,
      authorName: item.authorName,
    },
  };
}

export function planScenes(
  creativePlan: CreativePlan,
  library: BackgroundLibraryItem[],
  paidImageGenerationAllowed = false,
  options: { preserveBackgroundAssetId?: string } = {}
): ScenePlan[] {
  const designNotes = (creativePlan.productTruth.product.creativeContext?.appliedContentNotes || [])
    .filter((note) => ["IMAGE_RULE", "PRODUCT_IMAGE_RULE", "BACKGROUND_STYLE", "LAYOUT_RULE", "DESIGN_GUIDELINE"].includes(note.type))
    .map((note) => note.content);
  const fallback = library.find((item) => item.enabled !== false) || null;
  const knownAsset = matchKnownProductAsset(creativePlan.productTruth.product);
  const dedicatedLibrary = knownAsset
    ? library.filter((item) => item.enabled !== false && item.file.startsWith(knownAsset.backgroundPrefix))
    : [];
  const recommendationPool = dedicatedLibrary.length ? dedicatedLibrary : library;
  const preserved = options.preserveBackgroundAssetId
    ? recommendationPool.find(
        (item) => item.enabled !== false && item.id === options.preserveBackgroundAssetId
      )
    : undefined;
  const referenceHook = creativePlan.hookPlans[0];
  const recommendation = referenceHook
    ? recommendBackgrounds(recommendationPool, {
        product: creativePlan.productTruth.product,
        hook: strategyFor(referenceHook, creativePlan.productTruth.product),
        limit: 6,
        recommendationPage: 0,
      }).recommendations[0]
    : undefined;
  const selected = preserved || recommendation?.background || fallback;
  if (!selected) throw new Error("사용 가능한 배경 장면이 없습니다.");
  return creativePlan.hookPlans.map((hookPlan) => {
    return {
      id: `scene-${hookPlan.hookCode}-${selected.id}`,
      blueprintId: hookPlan.blueprintId,
      sceneAsset: toSceneAsset(selected),
      promptVersion: SCENE_PROMPT_VERSION,
      provider: "library",
      generated: false,
      paidGenerationAllowed: paidImageGenerationAllowed,
      reason: [
        dedicatedLibrary.length ? "등록된 상품 전용 배경" : "",
        preserved
          ? "사용자가 고정한 마스터 배경"
          : recommendation?.reasons.join(" · ") || "카테고리 안전 배경 fallback",
        "H01~H08 동일 배경·크롭·오버레이 고정",
        ...designNotes,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

export function createGenerationJob(params: {
  truth: ProductTruth;
  creativePlan: CreativePlan;
  scenes: ScenePlan[];
  concurrency?: number;
  paidImageGenerationEnabled?: boolean;
  planningMs: number;
}): GenerationJob {
  const jobId = id("creative-job");
  const now = new Date().toISOString();
  const masterScene = params.scenes[0];
  const creativePlan: CreativePlan = {
    ...params.creativePlan,
    masterDesign: {
      ...params.creativePlan.masterDesign,
      backgroundAssetId:
        masterScene?.sceneAsset.id || params.creativePlan.masterDesign.backgroundAssetId,
    },
  };
  const results: GenerationResult[] = params.creativePlan.hookPlans.map((hookPlan, index) => ({
    id: `result-${hookPlan.hookCode}-${hookPlan.blueprintId}`,
    order: index + 1,
    blueprintId: hookPlan.blueprintId,
    blueprintLabel: getCreativeBlueprint(hookPlan.blueprintId).label,
    status: "pending",
    hookPlan,
    scenePlan: params.scenes[index],
    attempts: 0,
  }));
  return {
    id: jobId,
    status: "pending",
    productTruth: params.truth,
    creativePlan,
    results,
    concurrency: Math.max(1, Math.min(3, params.concurrency || 2)),
    paidImageGenerationEnabled: Boolean(params.paidImageGenerationEnabled),
    createdAt: now,
    updatedAt: now,
    timing: { planningMs: params.planningMs },
    errors: [],
    version: "generation-job-v3-hook-master",
  };
}

export function brandPalette(brand: BrandProfile, fallback: string[]) {
  const palette = [...brand.primaryColors, ...brand.secondaryColors, ...fallback].filter((color) => /^#[0-9a-f]{6}$/i.test(color));
  return {
    background: palette[1] || "#101827",
    foreground: "#ffffff",
    accent: palette[0] || "#08d8b6",
    secondary: palette[2] || "#ffcf33",
  };
}
