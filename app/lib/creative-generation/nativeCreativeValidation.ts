import type { CategoryCreativeProfileId, NativeCreativeValidation, NativeGroupValidation } from "./types.ts";

type NativeCreativeQaScores = {
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
};

const foodCategories = new Set<CategoryCreativeProfileId>(["food_meat", "food_fresh", "food_processed"]);
const sensoryCategories = new Set<CategoryCreativeProfileId>(["beauty_cosmetics", "personal_care"]);

export const passesNativeCreativeValidation = (qa: NativeCreativeQaScores, category: CategoryCreativeProfileId = "general") => {
  const categorySpecificQuality = (!foodCategories.has(category) || qa.foodAppetiteAppeal >= 78) && (!sensoryCategories.has(category) || qa.sensoryExpression >= 78);

  return qa.hookAlignment >= 80 && qa.productIdentity >= 80 && qa.factualAccuracy >= 95 && qa.koreanTextAccuracy >= 95 && qa.readability >= 80 && qa.mobileReadability >= 82 && qa.composition >= 80 && qa.diversity >= 75 && qa.commercialQuality >= 80 && qa.productVisibility >= 78 && qa.humanNaturalness >= 80 && qa.categoryFit >= 80 && categorySpecificQuality && qa.exportCompliance >= 100;
};

const nativeScoreKeys = ["hookAlignment", "productIdentity", "factualAccuracy", "koreanTextAccuracy", "readability", "composition", "diversity", "commercialQuality", "exportCompliance", "productVisibility", "humanNaturalness", "categoryFit", "foodAppetiteAppeal", "sensoryExpression", "mobileReadability"] as const satisfies ReadonlyArray<keyof NativeCreativeQaScores>;

/**
 * Vision responses occasionally use a 0–10 scale even though the schema says
 * 0–100. Normalize that response and make the local JPEG verification the
 * authority for export compliance so a valid ad is not regenerated merely
 * because the vision model cannot inspect bytes or MIME metadata.
 */
export function normalizeNativeCreativeValidation(
  validation: NativeCreativeValidation,
  options: {
    category?: CategoryCreativeProfileId;
    exportComplianceVerified?: boolean;
  } = {}
): NativeCreativeValidation {
  const normalized = { ...validation };
  for (const key of nativeScoreKeys) {
    const raw = Number(validation[key]);
    normalized[key] = Math.max(0, Math.min(100, Math.round(raw > 0 && raw <= 10 ? raw * 10 : raw || 0)));
  }
  if (options.exportComplianceVerified) normalized.exportCompliance = 100;
  normalized.observedKoreanText = Array.isArray(validation.observedKoreanText) ? validation.observedKoreanText.map(String).slice(0, 30) : [];
  normalized.failures = (Array.isArray(validation.failures) ? validation.failures : [])
    .map(String)
    .filter((failure) => !options.exportComplianceVerified || !/(?:JPEG|JPG|1200\s*[×xX]\s*1200|800\s*KB|내보내기|납품\s*규격|exportCompliance)/i.test(failure))
    .slice(0, 20);
  const passed = passesNativeCreativeValidation(normalized, options.category || "general");
  normalized.recommendation = passed ? "approve" : validation.recommendation === "manual-review" ? "manual-review" : "revise";
  return normalized;
}

export const passesNativeGroupValidation = (qa: Pick<NativeGroupValidation, "sceneDiversity" | "productPlacementDiversity" | "cameraDiversity" | "colorMoodDiversity" | "messageSeparation" | "hookSceneAlignment" | "typographyDiversity" | "visualArchetypeDiversity" | "categoryFit" | "duplicatePairs" | "recommendation">) => qa.recommendation === "approve" && qa.duplicatePairs.length === 0 && [qa.sceneDiversity, qa.productPlacementDiversity, qa.cameraDiversity, qa.colorMoodDiversity, qa.messageSeparation, qa.hookSceneAlignment, qa.typographyDiversity, qa.visualArchetypeDiversity, qa.categoryFit].every((score) => score >= 75);
