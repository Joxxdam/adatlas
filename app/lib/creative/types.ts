import type {
  AdBrief,
  CreativeStrategy,
  GeneratedAdCopy,
  ProductImageRenderEffect,
  ProductInfoForPrompt,
  ReferenceMatchResult,
} from "../mvp/types";

export type AdvertiserProfile = {
  id: string;
  name: string;
  aliases?: string[];
  domains?: string[];
  categories: string[];
  brandKeywords?: string[];
  visualKeywords?: string[];
  preferredTones?: string[];
  preferredColorHints?: string[];
  prohibitedVisuals?: string[];
  prohibitedClaims?: string[];
  productDisplayRules?: string[];
  scenePreferences?: string[];
  defaultTextStylePreset?: string;
  defaultSceneProfile?: string;
  logoAssets?: Array<{
    kind: "logo" | "wordmark" | "symbol";
    path: string;
    variant: "dark" | "light" | "color";
    exact: boolean;
  }>;
  productAssets?: Array<{
    productId: string;
    productName: string;
    cutoutPath: string;
    backgroundPrefix: string;
  }>;
  preferredBlueprints?: string[];
  defaultLogoPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  logoMinSize?: number;
  minLogoClearSpace?: number;
};

export type ProductSafeZone = {
  position: string;
  widthRatio: number;
  heightRatio: number;
};

export type TextSafeZone = ProductSafeZone & {
  contrastRequirement: string;
};

export type SceneProfile = {
  id: string;
  label: string;
  categoryMatchers: string[];
  benefitMatchers?: string[];
  visualMood: string[];
  environment: string[];
  props?: string[];
  lighting: string[];
  textures?: string[];
  colorHints?: string[];
  compositionRules: string[];
  productSafeZoneRules: string[];
  textSafeZoneRules: string[];
  negativePromptRules: string[];
  compatibleArchetypes: string[];
};

export type ScenePromptPlan = {
  profileId: string;
  sceneType: string;
  visualMood: string[];
  environment: string[];
  lighting: string[];
  props: string[];
  colorHints: string[];
  productSafeZone: ProductSafeZone;
  textSafeZones: TextSafeZone[];
  depthPlan: {
    foreground: string[];
    midground: string[];
    background: string[];
  };
  prohibitedElements: string[];
  prompt: string;
  negativePrompt: string;
  reason: string;
};

export type VisualArchetype = {
  id: string;
  name: string;
  suitableStrategies: string[];
  suitableCategories: string[];
  textHierarchy: string[];
  recommendedProductCount: number[];
  productPlacement: string;
  sceneConditions: string[];
  graphicComponents: string[];
  useFooterBar: boolean;
  ctaPosition: string;
  textSafeArea: string;
  recommendedIntensity: Array<AdBrief["creativeIntensity"]>;
  avoid: string[];
};

export type TextStylePreset = {
  id: string;
  label: string;
  fontFamily: string;
  fontWeight: number;
  headlineScale: number;
  secondaryScale: number;
  letterSpacing: number;
  lineHeight: number;
  foregroundColor: string;
  outline?: { color: string; width: number };
  shadow?: { color: string; blur: number; offsetX: number; offsetY: number };
  backgroundBox?: { color: string; opacity: number; paddingRatio: number };
  highlightColors: string[];
  recommendedLineCount: number;
  recommendedCharacterRange: [number, number];
};

export type GraphicComponentPreset = {
  id: string;
  label: string;
  layer: "behind-product" | "product" | "above-product" | "text" | "footer";
  editable: Array<"text" | "visible" | "position" | "size" | "style" | "zIndex">;
  purpose: string;
};

export type ProductArrangement = {
  count: number;
  placement: string;
  scale: string;
  rotation?: number[];
};

export type VisualDirection = {
  id: string;
  title: string;
  archetypeId: string;
  sceneProfileId: string;
  textStylePresetId: string;
  recommendedTemplateId?: string;
  mood: string[];
  productArrangement: ProductArrangement;
  graphicComponents: string[];
  colorDirection: string[];
  headlineTreatment: string;
  footerTreatment?: string;
  scenePromptPlan: ScenePromptPlan;
  benchmarkPatternsUsed: string[];
  referencePatternsUsed: string[];
  reason: string;
  advertiserProfileId: string;
  productTreatment: ProductImageRenderEffect;
};

export type SceneGenerationProviderId = "openai" | "gemini" | "mock";

export type SceneGenerationInput = {
  width: 1200;
  height: 1200;
  prompt: string;
  negativePrompt?: string;
  referenceImages?: string[];
  productSafeZone?: ProductSafeZone;
  textSafeZones?: TextSafeZone[];
  profileId?: string;
  colorHints?: string[];
};

export type SceneGenerationResult = {
  imageUrl?: string;
  localPath?: string;
  imageBuffer?: Buffer;
  provider: SceneGenerationProviderId;
  revisedPrompt?: string;
  metadata?: Record<string, unknown>;
  fallback?: boolean;
  warning?: string;
};

export type SceneCandidateQuality = {
  score: number;
  status: "pass" | "repaired" | "review";
  sourceOpaque: boolean;
  outputOpaque: boolean;
  transparencyRatio: number;
  darkPixelRatio: number;
  brightness: number;
  retried: boolean;
  repaired: boolean;
  reasons: string[];
};

export type SceneCandidate = {
  id: string;
  imagePath: string;
  provider: SceneGenerationProviderId;
  directionId: string;
  sceneType: string;
  sceneProfileId: string;
  reason: string;
  archetypeId: string;
  productSafeZone: ProductSafeZone;
  textSafeZones: TextSafeZone[];
  fallback: boolean;
  warning?: string;
  quality?: SceneCandidateQuality;
  createdAt: string;
};

export type CreativeQualityScore = {
  hookStrength: number;
  hierarchy: number;
  productVisibility: number;
  sceneRelevance: number;
  textReadability: number;
  compositionBalance: number;
  benchmarkSimilarity: number;
  factualSafety: number;
  overall: number;
  warnings: string[];
  recommendations: string[];
};

export type BuildVisualDirectionsInput = {
  product: ProductInfoForPrompt;
  brief: AdBrief;
  strategy?: CreativeStrategy | null;
  copy?: Partial<GeneratedAdCopy>;
  referenceMatches?: ReferenceMatchResult[];
  advertiserProfile?: AdvertiserProfile;
};

export type BenchmarkImageAnalysis = {
  fileName: string;
  category: string;
  detectedArchetype: string;
  composition: Record<string, string>;
  visualTraits: string[];
  textHierarchy: string[];
  productTreatment: string[];
  backgroundTreatment: string[];
  reusablePatterns: string[];
  qualityNotes: string[];
};

export type BenchmarkAnalysis = {
  version: number;
  sourceDirectory: string;
  images: BenchmarkImageAnalysis[];
  globalPatterns: Record<string, string[] | number | string>;
  qualityThresholds: Record<string, number | string>;
};
