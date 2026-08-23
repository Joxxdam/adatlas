import type { BackgroundLibraryItem } from "../background-library/types";
import { recommendBackgrounds } from "../background-library/recommender.ts";
import { objectiveCta } from "../mvp/adObjective.ts";
import type { AdBrief, CreativeStrategy, ProductInfoForPrompt } from "../mvp/types";
import { matchKnownProductAsset } from "../creative/knownProductAssets.ts";
import { getCreativeBlueprint } from "./blueprints.ts";
import { buildFallbackHookMessages } from "./hookMessages.server.ts";
import {
  blueprintForHookTag,
  buildProductHookExploration,
  type CategoryHookPrior,
} from "./hookHypothesisEngine.ts";
import {
  designFingerprintForMaster,
  selectMasterCreativeDirection,
} from "./masterDesign.ts";
import {
  applyCategoryCreativeDirection,
  countDistinctVisualArchetypes,
  resolveCategoryCreativeProfile,
} from "./categoryCreativeRouter.ts";
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
  type HookHypothesisCandidate,
  type ProductTruth,
  type ProductReferenceProfile,
  type MasterSceneArtifact,
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
      evidenceSummary: hypothesis.evidenceSummary,
      specificityScore: hypothesis.specificityScore,
      naturalnessScore: hypothesis.naturalnessScore,
      validationStatus: hypothesis.validationStatus,
      validationErrors: hypothesis.validationErrors,
      generationSource: hypothesis.generationSource,
      repairCount: hypothesis.repairCount,
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
    mode: "exact-message-comparison",
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

function hookPlansForExploration(
  truth: ProductTruth,
  selected: HookHypothesisCandidate[],
  adBrief?: AdBrief
): HookPlan[] {
  const offer = exactOffer(truth);
  const cta = objectiveCta(adBrief?.adObjective, Boolean(offer));
  return selected.map((candidate, index) => {
    const blueprintId = blueprintForHookTag(candidate.primaryTag);
    const hookCode = `H${String(index + 1).padStart(2, "0")}`;
    const text = [candidate.mainHook, candidate.subCopy, offer, cta].join(" ");
    return {
      id: `hook-${hookCode}-${candidate.id}`,
      blueprintId,
      hookType: candidate.primaryTag,
      primaryTag: candidate.primaryTag,
      secondaryTags: candidate.secondaryTags,
      title: candidate.hypothesis,
      hypothesis: candidate.hypothesis,
      confidence: candidate.score.evidenceStrength >= 75 ? "high" : candidate.score.evidenceStrength >= 48 ? "medium" : "low",
      headline: candidate.mainHook,
      body: candidate.subCopy,
      proof: "",
      offer,
      cta,
      audience: truth.product.targetCustomer || "확인된 상품 고객",
      sceneIntent: candidate.visualStory,
      factIds: candidate.factIds,
      numericTokens: extractNumericTokens(text),
      experimentVariant: hookCode,
      hookCode,
      mainMessage: candidate.mainHook,
      hookGroupId: `hook-exploration-${truth.productId}`,
      visualDirection: candidate.creativeBrief.sceneDescription,
      evidenceSummary: candidate.evidenceSummary,
      specificityScore: candidate.score.distinctiveness,
      naturalnessScore: candidate.score.claimSafety,
      validationStatus: "valid",
      validationErrors: [],
      generationSource: candidate.generationSource === "codex-local" ? "ai" : "fallback",
      repairCount: 0,
      customerReason: candidate.customerReason,
      coreClaim: candidate.coreClaim,
      sentenceStyle: candidate.sentenceStyle,
      selectionReason: candidate.selectionReason,
      score: candidate.score,
      creativeBrief: {
        ...candidate.creativeBrief,
        creativeId: `creative-${truth.productId}-${hookCode}-C${String(index + 1).padStart(2, "0")}`,
        advertiserId: truth.product.creativeContext?.advertiserId || "unassigned-advertiser",
        productId: truth.product.creativeContext?.productId || truth.productId,
        hookId: hookCode,
        hookCode,
        mainHook: candidate.mainHook,
        subCopy: candidate.subCopy,
        messageHypothesis: candidate.hypothesis,
        customerInsight: candidate.customerReason,
        verifiedFacts: candidate.evidence.map((item) => item.fact),
        referenceImageIds: truth.imageAssets
          .filter((asset) => asset.verified && asset.validationStatus !== "excluded")
          .map((asset) => asset.id),
        differentiationReason: candidate.creativeBrief.differentiationReason || candidate.creativeBrief.differentiationFromOtherHooks,
      },
    };
  });
}

export function buildExplorationCreativePlan(
  truth: ProductTruth,
  options: {
    logoPath?: string;
    adBrief?: AdBrief;
    categoryPrior?: CategoryHookPrior;
    testCode?: `T${string}`;
    exploration?: ReturnType<typeof buildProductHookExploration>;
    copyGeneration?: CreativePlan["copyGeneration"];
  } = {}
): CreativePlan {
  const brandProfile = withRequestedLogo(matchBrandProfile(truth.product), options.logoPath);
  const categoryProfile = matchCategoryProfile(truth.product);
  const exploration = options.exploration || buildProductHookExploration(truth, options.categoryPrior);
  if (exploration.selected.length < 6) {
    throw new Error("상품 근거로 구분 가능한 후킹 가설이 6개보다 적습니다. 상세정보를 추가해 주세요.");
  }
  const categoryCreativeProfile = resolveCategoryCreativeProfile(truth);
  const selectedWithDirection = applyCategoryCreativeDirection(
    truth,
    exploration.selected,
    categoryCreativeProfile
  );
  if (countDistinctVisualArchetypes(selectedWithDirection) < 4) {
    throw new Error("후킹 6개에 필요한 시각 문법 다양성을 확보하지 못했습니다.");
  }
  const hookPlans = hookPlansForExploration(truth, selectedWithDirection, options.adBrief);
  const firstBlueprint = hookPlans[0].blueprintId;
  const masterDesign = selectMasterCreativeDirection({
    truth,
    brand: brandProfile,
    category: categoryProfile,
    preserveMasterDesignId: `exploration-${firstBlueprint}-01`,
  });
  return {
    id: id("creative-exploration-plan"),
    productTruth: truth,
    brandProfile,
    categoryProfile,
    categoryCreativeProfile,
    hookPlans,
    blueprintIds: Array.from(new Set(hookPlans.map((hook) => hook.blueprintId))),
    masterDesign,
    mode: "concept-exploration",
    productInsightProfile: exploration.profile,
    candidateHypotheses: exploration.candidates,
    selectedHypotheses: selectedWithDirection,
    testCode: options.testCode || "T01",
    copyGeneration: options.copyGeneration || {
      provider: "fallback",
      warnings: ["상품 공개정보와 검증된 입력만 사용해 후킹 가설 후보를 점수화했습니다."],
    },
    adBrief: options.adBrief,
    createdAt: new Date().toISOString(),
    plannerVersion: CREATIVE_PLANNER_VERSION,
  };
}

function strategyForMaster(
  blueprintId: CreativeBlueprintId,
  categoryVariant: string,
  product: ProductInfoForPrompt
): CreativeStrategy {
  const map: Record<CreativeBlueprintId, Pick<CreativeStrategy, "hookType" | "backgroundHookType">> = {
    "problem-solution-split": { hookType: "problem-solution", backgroundHookType: "problem_solution" },
    "editorial-story": { hookType: "lifestyle", backgroundHookType: "situation" },
    "chat-ugc": { hookType: "social-proof", backgroundHookType: "review_ugc" },
    "comparison-versus": { hookType: "problem-solution", backgroundHookType: "problem_solution" },
    "product-hero-lifestyle": { hookType: "feature-usp", backgroundHookType: "usp_proof" },
    "proof-data": { hookType: "feature-usp", backgroundHookType: "usp_proof" },
  };
  const strategy = map[blueprintId];
  return {
    id: `master-background-${blueprintId}-${categoryVariant}`,
    title: `상품 고정 배경 · ${categoryVariant}`,
    ...strategy,
    headline: product.productName,
    subCopy: product.mainBenefit,
    keyAppeal: product.mainBenefit,
    sceneDescription: "상품·카테고리·마스터 디자인에 맞는 고정 배경",
    mood: ["고대비", "상품 중심", "광고 집행형"],
    textSafeArea: "top-left",
    productPosition: "center-right",
    backgroundTags: [product.category, product.mainBenefit, categoryVariant, blueprintId].filter(Boolean),
    appeal: product.mainBenefit,
    mainCopy: product.productName,
    audience: product.targetCustomer,
    explanation: "후킹과 독립된 상품 단위 배경 선택",
    mainHookAngle: "product-master",
    coreAppealPoint: product.mainBenefit,
    audienceFit: product.targetCustomer,
    referenceFit: blueprintId,
    suggestedVisualEmphasis: "actual-product-large",
    risk: "검증되지 않은 수치 사용 금지",
    expectedCustomerProblem: product.mainBenefit,
    purchaseBarrierResponse: "상품 사실과 실제 이미지를 우선 표시",
    recommendedTone: "사실 중심",
    inferredEvidence: [],
    matchedReferenceIds: [],
    matchedReferencePatterns: [blueprintId, categoryVariant],
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

function productPhotoSceneCandidates(creativePlan: CreativePlan): SceneAsset[] {
  const product = creativePlan.productTruth.product;
  const categoryId = creativePlan.categoryProfile.id;
  const fullPhotoCategory = ["agriculture", "food-meat", "packaged-food"].includes(categoryId);
  const representation = product.productRepresentation?.type || "";
  if (
    !fullPhotoCategory ||
    !["irregular-product", "plated-product"].includes(representation)
  ) {
    return [];
  }
  return (product.sourceImageCandidates || [])
    .filter(
      (candidate) =>
        !candidate.hasText &&
        (candidate.width || 0) >= 500 &&
        (candidate.height || 0) >= 500 &&
        candidate.sourceType !== "unknown"
    )
    .slice(0, 3)
    .map((candidate, index) => ({
      id: `product-photo-${candidate.id}`,
      file: candidate.imagePath,
      sourceType: "product" as const,
      assetType: "lifestyle_photo",
      scene: `실제 상세페이지 상품 사진 ${index + 1}`,
      category: categoryId,
      includesPerson: false,
      textSafeArea: index % 2 ? "right" : "left",
      productPosition: "center",
      license: {
        sourceName: "상품 상세페이지",
        sourcePageUrl: product.landingUrl,
      },
    }));
}

/**
 * Creates empty per-hook slots for the AI-native production pipeline.
 * No background file is selected here: the image model creates the product,
 * scene, Korean copy, typography and final layout together in one pass.
 */
export function planAiScenes(
  creativePlan: CreativePlan,
  paidGenerationAllowed = true
): ScenePlan[] {
  const designNotes = (creativePlan.productTruth.product.creativeContext?.appliedContentNotes || [])
    .filter((note) => ["IMAGE_RULE", "PRODUCT_IMAGE_RULE", "BACKGROUND_STYLE", "LAYOUT_RULE", "DESIGN_GUIDELINE"].includes(note.type))
    .map((note) => note.content);
  return creativePlan.hookPlans.map((hookPlan) => ({
    id: `scene-${hookPlan.hookCode}-ai-${hookPlan.blueprintId}`,
    blueprintId: hookPlan.blueprintId,
    sceneAsset: {
      id: `ai-hook-${hookPlan.hookCode}-${hookPlan.blueprintId}`,
      file: "",
      sourceType: "generated" as const,
      assetType: "ai-generated-background",
      scene:
        hookPlan.creativeBrief?.sceneDescription ||
        hookPlan.creativeBrief?.visualStory ||
        `${hookPlan.hypothesis}을 시각화한 전용 광고 장면`,
      category: creativePlan.categoryProfile.id,
      includesPerson: false,
      textSafeArea: "planned-from-hook-layout",
      productPosition: "planned-from-hook-layout",
      license: { sourceName: "OpenAI generated scene" },
    },
    promptVersion: "ai-hook-background-v1",
    provider: "openai" as const,
    generated: true,
    paidGenerationAllowed,
    generationMode: "ai-reference-full-creative" as const,
    reason: [
      `${hookPlan.hookCode} 메시지 가설 전용 AI 전체 키비주얼`,
      hookPlan.creativeBrief?.visualStory,
      "기존 배경 라이브러리 미사용",
      "상세페이지 상품·사용·질감 이미지를 참조해 AI가 완성형 키비주얼 전체를 제작",
      "상품·장면·정확한 한국어 문구를 한 번에 조판한 완성형 광고 이미지",
      ...designNotes,
    ].filter(Boolean).join(" · "),
  }));
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
  if (creativePlan.mode === "concept-exploration") {
    const productPhotoScenes = productPhotoSceneCandidates(creativePlan);
    const selectedIds: string[] = [];
    return creativePlan.hookPlans.map((hookPlan, index) => {
      const productPhoto = productPhotoScenes[index % Math.max(1, productPhotoScenes.length)];
      if (productPhoto) {
        return {
          id: `scene-${hookPlan.hookCode}-${productPhoto.id}`,
          blueprintId: hookPlan.blueprintId,
          sceneAsset: productPhoto,
          promptVersion: SCENE_PROMPT_VERSION,
          provider: "library" as const,
          generated: false,
          paidGenerationAllowed: paidImageGenerationAllowed,
          generationMode: "real-photo-adaptation" as const,
          reason: [
            "배경 제거 없이 현재 상품의 실제 상세페이지 사진을 전체 장면으로 사용",
            hookPlan.creativeBrief?.visualStory,
            "실제 상품 레퍼런스의 품종·색·질감을 기준으로 상품과 정확한 한국어 문구를 AI 완성 광고 전체 안에서 함께 생성",
            ...designNotes,
          ].filter(Boolean).join(" · "),
        };
      }
      const recommendation = recommendBackgrounds(recommendationPool, {
        product: creativePlan.productTruth.product,
        hook: strategyForExploration(hookPlan, creativePlan.productTruth.product),
        selectedIds,
        limit: Math.max(6, recommendationPool.length),
        recommendationPage: index,
      }).recommendations.find((item) => !selectedIds.includes(item.background.id));
      const selected = recommendation?.background || recommendationPool.find((item) => !selectedIds.includes(item.id)) || fallback;
      if (!selected) throw new Error("사용 가능한 배경 장면이 없습니다.");
      selectedIds.push(selected.id);
      return {
        id: `scene-${hookPlan.hookCode}-${selected.id}`,
        blueprintId: hookPlan.blueprintId,
        sceneAsset: toSceneAsset(selected),
        promptVersion: SCENE_PROMPT_VERSION,
        provider: "library" as const,
        generated: false,
        paidGenerationAllowed: paidImageGenerationAllowed,
        reason: [
          recommendation?.reasons.join(" · ") || "카테고리 안전 배경 fallback",
          hookPlan.creativeBrief?.sceneDescription,
          "실제 상품 레퍼런스와 정확한 한국어 문구를 AI 완성 광고 전체 안에서 함께 생성",
          ...designNotes,
        ].filter(Boolean).join(" · "),
      };
    });
  }
  const recommendation = recommendBackgrounds(recommendationPool, {
    product: creativePlan.productTruth.product,
    hook: strategyForMaster(
      creativePlan.masterDesign.layoutFamily,
      creativePlan.masterDesign.categoryVariant,
      creativePlan.productTruth.product
    ),
    limit: 6,
    recommendationPage: 0,
  }).recommendations[0];
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
        "상품·카테고리·마스터 디자인을 기준으로 선택된 고정 배경이며, 후킹 성과 비교를 위해 H01~H06에 동일하게 적용",
        ...designNotes,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}

function strategyForExploration(hookPlan: HookPlan, product: ProductInfoForPrompt): CreativeStrategy {
  const map: Record<string, Pick<CreativeStrategy, "hookType" | "backgroundHookType">> = {
    "problem-solution": { hookType: "problem-solution", backgroundHookType: "problem_solution" },
    "sensory-experience": { hookType: "sensory", backgroundHookType: "sensory" },
    "price-value": { hookType: "price-benefit", backgroundHookType: "price_offer" },
    "feature-usp": { hookType: "feature-usp", backgroundHookType: "usp_proof" },
    "review-trust": { hookType: "social-proof", backgroundHookType: "review_ugc" },
    "usage-occasion": { hookType: "lifestyle", backgroundHookType: "situation" },
    "target-identity": { hookType: "lifestyle", backgroundHookType: "situation" },
    convenience: { hookType: "problem-solution", backgroundHookType: "convenience" },
    "bundle-choice": { hookType: "price-benefit", backgroundHookType: "price_offer" },
    "season-newness": { hookType: "season-event", backgroundHookType: "urgency" },
    "brand-origin": { hookType: "brand-story", backgroundHookType: "origin_story" },
    "comparison-alternative": { hookType: "problem-solution", backgroundHookType: "usp_proof" },
    "scarcity-urgency": { hookType: "season-event", backgroundHookType: "urgency" },
    "gift-purpose": { hookType: "gift", backgroundHookType: "gifting" },
    other: { hookType: "feature-usp", backgroundHookType: "usp_proof" },
  };
  const direction = map[hookPlan.primaryTag || hookPlan.hookType] || map.other;
  return {
    id: `exploration-${hookPlan.hookCode}`,
    title: hookPlan.title,
    ...direction,
    headline: hookPlan.headline,
    subCopy: hookPlan.body,
    keyAppeal: hookPlan.customerReason || product.mainBenefit,
    sceneDescription: hookPlan.creativeBrief?.sceneDescription || hookPlan.sceneIntent,
    mood: ["실사", "상품 중심", hookPlan.primaryTag || hookPlan.hookType],
    textSafeArea: "top-left",
    productPosition: "center-right",
    backgroundTags: [product.category, hookPlan.primaryTag, hookPlan.creativeBrief?.visualStory].filter(Boolean) as string[],
    appeal: hookPlan.customerReason || product.mainBenefit,
    mainCopy: hookPlan.headline,
    audience: hookPlan.audience,
    explanation: hookPlan.selectionReason || hookPlan.sceneIntent,
    mainHookAngle: hookPlan.primaryTag || hookPlan.hookType,
    coreAppealPoint: hookPlan.customerReason || product.mainBenefit,
    audienceFit: hookPlan.audience,
    referenceFit: hookPlan.blueprintId,
    suggestedVisualEmphasis: "actual-product-large",
    risk: "확인되지 않은 사실·수치·옵션 사용 금지",
    expectedCustomerProblem: hookPlan.customerReason || product.mainBenefit,
    purchaseBarrierResponse: hookPlan.body,
    recommendedTone: "상품 근거 중심",
    inferredEvidence: hookPlan.factIds,
    matchedReferenceIds: [],
    matchedReferencePatterns: [hookPlan.blueprintId, hookPlan.primaryTag || hookPlan.hookType],
  };
}

export function createGenerationJob(params: {
  truth: ProductTruth;
  creativePlan: CreativePlan;
  scenes: ScenePlan[];
  concurrency?: number;
  retryLimit?: number;
  paidImageGenerationEnabled?: boolean;
  planningMs: number;
  productReferenceProfile?: ProductReferenceProfile;
  masterScene?: MasterSceneArtifact;
}): GenerationJob {
  const jobId = id("creative-job");
  const now = new Date().toISOString();
  const masterScene = params.scenes[0];
  const masterWithBackground = {
    ...params.creativePlan.masterDesign,
    backgroundAssetId:
      masterScene?.sceneAsset.id || params.creativePlan.masterDesign.backgroundAssetId,
  };
  const creativePlan: CreativePlan = {
    ...params.creativePlan,
    masterDesign: {
      ...masterWithBackground,
      designFingerprint: designFingerprintForMaster(masterWithBackground),
    },
  };
  const results: GenerationResult[] = params.creativePlan.hookPlans.map((hookPlan, index) => {
    const creativeDesign = params.creativePlan.mode === "concept-exploration"
      ? selectMasterCreativeDirection({
          truth: params.truth,
          brand: params.creativePlan.brandProfile,
          category: params.creativePlan.categoryProfile,
          preserveMasterDesignId: `exploration-${hookPlan.blueprintId}-${index}`,
        })
      : creativePlan.masterDesign;
    const withBackground = {
      ...creativeDesign,
      backgroundAssetId: params.scenes[index]?.sceneAsset.id || creativeDesign.backgroundAssetId,
      fixedFacts: { ...creativeDesign.fixedFacts, cta: hookPlan.cta },
    };
    withBackground.designFingerprint = designFingerprintForMaster(withBackground);
    return {
      id: `result-${hookPlan.hookCode}-${hookPlan.blueprintId}`,
      order: index + 1,
      blueprintId: hookPlan.blueprintId,
      blueprintLabel: getCreativeBlueprint(hookPlan.blueprintId).label,
      status: "pending",
      generationStage: "planned",
      hookPlan,
      scenePlan: params.scenes[index],
      creativeDesign: withBackground,
      attempts: 0,
    };
  });
  return {
    id: jobId,
    status: "pending",
    productTruth: params.truth,
    creativePlan,
    results,
    concurrency: Math.max(1, Math.min(3, params.concurrency || 2)),
    retryLimit: Math.max(0, Math.min(3, params.retryLimit ?? 2)),
    paidImageGenerationEnabled: Boolean(params.paidImageGenerationEnabled),
    productReferenceProfile: params.productReferenceProfile,
    masterScene: params.masterScene,
    createdAt: now,
    updatedAt: now,
    timing: { planningMs: params.planningMs },
    errors: [],
    version: "generation-job-v5-product-hook-exploration",
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
