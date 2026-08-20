import type { CategoryCreativeProfileId, NativeGroupValidation } from "./types.ts";

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

export const passesNativeCreativeValidation = (
  qa: NativeCreativeQaScores,
  category: CategoryCreativeProfileId = "general",
) => {
  const categorySpecificQuality =
    (!foodCategories.has(category) || qa.foodAppetiteAppeal >= 78) &&
    (!sensoryCategories.has(category) || qa.sensoryExpression >= 78);

  return qa.hookAlignment >= 80 && qa.productIdentity >= 80 && qa.factualAccuracy >= 95 &&
    qa.koreanTextAccuracy >= 95 && qa.readability >= 80 && qa.mobileReadability >= 82 &&
    qa.composition >= 80 && qa.diversity >= 75 && qa.commercialQuality >= 80 &&
    qa.productVisibility >= 78 && qa.humanNaturalness >= 80 && qa.categoryFit >= 80 &&
    categorySpecificQuality && qa.exportCompliance >= 100;
};

export const passesNativeGroupValidation = (qa: Pick<NativeGroupValidation,
  "sceneDiversity" | "productPlacementDiversity" | "cameraDiversity" |
  "colorMoodDiversity" | "messageSeparation" | "hookSceneAlignment" |
  "typographyDiversity" | "visualArchetypeDiversity" | "categoryFit" |
  "duplicatePairs" | "recommendation"
>) => qa.recommendation === "approve" && qa.duplicatePairs.length === 0 && [
  qa.sceneDiversity,
  qa.productPlacementDiversity,
  qa.cameraDiversity,
  qa.colorMoodDiversity,
  qa.messageSeparation,
  qa.hookSceneAlignment,
  qa.typographyDiversity,
  qa.visualArchetypeDiversity,
  qa.categoryFit,
].every((score) => score >= 75);
