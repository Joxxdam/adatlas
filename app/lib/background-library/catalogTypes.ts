import type { AdProductPosition, AdTextSafeArea, ProductInfoForPrompt } from "../mvp/types.ts";
import type { BackgroundHookType, BackgroundLibraryItem } from "./types.ts";

export type CatalogSourceType = "local-import" | "pexels" | "local-generation";
export type CatalogLicenseStatus = "verified" | "unverified" | "rejected";
export type CatalogItemStatus = "pending" | "approved" | "review" | "rejected" | "inactive";
export type CatalogAnalysisStatus = "heuristic" | "source-derived" | "manually-reviewed" | "local-vision" | "pending";
export type RiskAssessment = "low" | "medium" | "high" | "pending";
export type CatalogPeoplePolicy = "hands-back-view-wide-scene" | "activity-back-view-silhouette" | "farmer-hands-back-view-wide-scene" | "empty-or-background";

export type BackgroundLicense = {
  sourceType: CatalogSourceType;
  sourceName: string;
  sourcePageUrl: string;
  creatorName: string;
  creatorUrl: string;
  licenseType: string;
  licenseUrl: string;
  proofPath: string;
  commercialUseAllowed: boolean | null;
  attributionRequired: boolean;
  attributionText: string;
  acquiredAt: string;
  licenseCheckedAt: string;
  licenseStatus: CatalogLicenseStatus;
};

export type CatalogCollectionRule = { keywords: string[]; categories: string[] };

export type BackgroundCollectionConfig = {
  id: string;
  displayName: string;
  description: string;
  targetCount: number;
  categories: Record<string, number>;
  searchQueries: Record<string, string[]>;
  generationPromptParts: { base: string; promptFamilies: string[] };
  negativePrompt: string;
  preferredMoods: string[];
  preferredColors: string[];
  excludedKeywords: string[];
  peoplePolicy: CatalogPeoplePolicy;
  minimumResolution: number;
  outputFormat: "webp";
  enabled: boolean;
  recommendationRules: CatalogCollectionRule[];
};

export type BackgroundCatalogItem = {
  id: string;
  sourceType: CatalogSourceType;
  provider: "local" | "pexels" | "comfyui";
  providerPhotoId: string;
  collectionIds: string[];
  primaryCategory: string;
  secondaryCategories: string[];
  matchedQuery: string;
  generationPrompt: string;
  negativePrompt: string;
  generationSeed: number | null;
  generationWorkflowHash: string;
  generatedUpscaled: boolean;
  originalWidth: number;
  originalHeight: number;
  localWidth: number;
  localHeight: number;
  originalUrl: string;
  sourcePageUrl: string;
  creatorName: string;
  creatorUrl: string;
  dominantColor: string;
  secondaryColors: string[];
  downloadedAt: string;
  generatedAt: string;
  licenseType: string;
  licenseUrl: string;
  licenseCheckedAt: string;
  licenseStatus: CatalogLicenseStatus;
  commercialUseAllowed: boolean | null;
  attributionRequired: boolean;
  attributionText: string;
  proofPath: string;
  filePath: string;
  thumbnailPath: string;
  originalPath: string;
  contentHash: string;
  perceptualHash: string;
  format: "webp";
  fileSize: number;
  status: CatalogItemStatus;
  rejectionReasons: string[];
  warnings: string[];
  analysisStatus: CatalogAnalysisStatus;
  analysisConfidence: number;
  analysisEvidence: string[];
  sceneType: string;
  indoorOutdoor: "indoor" | "outdoor" | "mixed" | "unknown";
  peoplePresence: "none" | "background" | "prominent" | "unknown";
  faceVisibility: "none" | "distant" | "prominent" | "unknown";
  endorsementRisk: RiskAssessment;
  logoRisk: RiskAssessment;
  textRisk: RiskAssessment;
  foodPresence: "yes" | "no" | "unknown";
  waterPresence: "yes" | "no" | "unknown";
  vegetationPresence: "yes" | "no" | "unknown";
  firePresence: "yes" | "no" | "unknown";
  productPlacementSpace: number;
  negativeSpaceDirection: AdTextSafeArea | "center" | "none";
  focalPoint: { x: number; y: number };
  cropSafety: number;
  clutterLevel: number;
  backgroundSuitabilityScore: number;
  adCompositionScore: number;
  recommendedProductPosition: AdProductPosition;
  recommendedCopyPosition: AdTextSafeArea;
  overlayReadability: number;
  needsDarkOverlay: boolean;
  needsLightOverlay: boolean;
  squareCropScore: number;
  brightness: number;
  saturation: number;
  contrast: number;
  entropy: number;
  edgeDensity: number;
  moodTags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BackgroundCatalogManifest = {
  version: number;
  updatedAt: string;
  items: BackgroundCatalogItem[];
};

export type BackgroundCatalogSummary = {
  total: number;
  approved: number;
  productionReady: number;
  unverified: number;
  rejected: number;
  inactive: number;
  duplicateRemoved: number;
  lowResolutionRejected: number;
  brokenRejected: number;
  riskReviewCount: number;
  totalBytes: number;
  thumbnailMissing: number;
  collections: Array<{
    id: string;
    displayName: string;
    targetCount: number;
    approvedCount: number;
    productionReadyCount: number;
    missingCount: number;
    categories: Array<{ id: string; targetCount: number; approvedCount: number; missingCount: number }>;
  }>;
};

export type BackgroundCatalogFilters = {
  collectionId?: string;
  category?: string;
  scene?: string;
  mood?: string;
  color?: string;
  brightness?: "bright" | "medium" | "dark";
  people?: "all" | "none" | "included";
  negativeSpace?: string;
  indoorOutdoor?: BackgroundCatalogItem["indoorOutdoor"];
  licenseStatus?: CatalogLicenseStatus;
  sourceType?: CatalogSourceType;
  search?: string;
  favorite?: boolean;
  status?: CatalogItemStatus;
  sort?: "recommended" | "latest" | "shuffle";
  page?: number;
  pageSize?: number;
};

export type CatalogRecommendationInput = {
  product: Partial<ProductInfoForPrompt> & { productColors?: string[]; brandColors?: string[] };
  hook?: {
    backgroundHookType?: BackgroundHookType;
    sceneDescription?: string;
    mood?: string[];
    backgroundTags?: string[];
    productPosition?: AdProductPosition;
    textSafeArea?: AdTextSafeArea;
  };
  limit?: number;
};

export type CatalogRecommendation = {
  item: BackgroundCatalogItem;
  background: BackgroundLibraryItem;
  score: number;
  reasons: string[];
};

export type PexelsSearchPhoto = {
  id: string;
  width: number;
  height: number;
  photographerName: string;
  photographerUrl: string;
  sourcePageUrl: string;
  originalUrl: string;
  largeUrl: string;
  thumbnailUrl: string;
  alt: string;
  avgColor: string;
};

export type DiversityPlanItem = {
  id: string;
  collectionId: string;
  categoryId: string;
  promptFamily: string;
  positivePrompt: string;
  negativePrompt: string;
  seed: number;
  width: number;
  height: number;
  status: "planned" | "queued" | "running" | "success" | "failed";
  attempts: number;
  outputPath: string;
  error: string;
};

export type BackgroundJobCheckpoint = {
  id: string;
  type: "import" | "comfyui";
  collectionId: string;
  createdAt: string;
  updatedAt: string;
  status: "planned" | "running" | "paused" | "completed" | "failed";
  cursor: number;
  workflowHash: string;
  items: DiversityPlanItem[];
  failures: number;
};
