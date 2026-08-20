import type { AdBrief, ProductInfoForPrompt } from "../mvp/types";
import type { CreativeAssetSnapshot } from "../creative-assets/types";
import type { CreativeNoteCompliance } from "../creative-content-notes/types";

export const CREATIVE_PLANNER_VERSION = "creative-planner-v7-ai-hook-parallel-repair";

export const creativeBlueprintIds = [
  "problem-solution-split",
  "editorial-story",
  "chat-ugc",
  "comparison-versus",
  "product-hero-lifestyle",
  "proof-data",
] as const;

export type CreativeBlueprintId = (typeof creativeBlueprintIds)[number];
export type FactVerification = "verified" | "source-backed" | "user-provided" | "unverified";
export type ProductEvidenceType =
  | "identity"
  | "usp"
  | "ingredient"
  | "composition"
  | "quantity"
  | "usage"
  | "target"
  | "price"
  | "offer"
  | "shipping"
  | "review"
  | "origin"
  | "certification"
  | "numeric"
  | "other";

export type ProductFact = {
  id: string;
  key: string;
  label: string;
  value: string;
  verification: FactVerification;
  source: "landing-page" | "structured-product" | "user-input" | "derived";
  sourceUrl?: string;
  usableInCopy: boolean;
  numericTokens: string[];
  strength?: number;
  specificity?: number;
  evidenceType?: ProductEvidenceType;
};

export type ProductEvidence = {
  factId: string;
  summary: string;
  strength: number;
  specificity: number;
  evidenceType: ProductEvidenceType;
};

export type CreativeImageRole =
  | "product-cutout"
  | "product-packshot"
  | "product-lifestyle"
  | "detail-image"
  | "ad-reference"
  | "review-image"
  | "logo"
  | "background";

export type CreativeImageAsset = {
  id: string;
  path: string;
  role: CreativeImageRole;
  source:
    | "known-product"
    | "user-confirmed"
    | "product-page"
    | "source-candidate"
    | "selected-reference"
    | "brand-profile";
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

export const productReferenceRoles = [
  "primary-product",
  "front-package",
  "side-package",
  "back-package",
  "product-detail",
  "texture",
  "lifestyle",
  "usage",
  "worn",
  "cooked",
  "ingredient",
  "size-reference",
  "option",
  "brand-logo",
  "unknown",
] as const;

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

export const masterSceneConcepts = [
  "sensory-impact",
  "problem-solution",
  "premium-editorial",
  "price-impact",
  "review-trust",
  "usage-moment",
  "ingredient-origin",
  "brand-story",
  "target-lifestyle",
] as const;

export type MasterSceneConcept = (typeof masterSceneConcepts)[number];

export const masterSceneGenerationModes = [
  "ai-background-composite",
  "ai-reference-full-creative",
  "reference-guided-full-scene",
  "real-photo-adaptation",
  "protected-product-composite",
  "library-fallback",
] as const;

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
  facts: ProductFact[];
  verifiedClaims: string[];
  unverifiedClaims: string[];
  allowedNumericTokens: string[];
  blockedClaimPatterns: string[];
  imageAssets: CreativeImageAsset[];
  referenceImages: CreativeImageAsset[];
  imagePaths: string[];
  confirmedProductImage?: CreativeImageAsset;
  coreEvidence?: ProductEvidence[];
  needsConfirmationImages?: CreativeImageAsset[];
  completeness: number;
  createdAt: string;
};

export const hookMessageCodes = [
  "H01",
  "H02",
  "H03",
  "H04",
  "H05",
  "H06",
] as const;

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

export const hookTaxonomyTags = [
  "problem-solution",
  "sensory-experience",
  "price-value",
  "feature-usp",
  "review-trust",
  "usage-occasion",
  "target-identity",
  "convenience",
  "bundle-choice",
  "season-newness",
  "brand-origin",
  "comparison-alternative",
  "scarcity-urgency",
  "gift-purpose",
  "other",
] as const;

export type HookTaxonomyTag = (typeof hookTaxonomyTags)[number];
export type CreativeExplorationMode = "concept-exploration" | "exact-message-comparison";

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
  purchaseReasonStrength: number;
  distinctiveness: number;
  visualizability: number;
  claimSafety: number;
  categoryPrior: number;
  novelty: number;
  total: number;
};

export type HookCreativeBrief = {
  creativeId: string;
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
};

export type CreativeGenerationEngine = "codex_local" | "openai_api";

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
  observedKoreanText: string[];
  failures: string[];
  recommendation: "approve" | "revise" | "manual-review";
  checkedAt: string;
};

export type NativeCreativeArtifact = {
  engine: CreativeGenerationEngine;
  originalPath?: string;
  revisionPaths: string[];
  finalPath?: string;
  promptVersion: string;
  revisionCount: number;
  validation?: NativeCreativeValidation;
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
  customerReason: string;
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
  selectionReason?: string;
  score?: HookHypothesisScore;
  creativeBrief?: HookCreativeBrief;
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

export const categoryDesignVariants = [
  "raw-product-focus",
  "cooked-serving",
  "set-composition",
  "fresh-origin",
  "harvest-story",
  "table-serving",
  "outfit-hero",
  "silhouette-focus",
  "detail-focus",
  "package-hero",
  "ingredient-proof",
  "usage-scene",
  "problem-scene",
  "function-demo",
  "clean-product-hero",
  "product-hero",
  "benefit-proof",
  "offer-focus",
] as const;

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
  hookPlans: HookPlan[];
  blueprintIds: CreativeBlueprintId[];
  masterDesign: MasterCreativeDirection;
  mode?: CreativeExplorationMode;
  productInsightProfile?: ProductInsightProfile;
  candidateHypotheses?: HookHypothesisCandidate[];
  selectedHypotheses?: HookHypothesisCandidate[];
  testCode: `T${string}`;
  copyGeneration: {
    provider: "openai" | "mixed" | "fallback";
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
  dimension:
    | "technical"
    | "text-overflow"
    | "contrast"
    | "product-visibility"
    | "factual-safety"
    | "logo"
    | "duplication"
    | "category-contamination"
    | "image-role"
    | "empty-element"
    | "unsupported-visualization"
    | "copy-quality"
    | "layout-collision";
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

export type GenerationResultStatus = "pending" | "running" | "success" | "failed" | "cancelled" | "korean-review" | "product-review" | "approved" | "excluded";

export type GenerationResult = {
  id: string;
  order: number;
  blueprintId: CreativeBlueprintId;
  blueprintLabel: string;
  status: GenerationResultStatus;
  hookPlan: HookPlan;
  scenePlan: ScenePlan;
  creativeDesign?: MasterCreativeDirection;
  masterScene?: MasterSceneArtifact;
  generationStage?: "planned" | "reference-preparing" | "ai-generating" | "ai-revising" | "quality-check" | "exporting" | "completed" | "scene-generating" | "compositing" | "copy-rendering";
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
};

export type GenerationJobStatus =
  | "pending"
  | "running"
  | "partial"
  | "completed"
  | "failed"
  | "cancelled";

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
  engine?: CreativeGenerationEngine;
  paidApiUsed?: boolean;
  advertiserId?: string;
  advertiserName?: string;
  codexThreadId?: string;
  visualDiversityMatrix?: VisualDiversityMatrixEntry[];
  recoveryLog?: Array<{
    at: string;
    message: string;
    resultIds: string[];
  }>;
  executionResultIds?: string[];
  sourceType?: "manual" | "auto-production";
  autoProductionRunId?: string;
  autoProductionTaskId?: string;
  hookLearningApplied?: boolean;
};

export type GenerationJobSummary = {
  jobId: string;
  advertiserId?: string;
  advertiserName?: string;
  productId: string;
  productName: string;
  productUrl: string;
  totalCount: number;
  completedCount: number;
  successCount: number;
  failedCount: number;
  currentHookCode?: string;
  status: GenerationJobStatus;
  runnerActive: boolean;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  completedAt?: string;
  completedResults: GenerationResult[];
  failedResults: GenerationResult[];
};

export type CreateGenerationJobInput = {
  product: ProductInfoForPrompt;
  adBrief?: AdBrief;
  productImagePaths?: string[];
  selectedAdImages?: string[];
  imageAssets?: CreativeImageAsset[];
  logoPath?: string;
  source?: "landing-page" | "user-input";
  concurrency?: number;
  preserveMasterDesignId?: string;
  preserveBackgroundAssetId?: string;
  excludedMasterDesignIds?: CreativeBlueprintId[];
  testCode?: `T${string}`;
  generationModePreference?: "auto" | "actual-product" | "ai-full-scene";
  forceSceneRevision?: boolean;
  strategyVariation?: number;
  mode?: CreativeExplorationMode;
  engine?: CreativeGenerationEngine;
};
