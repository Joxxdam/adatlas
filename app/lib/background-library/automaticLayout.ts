import type { GeneratedAdCopy } from "../mvp/types";
import type {
  AutomaticLayoutPreset,
  BackgroundHookType,
  BackgroundLibraryItem,
} from "./types";

export function selectAutomaticLayout(params: {
  background: Pick<
    BackgroundLibraryItem,
    | "assetType"
    | "category"
    | "textSafeArea"
    | "productPosition"
    | "includesPerson"
    | "personPosition"
    | "brightness"
    | "recommendedLayouts"
  >;
  hookType: BackgroundHookType;
  copy?: Partial<GeneratedAdCopy>;
  hasPrice?: boolean;
}): AutomaticLayoutPreset {
  const { background, hookType } = params;
  const preferred = background.recommendedLayouts?.[0];
  if (preferred) return preferred;
  if (
    ["price_offer", "urgency"].includes(hookType) ||
    (params.hasPrice && background.category === "promotion")
  ) {
    return background.category === "promotion"
      ? "centered-product-promotion"
      : "price-focused";
  }
  if (background.category === "fashion") return "fashion-lookbook";
  if (["ingredient_scene", "pattern_texture"].includes(background.assetType)) {
    return "ingredient-story";
  }
  if (hookType === "premium" || background.brightness === "dark") return "premium-minimal";
  if (background.includesPerson) return "people-scene";
  if (["people_photo", "lifestyle_photo"].includes(background.assetType)) {
    return "editorial-overlay";
  }
  if (background.textSafeArea.includes("left")) return "text-left-product-right";
  if (background.textSafeArea.includes("right")) return "text-right-product-left";
  if (background.textSafeArea.startsWith("top")) return "text-top-product-bottom";
  if (background.textSafeArea.startsWith("bottom")) return "text-bottom-product-top";
  if (background.productPosition === "center") return "centered-product-promotion";
  return "product-grounded";
}
