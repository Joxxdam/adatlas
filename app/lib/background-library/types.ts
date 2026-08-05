import type {
  AdHookType,
  AdProductPosition,
  AdTextSafeArea,
  CreativeStrategy,
  ProductInfoForPrompt,
} from "../mvp/types";

export const backgroundCategories = [
  "beauty",
  "fashion",
  "food",
  "agriculture",
  "lifestyle",
  "commerce",
] as const;

export type BackgroundCategory = (typeof backgroundCategories)[number];
export type BackgroundSourceType = "royalty_free" | "ai_generated" | "site_derived";

export type BackgroundLibraryItem = {
  id: string;
  file: string;
  category: BackgroundCategory;
  industries: string[];
  hookTypes: AdHookType[];
  scene: string;
  mood: string[];
  elements: string[];
  colors: string[];
  productPosition: AdProductPosition;
  textSafeArea: AdTextSafeArea;
  orientation: "square";
  width: number;
  height: number;
  sourceType: BackgroundSourceType;
  sourceName: string;
  sourceUrl: string;
  downloadUrl?: string;
  licenseUrl: string;
  downloadedAt: string;
  enabled: boolean;
};

export type BackgroundRecommendation = {
  background: BackgroundLibraryItem;
  score: number;
  reasons: string[];
  connectionLabel?: string;
  intendedTreatment?: "original" | "blurred-site-image";
};

export type BackgroundRecommendationInput = {
  product: Partial<ProductInfoForPrompt>;
  hook: Pick<
    CreativeStrategy,
    "hookType" | "sceneDescription" | "mood" | "textSafeArea" | "productPosition" | "backgroundTags"
  >;
  limit?: number;
};

export type BackgroundLibrarySummary = {
  total: number;
  counts: Record<BackgroundCategory, number>;
};
