import type { AdBrief, ProductInfoForPrompt } from "../mvp/types";
import type { CreativeAssetSnapshot } from "../creative-assets/types";
import type { CreativeNoteCompliance } from "../creative-content-notes/types";

export const CREATIVE_PLANNER_VERSION = "creative-planner-v3-hook-master";

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
  "H07",
  "H08",
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

export type MasterCreativeDirection = {
  id: string;
  categoryProfileId: string;
  layoutFamily: CreativeBlueprintId;
  backgroundAssetId: string;
  productComposition: ProductCompositionPlan;
  headlineBox: DynamicTextBox;
  subCopyBox: DynamicTextBox;
  proofBox?: DynamicTextBox;
  offerBox?: DynamicTextBox;
  logoBox: PlacementBox;
  ctaBox: DynamicTextBox;
  palette: CreativePalette;
  typography: TypographyPlan;
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
  testCode: `T${string}`;
  copyGeneration: {
    provider: "openai" | "fallback";
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
  backgroundAssetId: string;
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
  checkedAt: string;
};

export type GenerationResultStatus = "pending" | "running" | "success" | "failed" | "cancelled";

export type GenerationResult = {
  id: string;
  order: number;
  blueprintId: CreativeBlueprintId;
  blueprintLabel: string;
  status: GenerationResultStatus;
  hookPlan: HookPlan;
  scenePlan: ScenePlan;
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
  paidImageGenerationEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  timing: { planningMs: number; totalMs?: number };
  errors: string[];
  version: string;
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
};
