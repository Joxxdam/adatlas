import { stableId, uniqueStrings } from "../store-analysis/htmlUtils.ts";
import type { SiteAdCandidate, SiteAdFitSection, SiteAdFitSectionKey, SiteCandidateScore, SiteEvidenceLevel, SiteProductRecord, SiteRecommendationType } from "./types";

type Indicator = {
  available: boolean;
  ratio: number;
  reason?: string;
};

type RecommendationSignal = {
  type: SiteRecommendationType;
  strength: number;
};

const SECTION_LABELS: Record<SiteAdFitSectionKey, string> = {
  messageUsp: "메시지·USP 잠재력",
  trust: "고객 신뢰 근거",
  offer: "가격·혜택 경쟁력",
  creative: "소재 제작 적합성",
  season: "시즌·상황 적합성",
  landing: "랜딩페이지 준비도",
};

const SECTION_MAX: Record<SiteAdFitSectionKey, number> = {
  messageUsp: 25,
  trust: 20,
  offer: 20,
  creative: 15,
  season: 10,
  landing: 10,
};

function bounded(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function scoreEvidenceSection(key: SiteAdFitSectionKey, indicators: Indicator[]): SiteAdFitSection {
  const available = indicators.filter((indicator) => indicator.available);
  const rawRatio = available.length ? available.reduce((sum, indicator) => sum + bounded(indicator.ratio), 0) / available.length : 0;
  const evidenceSufficiency = indicators.length ? available.length / indicators.length : 0;
  // 확인된 값만 평균내면 근거 한 개로 만점에 가까워질 수 있다. 관측 평균에
  // 근거 충족도 계수를 적용하되, 미확인 정보를 사실상 0점이라고 표시하지 않는다.
  const confidenceCoefficient = evidenceSufficiency ? Math.pow(evidenceSufficiency, 0.75) : 0;
  return {
    key,
    label: SECTION_LABELS[key],
    score: Math.round(rawRatio * confidenceCoefficient * SECTION_MAX[key]),
    maxScore: SECTION_MAX[key],
    reasons: uniqueStrings(
      available.filter((indicator) => indicator.ratio > 0).map((indicator) => indicator.reason),
      6
    ),
    evidenceCount: available.length,
    indicatorCount: indicators.length,
    evidenceSufficiency,
    status: available.length === 0 ? "unavailable" : evidenceSufficiency < 0.67 ? "limited" : "scored",
  };
}

function includesAny(value: string, pattern: RegExp) {
  return pattern.test(value);
}

function hasEvidence(product: SiteProductRecord, key: string) {
  return product.evidence.find((field) => field.key === key)?.state === "present";
}

function evidenceKnown(product: SiteProductRecord, key: string) {
  const state = product.evidence.find((field) => field.key === key)?.state;
  return state === "present" || state === "absent" || state === "not_applicable";
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]/gi, "");
}

function isOfferOrOperationSignal(value: string) {
  return /무료\s*배송|배송비|당일\s*출고|출고|배송|쿠폰|할인|적립|증정|사은품|회원\s*혜택|세트\s*구성|묶음|패키지|\d+\s*\+\s*\d+/i.test(value);
}

function usableUspCandidates(product: SiteProductRecord) {
  const productNameKey = normalized(product.productName);
  return uniqueStrings(
    product.uspCandidates.filter((value) => {
      const key = normalized(value);
      if (!key || isOfferOrOperationSignal(value)) return false;
      if (key === productNameKey || (key.length >= 10 && productNameKey.includes(key))) return false;
      return true;
    }),
    8
  );
}

function formatPrice(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function imageCount(product: SiteProductRecord) {
  return Number(Boolean(product.representativeImage)) + product.additionalImages.length;
}

function sectionRatio(section: SiteAdFitSection) {
  return section.maxScore ? section.score / section.maxScore : 0;
}

function currentSeasonPattern(now: Date) {
  const month = now.getMonth() + 1;
  if (month >= 6 && month <= 8) return /여름|휴가|캠핑|야외|쿨링|냉감|장마|물놀이|보양/i;
  if (month >= 9 && month <= 11) return /가을|추석|캠핑|수확|선물|환절기/i;
  if (month === 12 || month <= 2) return /겨울|연말|크리스마스|설날|보온|난방|선물|국물/i;
  return /봄|신학기|입학|나들이|피크닉|선물|환절기/i;
}

function scoreSections(product: SiteProductRecord, now: Date): SiteCandidateScore {
  const usableUsps = usableUspCandidates(product);
  const messageText = [product.description, ...usableUsps, ...product.ingredients, product.origin, ...product.certifications, ...product.usageContexts, ...product.targetSignals].filter(Boolean).join(" ");
  const broaderText = [product.productName, messageText, ...product.badges].filter(Boolean).join(" ");
  const availableImageCount = imageCount(product);
  const hasProblem = includesAny([product.description, ...usableUsps].filter(Boolean).join(" "), /불편|고민|문제|부족|건조|냄새|땀|피로|번거|민감|자극|해결|개선|완화/i);
  const hasNumericProof = /\d+(?:\.\d+)?\s*(?:mg|g|kg|ml|개|회|시간|일|장|배)/i.test([...usableUsps, ...product.ingredients, product.origin || "", ...product.certifications].join(" "));
  const hasTarget = product.targetSignals.length > 0;
  const hasContext = product.usageContexts.length > 0;

  const messageUsp = scoreEvidenceSection("messageUsp", [
    {
      available: hasEvidence(product, "usp") || hasEvidence(product, "description"),
      ratio: Math.min(1, usableUsps.length / 3),
      reason: usableUsps.length ? `USP ${usableUsps.slice(0, 2).join(" · ")}` : undefined,
    },
    {
      available: Boolean(product.description),
      ratio: hasProblem ? 1 : 0,
      reason: hasProblem ? "고객 고민과 해결 방향 확인" : undefined,
    },
    {
      available: Boolean(usableUsps.length || product.ingredients.length || product.certifications.length),
      ratio: hasNumericProof ? 1 : 0,
      reason: hasNumericProof ? "수치 상품 근거 확인" : undefined,
    },
    {
      available: Boolean(product.ingredients.length || product.origin || product.certifications.length),
      ratio: Math.min(1, (product.ingredients.length + Number(Boolean(product.origin)) + product.certifications.length) / 4),
      reason: product.ingredients.length || product.origin || product.certifications.length ? uniqueStrings([product.ingredients.length ? `성분 ${product.ingredients.slice(0, 2).join(" · ")}` : undefined, product.origin ? `원산지 ${product.origin}` : undefined, product.certifications.length ? `인증 ${product.certifications.slice(0, 2).join(" · ")}` : undefined], 3).join(" · ") : undefined,
    },
    {
      available: hasTarget || hasContext,
      ratio: (Number(hasTarget) + Number(hasContext)) / 2,
      reason: hasTarget || hasContext ? uniqueStrings([hasTarget ? `타깃 ${product.targetSignals.slice(0, 2).join(" · ")}` : undefined, hasContext ? `사용 상황 ${product.usageContexts.slice(0, 2).join(" · ")}` : undefined], 2).join(" · ") : undefined,
    },
  ]);

  const trust = scoreEvidenceSection("trust", [
    {
      available: hasEvidence(product, "reviews") || typeof product.reviewCount === "number",
      ratio: product.reviewCount ? Math.min(1, Math.log10(product.reviewCount + 1) / 3.2) : product.rating ? 0.35 : 0,
      reason: product.reviewCount ? `리뷰 ${product.reviewCount.toLocaleString("ko-KR")}개` : undefined,
    },
    {
      available: typeof product.rating === "number",
      ratio: product.rating ? Math.max(0, Math.min(1, (product.rating - 3) / 2)) : 0,
      reason: product.rating ? `평점 ${product.rating.toFixed(1)}` : undefined,
    },
    {
      available: hasEvidence(product, "reviews") || product.extractedReviewPhrases.length > 0,
      ratio: Math.min(1, product.extractedReviewPhrases.length / 3),
      reason: product.extractedReviewPhrases.length ? `후기 표현 ${product.extractedReviewPhrases.length}개` : undefined,
    },
    {
      available: hasEvidence(product, "certifications"),
      ratio: Math.min(1, product.certifications.length / 2),
      reason: product.certifications.length ? `인증 ${product.certifications.slice(0, 2).join(" · ")}` : undefined,
    },
    {
      available: hasEvidence(product, "origin") || product.ingredients.length > 0,
      ratio: Math.min(1, (Number(Boolean(product.origin)) + product.ingredients.length) / 3),
      reason: product.origin || product.ingredients.length ? [product.origin ? `원산지 ${product.origin}` : "", product.ingredients[0] ? `성분 ${product.ingredients[0]}` : ""].filter(Boolean).join(" · ") : undefined,
    },
    {
      available: Boolean(product.brandName),
      ratio: product.brandName ? 1 : 0,
      reason: product.brandName ? `브랜드 ${product.brandName}` : undefined,
    },
  ]);

  const offer = scoreEvidenceSection("offer", [
    {
      available: evidenceKnown(product, "price") || typeof product.salePrice === "number",
      ratio: product.salePrice ? 0.65 : 0,
      reason: product.salePrice ? `판매가 ${formatPrice(product.salePrice)}` : undefined,
    },
    {
      available: Boolean(product.regularPrice && product.salePrice) || Boolean(product.discountRate),
      ratio: product.discountRate ? Math.min(1, product.discountRate / 35) : 0,
      reason: product.discountRate ? `${product.discountRate}% 할인` : undefined,
    },
    {
      available: Boolean(product.coupon),
      ratio: product.coupon ? 1 : 0,
      reason: product.coupon ? `쿠폰 ${product.coupon}` : undefined,
    },
    {
      available: evidenceKnown(product, "shipping") || Boolean(product.shippingInfo),
      ratio: product.freeShipping ? 1 : 0,
      reason: product.freeShipping ? "무료배송" : undefined,
    },
    {
      available: Boolean(product.setComposition),
      ratio: product.setComposition ? 1 : 0,
      reason: product.setComposition ? `세트 구성 ${product.setComposition}` : undefined,
    },
    {
      available: Boolean(product.giftBenefit || product.membershipBenefit || product.promotionEndsAt),
      ratio: product.giftBenefit || product.membershipBenefit || product.promotionEndsAt ? 1 : 0,
      reason: product.giftBenefit || product.membershipBenefit || product.promotionEndsAt ? uniqueStrings([product.giftBenefit, product.membershipBenefit, product.promotionEndsAt ? `프로모션 종료 ${product.promotionEndsAt}` : undefined], 2).join(" · ") : undefined,
    },
  ]);

  const creative = scoreEvidenceSection("creative", [
    {
      available: evidenceKnown(product, "images") || Boolean(product.representativeImage),
      ratio: product.representativeImage ? 1 : 0,
      reason: product.representativeImage ? "대표 이미지 확보" : undefined,
    },
    {
      available: evidenceKnown(product, "images") || availableImageCount > 0,
      ratio: Math.min(1, availableImageCount / 6),
      reason: availableImageCount ? `활용 이미지 ${availableImageCount}개` : undefined,
    },
    {
      available: evidenceKnown(product, "images") || availableImageCount > 0,
      ratio: product.additionalImages.length >= 2 ? 1 : product.additionalImages.length / 2,
      reason: product.additionalImages.length >= 2 ? `추가 이미지 ${product.additionalImages.length}개` : undefined,
    },
    {
      available: hasContext,
      ratio: hasContext ? 1 : 0,
      reason: hasContext ? `사용 상황 ${product.usageContexts.slice(0, 2).join(" · ")}` : undefined,
    },
    {
      available: Boolean(product.description || product.uspCandidates.length),
      ratio: product.description && product.uspCandidates.length ? 1 : 0.5,
      reason: product.description || product.uspCandidates.length ? "이미지와 함께 설명할 상품 근거 확인" : undefined,
    },
  ]);

  const seasonPattern = currentSeasonPattern(now);
  const seasonMatch = seasonPattern.test(broaderText);
  const season = scoreEvidenceSection("season", [
    {
      available: Boolean(broaderText),
      ratio: seasonMatch ? 1 : 0,
      reason: seasonMatch ? `현재 시즌 연결 ${product.usageContexts.slice(0, 2).join(" · ") || "페이지 문구"}` : undefined,
    },
    {
      available: Boolean(product.badges.length),
      ratio: product.badges.includes("신상품") ? 1 : 0,
      reason: product.badges.includes("신상품") ? "신상품 배지 확인" : undefined,
    },
    {
      available: Boolean(product.promotionEndsAt || product.badges.includes("한정")),
      ratio: product.promotionEndsAt || product.badges.includes("한정") ? 1 : 0,
      reason: product.promotionEndsAt || product.badges.includes("한정") ? "현재 프로모션 신호 확인" : undefined,
    },
  ]);

  const landing = scoreEvidenceSection("landing", [
    {
      available: product.stockStatus !== "unavailable",
      ratio: product.stockStatus === "in-stock" ? 1 : 0,
      reason: product.stockStatus === "in-stock" ? "판매 가능 상태가 명시됨" : undefined,
    },
    {
      available: evidenceKnown(product, "price") || typeof product.salePrice === "number",
      ratio: product.salePrice ? 1 : 0,
      reason: product.salePrice ? "가격 확인 가능" : undefined,
    },
    {
      available: evidenceKnown(product, "purchase-button") || typeof product.hasPurchaseButton === "boolean",
      ratio: product.hasPurchaseButton ? 1 : 0,
      reason: product.hasPurchaseButton ? "구매 버튼 확인" : undefined,
    },
    {
      available: product.options.length > 0,
      ratio: product.options.length ? 1 : 0,
      reason: product.options.length ? "옵션 구조 확인" : undefined,
    },
    {
      available: evidenceKnown(product, "shipping") || Boolean(product.shippingInfo),
      ratio: product.shippingInfo ? 1 : 0,
      reason: product.shippingInfo ? "배송 안내 확인" : undefined,
    },
    {
      available: hasEvidence(product, "benefits") || product.benefits.length > 0,
      ratio: product.benefits.length ? 1 : 0,
      reason: product.benefits.length ? "혜택 정보 확인" : undefined,
    },
  ]);

  const sections = { messageUsp, trust, offer, creative, season, landing };
  return {
    total: Object.values(sections).reduce((sum, item) => sum + item.score, 0),
    sections,
  };
}

export function evidenceLevelForProduct(product: SiteProductRecord): SiteEvidenceLevel {
  const groups = [Boolean(product.productName && (product.description || product.uspCandidates.length)), Boolean(product.salePrice || product.benefits.length), Boolean(product.reviewCount || product.rating || product.extractedReviewPhrases.length), Boolean(product.representativeImage && product.additionalImages.length), Boolean(product.hasPurchaseButton && product.stockStatus !== "sold-out")];
  const present = groups.filter(Boolean).length;
  if (present >= 5) return "high";
  if (present >= 3) return "medium";
  return "low";
}

function reviewSignalStrength(product: SiteProductRecord) {
  const reviewStrength = product.reviewCount ? Math.min(1, Math.log10(product.reviewCount + 1) / 3.2) : 0;
  const ratingStrength = product.rating ? bounded((product.rating - 3) / 2) : 0;
  const phraseStrength = Math.min(1, product.extractedReviewPhrases.length / 3);
  const parts = [...(product.reviewCount ? [reviewStrength] : []), ...(product.rating ? [ratingStrength] : []), ...(product.extractedReviewPhrases.length ? [phraseStrength] : [])];
  return parts.length ? parts.reduce((sum, value) => sum + value, 0) / parts.length : 0;
}

function recommendationSignals(product: SiteProductRecord, score: SiteCandidateScore) {
  const signals: RecommendationSignal[] = [];
  const usps = usableUspCandidates(product);
  const problemText = `${product.description || ""} ${usps.join(" ")}`;
  const hasProblem = /불편|고민|문제|냄새|땀|건조|자극|해결|개선|완화/i.test(problemText);
  const offerSignalCount = [Boolean(product.discountRate), Boolean(product.coupon), Boolean(product.freeShipping), Boolean(product.setComposition), Boolean(product.giftBenefit || product.membershipBenefit || product.promotionEndsAt)].filter(Boolean).length;
  const uspSpecificity = Math.min(1, (usps.length + Number(product.ingredients.length > 0) + Number(Boolean(product.origin)) + Number(product.certifications.length > 0)) / 4);
  const add = (type: SiteRecommendationType, strength: number, available: boolean) => {
    if (!available) return;
    signals.push({ type, strength: bounded(strength) });
  };

  const reviewStrength = reviewSignalStrength(product);
  add("review-trust", sectionRatio(score.sections.trust) * 0.4 + reviewStrength * 0.6, reviewStrength > 0);
  add("core-usp", sectionRatio(score.sections.messageUsp) * 0.7 + uspSpecificity * 0.3, Boolean(usps.length || product.ingredients.length || product.origin || product.certifications.length));
  add("price-benefit", sectionRatio(score.sections.offer) * 0.7 + Math.min(1, offerSignalCount / 4) * 0.3, offerSignalCount > 0);
  add("problem-solution", sectionRatio(score.sections.messageUsp) * 0.55 + 0.18, hasProblem);
  add("situation", sectionRatio(score.sections.season) * 0.4 + Math.min(1, product.usageContexts.length / 2) * 0.3, product.usageContexts.length > 0);
  add("visual-hook", sectionRatio(score.sections.creative), Boolean(product.representativeImage && product.additionalImages.length >= 2));
  add("new-product-test", 0.82, product.badges.includes("신상품"));
  add("seasonal-test", sectionRatio(score.sections.season), score.sections.season.score >= 5);
  add("bundle-value", Math.max(sectionRatio(score.sections.offer), 0.78), Boolean(product.setComposition));
  add("clear-target", sectionRatio(score.sections.messageUsp) * 0.45 + Math.min(1, product.targetSignals.length / 2) * 0.25, product.targetSignals.length > 0);

  if (!signals.length && product.representativeImage) {
    signals.push({ type: "visual-hook", strength: sectionRatio(score.sections.creative) });
  }
  return signals.sort((left, right) => right.strength - left.strength);
}

function trustFacts(product: SiteProductRecord) {
  return uniqueStrings([product.reviewCount ? `리뷰 ${product.reviewCount.toLocaleString("ko-KR")}개` : undefined, product.rating ? `평점 ${product.rating.toFixed(1)}` : undefined, product.extractedReviewPhrases.length ? `후기 표현 ${product.extractedReviewPhrases.length}개` : undefined], 3);
}

function offerFacts(product: SiteProductRecord) {
  return uniqueStrings([product.discountRate ? `${product.discountRate}% 할인` : undefined, product.coupon ? `쿠폰 ${product.coupon}` : undefined, product.freeShipping ? "무료배송" : undefined, product.setComposition ? `세트 구성 ${product.setComposition}` : undefined, product.giftBenefit, product.membershipBenefit], 4);
}

function messageFacts(product: SiteProductRecord) {
  const usps = usableUspCandidates(product);
  return uniqueStrings([...usps.slice(0, 2).map((value) => `USP ${value}`), product.ingredients.length ? `성분 ${product.ingredients.slice(0, 2).join(" · ")}` : undefined, product.origin ? `원산지 ${product.origin}` : undefined, product.certifications.length ? `인증 ${product.certifications.slice(0, 2).join(" · ")}` : undefined], 3);
}

function strengthEvidence(product: SiteProductRecord, key: SiteAdFitSectionKey) {
  if (key === "trust") return trustFacts(product).join(", ");
  if (key === "offer") {
    const facts = offerFacts(product);
    return facts.length ? facts.join(", ") : product.salePrice ? `판매가 ${formatPrice(product.salePrice)}` : "";
  }
  if (key === "messageUsp") return messageFacts(product).join(", ");
  if (key === "creative") return imageCount(product) ? `활용 이미지 ${imageCount(product)}개` : "";
  if (key === "season") {
    return uniqueStrings([product.usageContexts.length ? `사용 상황 ${product.usageContexts.slice(0, 2).join(" · ")}` : undefined, product.badges.includes("신상품") ? "신상품 배지" : undefined, product.badges.includes("한정") ? "한정 배지" : undefined], 2).join(", ");
  }
  return uniqueStrings([product.hasPurchaseButton ? "구매 버튼 확인" : undefined, product.salePrice ? `가격 ${formatPrice(product.salePrice)}` : undefined, product.stockStatus === "in-stock" ? "판매 가능 상태 확인" : undefined, product.shippingInfo ? "배송 안내 확인" : undefined], 3).join(", ");
}

const TEST_LABELS: Record<SiteRecommendationType, string> = {
  "review-trust": "후기·신뢰형",
  "core-usp": "핵심 USP형",
  "price-benefit": "가격·혜택형",
  "problem-solution": "문제 해결형",
  situation: "상황형",
  "visual-hook": "상품 인지형",
  "new-product-test": "신상품 탐색형",
  "seasonal-test": "시즌형",
  "bundle-value": "세트 혜택형",
  "clear-target": "타깃 공감형",
};

function coreRecommendationReason(product: SiteProductRecord, primaryType: SiteRecommendationType, insufficientData: boolean) {
  if (insufficientData) {
    return "확인 가능한 공개정보가 적어 상세페이지 추가 확인이 필요합니다.";
  }
  if (primaryType === "review-trust") {
    const facts = trustFacts(product);
    return `${facts.join(", ")}이 확인되어 후기·신뢰형 메시지를 검증하기 좋습니다.`;
  }
  if (primaryType === "price-benefit" || primaryType === "bundle-value") {
    const facts = offerFacts(product);
    return `${facts.join(", ")}이 확인되어 ${TEST_LABELS[primaryType]} 후킹을 테스트하기 좋습니다.`;
  }
  if (primaryType === "core-usp") {
    const facts = messageFacts(product);
    return `${facts[0] || "구체적인 상품 근거"}가 확인되어 핵심 USP형 메시지로 차별화하기 좋습니다.`;
  }
  if (primaryType === "problem-solution") {
    return "상세 설명에서 고객 고민과 해결 방향이 확인되어 문제 해결형 후킹을 만들기 좋습니다.";
  }
  if (primaryType === "situation" || primaryType === "seasonal-test") {
    return `${product.usageContexts.slice(0, 2).join("·") || "시즌 사용 상황"}이 확인되어 ${TEST_LABELS[primaryType]} 후킹을 만들기 좋습니다.`;
  }
  if (primaryType === "clear-target") {
    return `${product.targetSignals.slice(0, 2).join("·")} 타깃이 확인되어 타깃 공감형 후킹을 만들기 좋습니다.`;
  }
  if (primaryType === "new-product-test") {
    return "신상품 신호가 확인되어 새로운 메시지 가설을 검증하기 좋습니다.";
  }
  return `활용 이미지 ${imageCount(product)}개가 확인되어 상품 인지형 후킹에 사용할 시각 근거가 충분합니다.`;
}

function recommendationSummary(product: SiteProductRecord, score: SiteCandidateScore, evidenceLevel: SiteEvidenceLevel, signals: RecommendationSignal[]) {
  const primaryType = signals[0]?.type || "core-usp";
  const totalEvidence = Object.values(score.sections).reduce((sum, sectionItem) => sum + sectionItem.evidenceCount, 0);
  const insufficientData = evidenceLevel === "low" && (score.total < 45 || totalEvidence < 8);
  const topStrengths = Object.values(score.sections)
    .filter((item) => item.score > 0 && item.reasons.length > 0)
    .map((item) => ({
      sectionKey: item.key,
      label: item.label,
      score: item.score,
      maxScore: item.maxScore,
      evidence: strengthEvidence(product, item.key) || item.reasons.slice(0, 2).join(" · "),
    }))
    .filter((item) => Boolean(item.evidence))
    .sort((left, right) => right.score - left.score || right.score / right.maxScore - left.score / left.maxScore)
    .slice(0, 3);
  const testTypes = uniqueStrings(
    signals.map((item) => item.type),
    2
  ) as SiteRecommendationType[];
  const recommendedTest = insufficientData ? "추가 근거 확인 후 비교할 후킹 가설을 설정하세요." : testTypes.length >= 2 ? `${TEST_LABELS[testTypes[0]]} ↔ ${TEST_LABELS[testTypes[1]]} 후킹 비교` : `${TEST_LABELS[testTypes[0] || primaryType]} 후킹 우선 검증`;
  return {
    primaryType,
    summary: {
      coreReason: coreRecommendationReason(product, primaryType, insufficientData),
      topStrengths,
      recommendedTest,
      insufficientData,
    },
  };
}

function recommendationReasons(score: SiteCandidateScore, summary: ReturnType<typeof recommendationSummary>["summary"]) {
  return uniqueStrings([summary.coreReason, ...Object.values(score.sections).flatMap((item) => item.reasons), `추천 테스트: ${summary.recommendedTest}`], 10);
}

function cautions(product: SiteProductRecord, evidenceLevel: SiteEvidenceLevel) {
  const messages = ["사이트 공개정보 기반 추천이며 실제 판매·전환·ROAS는 광고 테스트로 검증해야 합니다."];
  if (!product.salePrice) messages.push("판매가를 확인하지 못해 가격 메시지는 추가 확인이 필요합니다.");
  if (!product.reviewCount && !product.rating) {
    messages.push("리뷰가 0개인 것이 아니라 공개 페이지에서 리뷰 지표를 확인하지 못했습니다.");
  }
  if (product.additionalImages.length < 2) messages.push("광고 제작 전에 추가 상품 이미지 확보가 필요합니다.");
  if (!product.hasPurchaseButton) messages.push("구매 버튼을 확인하지 못해 랜딩페이지를 직접 점검해야 합니다.");
  if (evidenceLevel === "low") messages.push("확인 가능한 정보가 적어 상세페이지 정밀 분석이 필요합니다.");
  return uniqueStrings(messages, 8);
}

export function buildSiteAdCandidate(product: SiteProductRecord, now = new Date()): SiteAdCandidate {
  const score = scoreSections(product, now);
  const evidenceLevel = evidenceLevelForProduct(product);
  const signals = recommendationSignals(product, score);
  const types = signals.slice(0, 5).map((item) => item.type);
  const { primaryType: primaryRecommendationType, summary } = recommendationSummary(product, score, evidenceLevel, signals);
  const tier = evidenceLevel === "high" && score.total >= 65 ? "evidence-backed" : product.badges.includes("신상품") || primaryRecommendationType === "seasonal-test" ? "experiment" : "content-potential";
  return {
    id: stableId("site-candidate", product.productUrl),
    rank: 0,
    tier,
    product,
    score,
    evidenceLevel,
    recommendationTypes: types,
    primaryRecommendationType,
    recommendationSummary: summary,
    recommendationReasons: recommendationReasons(score, summary),
    cautions: cautions(product, evidenceLevel),
    unavailableInformation: product.evidence.filter((field) => field.state !== "present").map((field) => `${field.label}: ${field.state === "absent" ? "없음" : "확인 불가"}`),
  };
}

export function exclusionReasons(product: SiteProductRecord) {
  const reasons: string[] = [];
  if (product.stockStatus === "sold-out") reasons.push("품절 또는 판매 종료 상태가 확인됨");
  if (!product.representativeImage) reasons.push("대표 이미지를 확인하지 못함");
  if (/상품명\s*확인\s*필요/i.test(product.productName)) reasons.push("상품 페이지에서 상품명을 확인하지 못함");
  if (/성인용품|전자담배|대마|마약|불법\s*도박|총기/i.test(`${product.productName} ${product.category || ""}`)) {
    reasons.push("정책상 자동 광고 추천에서 제외되는 상품 신호가 확인됨");
  }
  return reasons;
}
