import { hookMessageCodes, type GenerationResult, type VisualDiversityMatrixEntry } from "./types.ts";

const sceneTypes = ["problem-solution split", "sensory macro", "editorial lifestyle", "evidence studio", "UGC moment", "bold commerce hero"];
const angles = ["eye-level", "macro low-angle", "overhead", "three-quarter", "handheld close-up", "front hero"];
const placements = ["right third", "center oversized", "lower-left", "center-left", "upper-right", "bottom center"];
const scales = ["large", "extreme close", "medium", "large with context", "hand scale", "repeated scale"];
const colors = ["deep navy", "icy cyan", "warm neutral", "high-key white", "brand green", "complementary contrast"];
const type = ["bold condensed", "kinetic display", "editorial sans", "data-led grotesk", "conversational bubble", "oversized commerce"];
const emotion = ["relief", "refreshing shock", "aspiration", "confidence", "empathy", "urgency"];
const metaphor = ["before-to-after", "bursting freshness", "daily ritual", "proof spotlight", "real conversation", "product takeover"];

export function buildVisualDiversityMatrix(results: GenerationResult[]): VisualDiversityMatrixEntry[] {
  return results.slice(0, 6).map((result, index) => ({ hookCode: hookMessageCodes.includes(result.hookPlan.hookCode as (typeof hookMessageCodes)[number]) ? result.hookPlan.hookCode as (typeof hookMessageCodes)[number] : hookMessageCodes[index], sceneType: sceneTypes[index], cameraAngle: angles[index], productPlacement: placements[index], productScale: scales[index], dominantColor: colors[index], typographyStyle: type[index], emotionalTone: emotion[index], visualMetaphor: metaphor[index] }));
}

export function validateVisualDiversityMatrix(matrix: VisualDiversityMatrixEntry[]) {
  if (matrix.length !== 6) return { valid: false, errors: ["비주얼 다양성 매트릭스는 6개여야 합니다."] };
  const fingerprints = matrix.map((item) => [item.sceneType,item.cameraAngle,item.productPlacement,item.productScale,item.dominantColor,item.typographyStyle,item.emotionalTone,item.visualMetaphor].join("|"));
  const errors = fingerprints.length === new Set(fingerprints).size ? [] : ["동일한 비주얼 조합이 반복됩니다."];
  return { valid: errors.length === 0, errors };
}
