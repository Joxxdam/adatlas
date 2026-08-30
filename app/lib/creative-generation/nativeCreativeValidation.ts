import type { ProductInfoForPrompt } from "../mvp/types.ts";
import { isDomesticOriginCreativeSignal, isMeatProductContext, isNonDomesticOriginCreativeSignal, isOriginCreativeSignal } from "./productSignalHygiene.ts";
import type { CategoryCreativeProfileId, NativeCreativeValidation, NativeGroupValidation, ReferenceAdaptedCopyPlan } from "./types.ts";

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
    requiresHumanReplacement?: boolean;
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
  normalized.sourcePersonDetected = options.requiresHumanReplacement === true || validation.sourcePersonDetected === true;
  normalized.sourcePersonReplaced = validation.sourcePersonReplaced === true;
  normalized.humanCompositionChanged = validation.humanCompositionChanged === true;
  normalized.targetAudienceFit = Math.max(0, Math.min(100, Math.round(Number(validation.targetAudienceFit) || (normalized.sourcePersonDetected ? 0 : 100))));
  normalized.humanReplacementFindings = Array.isArray(validation.humanReplacementFindings) ? validation.humanReplacementFindings.map(String).slice(0, 10) : [];
  normalized.humanCopyAligned = validation.humanCopyAligned !== false;
  normalized.humanCopyAlignmentFindings = Array.isArray(validation.humanCopyAlignmentFindings) ? validation.humanCopyAlignmentFindings.map(String).slice(0, 10) : [];
  normalized.sceneProductInteractionAligned = validation.sceneProductInteractionAligned !== false;
  normalized.sceneProductInteractionFindings = Array.isArray(validation.sceneProductInteractionFindings) ? validation.sceneProductInteractionFindings.map(String).slice(0, 10) : [];
  normalized.unrelatedFoodOrIngredientDetected = validation.unrelatedFoodOrIngredientDetected === true;
  normalized.unrelatedFoodOrIngredientFindings = Array.isArray(validation.unrelatedFoodOrIngredientFindings) ? validation.unrelatedFoodOrIngredientFindings.map(String).slice(0, 10) : [];
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
  const humanReplacementFailed = normalized.sourcePersonDetected && (!normalized.sourcePersonReplaced || !normalized.humanCompositionChanged || normalized.targetAudienceFit < 75);
  if (humanReplacementFailed) {
    normalized.failures = [...new Set([
      ...normalized.failures,
      `원본 인물을 타깃 고객에 맞는 다른 인물·다른 인물 구도로 완전히 교체하지 못했습니다${normalized.humanReplacementFindings.length ? `: ${normalized.humanReplacementFindings.join(" / ")}` : "."}`,
    ])].slice(0, 20);
    normalized.humanNaturalness = Math.min(normalized.humanNaturalness, 40);
    normalized.composition = Math.min(normalized.composition, 60);
    normalized.categoryFit = Math.min(normalized.categoryFit, 60);
  }
  const humanCopyAlignmentFailed = normalized.sourcePersonDetected && normalized.humanCopyAligned === false;
  if (humanCopyAlignmentFailed) {
    normalized.failures = [...new Set([
      ...normalized.failures,
      `새 인물의 행동·표정·상황이 최종 광고 문구의 의미를 뒷받침하지 않습니다${normalized.humanCopyAlignmentFindings.length ? `: ${normalized.humanCopyAlignmentFindings.join(" / ")}` : "."}`,
    ])].slice(0, 20);
    normalized.hookAlignment = Math.min(normalized.hookAlignment, 40);
    normalized.humanNaturalness = Math.min(normalized.humanNaturalness, 60);
    normalized.commercialQuality = Math.min(normalized.commercialQuality, 50);
  }
  const sceneProductInteractionFailed = normalized.sceneProductInteractionAligned === false;
  if (sceneProductInteractionFailed) {
    normalized.failures = [...new Set([
      ...normalized.failures,
      `장면 또는 인물 행동이 현재 상품의 실제 사용·섭취 맥락과 맞지 않습니다${normalized.sceneProductInteractionFindings.length ? `: ${normalized.sceneProductInteractionFindings.join(" / ")}` : "."}`,
    ])].slice(0, 20);
    normalized.hookAlignment = Math.min(normalized.hookAlignment, 40);
    normalized.commercialQuality = Math.min(normalized.commercialQuality, 40);
    normalized.categoryFit = Math.min(normalized.categoryFit, 40);
  }
  if (normalized.unrelatedFoodOrIngredientDetected) {
    normalized.failures = [...new Set([
      ...normalized.failures,
      `현재 상품·확인된 재료와 무관한 먹거리 또는 재료가 보입니다${normalized.unrelatedFoodOrIngredientFindings.length ? `: ${normalized.unrelatedFoodOrIngredientFindings.join(" / ")}` : "."}`,
    ])].slice(0, 20);
    normalized.productIdentity = Math.min(normalized.productIdentity, 45);
    normalized.categoryFit = Math.min(normalized.categoryFit, 40);
    normalized.commercialQuality = Math.min(normalized.commercialQuality, 40);
  }
  const passed = passesNativeCreativeValidation(normalized, options.category || "general");
  // Vision이 failures에 실제 문구·상품 오류를 기록하고도 점수만 높게 주는
  // 응답이 있습니다. 발견된 실패가 하나라도 있으면 approve로 정규화하지 않습니다.
  const reportedFailure = normalized.failures.length > 0;
  normalized.recommendation = normalized.standaloneLogoDetected || humanReplacementFailed || humanCopyAlignmentFailed || sceneProductInteractionFailed || normalized.unrelatedFoodOrIngredientDetected || reportedFailure ? "revise" : passed ? "approve" : validation.recommendation === "manual-review" ? "manual-review" : "revise";
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

const sourceDisclosureCopyPattern = /(?:(?:연출|예시|참고|합성|생성)\s*(?:된\s*)?(?:이미지|사진|컷)|(?:이미지|사진)\s*(?:연출|예시|참고|합성|생성)|이해를\s*돕기\s*(?:위한|위해)[^\n]{0,16}(?:이미지|사진|연출|예시|참고|합성|생성)|실제와\s*(?:다를|상이할)\s*수|(?:AI|인공지능)\s*(?:를|을)?\s*(?:활용|사용|생성)(?:한|하여|해|된|되었|했습니다|하였습니다)?\s*(?:이미지|사진|콘텐츠)?)/iu;

export function isSourceDisclosureCopy(value: string) {
  return sourceDisclosureCopyPattern.test(String(value || "").normalize("NFKC"));
}

/**
 * 원본 레퍼런스의 이미지 고지는 기본 완성본에 승계하지 않는다. 사용자가
 * 선택하는 AI 고지는 생성·QA가 끝난 뒤 delivery 파생본에 별도로 적용되므로,
 * 이 게이트에서는 발견되는 모든 출처성 고지를 원본 잔존으로 판정한다.
 */
export function enforceNoSourceDisclosureCopy(
  validation: NativeCreativeValidation
): NativeCreativeValidation {
  const findings = validation.observedKoreanText
    .map((line) => String(line || "").trim())
    .filter((line) => line && isSourceDisclosureCopy(line));
  if (!findings.length) return validation;

  return {
    ...validation,
    koreanTextAccuracy: Math.min(validation.koreanTextAccuracy, 45),
    commercialQuality: Math.min(validation.commercialQuality, 40),
    failures: [...new Set([
      ...validation.failures,
      `출처 문구가 최종 이미지에 남아 있습니다: ${findings.slice(0, 4).join(" / ")}. 연출 이미지·예시 이미지·참고/합성/생성 이미지·원본 AI 활용 고지는 제거해야 합니다.`,
    ])].slice(0, 20),
    recommendation: "revise",
  };
}

/** 목표 문구에 없더라도 레퍼런스의 원산지 배지가 남는 경우를 최종 OCR에서 차단합니다. */
export function enforceOriginCopyPolicy(
  validation: NativeCreativeValidation,
  product: ProductInfoForPrompt
): NativeCreativeValidation {
  const originLines = validation.observedKoreanText
    .map((line) => String(line || "").trim())
    .filter((line) => line && isOriginCreativeSignal(line));
  if (!originLines.length) return validation;

  const meat = isMeatProductContext(product);
  const disallowed = originLines.filter((line) => !meat || !isDomesticOriginCreativeSignal(line) || isNonDomesticOriginCreativeSignal(line));
  if (!disallowed.length) return validation;

  return {
    ...validation,
    factualAccuracy: Math.min(validation.factualAccuracy, 45),
    koreanTextAccuracy: Math.min(validation.koreanTextAccuracy, 70),
    commercialQuality: Math.min(validation.commercialQuality, 45),
    failures: [...new Set([
      ...validation.failures,
      `원산지 문구 사용 정책을 위반했습니다: ${disallowed.slice(0, 4).join(" / ")}. 원산지는 확인된 국내산 육류 광고에만 표시할 수 있습니다.`,
    ])].slice(0, 20),
    recommendation: "revise",
  };
}

/**
 * 레퍼런스 광고의 비브랜드 문구 패널은 빈 상태로 납품할 수 없다. 빈 목표값은
 * 이미지 OCR로 찾을 수 없으므로 슬롯 계약 자체를 별도의 결정적 게이트로
 * 검사한다. source-brand/remove 슬롯만 배경 복원을 위해 비워 둘 수 있다.
 */
export function enforceReferenceCopySlotCompleteness(
  validation: NativeCreativeValidation,
  copySlots: NonNullable<ReferenceAdaptedCopyPlan["copySlots"]> = []
): NativeCreativeValidation {
  const blankSlots = copySlots.filter((slot) =>
    slot.sourceText.trim() &&
    slot.sourceType !== "source-brand" &&
    slot.replacePolicy !== "remove" &&
    !slot.targetText.trim()
  );
  if (!blankSlots.length) return validation;

  const labels = blankSlots.slice(0, 4).map((slot) => `${slot.role} ${slot.index + 1}번`).join(" / ");
  return {
    ...validation,
    hookAlignment: Math.min(validation.hookAlignment, 40),
    composition: Math.min(validation.composition, 60),
    commercialQuality: Math.min(validation.commercialQuality, 40),
    failures: [...new Set([
      ...validation.failures,
      `레퍼런스의 비브랜드 문구 슬롯이 빈 상태입니다: ${labels}. 빈 버튼·띠·배지·패널은 납품할 수 없습니다.`,
    ])].slice(0, 20),
    recommendation: "revise",
  };
}

/** 이미지 QA 점수가 높아도 입력 문구 계약 자체가 invalid면 승인할 수 없습니다. */
export function enforceReferenceCopyPlanValidity(
  validation: NativeCreativeValidation,
  plan: ReferenceAdaptedCopyPlan | undefined
): NativeCreativeValidation {
  if (plan?.validationStatus === "valid" && !(plan.validationErrors || []).length) return validation;
  const details = (plan?.validationErrors || []).slice(0, 4);
  return {
    ...validation,
    hookAlignment: Math.min(validation.hookAlignment, 45),
    koreanTextAccuracy: Math.min(validation.koreanTextAccuracy, 70),
    commercialQuality: Math.min(validation.commercialQuality, 45),
    failures: [...new Set([
      ...validation.failures,
      `이미지에 전달된 광고 문구 계획이 최종 품질 검수를 통과하지 못했습니다${details.length ? `: ${details.join(" / ")}` : "."}`,
    ])].slice(0, 20),
    recommendation: "revise",
  };
}

export const passesNativeGroupValidation = (qa: Pick<NativeGroupValidation, "sceneDiversity" | "productPlacementDiversity" | "cameraDiversity" | "colorMoodDiversity" | "messageSeparation" | "hookSceneAlignment" | "typographyDiversity" | "visualArchetypeDiversity" | "categoryFit" | "duplicatePairs" | "recommendation">) => qa.recommendation === "approve" && qa.duplicatePairs.length === 0 && [qa.sceneDiversity, qa.productPlacementDiversity, qa.cameraDiversity, qa.colorMoodDiversity, qa.messageSeparation, qa.hookSceneAlignment, qa.typographyDiversity, qa.visualArchetypeDiversity, qa.categoryFit].every((score) => score >= 75);
