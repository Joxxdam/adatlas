import { aggregateProductMetrics, isoDateShift, latestMetricDate } from "./aggregation.ts";
import { clampScore, percentile, safeChangeRate, safeDivide, smoothedConversionRate, weightedAvailableScore } from "./math.ts";
import type { AnalysisRun, DataQualityReport, OpportunityEvidence, OpportunityRecommendation, Product, ProductDailyMetric, ProductOpportunity, ProductOpportunityType, ReviewInsight } from "./types.ts";

export const OPPORTUNITY_ALGORITHM_VERSION = "opportunity-engine-v1";

export type OpportunityRuleConfig = {
  minimumProductViews: number;
  minimumOrders: number;
  minimumAnalysisDays: number;
  priorStrength: number;
  risingGrowthThreshold: number;
  highConversionPercentile: number;
  lowExposurePercentile: number;
  highInterestPercentile: number;
  lowConversionPercentile: number;
  highRefundRateThreshold: number;
  lowStockThreshold: number;
  minimumConfidenceForScale: number;
};

export const defaultOpportunityRuleConfig: OpportunityRuleConfig = {
  minimumProductViews: 10,
  minimumOrders: 2,
  minimumAnalysisDays: 7,
  priorStrength: 20,
  risingGrowthThreshold: 0.3,
  highConversionPercentile: 0.75,
  lowExposurePercentile: 0.25,
  highInterestPercentile: 0.75,
  lowConversionPercentile: 0.25,
  highRefundRateThreshold: 0.25,
  lowStockThreshold: 1,
  minimumConfidenceForScale: 65,
};

type ProductSignals = ReturnType<typeof signalForProduct>;

function ratioScore(value: number | null, baseline: number | null, positive = true) {
  if (value === null || baseline === null || baseline <= 0) return null;
  const ratio = value / baseline;
  return clampScore(50 + (positive ? 1 : -1) * (ratio - 1) * 50);
}

function signalForProduct(params: { product: Product; current: ReturnType<typeof aggregateProductMetrics>[number] | undefined; previous: ReturnType<typeof aggregateProductMetrics>[number] | undefined; medians: Record<string, number | null>; upper: Record<string, number | null>; insights: ReviewInsight[]; periodEnd: string }) {
  const { product, current, previous, medians, upper, insights } = params;
  const currentCvr = current?.viewToOrderRate ?? null;
  const categoryCvr = medians.viewToOrderRate;
  const smoothedCvr = smoothedConversionRate({
    orders: current?.paidOrders ?? null,
    views: current?.views ?? null,
    categoryRate: categoryCvr,
    priorStrength: 20,
  });
  const positiveInsights = insights.filter((insight) => insight.polarity === "positive");
  const negativeInsights = insights.filter((insight) => insight.polarity === "negative");
  const daysSinceFirstSeen = Math.max(0, Math.round((new Date(`${params.periodEnd}T00:00:00Z`).getTime() - new Date(product.firstSeenAt).getTime()) / 86400000));
  return {
    product,
    current,
    previous,
    currentCvr,
    smoothedCvr,
    orderChange: safeChangeRate(current?.paidOrders ?? null, previous?.paidOrders ?? null),
    viewChange: safeChangeRate(current?.views ?? null, previous?.views ?? null),
    revenueChange: safeChangeRate(current?.revenue ?? null, previous?.revenue ?? null),
    reviewAverage: current?.averageRating ?? null,
    positiveInsights,
    negativeInsights,
    medians,
    upper,
    daysSinceFirstSeen,
    repeatRate: safeDivide(current?.repeatOrders ?? null, current?.paidOrders ?? null),
  };
}

function evidence(params: { metric: string; label: string; current: number | null; previous?: number | null; median?: number | null; unit?: OpportunityEvidence["unit"]; source?: OpportunityEvidence["source"] }): OpportunityEvidence {
  const changeRate = safeChangeRate(params.current, params.previous ?? null);
  const formatted = params.current === null ? "데이터 없음" : params.unit === "rate" ? `${(params.current * 100).toFixed(1)}%` : params.current.toLocaleString("ko-KR");
  return {
    metric: params.metric,
    label: params.label,
    current: params.current,
    previous: params.previous ?? null,
    categoryMedian: params.median ?? null,
    changeRate,
    unit: params.unit || "count",
    source: params.source || "derived",
    message: `${params.label} ${formatted}${changeRate === null ? "" : ` · 이전 기간 대비 ${(changeRate * 100).toFixed(1)}%`}`,
  };
}

const recommendations: Record<ProductOpportunityType, OpportunityRecommendation> = {
  HIDDEN_WINNER: { objective: "구매 전환 확대", hookTypes: ["price-value", "usp-proof"], messageAngles: ["적은 노출에서도 확인된 전환", "핵심 효용"], imageDirection: "상품과 핵심 USP를 크게", promotionSuggestion: null, rationale: ["노출 대비 전환 효율이 높습니다."] },
  RISING_PRODUCT: { objective: "상승세 확장", hookTypes: ["urgency", "social-proof"], messageAngles: ["최근 반응 상승", "지금 주목할 이유"], imageDirection: "상승 흐름과 상품 사용 장면", promotionSuggestion: null, rationale: ["최근 기간 주문이 이전 기간보다 증가했습니다."] },
  SCALE_CANDIDATE: { objective: "예산 확장 테스트", hookTypes: ["proof-data", "product-hero"], messageAngles: ["검증된 판매 반응", "대표 혜택"], imageDirection: "대표 상품과 근거를 명확히", promotionSuggestion: null, rationale: ["판매 규모와 효율이 함께 확인됩니다."] },
  UNDEREXPOSED: { objective: "신규 도달 확보", hookTypes: ["problem-solution", "review"], messageAngles: ["후기에서 발견한 장점", "인지되지 않은 효용"], imageDirection: "후기 키워드와 실사용 장면", promotionSuggestion: null, rationale: ["상품 반응에 비해 조회 기회가 적습니다."] },
  HIGH_INTEREST_LOW_CONVERSION: { objective: "구매 장벽 해소", hookTypes: ["comparison", "objection"], messageAngles: ["선택 기준", "구매 전 걱정 해소"], imageDirection: "비교와 정보 위계 중심", promotionSuggestion: "구매 장벽을 줄이는 혜택 검토", rationale: ["관심 대비 구매 전환이 낮습니다."] },
  CART_ABANDONMENT: {
    objective: "장바구니 이탈 회수",
    hookTypes: ["urgency", "price-value"],
    messageAngles: ["결정을 미룬 이유 해소", "구성·가격 확인"],
    imageDirection: "가격·구성·CTA를 선명하게",
    promotionSuggestion: "기간과 사실이 확인된 혜택만 적용",
    rationale: ["장바구니 이후 주문 전환이 낮습니다."],
  },
  REVIEW_POWERED: { objective: "후기 근거 확장", hookTypes: ["review-ugc", "social-proof"], messageAngles: ["후기 반복 장점", "실사용 만족"], imageDirection: "실제 상품과 후기형 레이아웃", promotionSuggestion: null, rationale: ["평점과 긍정 후기 근거가 충분합니다."] },
  REVIEW_RISK: { objective: "오해 방지·기대치 조정", hookTypes: ["faq", "transparent"], messageAngles: ["사용 전 확인사항", "적합한 고객"], imageDirection: "과장 없이 안내형 구성", promotionSuggestion: null, rationale: ["부정 후기 신호를 먼저 해소해야 합니다."] },
  REPEAT_PURCHASE: { objective: "재구매 가치 강조", hookTypes: ["routine", "value"], messageAngles: ["꾸준히 쓰는 이유", "일상 루틴"], imageDirection: "반복 사용 장면", promotionSuggestion: "반복 구매 구성을 검토", rationale: ["재구매 주문 비중이 확인됩니다."] },
  BUNDLE_CANDIDATE: { objective: "객단가 확대", hookTypes: ["bundle-value", "usage"], messageAngles: ["함께 쓰는 구성", "묶음 가치"], imageDirection: "복수 구성과 사용 맥락", promotionSuggestion: "실제 판매 가능한 묶음 구성을 검토", rationale: ["주문·반복구매 신호가 묶음 테스트에 적합합니다."] },
  NEW_PRODUCT_TEST: { objective: "신상품 학습", hookTypes: ["new", "problem-solution"], messageAngles: ["새로운 선택지", "첫 사용 이유"], imageDirection: "상품을 크게 보여주는 단순한 테스트 소재", promotionSuggestion: null, rationale: ["출시 초기라 다양한 가설 테스트가 필요합니다."] },
  DECLINING_BESTSELLER: { objective: "하락 원인 재검증", hookTypes: ["refresh", "review"], messageAngles: ["기존 인기 이유 재발견", "최근 구매 장벽"], imageDirection: "기존 강점과 새 장면 조합", promotionSuggestion: null, rationale: ["이전 판매 규모 대비 최근 반응이 하락했습니다."] },
  INVENTORY_OPPORTUNITY: {
    objective: "재고 소진 테스트",
    hookTypes: ["product-hero", "price-value"],
    messageAngles: ["상품 핵심 가치", "구성 안내"],
    imageDirection: "재고 수치를 노출하지 않고 상품 효용 중심",
    promotionSuggestion: "실제 승인된 프로모션이 있을 때만 적용",
    rationale: ["재고와 낮은 노출이 함께 확인됩니다."],
  },
  EXCLUDE_FROM_ADS: { objective: "광고 제외", hookTypes: [], messageAngles: ["광고 집행 전 상태 확인"], imageDirection: "생성하지 않음", promotionSuggestion: null, rationale: ["품절·비노출·데이터 위험 등 제외 조건입니다."] },
};

function opportunity(params: { type: ProductOpportunityType; title: string; score: number; confidence: number; signals: ProductSignals; analysisRunId: string; evidence: OpportunityEvidence[]; now: string }): ProductOpportunity {
  const product = params.signals.product;
  const score = clampScore(params.score);
  const confidence = clampScore(params.confidence);
  return {
    id: `opp-${params.analysisRunId}-${product.id}-${params.type.toLowerCase()}`,
    advertiserId: product.advertiserId,
    productId: product.id,
    analysisRunId: params.analysisRunId,
    type: params.type,
    title: params.title,
    score,
    confidence,
    status: params.type === "EXCLUDE_FROM_ADS" ? "excluded" : "recommended",
    evidence: params.evidence,
    recommendation: recommendations[params.type],
    createdAt: params.now,
    updatedAt: params.now,
    primaryType: params.type,
    secondaryTypes: [],
    opportunityScore: score,
    confidenceScore: confidence,
    recommendationStatus: params.type === "EXCLUDE_FROM_ADS" ? "rejected" : "detected",
    summary: params.title,
    risks: params.type === "EXCLUDE_FROM_ADS" || params.type === "REVIEW_RISK" ? [params.title] : [],
    recommendedAction: recommendations[params.type].objective,
    recommendedHookTypes: recommendations[params.type].hookTypes,
    recommendedObjective: recommendations[params.type].objective,
    analysisPeriodStart: params.signals.current?.startsOn || "",
    analysisPeriodEnd: params.signals.current?.endsOn || "",
    comparisonPeriodStart: params.signals.previous?.startsOn || "",
    comparisonPeriodEnd: params.signals.previous?.endsOn || "",
    scoringVersion: OPPORTUNITY_ALGORITHM_VERSION,
  };
}

function detect(signal: ProductSignals, analysisRunId: string, quality: DataQualityReport, now: string, config: OpportunityRuleConfig) {
  const { product, current, previous, medians, upper } = signal;
  const results: ProductOpportunity[] = [];
  const dataFactors = [current?.views, current?.paidOrders, current?.revenue, signal.reviewAverage, current?.stockCount];
  const confidence = clampScore(35 + dataFactors.filter((value) => value !== null && value !== undefined).length * 10 + quality.score * 0.15);
  const ev = {
    views: evidence({ metric: "views", label: "조회", current: current?.views ?? null, previous: previous?.views, median: medians.views }),
    orders: evidence({ metric: "paidOrders", label: "결제 주문", current: current?.paidOrders ?? null, previous: previous?.paidOrders, median: medians.paidOrders }),
    revenue: evidence({ metric: "revenue", label: "매출", current: current?.revenue ?? null, previous: previous?.revenue, median: medians.revenue, unit: "currency" }),
    cvr: evidence({ metric: "smoothedCvr", label: "보정 조회→주문율", current: signal.smoothedCvr, median: medians.viewToOrderRate, unit: "rate" }),
    cartRate: evidence({ metric: "viewToCartRate", label: "조회→장바구니율", current: current?.viewToCartRate ?? null, median: medians.viewToCartRate, unit: "rate" }),
    cartOrder: evidence({ metric: "cartToOrderRate", label: "장바구니→주문율", current: current?.cartToOrderRate ?? null, median: medians.cartToOrderRate, unit: "rate" }),
    rating: evidence({ metric: "averageRating", label: "평균 평점", current: signal.reviewAverage, median: medians.averageRating, unit: "score" }),
    stock: evidence({ metric: "stockCount", label: "재고", current: current?.stockCount ?? product.stockCount, median: medians.stockCount }),
  };

  const dataError = quality.issues.some((issue) => issue.severity === "error" && issue.productId === product.id);
  const reviewRisk = signal.reviewAverage !== null && signal.reviewAverage < 3 && signal.negativeInsights.length >= 2;
  const refundRisk = current?.refundRate !== null && current?.refundRate !== undefined && current.refundRate >= config.highRefundRateThreshold;
  const excluded = product.display === false || /sold|품절|중지|숨김/i.test(product.status || "") || (product.stockCount !== null && product.stockCount <= config.lowStockThreshold) || reviewRisk || refundRisk || dataError || (product.margin !== null && product.margin <= 0) || !product.url;
  if (excluded) {
    const excludedOpportunity = opportunity({
      type: "EXCLUDE_FROM_ADS",
      title: "재고·환불·리뷰·상품 상태 확인 후 광고 제외",
      score: 100,
      confidence,
      signals: signal,
      analysisRunId,
      evidence: [ev.stock, ev.rating, evidence({ metric: "refundRate", label: "환불률", current: current?.refundRate ?? null, unit: "rate" })],
      now,
    });
    excludedOpportunity.secondaryTypes = reviewRisk ? ["REVIEW_RISK"] : [];
    excludedOpportunity.risks = [product.stockCount !== null && product.stockCount <= config.lowStockThreshold ? "재고 부족" : "", reviewRisk ? "반복 부정 후기와 낮은 평점" : "", refundRisk ? "높은 환불률" : "", dataError ? "데이터 오류" : "", !product.url ? "상품 URL 누락" : "", product.margin !== null && product.margin <= 0 ? "마진 부족" : ""].filter(Boolean);
    return [excludedOpportunity];
  }

  if (signal.daysSinceFirstSeen <= 28 && (current?.paidOrders ?? 0) < Math.max(3, medians.paidOrders ?? 3)) {
    results.push(opportunity({ type: "NEW_PRODUCT_TEST", title: "신상품 가설 테스트", score: 78, confidence, signals: signal, analysisRunId, evidence: [evidence({ metric: "daysSinceFirstSeen", label: "첫 수집 후 경과일", current: signal.daysSinceFirstSeen, unit: "days" }), ev.orders], now }));
  }
  if (current?.views !== null && current?.views !== undefined && medians.views !== null && current.views < medians.views * 0.75 && signal.smoothedCvr !== null && upper.viewToOrderRate !== null && signal.smoothedCvr >= upper.viewToOrderRate && (current.paidOrders ?? 0) > 0) {
    const score =
      weightedAvailableScore([
        { value: ratioScore(signal.smoothedCvr, upper.viewToOrderRate), weight: 0.7 },
        { value: ratioScore(medians.views, Math.max(1, current.views)), weight: 0.3 },
      ]) ?? 70;
    results.push(opportunity({ type: "HIDDEN_WINNER", title: "적은 노출에서 전환이 확인된 숨은 상품", score, confidence, signals: signal, analysisRunId, evidence: [ev.views, ev.cvr, ev.orders], now }));
  }
  if (signal.orderChange !== null && signal.orderChange >= config.risingGrowthThreshold && (current?.paidOrders ?? 0) >= config.minimumOrders) {
    results.push(opportunity({ type: "RISING_PRODUCT", title: "최근 주문 반응 상승", score: 72 + Math.min(25, signal.orderChange * 20), confidence, signals: signal, analysisRunId, evidence: [ev.orders, ev.views], now }));
  }
  if (confidence >= config.minimumConfidenceForScale && (current?.paidOrders ?? -1) >= (upper.paidOrders ?? Infinity) && signal.smoothedCvr !== null && signal.smoothedCvr >= (medians.viewToOrderRate ?? Infinity)) {
    results.push(opportunity({ type: "SCALE_CANDIDATE", title: "판매 규모와 효율이 함께 확인된 확장 후보", score: 88, confidence, signals: signal, analysisRunId, evidence: [ev.orders, ev.revenue, ev.cvr], now }));
  }
  if ((current?.views ?? Infinity) < (medians.views ?? -Infinity) * 0.7 && ((signal.reviewAverage ?? 0) >= 4.3 || signal.positiveInsights.length > 0)) {
    results.push(opportunity({ type: "UNDEREXPOSED", title: "후기 반응 대비 노출 부족", score: 76, confidence, signals: signal, analysisRunId, evidence: [ev.views, ev.rating], now }));
  }
  if ((current?.views ?? -1) >= (upper.views ?? Infinity) && signal.smoothedCvr !== null && signal.smoothedCvr < (medians.viewToOrderRate ?? -Infinity) * 0.7) {
    results.push(opportunity({ type: "HIGH_INTEREST_LOW_CONVERSION", title: "관심은 높지만 구매 장벽이 큰 상품", score: 82, confidence, signals: signal, analysisRunId, evidence: [ev.views, ev.cvr], now }));
  }
  if (current?.viewToCartRate !== null && current?.viewToCartRate !== undefined && current?.cartToOrderRate !== null && current?.cartToOrderRate !== undefined && current.viewToCartRate > (upper.viewToCartRate ?? Infinity) && current.cartToOrderRate < (medians.cartToOrderRate ?? -Infinity) * 0.7) {
    results.push(opportunity({ type: "CART_ABANDONMENT", title: "장바구니 이후 이탈이 큰 상품", score: 83, confidence, signals: signal, analysisRunId, evidence: [ev.cartRate, ev.cartOrder], now }));
  }
  if ((signal.reviewAverage ?? 0) >= 4.5 && ((current?.reviewCount ?? 0) >= 3 || signal.positiveInsights.length > 0)) {
    results.push(opportunity({ type: "REVIEW_POWERED", title: "후기 근거가 강한 광고 후보", score: 80, confidence, signals: signal, analysisRunId, evidence: [ev.rating, evidence({ metric: "reviewCount", label: "후기", current: current?.reviewCount ?? null })], now }));
  }
  if ((signal.reviewAverage !== null && signal.reviewAverage < 3.5) || signal.negativeInsights.length >= 2) {
    results.push(opportunity({ type: "REVIEW_RISK", title: "부정 후기 장벽 선해결 필요", score: 86, confidence, signals: signal, analysisRunId, evidence: [ev.rating, evidence({ metric: "negativeInsights", label: "부정 후기 주제", current: signal.negativeInsights.length })], now }));
  }
  if ((signal.repeatRate ?? 0) >= 0.25 && (current?.repeatOrders ?? 0) >= 2) {
    results.push(opportunity({ type: "REPEAT_PURCHASE", title: "재구매 가치가 확인된 상품", score: 79, confidence, signals: signal, analysisRunId, evidence: [evidence({ metric: "repeatRate", label: "재구매 주문 비중", current: signal.repeatRate, unit: "rate" }), ev.orders], now }));
  }
  if ((signal.repeatRate ?? 0) >= 0.2 && (current?.paidOrders ?? 0) >= (medians.paidOrders ?? Infinity)) {
    results.push(opportunity({ type: "BUNDLE_CANDIDATE", title: "묶음 구성 테스트 후보", score: 71, confidence, signals: signal, analysisRunId, evidence: [ev.orders, evidence({ metric: "repeatRate", label: "재구매 주문 비중", current: signal.repeatRate, unit: "rate" })], now }));
  }
  if ((previous?.paidOrders ?? -1) >= (upper.paidOrders ?? Infinity) && (signal.orderChange ?? 0) <= -0.3) {
    results.push(opportunity({ type: "DECLINING_BESTSELLER", title: "기존 판매 상품의 최근 하락", score: 84, confidence, signals: signal, analysisRunId, evidence: [ev.orders, ev.revenue], now }));
  }
  if ((current?.stockCount ?? product.stockCount ?? -1) >= (upper.stockCount ?? Infinity) && (current?.views ?? Infinity) < (medians.views ?? -Infinity)) {
    results.push(opportunity({ type: "INVENTORY_OPPORTUNITY", title: "재고 대비 노출이 낮은 상품", score: 74, confidence, signals: signal, analysisRunId, evidence: [ev.stock, ev.views], now }));
  }
  return results;
}

export function runOpportunityAnalysis(params: { advertiserId: string; products: Product[]; metrics: ProductDailyMetric[]; insights: ReviewInsight[]; qualityReport: DataQualityReport; periodDays?: 1 | 7 | 14 | 28; now?: string; ruleConfig?: Partial<OpportunityRuleConfig> }) {
  const now = params.now || new Date().toISOString();
  const periodDays = params.periodDays || 14;
  const ruleConfig = { ...defaultOpportunityRuleConfig, ...(params.ruleConfig || {}) };
  const currentEndsOn = latestMetricDate(params.metrics, new Date(now));
  const currentStartsOn = isoDateShift(currentEndsOn, -(periodDays - 1));
  const previousEndsOn = isoDateShift(currentStartsOn, -1);
  const previousStartsOn = isoDateShift(previousEndsOn, -(periodDays - 1));
  const runId = `analysis-${params.advertiserId}-${now.replace(/\D/g, "").slice(0, 14)}`;
  const current = aggregateProductMetrics(params.metrics, currentStartsOn, currentEndsOn);
  const previous = aggregateProductMetrics(params.metrics, previousStartsOn, previousEndsOn);
  const value = (field: keyof (typeof current)[number]) => current.map((metric) => (typeof metric[field] === "number" ? (metric[field] as number) : null));
  const medians = {
    views: percentile(value("views"), 0.5),
    paidOrders: percentile(value("paidOrders"), 0.5),
    revenue: percentile(value("revenue"), 0.5),
    viewToOrderRate: percentile(value("viewToOrderRate"), 0.5),
    viewToCartRate: percentile(value("viewToCartRate"), 0.5),
    cartToOrderRate: percentile(value("cartToOrderRate"), 0.5),
    averageRating: percentile(value("averageRating"), 0.5),
    stockCount: percentile(value("stockCount"), 0.5),
  };
  const upper = {
    views: percentile(value("views"), 0.75),
    paidOrders: percentile(value("paidOrders"), 0.75),
    revenue: percentile(value("revenue"), 0.75),
    viewToOrderRate: percentile(value("viewToOrderRate"), 0.75),
    viewToCartRate: percentile(value("viewToCartRate"), 0.75),
    cartToOrderRate: percentile(value("cartToOrderRate"), 0.75),
    averageRating: percentile(value("averageRating"), 0.75),
    stockCount: percentile(value("stockCount"), 0.75),
  };
  const rawOpportunities = params.products
    .flatMap((product) =>
      detect(
        signalForProduct({
          product,
          current: current.find((metric) => metric.productId === product.id),
          previous: previous.find((metric) => metric.productId === product.id),
          medians,
          upper,
          insights: params.insights.filter((insight) => insight.productId === product.id),
          periodEnd: currentEndsOn,
        }),
        runId,
        params.qualityReport,
        now,
        ruleConfig
      )
    )
    .sort((left, right) => right.score - left.score);
  const grouped = new Map<string, ProductOpportunity[]>();
  for (const item of rawOpportunities) {
    const values = grouped.get(item.productId) || [];
    values.push(item);
    grouped.set(item.productId, values);
  }
  const opportunities = Array.from(grouped.values(), (items) => {
    const [primary, ...secondary] = items.sort((left, right) => right.score - left.score);
    const secondaryTypes = Array.from(new Set([...primary.secondaryTypes, ...secondary.flatMap((item) => [item.type, ...item.secondaryTypes])]));
    const combinedEvidence = Array.from(new Map(items.flatMap((item) => item.evidence).map((item) => [item.metric, item])).values()).slice(0, 8);
    return {
      ...primary,
      secondaryTypes,
      evidence: combinedEvidence,
      risks: Array.from(new Set(items.flatMap((item) => item.risks))),
      summary: [primary.title, secondaryTypes.length ? `보조 신호: ${secondaryTypes.join(", ")}` : ""].filter(Boolean).join(" · "),
    };
  }).sort((left, right) => right.score - left.score);
  const run: AnalysisRun = {
    id: runId,
    advertiserId: params.advertiserId,
    status: "completed",
    periodDays,
    currentStartsOn,
    currentEndsOn,
    previousStartsOn,
    previousEndsOn,
    productCount: params.products.length,
    opportunityIds: opportunities.map((item) => item.id),
    qualityReportId: params.qualityReport.id,
    algorithmVersion: OPPORTUNITY_ALGORITHM_VERSION,
    createdAt: now,
    completedAt: now,
  };
  return { run, opportunities, current, previous, medians, upper };
}
