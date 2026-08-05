import type { ContentAngleRecommendation, ProductDetailAnalysis } from "./types";
import { roundScore, stableId, uniqueStrings } from "./htmlUtils";

function currency(value?: number) {
  return value ? `${Math.round(value).toLocaleString("ko-KR")}원` : "";
}

function unitPriceEvidence(detail: ProductDetailAnalysis) {
  if (!detail.product.salePrice) return "";
  const compositionText = [
    detail.product.name,
    detail.description,
    ...Object.entries(detail.specifications).map(([key, value]) => `${key} ${value}`),
  ]
    .filter(Boolean)
    .join(" ");
  const match = compositionText.match(
    /(?:^|\s)(\d{1,3})\s*(개|팩|입|병|장)(?:\s|구성|세트|묶음|\/|$)/i
  );
  const quantity = Number(match?.[1]);
  if (!match || !Number.isInteger(quantity) || quantity < 2 || quantity > 100) return "";
  const unitPrice = Math.round(detail.product.salePrice / quantity);
  return `공개 구성 ${quantity}${match[2]} 기준 ${match[2]}당 약 ${currency(unitPrice)}꼴`;
}

function templateIdsFor(type: ContentAngleRecommendation["type"], category = "") {
  const beauty = /뷰티|화장품|스킨|바디|beauty/i.test(category);
  if (beauty) {
    return type === "review" || type === "problem-solution"
      ? ["auto-beauty-proof-002", "auto-body-solution-001"]
      : ["auto-beauty-editorial-001", "auto-beauty-proof-002"];
  }
  const mapping: Partial<Record<ContentAngleRecommendation["type"], string[]>> = {
    "price-shock": ["auto-meat-impact-001", "food-template-001", "black-repeat-product"],
    review: ["circle-focus-review", "before-after-split-review"],
    quality: ["food-template-003", "auto-meat-impact-001"],
    family: ["food-template-002", "circle-focus-review"],
    camping: ["camping-popularity-impact", "food-template-002"],
    gift: ["food-template-003", "food-template-004"],
    ingredient: ["sports-benefit-chip", "food-template-003"],
    "problem-solution": ["before-after-split-review", "sports-benefit-chip"],
    "new-product": ["food-template-004", "food-template-003"],
    comparison: ["before-after-split-review", "food-template-005"],
    "bundle-value": ["black-repeat-product", "food-template-001"],
    seasonal: ["camping-popularity-impact", "food-template-004"],
  };
  return mapping[type] || ["food-template-003"];
}

export function recommendContentAngles(
  detail: ProductDetailAnalysis
): ContentAngleRecommendation[] {
  const { product } = detail;
  const text = [
    product.name,
    product.category,
    detail.description,
    ...detail.uspCandidates,
    ...Object.entries(detail.specifications).flat(),
    ...(detail.reviewAnalysis?.purchaseSituations || []),
  ]
    .filter(Boolean)
    .join(" ");
  const angles: ContentAngleRecommendation[] = [];
  const add = (
    type: ContentAngleRecommendation["type"],
    name: string,
    reason: string,
    evidence: string[],
    headlineDirection: string,
    bodyDirection: string,
    baseScore: number
  ) => {
    if (angles.some((angle) => angle.type === type)) return;
    const cleanEvidence = uniqueStrings(evidence, 5);
    if (!cleanEvidence.length) return;
    angles.push({
      id: stableId("angle", `${product.id}:${type}`),
      name,
      type,
      reason,
      evidence: cleanEvidence,
      headlineDirection,
      bodyDirection,
      templateIds: templateIdsFor(type, product.category),
      score: roundScore(baseScore + Math.min(12, cleanEvidence.length * 3)),
    });
  };

  if (
    product.salePrice &&
    (product.discountRate || product.originalPrice || product.isSetProduct)
  ) {
    add(
      "price-shock",
      "확인 가능한 가격 혜택 강조",
      "공개 페이지에서 확인된 가격·할인·구성 정보로 즉시 이해되는 구매 이유를 만들 수 있습니다.",
      [
        product.salePrice ? `판매가 ${currency(product.salePrice)}` : "",
        product.originalPrice ? `정상가 ${currency(product.originalPrice)}` : "",
        product.discountRate ? `확인된 할인율 ${product.discountRate}%` : "",
        unitPriceEvidence(detail),
      ],
      "확인된 가격 또는 할인율을 짧고 강하게 제시",
      "정상가·판매가·구성 중 공개 페이지에서 확인된 사실만 설명",
      82
    );
  }

  const reviewEvidence = [
    product.reviewCount ? `공개 리뷰 수 ${product.reviewCount.toLocaleString("ko-KR")}개` : "",
    product.rating ? `공개 평점 ${product.rating}` : "",
    ...(detail.reviewAnalysis?.repeatedBenefits || []).map((value) => `반복 장점: ${value}`),
    ...(detail.reviewAnalysis?.purchaseSituations || []).map((value) => `구매 상황: ${value}`),
  ];
  if (reviewEvidence.some(Boolean)) {
    add(
      "review",
      "반복 후기 근거 활용",
      "단일 후기 문장을 복사하지 않고 반복 확인된 장점과 상황을 광고 근거로 활용합니다.",
      reviewEvidence,
      "고객 반응을 과장 없이 요약한 구어체 후킹",
      "반복 장점과 실제 사용 상황을 중심으로 설명",
      78
    );
  }

  if (product.isNew) {
    add(
      "new-product",
      "신상품 테스트 가치",
      "리뷰가 적더라도 신상품 자체의 발견성과 차별점을 검증할 수 있습니다.",
      ["신상품 영역에서 발견됨", detail.uspCandidates[0]],
      "새롭게 공개된 상품임을 알리는 발견형 헤드라인",
      "기존 제품과 구분되는 공개 USP와 구성을 설명",
      80
    );
  }

  if (product.isSetProduct) {
    add(
      "bundle-value",
      "구성·묶음 가치",
      "확인 가능한 세트 또는 묶음 구성이 구매 이유가 될 수 있습니다.",
      [
        "상품명 또는 설명에서 세트·묶음 구성이 확인됨",
        unitPriceEvidence(detail),
        ...detail.uspCandidates.slice(0, 2),
      ],
      "구성 수와 한 번에 얻는 가치를 먼저 제시",
      "확인된 수량·용량·구성만 풀어서 설명",
      79
    );
  }

  const situations = detail.reviewAnalysis?.purchaseSituations || [];
  if (/캠핑|바비큐|바베큐|여행|펜션/.test(text) || situations.includes("캠핑")) {
    add(
      "camping",
      "캠핑 사용 상황",
      "상품 설명 또는 후기에서 캠핑·야외 사용 맥락이 확인됩니다.",
      [
        situations.includes("캠핑")
          ? "후기 구매 상황: 캠핑"
          : "상품 페이지에서 캠핑 관련 표현 확인",
        ...detail.uspCandidates.slice(0, 2),
      ],
      "캠핑 현장에서의 사용 장면을 떠올리게 하는 후킹",
      "조리·휴대·구성 등 페이지에서 확인된 편의만 설명",
      77
    );
  }
  if (/가족|아이|부모님|식구|가족식사/.test(text) || situations.includes("가족식사")) {
    add(
      "family",
      "가족 사용 상황",
      "가족 구매·사용 맥락이 공개 정보에서 확인됩니다.",
      [
        situations.includes("가족식사") ? "후기 구매 상황: 가족식사" : "상품 설명의 가족 관련 표현",
        ...detail.uspCandidates.slice(0, 2),
      ],
      "가족이 함께 쓰거나 먹는 장면 중심의 공감형 후킹",
      "구성·양·편의 등 확인 가능한 가족 사용 이점을 설명",
      74
    );
  }
  if (/선물|명절|기프트|답례/.test(text) || situations.includes("선물")) {
    add(
      "gift",
      "선물 선택 이유",
      "선물 관련 용도 또는 구성 근거가 공개 페이지에서 확인됩니다.",
      [situations.includes("선물") ? "후기 구매 상황: 선물" : "상품 페이지의 선물 관련 표현"],
      "누구에게 어떤 상황에 선물하기 좋은지 제안",
      "포장·구성·품질 중 확인된 선물 근거를 설명",
      73
    );
  }
  if (/성분|원재료|함량|원산지|무첨가|저당|단백질|인증/.test(text)) {
    add(
      "ingredient",
      "성분·원산지 근거",
      "상세페이지에서 확인 가능한 성분·원산지·인증 정보를 신뢰 근거로 사용할 수 있습니다.",
      [
        ...detail.uspCandidates.filter((value) =>
          /성분|원재료|함량|원산지|무첨가|저당|단백질|인증/.test(value)
        ),
        ...Object.entries(detail.specifications)
          .slice(0, 2)
          .map(([key, value]) => `${key}: ${value}`),
      ],
      "검증 가능한 성분 또는 원산지 한 가지를 전면에 제시",
      "수치와 인증은 상세페이지에 공개된 범위에서만 설명",
      76
    );
  }

  if (detail.uspCandidates.length) {
    add(
      "quality",
      "핵심 USP 신뢰",
      "상세페이지의 차별점과 품질 설명을 중심으로 상품 선택 이유를 만들 수 있습니다.",
      detail.uspCandidates.slice(0, 4),
      "가장 명확한 품질·차별점 한 가지를 짧게 제시",
      "USP의 근거와 실제 사용 이점을 연결",
      72
    );
  }

  if (detail.uspCandidates.length || detail.description) {
    add(
      "problem-solution",
      "사용 문제 해결",
      "상품 설명에서 확인되는 효용을 고객의 사용 문제와 연결해 테스트할 수 있습니다.",
      [detail.uspCandidates[0], detail.description?.slice(0, 140)].filter(Boolean) as string[],
      "고객이 겪는 상황을 질문 또는 반전으로 제시",
      "확인된 상품 효용이 그 상황에 어떻게 도움 되는지 설명",
      68
    );
  }

  if (Object.keys(detail.specifications).length || product.salePrice) {
    add(
      "comparison",
      "선택 기준 비교",
      "공개된 가격·구성·규격을 구매자가 비교하기 쉬운 기준으로 정리할 수 있습니다.",
      [
        product.salePrice ? `판매가 ${currency(product.salePrice)}` : "",
        ...Object.entries(detail.specifications)
          .slice(0, 3)
          .map(([key, value]) => `${key}: ${value}`),
      ],
      "구매자가 가장 궁금해할 비교 기준을 먼저 제시",
      "경쟁사 수치를 만들지 않고 상품 자체의 가격·구성·규격만 비교",
      66
    );
  }

  while (angles.length < 3) {
    const fallbackTypes = ["quality", "problem-solution", "comparison"] as const;
    const type = fallbackTypes.find(
      (candidate) => !angles.some((angle) => angle.type === candidate)
    );
    if (!type) break;
    const evidence = [
      detail.uspCandidates[0],
      detail.description?.slice(0, 140),
      product.name,
      product.category,
    ].filter(Boolean) as string[];
    const fallback = {
      quality: [
        "상품 핵심 정보 명확화",
        "공개된 상품명과 설명을 중심으로 핵심 선택 이유를 정리합니다.",
        "핵심 상품 특성을 한 문장으로 제시",
        "상세페이지에서 확인된 특성과 용도를 설명",
      ],
      "problem-solution": [
        "구매 상황 문제 해결",
        "공개된 상품 효용을 실제 사용 상황과 연결해 검증합니다.",
        "사용 상황의 불편 또는 니즈를 제시",
        "상품 페이지에서 확인된 효용만 해결 근거로 설명",
      ],
      comparison: [
        "구매 기준 정리",
        "상품 자체의 공개 정보를 구매자가 비교하기 쉬운 기준으로 정리합니다.",
        "가격·구성·특성 중 확인된 기준을 제시",
        "확인되지 않은 경쟁사 정보 없이 상품 내부 기준만 설명",
      ],
    } as const;
    add(
      type,
      fallback[type][0],
      fallback[type][1],
      evidence,
      fallback[type][2],
      fallback[type][3],
      58
    );
  }

  return angles.sort((a, b) => b.score - a.score).slice(0, 6);
}
