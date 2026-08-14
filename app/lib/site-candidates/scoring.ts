import { stableId, uniqueStrings } from "../store-analysis/htmlUtils.ts";
import type {
  SiteAdCandidate,
  SiteAdFitSection,
  SiteAdFitSectionKey,
  SiteCandidateScore,
  SiteEvidenceLevel,
  SiteProductRecord,
  SiteRecommendationType,
} from "./types";

type Indicator = {
  available: boolean;
  ratio: number;
  reason?: string;
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

function section(key: SiteAdFitSectionKey, indicators: Indicator[]): SiteAdFitSection {
  const available = indicators.filter((indicator) => indicator.available);
  const ratio = available.length
    ? available.reduce((sum, indicator) => sum + bounded(indicator.ratio), 0) / available.length
    : 0;
  return {
    key,
    label: SECTION_LABELS[key],
    score: Math.round(ratio * SECTION_MAX[key]),
    maxScore: SECTION_MAX[key],
    reasons: uniqueStrings(
      available.filter((indicator) => indicator.ratio > 0).map((indicator) => indicator.reason),
      6
    ),
  };
}

function includesAny(value: string, pattern: RegExp) {
  return pattern.test(value);
}

function hasEvidence(product: SiteProductRecord, key: string) {
  return product.evidence.find((field) => field.key === key)?.state === "present";
}

function currentSeasonPattern(now: Date) {
  const month = now.getMonth() + 1;
  if (month >= 6 && month <= 8) return /여름|휴가|캠핑|야외|쿨링|냉감|장마|물놀이|보양/i;
  if (month >= 9 && month <= 11) return /가을|추석|캠핑|수확|선물|환절기/i;
  if (month === 12 || month <= 2) return /겨울|연말|크리스마스|설날|보온|난방|선물|국물/i;
  return /봄|신학기|입학|나들이|피크닉|선물|환절기/i;
}

function scoreSections(product: SiteProductRecord, now: Date): SiteCandidateScore {
  const text = [
    product.productName,
    product.description,
    ...product.uspCandidates,
    ...product.benefits,
    ...product.usageContexts,
    ...product.targetSignals,
  ]
    .filter(Boolean)
    .join(" ");
  const imageCount = Number(Boolean(product.representativeImage)) + product.additionalImages.length;
  const hasProblem = includesAny(
    text,
    /불편|고민|문제|부족|건조|냄새|땀|피로|번거|민감|자극|해결|개선|완화/i
  );
  const hasNumericProof = /\d+(?:\.\d+)?\s*(?:%|mg|g|kg|ml|개|회|시간|일|장|배)/i.test(text);
  const hasTarget = product.targetSignals.length > 0;
  const hasContext = product.usageContexts.length > 0;

  const messageUsp = section("messageUsp", [
    {
      available: hasEvidence(product, "usp") || hasEvidence(product, "description"),
      ratio: Math.min(1, product.uspCandidates.length / 4),
      reason: product.uspCandidates.length
        ? `확인된 USP ${product.uspCandidates.length}개`
        : undefined,
    },
    {
      available: Boolean(product.description),
      ratio: hasProblem ? 1 : 0,
      reason: hasProblem ? "고객 문제와 해결 방향이 페이지에 명시됨" : undefined,
    },
    {
      available: Boolean(text),
      ratio: hasNumericProof ? 1 : 0,
      reason: hasNumericProof ? "수치로 표현된 상품 근거가 확인됨" : undefined,
    },
    {
      available: Boolean(product.ingredients.length || product.origin || product.certifications.length),
      ratio: Math.min(
        1,
        (product.ingredients.length + Number(Boolean(product.origin)) + product.certifications.length) /
          4
      ),
      reason:
        product.ingredients.length || product.origin || product.certifications.length
          ? "성분·원산지·인증 근거를 메시지에 활용 가능"
          : undefined,
    },
    {
      available: hasTarget || hasContext,
      ratio: (Number(hasTarget) + Number(hasContext)) / 2,
      reason: hasTarget || hasContext ? "타깃 또는 사용 상황이 구체적으로 확인됨" : undefined,
    },
  ]);

  const trust = section("trust", [
    {
      available: hasEvidence(product, "reviews"),
      ratio: product.reviewCount
        ? Math.min(1, Math.log10(product.reviewCount + 1) / 3.2)
        : product.rating
          ? 0.35
          : 0,
      reason: product.reviewCount
        ? `공개 리뷰 ${product.reviewCount.toLocaleString("ko-KR")}개 확인`
        : undefined,
    },
    {
      available: typeof product.rating === "number",
      ratio: product.rating ? Math.max(0, Math.min(1, (product.rating - 3) / 2)) : 0,
      reason: product.rating ? `공개 평점 ${product.rating.toFixed(1)}점 확인` : undefined,
    },
    {
      available: hasEvidence(product, "reviews"),
      ratio: Math.min(1, product.extractedReviewPhrases.length / 3),
      reason: product.extractedReviewPhrases.length
        ? `후기 인사이트 ${product.extractedReviewPhrases.length}개 확인`
        : undefined,
    },
    {
      available: hasEvidence(product, "certifications"),
      ratio: Math.min(1, product.certifications.length / 2),
      reason: product.certifications.length ? "인증·시험 근거 확인" : undefined,
    },
    {
      available: hasEvidence(product, "origin") || product.ingredients.length > 0,
      ratio: Math.min(1, (Number(Boolean(product.origin)) + product.ingredients.length) / 3),
      reason: product.origin || product.ingredients.length ? "원산지 또는 성분 정보 확인" : undefined,
    },
    {
      available: Boolean(product.brandName),
      ratio: product.brandName ? 1 : 0,
      reason: product.brandName ? `브랜드 ${product.brandName} 확인` : undefined,
    },
  ]);

  const offer = section("offer", [
    {
      available: hasEvidence(product, "price"),
      ratio: product.salePrice ? 1 : 0,
      reason: product.salePrice ? "판매가가 명확하게 표시됨" : undefined,
    },
    {
      available: Boolean(product.regularPrice && product.salePrice),
      ratio: product.discountRate ? Math.min(1, product.discountRate / 35) : 0,
      reason: product.discountRate ? `확인된 할인율 ${product.discountRate}%` : undefined,
    },
    {
      available: hasEvidence(product, "benefits"),
      ratio: product.coupon ? 1 : 0,
      reason: product.coupon ? "쿠폰 혜택 확인" : undefined,
    },
    {
      available: hasEvidence(product, "shipping"),
      ratio: product.freeShipping ? 1 : 0,
      reason: product.freeShipping ? "무료배송 혜택 확인" : undefined,
    },
    {
      available: hasEvidence(product, "benefits"),
      ratio: product.setComposition ? 1 : 0,
      reason: product.setComposition ? "세트·구성 구매 명분 확인" : undefined,
    },
    {
      available: hasEvidence(product, "benefits"),
      ratio: product.giftBenefit || product.membershipBenefit ? 1 : 0,
      reason:
        product.giftBenefit || product.membershipBenefit ? "증정 또는 회원 혜택 확인" : undefined,
    },
    {
      available: Boolean(product.promotionEndsAt),
      ratio: product.promotionEndsAt ? 1 : 0,
      reason: product.promotionEndsAt ? "기간 한정 혜택 정보 확인" : undefined,
    },
  ]);

  const creative = section("creative", [
    {
      available: true,
      ratio: product.representativeImage ? 1 : 0,
      reason: product.representativeImage ? "대표 이미지 확보" : undefined,
    },
    {
      available: true,
      ratio: Math.min(1, imageCount / 4),
      reason: imageCount ? `활용 가능한 이미지 ${imageCount}개 확인` : undefined,
    },
    {
      available: Boolean(imageCount),
      ratio: product.additionalImages.length >= 2 ? 1 : product.additionalImages.length / 2,
      reason: product.additionalImages.length >= 2 ? "복수 구도 이미지 활용 가능" : undefined,
    },
    {
      available: hasContext,
      ratio: hasContext ? 1 : 0,
      reason: hasContext ? "사용 상황 소재 방향 확인" : undefined,
    },
    {
      available: Boolean(product.description || product.uspCandidates.length),
      ratio: product.description && product.uspCandidates.length ? 1 : 0.5,
      reason:
        product.description || product.uspCandidates.length
          ? "이미지와 함께 설명할 상품 근거 확보"
          : undefined,
    },
  ]);

  const seasonPattern = currentSeasonPattern(now);
  const seasonMatch = seasonPattern.test(text);
  const season = section("season", [
    {
      available: Boolean(text),
      ratio: seasonMatch ? 1 : 0,
      reason: seasonMatch ? "현재 시즌과 연결되는 공개 문구 확인" : undefined,
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

  const landing = section("landing", [
    {
      available: product.stockStatus !== "unavailable",
      ratio: product.stockStatus === "in-stock" ? 1 : 0,
      reason: product.stockStatus === "in-stock" ? "판매 가능 상태가 명시됨" : undefined,
    },
    {
      available: hasEvidence(product, "price"),
      ratio: product.salePrice ? 1 : 0,
      reason: product.salePrice ? "가격 확인 가능" : undefined,
    },
    {
      available: true,
      ratio: product.hasPurchaseButton ? 1 : 0,
      reason: product.hasPurchaseButton ? "구매 버튼 확인" : undefined,
    },
    {
      available: product.options.length > 0,
      ratio: product.options.length ? 1 : 0,
      reason: product.options.length ? "옵션 구조 확인" : undefined,
    },
    {
      available: hasEvidence(product, "shipping"),
      ratio: product.shippingInfo ? 1 : 0,
      reason: product.shippingInfo ? "배송 안내 확인" : undefined,
    },
    {
      available: hasEvidence(product, "benefits"),
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
  const groups = [
    Boolean(product.productName && (product.description || product.uspCandidates.length)),
    Boolean(product.salePrice || product.benefits.length),
    Boolean(product.reviewCount || product.rating || product.extractedReviewPhrases.length),
    Boolean(product.representativeImage && product.additionalImages.length),
    Boolean(product.hasPurchaseButton && product.stockStatus !== "sold-out"),
  ];
  const present = groups.filter(Boolean).length;
  if (present >= 5) return "high";
  if (present >= 3) return "medium";
  return "low";
}

function recommendationTypes(product: SiteProductRecord, score: SiteCandidateScore) {
  const types: SiteRecommendationType[] = [];
  const text = `${product.description || ""} ${product.uspCandidates.join(" ")}`;
  if (product.reviewCount || product.rating || product.extractedReviewPhrases.length) {
    types.push("review-trust");
  }
  if (product.uspCandidates.length) types.push("core-usp");
  if (product.discountRate || product.benefits.length) types.push("price-benefit");
  if (/불편|고민|문제|냄새|땀|건조|자극|해결|개선|완화/i.test(text)) {
    types.push("problem-solution");
  }
  if (product.usageContexts.length) types.push("situation");
  if (product.representativeImage && product.additionalImages.length >= 2) types.push("visual-hook");
  if (product.badges.includes("신상품")) types.push("new-product-test");
  if (score.sections.season.score >= 5) types.push("seasonal-test");
  if (product.setComposition) types.push("bundle-value");
  if (product.targetSignals.length) types.push("clear-target");
  if (!types.length && product.representativeImage) types.push("visual-hook");
  return uniqueStrings(types, 5) as SiteRecommendationType[];
}

function recommendationReasons(product: SiteProductRecord) {
  const reasons: string[] = [];
  if (product.reviewCount) {
    reasons.push(
      `공개 리뷰 ${product.reviewCount.toLocaleString("ko-KR")}개가 확인되어 후기·신뢰 메시지를 테스트할 수 있습니다.`
    );
  }
  if (product.extractedReviewPhrases[0]) {
    reasons.push(`후기에서 '${product.extractedReviewPhrases[0]}' 인사이트가 확인됩니다.`);
  }
  if (product.uspCandidates[0]) {
    reasons.push(`'${product.uspCandidates[0]}'을 핵심 USP 메시지로 활용할 수 있습니다.`);
  }
  if (product.discountRate) {
    reasons.push(`정상가와 판매가에서 ${product.discountRate}% 할인 혜택이 확인됩니다.`);
  }
  if (product.setComposition) {
    reasons.push("세트·구성 정보가 확인되어 구매 명분을 설명할 수 있습니다.");
  }
  if (product.usageContexts.length) {
    reasons.push(`페이지에서 ${product.usageContexts.slice(0, 2).join(", ")} 상황을 확인했습니다.`);
  }
  const imageCount = Number(Boolean(product.representativeImage)) + product.additionalImages.length;
  if (imageCount >= 3) {
    reasons.push(`상품 이미지 ${imageCount}개가 확인되어 여러 소재 구도를 테스트할 수 있습니다.`);
  }
  if (product.badges.includes("신상품")) {
    reasons.push("신상품 배지가 확인되어 신규 메시지를 실험할 가치가 있습니다.");
  }
  return uniqueStrings(reasons, 6);
}

function cautions(product: SiteProductRecord, evidenceLevel: SiteEvidenceLevel) {
  const messages = [
    "사이트 공개정보 기반 추천이며 실제 판매·전환·ROAS는 광고 테스트로 검증해야 합니다.",
  ];
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
  const types = recommendationTypes(product, score);
  const primaryRecommendationType = types[0] || "core-usp";
  const tier =
    evidenceLevel === "high" && score.total >= 65
      ? "evidence-backed"
      : product.badges.includes("신상품") || primaryRecommendationType === "seasonal-test"
        ? "experiment"
        : "content-potential";
  return {
    id: stableId("site-candidate", product.productUrl),
    rank: 0,
    tier,
    product,
    score,
    evidenceLevel,
    recommendationTypes: types,
    primaryRecommendationType,
    recommendationReasons: recommendationReasons(product),
    cautions: cautions(product, evidenceLevel),
    unavailableInformation: product.evidence
      .filter((field) => field.state !== "present")
      .map((field) => `${field.label}: ${field.state === "absent" ? "없음" : "확인 불가"}`),
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
