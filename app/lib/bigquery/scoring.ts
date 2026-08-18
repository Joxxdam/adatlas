import type {
  BigQueryAdCandidate,
  BigQueryCandidateMetric,
  BigQueryOfferVariant,
  BigQueryProductFamily,
  BigQueryProductFamilyMatchSource,
  BigQueryRecommendationType,
  BigQueryScoreBreakdown,
  BigQueryTrendState,
} from "./types";

export const BIGQUERY_RECOMMENDATION_THRESHOLDS = {
  MIN_PURCHASES_FOR_EFFICIENCY: 3,
  MIN_EXPOSURES_FOR_EFFICIENCY: 100,
  MIN_SALES_FOR_SCALE: 100_000,
  MIN_PERIODS_FOR_STABILITY: 2,
  CORE_TOP_RANK: 3,
  CORE_SALES_SHARE: 0.08,
  CORE_PURCHASE_SHARE: 0.08,
  HIGH_EFFICIENCY_RATIO: 1.15,
  LOW_EFFICIENCY_RATIO: 0.85,
  LOW_EXPOSURE_RATIO: 0.75,
  HIGH_EXPOSURE_RATIO: 1.0,
} as const;

export const BUSINESS_IMPORTANCE_WEIGHTS = {
  salesShare: 0.3,
  purchaseShare: 0.25,
  salesRank: 0.2,
  purchaseRank: 0.15,
  mediumTermStability: 0.1,
} as const;

export const AD_OPPORTUNITY_WEIGHTS = {
  efficiency: 0.3,
  momentum: 0.2,
  exposureHeadroom: 0.2,
  purchaseEvidence: 0.15,
  improvementHeadroom: 0.15,
} as const;

export type BigQueryProductSignalRow = {
  productName: string;
  productIdHint: string | null;
  currentSales: number;
  previousSales: number;
  currentExposures: number;
  previousExposures: number;
  currentPurchases: number;
  previousPurchases: number;
  currentCarts: number;
  conversionRate: number | null;
  salesChangeRate: number | null;
  averageExposures: number;
  brandConversionRate: number | null;
  brandTotalSales?: number;
  brandTotalPurchases?: number;
  productSalesShare?: number;
  productPurchaseShare?: number;
  salesRank: number;
  purchaseRank?: number;
  productCount: number;
  recent1WeekSales?: number;
  recent1WeekPurchases?: number;
  recent4WeekSales?: number;
  previous4WeekSales?: number;
  recent8WeekSales?: number;
  recent12WeekSales?: number;
  recent4WeekPurchases?: number;
  previous4WeekPurchases?: number;
  periodsAvailable?: number;
  latestDate: string;
};

type CandidateContext = {
  advertiserId: string;
  source: "host24" | "hostmk";
  brandId: string | null;
  brandName: string;
  category: string | null;
  storeUrl?: string | null;
  analysisPeriodStart: string;
  analysisPeriodEnd: string;
  comparisonPeriodStart: string;
  comparisonPeriodEnd: string;
  sourceTable: string;
  candidateId: (row: BigQueryProductSignalRow) => string;
};

export function resolveBigQueryProductUrl(input: {
  source: "host24" | "hostmk";
  storeUrl?: string | null;
  productId?: string | null;
}) {
  const productId = String(input.productId || "").trim();
  if (!/^\d+$/.test(productId)) return null;

  try {
    const store = new URL(String(input.storeUrl || "").trim());
    if (store.protocol !== "http:" && store.protocol !== "https:") return null;

    const detail = new URL(
      input.source === "host24" ? "/product/detail.html" : "/shop/shopdetail.html",
      store.origin
    );
    detail.searchParams.set(input.source === "host24" ? "product_no" : "branduid", productId);
    return detail.toString();
  } catch {
    return null;
  }
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function rounded(value: number) {
  return Math.round(clamp(value));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function weightedAvailable(
  values: Record<string, number | null | undefined>,
  weights: Record<string, number>
) {
  let sum = 0;
  let used = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = values[key];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    sum += clamp(value) * weight;
    used += weight;
  }
  return used ? rounded(sum / used) : 0;
}

function rankScore(rank: number, count: number) {
  if (!rank || !count) return 0;
  if (count === 1) return 100;
  return clamp((1 - (rank - 1) / (count - 1)) * 100);
}

function shareScore(share: number) {
  return clamp((share / 0.25) * 100);
}

function efficiencyRatio(row: BigQueryProductSignalRow) {
  if (
    row.conversionRate === null ||
    row.brandConversionRate === null ||
    row.brandConversionRate <= 0
  ) return null;
  return row.conversionRate / row.brandConversionRate;
}

function hasEfficiencySample(row: BigQueryProductSignalRow) {
  return (
    row.currentPurchases >= BIGQUERY_RECOMMENDATION_THRESHOLDS.MIN_PURCHASES_FOR_EFFICIENCY &&
    row.currentExposures >= BIGQUERY_RECOMMENDATION_THRESHOLDS.MIN_EXPOSURES_FOR_EFFICIENCY
  );
}

export function determineTrendState(row: BigQueryProductSignalRow): BigQueryTrendState {
  const current = row.recent4WeekSales ?? row.currentSales;
  const previous = row.previous4WeekSales ?? row.previousSales;
  if (!(previous > 0) || !Number.isFinite(current)) return "insufficient-period-data";
  const change = (current - previous) / previous;
  if (change >= 0.25) return "strong-growth";
  if (change >= 0.05) return "growth";
  if (change > -0.05) return "stable";
  const recent12 = row.recent12WeekSales || 0;
  const recentWeekly = current / 4;
  const longWeekly = recent12 > 0 ? recent12 / 12 : 0;
  if (change <= -0.2 && longWeekly > 0 && recentWeekly < longWeekly * 0.8) {
    return "sustained-decline";
  }
  return "short-term-decline";
}

export function trendLabel(state: BigQueryTrendState) {
  if (state === "strong-growth" || state === "growth") return "최근 반응 상승";
  if (state === "stable") return "꾸준히 판매되는 흐름";
  if (state === "short-term-decline" || state === "sustained-decline") return "최근 반응 회복 테스트 추천";
  return "현재 판매 흐름 기준";
}

function trendScores(state: BigQueryTrendState) {
  const positive: Record<BigQueryTrendState, number | null> = {
    "strong-growth": 100,
    growth: 88,
    stable: 78,
    "short-term-decline": 58,
    "sustained-decline": 45,
    "insufficient-period-data": null,
  };
  const recovery: Record<BigQueryTrendState, number> = {
    "strong-growth": 10,
    growth: 15,
    stable: 30,
    "short-term-decline": 88,
    "sustained-decline": 100,
    "insufficient-period-data": 35,
  };
  return { positive: positive[state], recovery: recovery[state] };
}

function momentumFromChange(change: number) {
  if (change >= 0.25) return 100;
  if (change >= 0.05) return 88;
  if (change > -0.05) return 78;
  if (change > -0.2) return 58;
  return 45;
}

function stabilityScore(row: BigQueryProductSignalRow, state: BigQueryTrendState) {
  const periods = row.periodsAvailable ?? [row.recent4WeekSales, row.recent8WeekSales, row.recent12WeekSales].filter((value) => (value || 0) > 0).length;
  if (periods < BIGQUERY_RECOMMENDATION_THRESHOLDS.MIN_PERIODS_FOR_STABILITY) return 55;
  if (state === "stable") return 100;
  if (state === "growth" || state === "strong-growth") return 88;
  if (state === "short-term-decline") return 78;
  if (state === "sustained-decline") return 62;
  return 65;
}

function scoreRow(row: BigQueryProductSignalRow) {
  const brandSales = row.brandTotalSales || 0;
  const brandPurchases = row.brandTotalPurchases || 0;
  const salesShare = row.productSalesShare ?? (brandSales > 0 ? row.currentSales / brandSales : 0);
  const purchaseShare = row.productPurchaseShare ?? (brandPurchases > 0 ? row.currentPurchases / brandPurchases : 0);
  const state = determineTrendState(row);
  const trends = trendScores(state);
  const currentPurchaseFlow = row.recent4WeekPurchases ?? row.currentPurchases;
  const previousPurchaseFlow = row.previous4WeekPurchases ?? row.previousPurchases;
  const purchaseMomentum = previousPurchaseFlow > 0
    ? momentumFromChange((currentPurchaseFlow - previousPurchaseFlow) / previousPurchaseFlow)
    : null;
  const positiveMomentum = trends.positive === null
    ? purchaseMomentum
    : purchaseMomentum === null
      ? trends.positive
      : rounded(trends.positive * 0.7 + purchaseMomentum * 0.3);
  const rawRatio = efficiencyRatio(row);
  const rawEfficiency = rawRatio === null ? 45 : clamp((rawRatio - 0.45) / 1.1 * 100);
  const efficiencyScore = hasEfficiencySample(row) ? rawEfficiency : Math.min(42, rawEfficiency);
  const exposureRatio = row.averageExposures > 0 ? row.currentExposures / row.averageExposures : 1;
  const exposureHeadroomScore = clamp((1.35 - exposureRatio) / 1.05 * 100);
  const exposureScaleScore = clamp((exposureRatio - 0.55) / 1.1 * 100);
  const purchaseSignal = Math.log10(row.currentPurchases + 1) * 0.7 + Math.log10(row.currentCarts + 1) * 0.3;
  const purchaseEvidenceScore = clamp(purchaseSignal / 2.2 * 100);
  const efficiencyGapScore = clamp(100 - efficiencyScore);
  const improvementHeadroom = rounded(efficiencyGapScore * 0.65 + exposureScaleScore * 0.35);
  const businessBreakdown = {
    salesShare: rounded(shareScore(salesShare)),
    purchaseShare: rounded(shareScore(purchaseShare)),
    salesRank: rounded(rankScore(row.salesRank, row.productCount)),
    purchaseRank: rounded(rankScore(row.purchaseRank || row.salesRank, row.productCount)),
    mediumTermStability: rounded(stabilityScore(row, state)),
  };
  const businessImportanceScore = weightedAvailable(businessBreakdown, BUSINESS_IMPORTANCE_WEIGHTS);
  const opportunityBreakdown = {
    efficiency: rounded(efficiencyScore),
    momentum: positiveMomentum === null ? null : rounded(positiveMomentum),
    exposureHeadroom: rounded(exposureHeadroomScore),
    purchaseEvidence: rounded(purchaseEvidenceScore),
    improvementHeadroom,
  };
  const adOpportunityScore = weightedAvailable(opportunityBreakdown, AD_OPPORTUNITY_WEIGHTS);
  const breakdown: BigQueryScoreBreakdown = {
    businessImportance: businessBreakdown,
    adOpportunity: opportunityBreakdown,
    efficiencyScore: rounded(efficiencyScore),
    positiveMomentumScore: positiveMomentum === null ? null : rounded(positiveMomentum),
    recoveryOpportunityScore: rounded(trends.recovery),
    exposureHeadroomScore: rounded(exposureHeadroomScore),
    exposureScaleScore: rounded(exposureScaleScore),
    efficiencyGapScore: rounded(efficiencyGapScore),
    purchaseEvidenceScore: rounded(purchaseEvidenceScore),
  };
  return {
    salesShare,
    purchaseShare,
    state,
    ratio: rawRatio,
    exposureRatio,
    businessImportanceScore,
    adOpportunityScore,
    breakdown,
  };
}

export function detectOfferVariant(productName: string) {
  const name = String(productName || "").normalize("NFKC");
  const matches: Array<[BigQueryOfferVariant, RegExp, string]> = [
    ["two-plus-one", /2\s*\+\s*1/i, "2+1"],
    ["one-plus-one", /1\s*\+\s*1/i, "1+1"],
    ["planning-pack", /기획\s*(?:세트|팩)/i, "기획 구성"],
    ["mix-and-match", /골라\s*담기/i, "골라담기"],
    ["free-shipping", /무료\s*배송/i, "무료배송"],
    ["gift", /증정/i, "증정"],
    ["discount", /할인|특가|쿠폰/i, "할인·특가"],
    ["large-capacity", /대용량/i, "대용량"],
    ["bundle", /묶음|\d+\s*\+\s*\d+/i, "묶음"],
    ["set", /세트|\bset\b/i, "세트"],
  ];
  const found = matches.filter(([, pattern]) => pattern.test(name));
  return {
    variant: found[0]?.[0] || "single" as BigQueryOfferVariant,
    signals: found.map(([, , label]) => label),
  };
}

export function normalizeProductFamilyName(productName: string) {
  const withoutId = String(productName || "")
    .normalize("NFKC")
    .replace(/\([0-9]+\)\s*$/u, "")
    .replace(/\[[^\]]*(?:1\s*\+\s*1|2\s*\+\s*1|세트|특가|증정)[^\]]*\]/giu, " ")
    .replace(/(?:\d+\s*\+\s*\d+|기획\s*세트|기획\s*팩|골라\s*담기|묶음|단품|대용량|할인|특가|증정|무료\s*배송|세트|\bset\b)/giu, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ml|mL|l|L|g|kg|개입|개|팩|병)\b/giu, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return withoutId || String(productName || "").trim();
}

function familyKey(row: BigQueryProductSignalRow) {
  const normalized = normalizeProductFamilyName(row.productName).toLocaleLowerCase("ko-KR");
  return normalized || `product:${row.productIdHint || row.productName}`;
}

export function buildProductFamilies(rows: BigQueryProductSignalRow[]): BigQueryProductFamily[] {
  const groups = new Map<string, BigQueryProductSignalRow[]>();
  for (const row of rows) {
    const key = familyKey(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const brandSales = Math.max(0, ...rows.map((row) => row.brandTotalSales || 0), rows.reduce((sum, row) => sum + row.currentSales, 0));
  const brandPurchases = Math.max(0, ...rows.map((row) => row.brandTotalPurchases || 0), rows.reduce((sum, row) => sum + row.currentPurchases, 0));
  return [...groups.entries()].map(([key, products]) => {
    const sorted = [...products].sort((left, right) => right.currentSales - left.currentSales || right.currentPurchases - left.currentPurchases);
    const totalSales = products.reduce((sum, row) => sum + row.currentSales, 0);
    const totalPurchases = products.reduce((sum, row) => sum + row.currentPurchases, 0);
    const recent4 = products.reduce((sum, row) => sum + (row.recent4WeekSales ?? row.currentSales), 0);
    const previous4 = products.reduce((sum, row) => sum + (row.previous4WeekSales ?? row.previousSales), 0);
    const recent12 = products.reduce((sum, row) => sum + (row.recent12WeekSales || 0), 0);
    const offerRows = sorted.map((row) => ({ row, offer: detectOfferVariant(row.productName) }));
    const topOffer = offerRows.find((item) => item.offer.variant !== "single")?.offer.variant || "single";
    const distinctIds = new Set(products.map((row) => row.productIdHint).filter(Boolean));
    const normalizedChanged = products.some((row) => normalizeProductFamilyName(row.productName) !== row.productName.replace(/\([0-9]+\)\s*$/u, "").trim());
    const matchSource: BigQueryProductFamilyMatchSource =
      products.length > 1 && distinctIds.size === 1 && distinctIds.size > 0
        ? "stable-product-id"
        : products.length > 1 || normalizedChanged
          ? "normalized-product-name"
          : "product-only";
    const trendState = determineTrendState({
      ...sorted[0],
      recent4WeekSales: recent4,
      previous4WeekSales: previous4,
      recent12WeekSales: recent12,
    });
    const hasSingle = offerRows.some((item) => item.offer.variant === "single");
    const hasOffer = offerRows.some((item) => item.offer.variant !== "single");
    const recommendedAction = hasSingle && hasOffer
      ? "기본상품과 혜택상품의 후킹 반응을 함께 비교"
      : hasOffer
        ? "가격·혜택 메시지 반응 가능성 테스트"
        : "상품 USP 중심 후킹 테스트";
    return {
      familyId: `bqf.${stableHash(key)}`,
      familyName: normalizeProductFamilyName(sorted[0].productName),
      products: sorted.map((row) => ({
        productId: row.productIdHint,
        productName: row.productName,
        sales: row.currentSales,
        purchases: row.currentPurchases,
        offerVariant: detectOfferVariant(row.productName).variant,
      })),
      productIds: products.map((row) => row.productIdHint || `name-${stableHash(row.productName)}`),
      productNames: products.map((row) => row.productName),
      totalSales,
      totalPurchases,
      salesShare: brandSales > 0 ? totalSales / brandSales : 0,
      purchaseShare: brandPurchases > 0 ? totalPurchases / brandPurchases : 0,
      topProduct: sorted[0].productName,
      topOfferVariant: topOffer,
      trendState,
      recommendedAction,
      matchSource,
    };
  }).sort((left, right) => right.totalSales - left.totalSales || right.totalPurchases - left.totalPurchases);
}

function familySummary(family: BigQueryProductFamily, row: BigQueryProductSignalRow) {
  const offers = family.productNames.map(detectOfferVariant);
  const hasSingle = offers.some((item) => item.variant === "single");
  const hasOffer = offers.some((item) => item.variant !== "single");
  if (family.productNames.length > 1 && hasSingle && hasOffer) {
    return `${family.familyName} 제품군에서 기본상품과 혜택 구성이 함께 집계되었습니다.`;
  }
  if (hasOffer && !hasSingle) {
    return `${family.familyName} 제품군 판매가 혜택 구성에 집중되어 있습니다.`;
  }
  if (family.productNames.length > 1) {
    return `${family.familyName} 제품군의 ${family.productNames.length}개 구성을 함께 분석했습니다.`;
  }
  return `${row.productName} 상품 단위 집계를 분석했습니다.`;
}

function recommendationScore(type: BigQueryRecommendationType, scored: ReturnType<typeof scoreRow>) {
  const b = scored.breakdown;
  if (type === "core-scale") {
    return weightedAvailable(
      { business: scored.businessImportanceScore, efficiency: b.efficiencyScore, momentum: b.positiveMomentumScore },
      { business: 0.6, efficiency: 0.25, momentum: 0.15 }
    );
  }
  if (type === "core-recovery") {
    return weightedAvailable(
      { business: scored.businessImportanceScore, recovery: b.recoveryOpportunityScore, purchase: b.purchaseEvidenceScore },
      { business: 0.65, recovery: 0.2, purchase: 0.15 }
    );
  }
  if (type === "hidden-potential") {
    return weightedAvailable(
      { efficiency: b.efficiencyScore, exposure: b.exposureHeadroomScore, momentum: b.positiveMomentumScore, purchase: b.purchaseEvidenceScore },
      { efficiency: 0.4, exposure: 0.3, momentum: 0.15, purchase: 0.15 }
    );
  }
  return weightedAvailable(
    { business: scored.businessImportanceScore, exposure: b.exposureScaleScore, gap: b.efficiencyGapScore, recovery: b.recoveryOpportunityScore },
    { business: 0.45, exposure: 0.25, gap: 0.2, recovery: 0.1 }
  );
}

function classify(row: BigQueryProductSignalRow, scored: ReturnType<typeof scoreRow>) {
  const t = BIGQUERY_RECOMMENDATION_THRESHOLDS;
  const businessCore =
    row.currentSales >= t.MIN_SALES_FOR_SCALE &&
    (row.salesRank <= t.CORE_TOP_RANK || scored.salesShare >= t.CORE_SALES_SHARE || scored.purchaseShare >= t.CORE_PURCHASE_SHARE);
  const decline = scored.state === "short-term-decline" || scored.state === "sustained-decline";
  const hidden =
    !businessCore &&
    hasEfficiencySample(row) &&
    scored.ratio !== null &&
    scored.ratio >= t.HIGH_EFFICIENCY_RATIO &&
    scored.exposureRatio < t.LOW_EXPOSURE_RATIO;
  const improvement =
    scored.businessImportanceScore >= 35 &&
    row.currentExposures >= t.MIN_EXPOSURES_FOR_EFFICIENCY &&
    scored.exposureRatio >= t.HIGH_EXPOSURE_RATIO &&
    scored.ratio !== null &&
    scored.ratio < t.LOW_EFFICIENCY_RATIO;
  let primary: BigQueryRecommendationType | null = null;
  if (businessCore && decline) primary = "core-recovery";
  else if (businessCore) primary = "core-scale";
  else if (hidden) primary = "hidden-potential";
  else if (improvement) primary = "creative-improvement";
  const secondary: BigQueryRecommendationType[] = [];
  if (primary !== "hidden-potential" && hidden) secondary.push("hidden-potential");
  if (primary !== "creative-improvement" && improvement) secondary.push("creative-improvement");
  if (primary !== "core-recovery" && businessCore && decline) secondary.push("core-recovery");
  if (primary !== "core-scale" && businessCore && !decline) secondary.push("core-scale");
  return { primary, secondary };
}

function recommendation(
  type: BigQueryRecommendationType,
  row: BigQueryProductSignalRow,
  scored: ReturnType<typeof scoreRow>,
  offerVariant: BigQueryOfferVariant
) {
  const salesShare = `${(scored.salesShare * 100).toFixed(1)}%`;
  if (type === "core-recovery") {
    return {
      reason: `현재 ${row.salesRank}위, 광고주 매출 비중 ${salesShare}의 주력상품입니다. 최근 집계는 이전 기간보다 감소했지만 새로운 후킹으로 반응 회복을 테스트할 가치가 있습니다.`,
      hooks: ["강한 감각형", "문제해결형", "성분·USP형"],
      angles: ["주력상품의 새로운 사용 이유", "기존 우승 소재와 T00 대조", "USP·가격·랜딩 조건 점검"],
      action: "기존 우승 소재를 대조군으로 두고 H01~H06 반응 회복 테스트",
    };
  }
  if (type === "core-scale") {
    const offer = offerVariant !== "single";
    return {
      reason: `현재 매출 ${row.salesRank}위, 광고주 매출 비중 ${salesShare}의 주력상품입니다. 확인된 구매 반응을 더 많은 메시지와 노출에서 확장해 볼 수 있습니다.`,
      hooks: offer ? ["가격·혜택형", "핵심 USP형", "상황형"] : ["핵심 USP형", "신뢰형", "상황형"],
      angles: offer ? ["혜택 구성의 구매 명분", "상품 자체 USP", "노출 확대 후 추가 검증"] : ["검증된 USP 확장", "선택이 모인 이유", "예산·노출 확대 테스트"],
      action: "검증된 USP를 유지하고 후킹별 확장 테스트",
    };
  }
  if (type === "hidden-potential") {
    return {
      reason: `현재 노출은 광고주 평균보다 적지만 노출 대비 구매 반응은 평균보다 높습니다. 새로운 후킹으로 도달을 확대해 추가 성과를 검증할 수 있습니다.`,
      hooks: ["상황형", "궁금증형", "핵심 USP형"],
      angles: ["아직 덜 알려진 사용 이유", "적은 노출에서 확인된 구매 근거", "노출 확대 후 추가 검증"],
      action: "동일 디자인 후킹 실험 후 노출 확대",
    };
  }
  return {
    reason: `판매 기여도가 있는 상품이지만 현재 노출 대비 구매 반응이 광고주 평균보다 낮습니다. 핵심 USP와 구매 이유를 더 명확하게 전달하는 콘텐츠 테스트를 추천합니다.`,
    hooks: ["문제해결형", "핵심 USP형", "가격·혜택형"],
    angles: ["상품이 해결하는 구체적 문제", "경쟁 상품과 구분되는 USP", "가격·랜딩·상품 조건 함께 점검"],
    action: "새 메시지 테스트와 랜딩·가격 조건 점검",
  };
}

function metrics(row: BigQueryProductSignalRow, scored: ReturnType<typeof scoreRow>): BigQueryCandidateMetric[] {
  return [
    { key: "current-sales", label: "최근 매출", value: row.currentSales, previousValue: row.previousSales, unit: "currency", note: "선택한 현재 기간의 집계 매출입니다." },
    { key: "purchase-count", label: "최근 구매", value: row.currentPurchases, previousValue: row.previousPurchases, unit: "count", note: "원본 테이블 PURCHASE_NUM 합계입니다." },
    { key: "sales-rank", label: "광고주 내 매출 순위", value: row.salesRank, previousValue: null, unit: "rank", note: "선택한 광고주의 조회 상품 내 순위입니다." },
    { key: "sales-share", label: "광고주 매출 비중", value: scored.salesShare, previousValue: null, unit: "rate", note: "현재 상품 매출을 광고주 전체 현재 매출로 나눈 값입니다." },
    { key: "purchase-rank", label: "광고주 내 구매 순위", value: row.purchaseRank || row.salesRank, previousValue: null, unit: "rank", note: "선택한 광고주의 조회 상품 내 구매 순위입니다." },
    { key: "purchase-share", label: "광고주 구매 비중", value: scored.purchaseShare, previousValue: null, unit: "rate", note: "현재 상품 구매를 광고주 전체 현재 구매로 나눈 값입니다." },
    { key: "exposures", label: "상품 노출", value: row.currentExposures, previousValue: row.previousExposures, unit: "count", note: "상품 단위 노출 합계입니다." },
    { key: "conversion-rate", label: "노출 대비 구매율", value: row.conversionRate, previousValue: row.brandConversionRate, unit: "rate", note: "상품 구매 수를 상품 노출 수로 나눈 참고 지표입니다." },
    { key: "sales-change", label: "최근 흐름", value: row.previousSales > 0 ? row.salesChangeRate : null, previousValue: null, unit: "rate", note: "증감률은 감점이 아니라 확장·유지·회복 행동을 정하는 신호로 사용합니다." },
  ];
}

export function buildCandidatesFromSignals(rows: BigQueryProductSignalRow[], context: CandidateContext): BigQueryAdCandidate[] {
  const derivedBrandSales = rows.reduce((sum, row) => sum + row.currentSales, 0);
  const derivedBrandPurchases = rows.reduce((sum, row) => sum + row.currentPurchases, 0);
  const families = buildProductFamilies(rows);
  const familyByName = new Map(families.flatMap((family) => family.productNames.map((name) => [name, family] as const)));
  const candidates = rows.map<BigQueryAdCandidate | null>((originalRow) => {
    const row: BigQueryProductSignalRow = {
      ...originalRow,
      brandTotalSales: originalRow.brandTotalSales || derivedBrandSales,
      brandTotalPurchases: originalRow.brandTotalPurchases || derivedBrandPurchases,
      productSalesShare: originalRow.productSalesShare ?? (derivedBrandSales > 0 ? originalRow.currentSales / derivedBrandSales : 0),
      productPurchaseShare: originalRow.productPurchaseShare ?? (derivedBrandPurchases > 0 ? originalRow.currentPurchases / derivedBrandPurchases : 0),
      purchaseRank: originalRow.purchaseRank || originalRow.salesRank,
    };
    const scored = scoreRow(row);
    const classified = classify(row, scored);
    if (!classified.primary) return null;
    const offer = detectOfferVariant(row.productName);
    const family = familyByName.get(row.productName)!;
    const message = recommendation(classified.primary, row, scored, offer.variant);
    const finalScore = recommendationScore(classified.primary, scored);
    return {
      id: context.candidateId(row),
      advertiserId: context.advertiserId,
      source: context.source,
      brandId: context.brandId,
      brandName: context.brandName,
      productId: row.productIdHint,
      productName: row.productName,
      category: context.category,
      productUrl: resolveBigQueryProductUrl({
        source: context.source,
        storeUrl: context.storeUrl,
        productId: row.productIdHint,
      }),
      imageUrl: null,
      primaryType: classified.primary,
      secondaryTypes: classified.secondary,
      score: finalScore,
      recommendationScore: finalScore,
      businessImportanceScore: scored.businessImportanceScore,
      adOpportunityScore: scored.adOpportunityScore,
      scoreBreakdown: scored.breakdown,
      dataSufficiency: "analysis-ready",
      recommendationReason: message.reason,
      metrics: metrics(row, scored),
      currentSales: row.currentSales,
      previousSales: row.previousSales,
      salesChangeRate: row.previousSales > 0 ? row.salesChangeRate : null,
      purchaseCount: row.currentPurchases,
      purchaseRank: row.purchaseRank || null,
      salesRank: row.salesRank,
      salesShare: scored.salesShare,
      purchaseShare: scored.purchaseShare,
      brandTotalSales: row.brandTotalSales || 0,
      brandTotalPurchases: row.brandTotalPurchases || 0,
      exposureCount: row.currentExposures,
      conversionRate: row.conversionRate,
      reviewCount: null,
      analysisPeriodStart: context.analysisPeriodStart,
      analysisPeriodEnd: context.analysisPeriodEnd,
      comparisonPeriodStart: context.comparisonPeriodStart,
      comparisonPeriodEnd: context.comparisonPeriodEnd,
      latestDataDate: row.latestDate,
      sourceTables: [context.sourceTable],
      cautions: [
        "취소·반품 반영 기준은 원본 집계 정의를 따릅니다.",
        "증감률은 성과 원인의 확정이 아니라 다음 광고 행동을 정하는 관찰 신호입니다.",
        "후킹 성과는 실제 광고 실험에서 최종 확인해야 합니다.",
      ],
      recommendedHookTypes: message.hooks,
      recommendedMessageAngles: message.angles,
      recommendedAction: message.action,
      trendState: scored.state,
      trendLabel: trendLabel(scored.state),
      offerVariant: offer.variant,
      offerSignals: offer.signals,
      productFamilyId: family.familyId,
      productFamilyName: family.familyName,
      productFamilyMatchSource: family.matchSource,
      productFamilySummary: familySummary(family, row),
      productMatchConfidence: row.productIdHint ? "source-id-hint" : "temporary-name-key",
    };
  }).filter((candidate): candidate is BigQueryAdCandidate => candidate !== null);

  const groupOrder: Record<BigQueryRecommendationType, number> = {
    "core-scale": 0,
    "core-recovery": 0,
    "hidden-potential": 1,
    "creative-improvement": 2,
  };
  return candidates.sort((left, right) =>
    groupOrder[left.primaryType] - groupOrder[right.primaryType] ||
    right.recommendationScore - left.recommendationScore ||
    right.businessImportanceScore - left.businessImportanceScore ||
    (right.currentSales || 0) - (left.currentSales || 0) ||
    (right.purchaseCount || 0) - (left.purchaseCount || 0)
  );
}
