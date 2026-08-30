import type { AdBrief, ProductInfoForPrompt } from "../mvp/types";
import type { CreativeAssetSnapshot } from "../creative-assets/types";
import type { CreativeNoteCompliance } from "../creative-content-notes/types";
import type { ProductAdCopy } from "../ad-copy/types";
import type { PerformanceTemplateId } from "./performanceTemplateRegistry";

export const CREATIVE_PLANNER_VERSION = "creative-planner-v8-reference-adapted-copy";

export const creativeBlueprintIds = ["problem-solution-split", "editorial-story", "chat-ugc", "comparison-versus", "product-hero-lifestyle", "proof-data"] as const;

export type CreativeBlueprintId = (typeof creativeBlueprintIds)[number];
export type FactVerification = "verified" | "source-backed" | "user-provided" | "unverified";
export type ProductEvidenceType = "identity" | "usp" | "ingredient" | "composition" | "quantity" | "usage" | "target" | "price" | "offer" | "shipping" | "review" | "origin" | "certification" | "numeric" | "other";

export type ProductFact = {
  id: string;
  key: string;
  label: string;
  value: string;
  verification: FactVerification;
  source: "landing-page" | "structured-product" | "vendor-research" | "user-input" | "derived";
  sourceUrl?: string;
  sourceDocument?: string;
  sourceSheet?: string;
  sourceCells?: string[];
  usableInCopy: boolean;
  numericTokens: string[];
  strength?: number;
  specificity?: number;
  evidenceType?: ProductEvidenceType;
  /** 새 레퍼런스 우선 문구 경로에서 이 사실을 사용할 수 있는 문구 역할입니다. */
  copyEligibility?: "headlineEligible" | "proofOnly" | "offerOnly" | "identityOnly" | "blocked";
};

export type ReferenceCopyProfile = {
  id: string;
  referenceId: string;
  referenceHash: string;
  profileVersion: string;
  tone: string;
  sentenceStyle: "question" | "declaration" | "dialogue" | "contrast" | "sensory" | "urgency" | "proof";
  rhetoricalDevice: string;
  headlineRole: string;
  headlineLineBudget: number;
  headlineCharacterBudget: number;
  supportRole: string;
  supportLineBudget: number;
  supportCharacterBudget: number;
  proofRole: string;
  offerRole: string;
  ctaRole: string;
  numericEmphasis: "none" | "light" | "strong";
  density: "light" | "medium" | "dense";
  punctuationRhythm: string;
  prohibitedLiteralPhrases: string[];
  analysisSource: "codex-local" | "safe-minimal";
  analysisError?: string;
  createdAt: string;
};

export type ReferenceAdaptedCopyPlan = {
  id: string;
  resultCode: string;
  referenceId: string;
  referenceCopyProfileId: string;
  /** 선택 레퍼런스에 실제로 적혀 있던 원문과 줄 구조입니다. */
  referenceRawCopy?: string;
  referenceRawLines?: string[];
  adaptedLines?: string[];
  /** 원본 문구 블록과 최종 문구 블록의 1:1 편집 계약입니다. */
  copySlots?: Array<{
    index: number;
    regionId?: string;
    readingOrder?: number;
    role: "headline" | "support" | "proof" | "offer" | "cta" | "badge" | "other";
    sourceType?: "ad-copy" | "source-brand" | "source-product-label" | "decorative" | "uncertain";
    replacePolicy?: "adapt" | "remove" | "product-replacement" | "preserve" | "review";
    sourceText: string;
    targetText: string;
    emphasis: "none" | "light" | "strong";
    box?: { x: number; y: number; width: number; height: number };
    align?: "left" | "center" | "right" | "unknown";
    colorHint?: string;
    backgroundHint?: string;
    outlineHint?: string;
    sizeClass?: "small" | "medium" | "large" | "hero";
    characterBudget?: number;
  }>;
  headline: string;
  subCopy: string;
  proof: string;
  offer: string;
  cta: string;
  factIds: string[];
  sourceFactValues: string[];
  tone: string;
  sentenceStyle: ReferenceCopyProfile["sentenceStyle"];
  naturalnessScore: number;
  referenceFitScore: number;
  factualSafetyScore: number;
  validationStatus: "valid" | "needs-review" | "invalid";
  validationErrors: string[];
  repairCount: number;
  generationSource: "codex-local" | "repaired-codex-local" | "reference-best-effort" | "safe-minimal";
};

export type ProductEvidence = {
  factId: string;
  summary: string;
  strength: number;
  specificity: number;
  evidenceType: ProductEvidenceType;
};

export type CreativeImageRole = "product-cutout" | "product-packshot" | "product-lifestyle" | "detail-image" | "ad-reference" | "review-image" | "logo" | "background";

export type CreativeImageAsset = {
  id: string;
  path: string;
  role: CreativeImageRole;
  source: "known-product" | "user-confirmed" | "product-page" | "source-candidate" | "selected-reference" | "brand-profile";
  verified: boolean;
  reason: string;
  width?: number;
  height?: number;
  transparent?: boolean;
  hasText?: boolean;
  validationStatus?: "confirmed" | "excluded" | "needs-confirmation";
  classificationSignals?: string[];
  productFocusRatio?: number;
};

export const productReferenceRoles = ["primary-product", "front-package", "side-package", "back-package", "product-detail", "texture", "lifestyle", "usage", "worn", "cooked", "ingredient", "size-reference", "option", "brand-logo", "unknown"] as const;

export type ProductReferenceRole = (typeof productReferenceRoles)[number];

export type ProductReferenceImage = {
  id: string;
  url: string;
  role: ProductReferenceRole;
  importance: number;
  width?: number;
  height?: number;
  usableForGeneration: boolean;
  description: string;
  contentHash?: string;
  duplicateOf?: string;
  watermarkRisk?: boolean;
  hasText?: boolean;
};

export type ProductReferenceProfile = {
  id: string;
  productName: string;
  brandName?: string;
  category: string;
  subCategory?: string;
  immutableFacts: {
    productType?: string;
    packageType?: string;
    packageShape?: string;
    primaryColor?: string;
    secondaryColors?: string[];
    logoDescription?: string;
    labelLayout?: string;
    quantity?: string;
    volume?: string;
    count?: string;
    material?: string;
    pattern?: string;
    mainIngredients?: string[];
    origin?: string;
    optionName?: string;
    includedItems?: string[];
  };
  visualIdentity: {
    silhouette: string;
    proportions: string;
    surfaceTexture: string;
    signatureDetails: string[];
    mustPreserve: string[];
    mustNotGenerate: string[];
  };
  verifiedClaims: string[];
  prohibitedClaims: string[];
  referenceImages: ProductReferenceImage[];
  referenceSufficiency: "high" | "medium" | "low";
  createdAt: string;
};

export const masterSceneConcepts = ["sensory-impact", "problem-solution", "premium-editorial", "price-impact", "review-trust", "usage-moment", "ingredient-origin", "brand-story", "target-lifestyle"] as const;

export type MasterSceneConcept = (typeof masterSceneConcepts)[number];

export const masterSceneGenerationModes = ["ai-background-composite", "ai-reference-full-creative", "reference-guided-full-scene", "real-photo-adaptation", "protected-product-composite", "library-fallback"] as const;

export type MasterSceneGenerationMode = (typeof masterSceneGenerationModes)[number];

export type MasterSceneSpec = {
  sceneId: string;
  productId: string;
  category: string;
  concept: MasterSceneConcept;
  generationMode: MasterSceneGenerationMode;
  productPlacement: {
    position: string;
    scale: number;
    angle: string;
    groundingSurface: string;
  };
  lighting: string;
  environment: string;
  colorDirection: string;
  cameraDirection: string;
  depthDirection: string;
  copySafeZone: PlacementBox;
  productSafeZone: PlacementBox;
  forbiddenElements: string[];
  referenceImageUrls: string[];
  referenceArchetype?: string;
  benchmarkPatterns?: string[];
  designFingerprint: string;
  strategyVariation: number;
};

export type SceneQualityResult = {
  score: number;
  productIdentityScore: number;
  compositionScore: number;
  groundingScore: number;
  copySafetyScore: number;
  factSafetyScore: number;
  productVisibilityScore: number;
  categoryFitScore: number;
  attentionScore: number;
  failures: string[];
  recommendation: "approve" | "retry" | "use-protected-product-composite" | "manual-review";
};

export type MasterSceneCandidate = {
  id: string;
  file?: string;
  provider: "openai" | "library" | "protected-composite";
  generationMode: MasterSceneGenerationMode;
  quality: SceneQualityResult;
  selected: boolean;
  warning?: string;
};

export type MasterSceneArtifact = {
  id: string;
  file: string;
  cacheKey: string;
  productReferenceProfileId: string;
  generationMode: MasterSceneGenerationMode;
  requestedGenerationMode: MasterSceneGenerationMode;
  includesProduct: boolean;
  provider: "openai" | "library" | "protected-composite";
  imageModel: string;
  generationPromptVersion: string;
  referenceImageIds: string[];
  sceneSpec: MasterSceneSpec;
  sceneQualityResult: SceneQualityResult;
  candidates: MasterSceneCandidate[];
  productIdentityScore: number;
  masterVisualDigest: string;
  estimatedProductAreaRatio: number;
  productBounds: PlacementBox;
  reused: boolean;
  requiresProductReview: boolean;
  warnings: string[];
  createdAt: string;
};

export type ProductTruth = {
  productId: string;
  product: ProductInfoForPrompt;
  normalized: {
    rawProductTitle: string;
    cleanProductName: string;
    baseProductName?: string;
    baseName?: string;
    verifiedDescriptor?: string;
    descriptor?: string;
    salesUnit?: string;
    promotionalTokens?: string[];
    offerTokens?: string[];
    selectionTokens?: string[];
    volumeTokens?: string[];
    promotionTokens?: string[];
    brandName: string;
    category: string;
    price?: string;
    originalPrice?: string;
    discount?: string;
    discountInfo?: string;
    promotion?: string;
    quantity?: string;
    composition?: string;
    shipping?: string;
    origin?: string;
    ingredients: string[];
    verifiedBenefits: string[];
    seasonOrEvent?: string;
    packageOrOption?: string;
    uspCandidates: string[];
    reviewEvidence: string[];
    targetCustomer?: string;
    target?: string;
    usageOccasions: string[];
    useSituations: string[];
  };
  facts: ProductFact[];
  verifiedClaims: string[];
  unverifiedClaims: string[];
  allowedNumericTokens: string[];
  blockedClaimPatterns: string[];
  /** 상세 이미지 OCR에서 광고 문구로는 쓰지 않고 과장 방지에만 쓰는 조건입니다. */
  productCopyConstraints: string[];
  imageAssets: CreativeImageAsset[];
  referenceImages: CreativeImageAsset[];
  imagePaths: string[];
  confirmedProductImage?: CreativeImageAsset;
  coreEvidence?: ProductEvidence[];
  needsConfirmationImages?: CreativeImageAsset[];
  completeness: number;
  createdAt: string;
};

export const hookMessageCodes = ["H01", "H02", "H03", "H04", "H05", "H06"] as const;

export type HookMessageCode = (typeof hookMessageCodes)[number];

export type HookMessageHypothesis = {
  code: HookMessageCode;
  hookType: string;
  hypothesis: string;
  mainHook: string;
  subCopy: string;
  factIds: string[];
  confidence: "high" | "medium" | "low";
  evidenceSummary?: string;
  specificityScore?: number;
  naturalnessScore?: number;
  validationStatus?: "valid" | "invalid" | "fallback";
  validationErrors?: string[];
  generationSource?: "ai" | "repaired-ai" | "fallback";
  repairCount?: number;
};

export const hookTaxonomyTags = ["problem-solution", "sensory-experience", "price-value", "feature-usp", "review-trust", "usage-occasion", "target-identity", "convenience", "bundle-choice", "season-newness", "brand-origin", "comparison-alternative", "scarcity-urgency", "gift-purpose", "other"] as const;

export type HookTaxonomyTag = (typeof hookTaxonomyTags)[number];
export type CreativeExplorationMode = "concept-exploration" | "exact-message-comparison" | "reference-adapted-materials";

export type ProductInsightProfile = {
  productId: string;
  productName: string;
  category: string;
  brandName: string;
  primaryBenefit: string;
  customerReasons: Array<{ id: string; reason: string; factIds: string[]; strength: number }>;
  problems: Array<{ value: string; factIds: string[] }>;
  outcomes: Array<{ value: string; factIds: string[] }>;
  useOccasions: Array<{ value: string; factIds: string[] }>;
  targets: Array<{ value: string; factIds: string[] }>;
  ingredients: Array<{ value: string; factIds: string[] }>;
  priceSignals: Array<{ value: string; factIds: string[] }>;
  reviewSignals: Array<{ value: string; factIds: string[] }>;
  optionSignals: Array<{ value: string; factIds: string[] }>;
  originSignals: Array<{ value: string; factIds: string[] }>;
  seasonSignals: Array<{ value: string; factIds: string[] }>;
  visualAssets: Array<{ id: string; role: CreativeImageRole; path: string }>;
  dataSufficiency: number;
};

export type HookHypothesisScore = {
  evidenceStrength: number;
  specificity: number;
  purchaseReasonStrength: number;
  distinctiveness: number;
  attentionPotential: number;
  visualizability: number;
  advertisingFit: number;
  claimSafety: number;
  categoryPrior: number;
  novelty: number;
  total: number;
};

export type HookCreativeBrief = {
  creativeId: string;
  advertiserId: string;
  productId: string;
  hookId: string;
  hookCode: string;
  hypothesisId: string;
  mainHook: string;
  subCopy: string;
  customerInsight: string;
  messageHypothesis: string;
  verifiedFacts: string[];
  objective: string;
  visualStory: string;
  sceneDescription: string;
  productRole: string;
  composition: string;
  cameraDirection: string;
  lightingDirection: string;
  colorDirection: string;
  graphicDirection: string;
  copySafeZone: string;
  referenceImageIds: string[];
  forbiddenElements: string[];
  productDirection: string;
  backgroundDirection: string;
  copySafeDirection: string;
  mustUseReferenceImages: boolean;
  forbidPromotionalBannerCutouts: boolean;
  /** Native-final means the image model creates scene, product, Korean copy and layout together. */
  textRendering: "post-render-exact-korean" | "ai-native-final";
  sceneType?: string;
  framing?: string;
  productPlacement?: string;
  productScale?: string;
  typographyStyle?: string;
  emotionalTone?: string;
  visualMetaphor?: string;
  requiredKoreanText?: string[];
  negativePrompt?: string[];
  targetCustomer: string;
  customerSituation: string;
  intendedReaction: string;
  visualArchetype: string;
  heroScene: string;
  humanRole: string;
  cameraAngle: string;
  colorPalette: string;
  lighting: string;
  typographyDirection: string;
  supportingElements: string[];
  prohibitedClaims: string[];
  differentiationReason: string;
  differentiationFromOtherHooks: string;
};

export const categoryCreativeProfileIds = ["food_meat", "food_fresh", "food_processed", "beauty_cosmetics", "personal_care", "fashion", "health", "household", "kids", "general"] as const;

export type CategoryCreativeProfileId = (typeof categoryCreativeProfileIds)[number];

/** Category guidance for AI art direction. It never defines a fixed layout. */
export type CategoryCreativeProfile = {
  category: CategoryCreativeProfileId;
  label: string;
  visualObjectives: string[];
  recommendedScenes: string[];
  recommendedHumanUsage: string[];
  productPresentation: string[];
  typographyDirection: string[];
  colorDirection: string[];
  compositionDirection: string[];
  preferredVisualArchetypes: string[];
  avoidList: string[];
  reason: string;
  matchedSignals: string[];
};

export type CreativeGenerationEngine = "codex_local" | "openai_api";

/**
 * 유료 API는 키나 서버 플래그만으로 활성화하지 않는다.
 * 향후 별도 선택 UI에서 사용자가 해당 작업에 한해 명시적으로 승인했을 때만 전달한다.
 */
export type PaidApiAuthorization = {
  explicitlySelected: true;
  provider: "openai_api";
  scope: "native-creative";
  acknowledgedAt: string;
};

export function hasExplicitPaidApiAuthorization(value: PaidApiAuthorization | undefined): value is PaidApiAuthorization {
  if (value?.explicitlySelected !== true || value.provider !== "openai_api" || value.scope !== "native-creative") {
    return false;
  }
  const acknowledgedAt = Date.parse(value.acknowledgedAt);
  return Number.isFinite(acknowledgedAt) && acknowledgedAt <= Date.now();
}

export type VisualDiversityMatrixEntry = {
  hookCode: HookMessageCode;
  sceneType: string;
  cameraAngle: string;
  productPlacement: string;
  productScale: string;
  dominantColor: string;
  typographyStyle: string;
  emotionalTone: string;
  visualMetaphor: string;
  visualArchetype: string;
  humanUsage: string;
};

export type NativeCreativeValidation = {
  hookAlignment: number;
  productIdentity: number;
  factualAccuracy: number;
  koreanTextAccuracy: number;
  readability: number;
  composition: number;
  diversity: number;
  commercialQuality: number;
  exportCompliance: number;
  productVisibility: number;
  humanNaturalness: number;
  categoryFit: number;
  foodAppetiteAppeal: number;
  sensoryExpression: number;
  mobileReadability: number;
  observedKoreanText: string[];
  /** 실제 상품 패키지 밖에 AI가 새로 만든 독립 로고·워드마크가 있는지에 대한 시각 QA 결과입니다. */
  standaloneLogoDetected: boolean;
  standaloneLogoFindings: string[];
  /** 레퍼런스에 교체가 필요한 인물이 실제로 포함됐는지에 대한 시각 QA 결과입니다. */
  sourcePersonDetected?: boolean;
  /** 원본 인물을 삭제하지 않고 타깃 고객에 맞는 다른 가상 인물로 완전히 교체했는지 여부입니다. */
  sourcePersonReplaced?: boolean;
  /** 포즈·시선·카메라·크롭·위치 중 최소 두 요소가 달라졌는지 여부입니다. */
  humanCompositionChanged?: boolean;
  /** 인물만 덧대지 않고 원본 장소·배경 랜드마크까지 새 장면으로 교체했는지 여부입니다. */
  humanSceneBackgroundRebuilt?: boolean;
  humanSceneBackgroundFindings?: string[];
  targetAudienceFit?: number;
  humanReplacementFindings?: string[];
  /** 새 인물의 행동·표정·상황이 최종 광고 문구의 의미를 직접 뒷받침하는지 여부입니다. */
  humanCopyAligned?: boolean;
  humanCopyAlignmentFindings?: string[];
  /** 레퍼런스에 실제 동물·동물 캐릭터·마스코트가 포함됐는지에 대한 시각 QA 결과입니다. */
  sourceAnimalDetected?: boolean;
  /** 원본 동물의 구도적 역할을 유지하면서 상품 관련성이 있는 다른 동물로 교체했는지 여부입니다. */
  sourceAnimalReplaced?: boolean;
  animalReplacementFindings?: string[];
  /** 단순 무지/그래픽이 아닌 실제 장소·생활 소품 맥락의 배경이 레퍼런스에 있는지 여부입니다. */
  sourceContextualBackgroundDetected?: boolean;
  /** 의미 있는 원본 배경을 상품·문구에 맞는 새 장면으로 재구성했는지 여부입니다. */
  contextualBackgroundRebuilt?: boolean;
  contextualBackgroundFindings?: string[];
  /** 장면과 인물 행동이 원본 카테고리가 아니라 현재 상품의 사용·섭취 맥락을 보여주는지 여부입니다. */
  sceneProductInteractionAligned?: boolean;
  sceneProductInteractionFindings?: string[];
  /** 식품 결과에 현재 상품·확인된 재료가 아닌 다른 먹거리나 재료가 보이는지 여부입니다. */
  unrelatedFoodOrIngredientDetected?: boolean;
  unrelatedFoodOrIngredientFindings?: string[];
  /** source-brand/remove 영역의 글자뿐 아니라 빈 배지·캡슐·리본까지 완전히 제거했는지 여부입니다. */
  sourceBrandRegionCleared?: boolean;
  sourceBrandRegionFindings?: string[];
  /** VS 레퍼런스의 불리한 동일 카테고리 대안 → 현재 상품 해결 관계가 유지됐는지 여부입니다. */
  comparisonSemanticAligned?: boolean;
  comparisonSemanticFindings?: string[];
  failures: string[];
  recommendation: "approve" | "revise" | "manual-review";
  checkedAt: string;
};

export type NativeGroupValidation = {
  sceneDiversity: number;
  productPlacementDiversity: number;
  cameraDiversity: number;
  colorMoodDiversity: number;
  messageSeparation: number;
  hookSceneAlignment: number;
  typographyDiversity: number;
  visualArchetypeDiversity: number;
  categoryFit: number;
  duplicatePairs: Array<{
    leftHookCode: HookMessageCode;
    rightHookCode: HookMessageCode;
    reason: string;
  }>;
  reviseHookCodes: HookMessageCode[];
  failures: string[];
  recommendation: "approve" | "revise" | "manual-review";
  checkedAt: string;
};

export type NativeCreativeArtifact = {
  engine: CreativeGenerationEngine;
  /** 수동·자동 신규 작업이 공유하는 고정 레퍼런스 편집 계약입니다. */
  workflow?: "reference-lock-product-then-copy";
  stageOrder?: readonly ["reference-copy", "product-replacement", "copy-replacement", "qa-repair"];
  /** One of the unique advertisements randomly selected from the matching ZIP category for this result. */
  adReference?: {
    id: string;
    path: string;
    publicPath?: string;
    sourceFile?: string;
    layoutFamily: string;
    categoryGroup?: "fashion" | "food" | "beauty";
    foodSubcategory?: import("./referenceLibraryManagement").NativeReferenceFoodSubcategory;
    categoryLabel?: string;
    selectionReason: string;
    productForm?: import("./referenceLibraryManagement").NativeReferenceProductForm;
    compositionType?: import("./referenceLibraryManagement").NativeReferenceCompositionType;
    productSlotCount?: number;
    productSlotShape?: import("./referenceLibraryManagement").NativeReferenceSlotShape;
    photographyType?: import("./referenceLibraryManagement").NativeReferencePhotographyType;
    textDensity?: import("./referenceLibraryManagement").NativeReferenceTextDensity;
    compatibilityConfidence?: import("./referenceLibraryManagement").NativeReferenceCompatibilityConfidence;
    nativeCopy?: import("./referenceLibraryManagement").ReferenceNativeCopy;
  };
  /** Persisted outputs from the staged native-AI edit pipeline. */
  stagePaths?: {
    structurePath?: string;
    productPath?: string;
    copyPath?: string;
    qaRepairPaths?: string[];
  };
  /** Exact URL-product reference set supplied to this result's staged advertisement edits. */
  referencePaths?: string[];
  /** Legacy text-free scene path. New ai-native-final results leave this empty. */
  backgroundPath?: string;
  originalPath?: string;
  revisionPaths: string[];
  finalPath?: string;
  promptVersion: string;
  revisionCount: number;
  validation?: NativeCreativeValidation;
  provenance?: {
    workflow?: "reference-lock-product-then-copy";
    stageOrder?: readonly ["reference-copy", "product-replacement", "copy-replacement", "qa-repair"];
    referenceId: string;
    referenceSourcePath: string;
    referenceRawCopy?: string;
    adaptedCopy: string;
    productSourcePaths: string[];
    sourceProductImageIds?: string[];
    finalImageId?: string;
    editableRegions?: string[];
    lockedRegions?: string[];
    productReplacementSummary: string;
    copyReplacementSummary: string;
    finalOutputPath?: string;
    productQa?: { status: "passed" | "manual-review"; score: number };
    referencePreservationDetails?: { status: "passed" | "manual-review"; score: number };
    copyQaDetails?: { status: "passed" | "manual-review"; factualAccuracy: number; koreanTextAccuracy: number };
    sceneCopyAlignmentDetails?: { status: "passed" | "manual-review"; score: number };
    referencePreservationQa?: "passed" | "manual-review";
    copyQa?: "passed" | "manual-review";
    sceneCopyAlignmentQa?: "passed" | "manual-review";
    groupDiversityQa?: "passed" | "manual-review";
  };
  timing?: {
    referenceMs: number;
    generationMs: number;
    compositionMs?: number;
    validationMs: number;
    exportMs: number;
    totalMs: number;
  };
  composition?: {
    version: string;
    /** Present only for legacy template-composed results. */
    templateId?: PerformanceTemplateId;
    creativeGrammarId?: CreativeGrammarId;
    layoutPlan?: AdaptiveLayoutPlan;
    paletteId: string;
    productSource: string;
    productComposed: boolean;
    exactKoreanComposed: boolean;
    productBounds?: PlacementBox[];
    textBounds?: PlacementBox[];
    validationStatus?: "auto-checked" | "manual-review" | "failed";
  };
  export?: {
    width: 1200;
    height: 1200;
    fileSizeBytes: number;
    jpegQuality: number;
    colorSpace: "srgb";
    format: "jpeg";
  };
};

export type HookHypothesisCandidate = {
  id: string;
  primaryTag: HookTaxonomyTag;
  secondaryTags: HookTaxonomyTag[];
  hypothesis: string;
  mainHook: string;
  subCopy: string;
  coreClaim?: string;
  sentenceStyle?: "question" | "declaration" | "dialogue" | "contrast" | "sensory" | "urgency" | "proof";
  customerReason: string;
  customerTension: string;
  verifiedEvidence: string[];
  intendedReaction: string;
  visualConcept: string;
  prohibitedClaims: string[];
  confidence: "high" | "medium" | "low";
  generationSource: "codex-local" | "fallback";
  selectionReason: string;
  evidenceSummary: string;
  evidence: Array<{ fact: string; sourceReference: string }>;
  factIds: string[];
  sceneKey: string;
  visualStory: string;
  score: HookHypothesisScore;
  status: "candidate" | "selected" | "rejected";
  creativeBrief: HookCreativeBrief;
};

export type BrandAsset = {
  kind: "logo" | "wordmark" | "symbol";
  path: string;
  variant: "dark" | "light" | "color";
  exact: boolean;
};

export type BrandProfile = {
  id: string;
  name: string;
  aliases: string[];
  domains: string[];
  categories: string[];
  brandKeywords: string[];
  primaryColors: string[];
  secondaryColors: string[];
  toneOfVoice: string[];
  preferredHookTypes: string[];
  allowedClaimPatterns: string[];
  blacklistedClaims: string[];
  preferredSceneTypes: string[];
  preferredBlueprints: CreativeBlueprintId[];
  logoAssets: BrandAsset[];
  defaultLogoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  logoMinSize: number;
  minLogoClearSpace: number;
  fallbackPolicy: "brand-colors" | "category-colors" | "neutral";
};

export type CategoryProfile = {
  id: string;
  label: string;
  matchers: string[];
  fallbackColors: string[];
  audienceHints: string[];
  preferredHookTypes: string[];
  preferredSceneTypes: string[];
  preferredBlueprints: CreativeBlueprintId[];
  visualPriorities: string[];
  forbiddenAssumptions: string[];
};

export type HookPlan = {
  id: string;
  blueprintId: CreativeBlueprintId;
  hookType: string;
  title: string;
  headline: string;
  body: string;
  proof: string;
  offer: string;
  cta: string;
  audience: string;
  sceneIntent: string;
  factIds: string[];
  numericTokens: string[];
  experimentVariant?: string;
  visualDirection?: string;
  hookCode: HookMessageCode | string;
  hypothesis: string;
  confidence: "high" | "medium" | "low";
  mainMessage?: string;
  hookGroupId?: string;
  evidenceSummary?: string;
  specificityScore?: number;
  naturalnessScore?: number;
  validationStatus?: "valid" | "invalid" | "fallback";
  validationErrors?: string[];
  generationSource?: "ai" | "repaired-ai" | "fallback";
  repairCount?: number;
  primaryTag?: HookTaxonomyTag;
  secondaryTags?: HookTaxonomyTag[];
  customerReason?: string;
  coreClaim?: string;
  sentenceStyle?: HookHypothesisCandidate["sentenceStyle"];
  selectionReason?: string;
  score?: HookHypothesisScore;
  creativeBrief?: HookCreativeBrief;
  /** Automatically selected performance grammar. It is internal metadata, not ad copy. */
  performanceTemplateId?: PerformanceTemplateId;
  /** Semantic native-creative grammar. It carries no fixed coordinates. */
  creativeGrammarId?: CreativeGrammarId;
};

export const creativeGrammarIds = ["PROVOCATIVE_REVERSAL", "SENSORY_PROOF", "SITUATION_STORY", "PRICE_VALUE", "SOCIAL_DIALOGUE", "FEATURE_EVIDENCE", "BUNDLE_LINEUP", "SEASON_URGENCY", "PREMIUM_EDITORIAL", "PROBLEM_RELIEF"] as const;

export type CreativeGrammarId = (typeof creativeGrammarIds)[number];

export type AdaptiveLayoutPlan = {
  version: string;
  id: string;
  grammarId: CreativeGrammarId;
  sceneAnchor: "full-bleed" | "left-story" | "right-story" | "top-story" | "split-story";
  copyAnchor: "top-left" | "top-center" | "left-center" | "bottom-left" | "bottom-center";
  productAnchor: "left" | "center" | "right" | "bottom-left" | "bottom-right";
  productScale: number;
  productCount: 1 | 2 | 3;
  productRotation: number[];
  textAlign: "left" | "center";
  typographyRole: "heavy" | "display" | "editorial" | "handwritten";
  headlineMaxWidth: number;
  headlineMaxLines: number;
  subCopyMaxWidth: number;
  graphicMotif: "marker" | "speech" | "circle" | "arrow" | "label" | "receipt" | "none";
  paletteId: string;
  contrastSurface: "none" | "gradient" | "paper" | "solid";
  priceEmphasis: boolean;
  sceneKey: string;
  reasons: string[];
};

export type DynamicTextBox = PlacementBox & {
  maxChars: number;
  maxLines: number;
  fontSize: number;
  minFontSize: number;
  lineHeight: number;
  padding: number;
  align: "left" | "center";
  container: "none" | "panel" | "pill";
  colorRole: "foreground" | "background" | "accent" | "secondary";
  fillRole?: "background" | "foreground" | "accent" | "secondary";
};

export type CreativePalette = {
  background: string;
  foreground: string;
  accent: string;
  secondary: string;
};

export type TypographyPlan = {
  fontFamily: string;
  headlineFontSize: number;
  subCopyFontSize: number;
  ctaFontSize: number;
};

export const categoryDesignVariants = ["raw-product-focus", "cooked-serving", "set-composition", "fresh-origin", "harvest-story", "table-serving", "outfit-hero", "silhouette-focus", "detail-focus", "package-hero", "ingredient-proof", "usage-scene", "problem-scene", "function-demo", "clean-product-hero", "product-hero", "benefit-proof", "offer-focus"] as const;

export type CategoryDesignVariant = (typeof categoryDesignVariants)[number];

export type MasterCreativeDirection = {
  id: string;
  categoryProfileId: string;
  layoutFamily: CreativeBlueprintId;
  categoryVariant: CategoryDesignVariant;
  designFingerprint: string;
  backgroundAssetId: string;
  productComposition: ProductCompositionPlan;
  productPosition: PlacementBox;
  productScale: number;
  headlineBox: DynamicTextBox;
  subCopyBox: DynamicTextBox;
  proofBox?: DynamicTextBox;
  offerBox?: DynamicTextBox;
  logoBox: PlacementBox;
  ctaBox: DynamicTextBox;
  palette: CreativePalette;
  typography: TypographyPlan;
  fontPreset: string;
  overlay: {
    color: string;
    opacity: number;
  };
  fixedFacts: {
    proof?: string;
    offer?: string;
    price?: string;
    promotion?: string;
    cta: string;
  };
  selectionReasons: string[];
  locked: boolean;
};

export type CreativePlan = {
  id: string;
  productTruth: ProductTruth;
  brandProfile: BrandProfile;
  categoryProfile: CategoryProfile;
  categoryCreativeProfile?: CategoryCreativeProfile;
  hookPlans: HookPlan[];
  blueprintIds: CreativeBlueprintId[];
  masterDesign: MasterCreativeDirection;
  mode?: CreativeExplorationMode;
  productInsightProfile?: ProductInsightProfile;
  candidateHypotheses?: HookHypothesisCandidate[];
  selectedHypotheses?: HookHypothesisCandidate[];
  testCode: `T${string}`;
  copyGeneration: {
    provider: "openai" | "mixed" | "codex-local" | "fallback";
    model?: string;
    repairAttempts?: number;
    warnings: string[];
  };
  adBrief?: AdBrief;
  experimentContext?: {
    experimentId: string;
    experimentCode: string;
    originalHostProductNo: string;
    generationRound: number;
  };
  createdAt: string;
  plannerVersion: string;
};

export type BlueprintSlot = {
  id: "logo" | "headline" | "body" | "proof" | "offer" | "cta" | "product" | "scene";
  required: boolean;
  maxChars?: number;
  maxLines?: number;
  minFontSize?: number;
};

export type ProductCompositionMode = "single" | "repeat-overlap" | "scale-contrast";

export type ProductCompositionInstance = PlacementBox & {
  role: "support" | "primary";
  fit: "contain" | "cover";
  rotation: number;
  sourceIndex?: number;
};

export type ProductCompositionPlan = {
  mode: ProductCompositionMode;
  requiresTransparentProduct: boolean;
  instances: ProductCompositionInstance[];
};

export type CreativeBlueprint = {
  id: CreativeBlueprintId;
  label: string;
  description: string;
  referencePattern: string;
  sceneModes: string[];
  productBox: PlacementBox;
  productComposition?: ProductCompositionPlan;
  textSafeArea: PlacementBox;
  logoBox: PlacementBox;
  slots: BlueprintSlot[];
  palettePolicy: "brand-led" | "dark-performance" | "editorial" | "ugc";
  fallbackBlueprintId?: CreativeBlueprintId;
};

export type SceneAsset = {
  id: string;
  file: string;
  sourceType: "library" | "generated" | "product" | "fallback";
  assetType: string;
  scene: string;
  category: string;
  includesPerson: boolean;
  textSafeArea: string;
  productPosition: string;
  license?: {
    sourceName: string;
    sourcePageUrl?: string;
    licenseUrl?: string;
    authorName?: string;
  };
};

export type ScenePlan = {
  id: string;
  blueprintId: CreativeBlueprintId;
  sceneAsset: SceneAsset;
  prompt?: string;
  negativePrompt?: string;
  promptVersion: string;
  provider: "library" | "openai" | "mock";
  providerModel?: string;
  generated: boolean;
  paidGenerationAllowed: boolean;
  reason: string;
  masterSceneId?: string;
  generationMode?: MasterSceneGenerationMode;
};

export type PlacementBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PlacementPlan = {
  product: PlacementBox;
  text: PlacementBox;
  logo: PlacementBox;
  scene: PlacementBox;
  safeMargin: number;
};

export type CopyPlan = Pick<HookPlan, "headline" | "body" | "proof" | "offer" | "cta"> & {
  factIds: string[];
  numericTokens: string[];
};

export type LayoutPlan = {
  blueprintId: CreativeBlueprintId;
  placement: PlacementPlan;
  colors: {
    background: string;
    foreground: string;
    accent: string;
    secondary: string;
  };
  fontFamily: string;
  headlineFontSize: number;
  bodyFontSize: number;
  minFontSize: number;
};

export type RenderPlan = {
  id: string;
  jobId: string;
  resultId: string;
  width: 1200;
  height: 1200;
  outputFormat: "webp" | "jpeg";
  maxFileSizeBytes: number;
  copy: CopyPlan;
  layout: LayoutPlan;
  scene: ScenePlan;
  productImagePaths: string[];
  productImageAssets: CreativeImageAsset[];
  productComposition: ProductCompositionPlan;
  masterDesignId: string;
  designFingerprint: string;
  backgroundAssetId: string;
  masterSceneId?: string;
  masterVisualDigest?: string;
  generationMode?: MasterSceneGenerationMode;
  productReferenceProfileId?: string;
  productLayerRequired?: boolean;
  overlay: MasterCreativeDirection["overlay"];
  fontAdjustments?: string[];
  renderedSlots: Array<{
    id: "headline" | "body" | "proof" | "offer" | "cta";
    box: PlacementBox;
    textBounds: PlacementBox;
    text: string;
    lines: string[];
    textColor: string;
    fillColor?: string;
    fontSize: number;
    lineHeight: number;
    lineCount: number;
    overflow: boolean;
  }>;
  logoAsset?: BrandAsset;
  repairPass: number;
};

export type QAFinding = {
  id: string;
  severity: "info" | "warning" | "error";
  dimension: "technical" | "text-overflow" | "contrast" | "product-visibility" | "factual-safety" | "logo" | "duplication" | "category-contamination" | "image-role" | "empty-element" | "unsupported-visualization" | "copy-quality" | "layout-collision";
  message: string;
  repairable: boolean;
};

export type QAResult = {
  passed: boolean;
  score: number;
  technicalPassed: boolean;
  creativePassed: boolean;
  technicalScore: number;
  creativeScore: number;
  width: number;
  height: number;
  format: string;
  fileSizeBytes: number;
  decoded: boolean;
  minFontSize: number;
  productAreaRatio: number;
  findings: QAFinding[];
  autoRepairs: string[];
  designLockVerified?: boolean;
  masterSceneLockVerified?: boolean;
  checkedAt: string;
};

export type GenerationResultStatus = "pending" | "running" | "success" | "failed" | "cancelled" | "korean-review" | "product-review" | "quality-review" | "group-review" | "approved" | "excluded";

export type DeliveryBranding = {
  logoId?: string;
  aiDisclosure: boolean;
  imagePath?: string;
  sourceImagePath?: string;
  updatedAt: string;
};

export type GenerationResult = {
  id: string;
  order: number;
  /** 새 기본 제작에서 사용자에게 표시하는 소재 순번. H 코드는 과거 저장 구조 호환용입니다. */
  materialCode?: string;
  blueprintId: CreativeBlueprintId;
  blueprintLabel: string;
  status: GenerationResultStatus;
  hookPlan: HookPlan;
  scenePlan: ScenePlan;
  creativeDesign?: MasterCreativeDirection;
  masterScene?: MasterSceneArtifact;
  generationStage?: "planned" | "reference-preparing" | "reference-selecting" | "structure-recreating" | "product-replacing" | "copy-replacing" | "qa-repairing" | "ai-generating" | "ai-revising" | "quality-check" | "exporting" | "completed" | "scene-generating" | "compositing" | "copy-rendering";
  renderPlan?: RenderPlan;
  imagePath?: string;
  downloadName?: string;
  creativeAsset?: CreativeAssetSnapshot;
  qa?: QAResult;
  contentNoteCompliance?: CreativeNoteCompliance;
  attempts: number;
  autoRepairs?: string[];
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  nativeCreative?: NativeCreativeArtifact;
  userFeedback?: string;
  deliveryBranding?: DeliveryBranding;
  /** 새 기본 제작의 원본 데이터. hookPlan은 과거 결과 호환용 투영값입니다. */
  referenceAdaptedCopyPlan?: ReferenceAdaptedCopyPlan;
};

export type GenerationJobStatus = "pending" | "running" | "partial" | "completed" | "failed" | "cancelled";

/**
 * 수동 제작에서 자동 상품군 판정을 덮어쓸 때만 저장하는 레퍼런스 풀입니다.
 * `food-snack`은 별도 대분류가 아니라 음식 안의 간식 전용 풀입니다.
 * `food-produce`는 저장된 과거 작업을 읽기 위한 호환 값이며 신규 UI에는 노출하지 않습니다.
 */
export type ReferenceCategoryOverride = "fashion" | "food" | "food-snack" | "food-produce" | "beauty";

export type GenerationJob = {
  id: string;
  status: GenerationJobStatus;
  productTruth: ProductTruth;
  creativePlan: CreativePlan;
  results: GenerationResult[];
  concurrency: number;
  retryLimit: number;
  paidImageGenerationEnabled: boolean;
  productReferenceProfile?: ProductReferenceProfile;
  masterScene?: MasterSceneArtifact;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  timing: { planningMs: number; totalMs?: number };
  errors: string[];
  version: string;
  /** Semantic pipeline name. Older v12 jobs may omit it and remain readable. */
  pipeline?: "reference-staged-edit" | "reference-first-adapted-copy";
  engine?: CreativeGenerationEngine;
  /** 서버 저장용 작업별 유료 API 승인. 기본 Codex 작업에는 존재하지 않는다. */
  paidApiAuthorization?: PaidApiAuthorization;
  paidApiUsed?: boolean;
  advertiserId?: string;
  advertiserName?: string;
  visualDiversityMatrix?: VisualDiversityMatrixEntry[];
  groupValidation?: NativeGroupValidation;
  groupRevisionCount?: number;
  recoveryLog?: Array<{
    at: string;
    message: string;
    resultIds: string[];
  }>;
  executionResultIds?: string[];
  sourceType?: "manual" | "auto-production";
  /** 수동 제작자가 선택한 레퍼런스 상품군. 없으면 ProductTruth로 자동 판정합니다. */
  referenceCategoryOverride?: ReferenceCategoryOverride;
  autoProductionRunId?: string;
  autoProductionTaskId?: string;
  hookLearningApplied?: boolean;
  /** 상품 단위 대표 이미지. 여러 이미지가 있어도 광고 기본 문구는 이 결과를 기준으로 하나만 생성합니다. */
  representativeResultId?: string;
  /** Meta 기본 문구. 결과 이미지 수와 관계없이 작업(상품)당 최대 하나입니다. */
  adCopy?: ProductAdCopy;
  planningFingerprint?: string;
  templateRegistryVersion?: string;
  unusedPerformanceTemplateIds?: PerformanceTemplateId[];
  /** 값이 없으면 과거 작업으로 보고 legacy-hook-first로 읽습니다. */
  copyPlanMode?: "reference-adapted" | "legacy-hook-first";
  referenceCopyProfiles?: ReferenceCopyProfile[];
};

export type GenerationJobSummary = {
  jobId: string;
  advertiserId?: string;
  advertiserName?: string;
  productId: string;
  productName: string;
  productUrl: string;
  sourceType?: "manual" | "auto-production";
  totalCount: number;
  completedCount: number;
  generatedCount: number;
  successCount: number;
  failedCount: number;
  currentHookCode?: string;
  status: GenerationJobStatus;
  runnerActive: boolean;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
};

export type CreateGenerationJobInput = {
  product: ProductInfoForPrompt;
  adBrief?: AdBrief;
  productImagePaths?: string[];
  selectedAdImages?: string[];
  imageAssets?: CreativeImageAsset[];
  logoPath?: string;
  source?: "landing-page" | "user-input";
  /** 수동 제작 전용 레퍼런스 풀 선택. 생략하면 상품 분석 결과로 자동 매칭합니다. */
  referenceCategoryOverride?: ReferenceCategoryOverride;
  concurrency?: number;
  preserveMasterDesignId?: string;
  preserveBackgroundAssetId?: string;
  excludedMasterDesignIds?: CreativeBlueprintId[];
  testCode?: `T${string}`;
  generationModePreference?: "auto" | "actual-product" | "ai-full-scene" | "reference-staged-edit" | "reference-first-adapted-copy";
  forceSceneRevision?: boolean;
  strategyVariation?: number;
  mode?: CreativeExplorationMode;
  engine?: CreativeGenerationEngine;
  /** 별도 유료 공급자 선택 화면에서만 설정한다. 일반 제작 UI는 이 값을 보내지 않는다. */
  paidApiAuthorization?: PaidApiAuthorization;
};
