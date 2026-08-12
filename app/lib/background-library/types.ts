import type {
  AdHookType,
  AdProductPosition,
  AdTextSafeArea,
  CreativeStrategy,
  ProductInfoForPrompt,
} from "../mvp/types";

export const backgroundCategories = [
  "fashion",
  "beauty",
  "health",
  "agriculture",
  "meat",
  "seafood",
  "processed-food",
  "food-mall",
  "living",
  "kids",
  "pet",
  "promotion",
] as const;

export type BackgroundCategory = (typeof backgroundCategories)[number];

export const backgroundAssetTypes = [
  "lifestyle_photo",
  "people_photo",
  "product_set",
  "pattern_texture",
  "ingredient_scene",
  "ai_generated",
  "designed_asset",
  "user_uploaded",
] as const;

export type BackgroundAssetType = (typeof backgroundAssetTypes)[number];

export const backgroundHookTypes = [
  "problem_solution",
  "price_offer",
  "usp_proof",
  "sensory",
  "situation",
  "review_ugc",
  "urgency",
  "premium",
  "styling",
  "freshness",
  "origin_story",
  "family",
  "convenience",
  "gifting",
] as const;

export type BackgroundHookType = (typeof backgroundHookTypes)[number];
export type BackgroundSourceType =
  | "stock_photo"
  | "ai_generated"
  | "designed_asset"
  | "user_uploaded";

export const audienceAgeGroups = [
  "teens",
  "twenties",
  "thirties",
  "forties",
  "fifties",
  "senior",
  "kids",
  "family",
  "couple",
  "friends",
  "no_people",
] as const;

export type AudienceAgeGroup = (typeof audienceAgeGroups)[number];

export const backgroundPeopleTypes = [
  "woman",
  "man",
  "couple",
  "family",
  "friends",
  "parent_child",
  "office_worker",
  "athlete",
  "farmer",
  "senior",
  "child",
  "no_people",
] as const;

export type BackgroundPeopleType = (typeof backgroundPeopleTypes)[number];

export const automaticLayoutPresets = [
  "text-left-product-right",
  "text-right-product-left",
  "text-top-product-bottom",
  "text-bottom-product-top",
  "centered-product-promotion",
  "lifestyle-caption",
  "editorial-overlay",
  "premium-minimal",
  "split-panel",
  "price-focused",
  "ingredient-story",
  "people-scene",
  "product-grounded",
  "fashion-lookbook",
] as const;

export type AutomaticLayoutPreset = (typeof automaticLayoutPresets)[number];

export type AudienceProfile = {
  category: BackgroundCategory;
  ageGroups: AudienceAgeGroup[];
  labels: string[];
  evidence: string[];
  confidence: "explicit" | "inferred" | "broad";
};

export type BackgroundLibraryItem = {
  id: string;
  file: string;
  enabled: boolean;
  category: BackgroundCategory;
  subcategories: string[];
  industries: string[];
  assetType: BackgroundAssetType;
  hookTypes: BackgroundHookType[];
  ageGroups: AudienceAgeGroup[];
  peopleType: BackgroundPeopleType[];
  peopleCount: number;
  includesPerson: boolean;
  personPosition: "left" | "center" | "right" | "none";
  personGaze: "left" | "front" | "right" | "away" | "none";
  personEmotion: string;
  personAction: string;
  scene: string;
  mood: string[];
  elements: string[];
  colors: string[];
  productPosition: AdProductPosition;
  textSafeArea: AdTextSafeArea;
  focalArea: string;
  groundArea?: { y: number; xStart?: number; xEnd?: number };
  emptyAreas?: AdTextSafeArea[];
  complexAreas?: AdTextSafeArea[];
  dominantSubjectPosition?: "left" | "center" | "right" | "none";
  brightness: "bright" | "medium" | "dark";
  contrast: "low" | "medium" | "high";
  orientation: "square";
  recommendedLayouts?: AutomaticLayoutPreset[];
  advertiserAliases?: string[];
  productKeywords?: string[];
  sourceType: BackgroundSourceType;
  sourceName: string;
  sourcePageUrl: string;
  originalImageUrl: string;
  licenseUrl: string;
  authorName: string;
  downloadedAt?: string;
  generationModel?: string;
  generationPrompt?: string;
  generatedAt?: string;
  reviewed?: boolean;
  designMethod?: string;
  createdAt?: string;
  uploadedAt?: string;
  width: number;
  height: number;
  fileSize: number;
  hash: string;
  perceptualHash?: string;
};

export type BackgroundRecommendation = {
  background: BackgroundLibraryItem;
  score: number;
  matchScore: number;
  diversityScore: number;
  reasons: string[];
  connectionLabel?: string;
  audienceMatchLabels?: string[];
  automaticLayout: AutomaticLayoutPreset;
};

export type BackgroundRecommendationInput = {
  product: Partial<ProductInfoForPrompt> & {
    productSubCategory?: string;
    detectedProductType?: string;
    targetAgeGroups?: AudienceAgeGroup[];
    productColors?: string[];
    brandColors?: string[];
    ingredients?: string[];
    modelIncluded?: boolean;
  };
  hook: Pick<
    CreativeStrategy,
    | "hookType"
    | "backgroundHookType"
    | "sceneDescription"
    | "mood"
    | "textSafeArea"
    | "productPosition"
    | "backgroundTags"
  > & {
    targetAgeGroups?: AudienceAgeGroup[];
    preferredAssetTypes?: BackgroundAssetType[];
    preferredColors?: string[];
  };
  limit?: number;
  excludeIds?: string[];
  selectedIds?: string[];
  recommendationPage?: number;
};

export const adaptiveLayoutVariants = [
  "copy-focused",
  "product-focused",
  "content-focused",
] as const;

export type AdaptiveLayoutVariant = (typeof adaptiveLayoutVariants)[number];
export type BackgroundSelectionMode = "recommended" | "library" | "fixed";
export type CreativeGenerationMode =
  | "diverse-backgrounds"
  | "selected-background"
  | "hook-based";

export type AdaptivePlacementBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AdaptiveTextPlacement = AdaptivePlacementBox & {
  align: "left" | "center" | "right";
  fontSize: number;
  maxLines: number;
  color: string;
};

export type AdaptiveProductComposition =
  | { mode: "single"; count: 1; scaleStep: number; overlapRatio: number }
  | {
      mode: "repeat-overlap" | "scale-contrast";
      count: 2 | 3;
      scaleStep: number;
      overlapRatio: number;
    };

export type AdaptiveCreativePlan = {
  id: string;
  productId: string;
  hookId: string;
  backgroundId: string;
  backgroundSelectionMode: BackgroundSelectionMode;
  layoutType: AutomaticLayoutPreset;
  layoutVariant: AdaptiveLayoutVariant;
  productPlacement: AdaptivePlacementBox & {
    scale: number;
    rotation: number;
    groundY: number;
  };
  productComposition: AdaptiveProductComposition;
  textPlacement: AdaptiveTextPlacement;
  bodyPlacement: AdaptiveTextPlacement;
  pricePlacement: AdaptiveTextPlacement & { visible: boolean };
  ctaPlacement: AdaptiveTextPlacement & { visible: boolean };
  colorPalette: {
    headline: string;
    body: string;
    price: string;
    accent: string;
    ctaBackground: string;
    ctaText: string;
    panel: string;
  };
  contrastAdjustments: {
    useTextPanel: boolean;
    panelOpacity: number;
    gradientDirection: "left" | "right" | "top" | "bottom" | "none";
    productSeparation: number;
  };
  backgroundAdjustments: {
    brightness: number;
    blur: number;
    scale: number;
    offsetX: number;
    offsetY: number;
  };
  decorationStyle: "minimal" | "editorial" | "ingredient" | "promotion" | "none";
  rationale: string;
  createdAt: string;
  updatedAt: string;
};

export type BackgroundRecommendationHistory = {
  recommendedBackgroundIds: string[];
  selectedBackgroundId?: string;
  excludedBackgroundIds: string[];
  recommendationPage: number;
  hookId: string;
  productCategory: string;
  createdAt: string;
};

export type AdaptiveCreativeRenderResult = {
  id: string;
  status: "pending" | "running" | "success" | "error";
  mode: CreativeGenerationMode;
  background: BackgroundLibraryItem;
  plan: AdaptiveCreativePlan;
  hookId: string;
  hookTitle: string;
  imagePath?: string;
  errorMessage?: string;
};

export type BackgroundLibrarySummary = {
  total: number;
  totalBytes: number;
  counts: Record<BackgroundCategory, number>;
  assetTypeCounts: Record<BackgroundAssetType, number>;
  peopleTotal: number;
  ageCounts: Record<AudienceAgeGroup, number>;
};

export const legacyHookToBackgroundHook: Record<AdHookType, BackgroundHookType> = {
  "price-benefit": "price_offer",
  "feature-usp": "usp_proof",
  lifestyle: "situation",
  "season-event": "urgency",
  "problem-solution": "problem_solution",
  "social-proof": "review_ugc",
  curiosity: "usp_proof",
  sensory: "sensory",
  gift: "gifting",
  "brand-story": "origin_story",
};
