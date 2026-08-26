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
  normalized.standaloneLogoDetected = validation.standaloneLogoDetected === true;
  normalized.standaloneLogoFindings = Array.isArray(validation.standaloneLogoFindings) ? validation.standaloneLogoFindings.map(String).slice(0, 10) : [];
  normalized.failures = (Array.isArray(validation.failures) ? validation.failures : [])
    .map(String)
    .filter((failure) => !options.exportComplianceVerified || !/(?:JPEG|JPG|1200\s*[×xX]\s*1200|800\s*KB|내보내기|납품\s*규격|exportCompliance)/i.test(failure))
    .slice(0, 20);
  if (normalized.standaloneLogoDetected) {
    normalized.failures = [...new Set([
      ...normalized.failures,
      `실제 상품 패키지 밖에 AI가 새로 만든 독립 로고·워드마크가 있습니다${normalized.standaloneLogoFindings.length ? `: ${normalized.standaloneLogoFindings.join(" / ")}` : "."}`,
    ])].slice(0, 20);
    normalized.commercialQuality = Math.min(normalized.commercialQuality, 40);
  }
  const passed = passesNativeCreativeValidation(normalized, options.category || "general");
  normalized.recommendation = normalized.standaloneLogoDetected ? "revise" : passed ? "approve" : validation.recommendation === "manual-review" ? "manual-review" : "revise";
  return normalized;
}

function visibleCopyFingerprint(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Vision QA must transcribe what is actually visible, but it can still infer a
 * malformed syllable from context. Keep a deterministic second gate so a
 * missing/illegible target line cannot be approved merely because the overall
 * sentence looks plausible. Whitespace and punctuation are ignored because
 * line wrapping is part of the inherited reference layout; letters and digits
 * are not.
 */
export function enforceExactRenderedCopyValidation(
  validation: NativeCreativeValidation,
  requiredLines: string[]
): NativeCreativeValidation {
  const required = [...new Set(requiredLines.map((line) => String(line || "").trim()).filter(Boolean))];
  if (!required.length) return validation;

  const observed = validation.observedKoreanText.map((line) => String(line || "").trim()).filter(Boolean);
  const observedFingerprint = visibleCopyFingerprint(observed.join(" "));
  const missing = required.filter((line) => {
    const fingerprint = visibleCopyFingerprint(line);
    return fingerprint.length >= 2 && !observedFingerprint.includes(fingerprint);
  });
  const hasMalformedGlyphMarker = observed.some((line) => /(?:\uFFFD|[□▢�]|\[(?:깨짐|불명|판독불가)[^\]]*\]|깨진\s*글자|판독\s*불가)/i.test(line));

  if (observed.length && !missing.length && !hasMalformedGlyphMarker) return validation;

  const failures = [...validation.failures];
  if (!observed.length) failures.push("최종 이미지의 실제 한글 OCR 전사가 없어 목표 문구의 글자 형태를 확인할 수 없습니다.");
  if (missing.length) failures.push(`최종 이미지 OCR과 목표 문구가 일치하지 않거나 글자가 판독되지 않습니다: ${missing.slice(0, 3).join(" / ")}`);
  if (hasMalformedGlyphMarker) failures.push("문맥으로 추측하지 못할 정도로 획이 깨지거나 합쳐진 한글 글자가 있습니다.");

  return {
    ...validation,
    koreanTextAccuracy: Math.min(validation.koreanTextAccuracy, observed.length ? 45 : 0),
    failures: [...new Set(failures)].slice(0, 20),
    recommendation: "revise",
  };
}

export const passesNativeGroupValidation = (qa: Pick<NativeGroupValidation, "sceneDiversity" | "productPlacementDiversity" | "cameraDiversity" | "colorMoodDiversity" | "messageSeparation" | "hookSceneAlignment" | "typographyDiversity" | "visualArchetypeDiversity" | "categoryFit" | "duplicatePairs" | "recommendation">) => qa.recommendation === "approve" && qa.duplicatePairs.length === 0 && [qa.sceneDiversity, qa.productPlacementDiversity, qa.cameraDiversity, qa.colorMoodDiversity, qa.messageSeparation, qa.hookSceneAlignment, qa.typographyDiversity, qa.visualArchetypeDiversity, qa.categoryFit].every((score) => score >= 75);
