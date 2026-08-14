import type {
  BigQueryAdCandidate,
  BigQueryCandidateMetric,
  BigQueryCandidateType,
} from "./types";

// Missing indicators are omitted and the remaining weights are re-normalized.
export const BIGQUERY_CANDIDATE_WEIGHTS = {
  salesScale: 0.3,
  salesGrowth: 0.25,
  conversionEfficiency: 0.25,
  exposureOpportunity: 0.1,
  purchaseEvidence: 0.1,
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
  salesRank: number;
  productCount: number;
  latestDate: string;
};

type CandidateContext = {
  advertiserId: string;
  source: "host24" | "hostmk";
  brandId: string | null;
  brandName: string;
  category: string | null;
  analysisPeriodStart: string;
  analysisPeriodEnd: string;
  comparisonPeriodStart: string;
  comparisonPeriodEnd: string;
  sourceTable: string;
  candidateId: (row: BigQueryProductSignalRow) => string;
};

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function weightedScore(
  indicators: Partial<Record<keyof typeof BIGQUERY_CANDIDATE_WEIGHTS, number>>
) {
  let weighted = 0;
  let usedWeight = 0;
  for (const [key, weight] of Object.entries(BIGQUERY_CANDIDATE_WEIGHTS) as Array<
    [keyof typeof BIGQUERY_CANDIDATE_WEIGHTS, number]
  >) {
    const value = indicators[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    weighted += clamp(value) * weight;
    usedWeight += weight;
  }
  return usedWeight ? Math.round((weighted / usedWeight) * 100) : 0;
}

function candidateTypes(row: BigQueryProductSignalRow): BigQueryCandidateType[] {
  const result: BigQueryCandidateType[] = [];
  const rate = row.conversionRate;
  const brandRate = row.brandConversionRate;
  const topRankThreshold = Math.max(3, Math.min(10, Math.ceil(row.productCount * 0.1)));

  if (row.previousSales > 0 && (row.salesChangeRate ?? 0) >= 0.15) result.push("sales-rising");
  if (row.currentSales > 0 && row.salesRank <= topRankThreshold) result.push("bestseller");
  if (rate !== null && brandRate !== null && row.currentPurchases >= 3 && rate >= brandRate * 1.2) {
    result.push("exposure-efficient");
  }
  if (
    rate !== null &&
    brandRate !== null &&
    row.currentPurchases >= 3 &&
    row.currentExposures < row.averageExposures * 0.7 &&
    rate >= brandRate * 1.2
  ) {
    result.push("exposure-potential");
  }
  if (
    rate !== null &&
    brandRate !== null &&
    row.currentExposures > row.averageExposures * 1.2 &&
    rate < brandRate * 0.75
  ) {
    result.push("improvement-needed");
  }
  return result;
}

const typePriority: BigQueryCandidateType[] = [
  "improvement-needed",
  "sales-rising",
  "exposure-potential",
  "exposure-efficient",
  "bestseller",
  "review-strength",
  "new-product",
  "price-competitive",
];

function recommendation(type: BigQueryCandidateType, row: BigQueryProductSignalRow) {
  if (type === "sales-rising") {
    return {
      reason: `이전 동기간 대비 집계 매출이 ${Math.round((row.salesChangeRate ?? 0) * 100)}% 상승해 반응 확대 가능성을 확인할 후보입니다.`,
      hooks: ["궁금증형", "상황제안형", "핵심 USP형"],
      angles: ["최근 선택이 늘어난 이유", "지금 반응이 붙은 사용 상황", "상품의 핵심 효용"],
    };
  }
  if (type === "bestseller") {
    return {
      reason: `조회 가능한 ${row.productCount}개 상품 중 집계 매출 ${row.salesRank}위로, 실제 선택 근거를 앞세울 후보입니다.`,
      hooks: ["사회적증거형", "후기/리뷰형", "핵심 USP형"],
      angles: ["판매 상위 상품의 선택 이유", "구매가 모인 핵심 효용", "대표 상품 신뢰 근거"],
    };
  }
  if (type === "exposure-efficient") {
    return {
      reason: "상품 노출 대비 구매율이 같은 광고주의 조회 기간 평균보다 높아 효율 근거를 확장해 볼 후보입니다.",
      hooks: ["핵심 USP형", "상황제안형", "후기/리뷰형"],
      angles: ["구매로 이어지는 구체적 효용", "사용 상황별 필요성", "선택을 돕는 신뢰 근거"],
    };
  }
  if (type === "exposure-potential") {
    return {
      reason: "노출은 평균보다 적지만 노출 대비 구매율이 높아 더 많은 도달에서 검증할 잠재 후보입니다.",
      hooks: ["궁금증형", "상황제안형", "핵심 USP형"],
      angles: ["아직 덜 알려진 효용", "반응이 좋은 사용 맥락", "낮은 노출에서 확인된 구매 근거"],
    };
  }
  return {
    reason: "노출은 많지만 노출 대비 구매율이 평균보다 낮아 문제 해결형 또는 USP형 메시지 검증이 필요한 후보입니다.",
    hooks: ["문제제기형", "핵심 USP형", "공감형"],
    angles: ["구매를 망설이는 이유 해소", "경쟁 상품과 구분되는 효용", "랜딩·가격·상품 조건 함께 점검"],
  };
}

function metrics(row: BigQueryProductSignalRow): BigQueryCandidateMetric[] {
  return [
    {
      key: "current-sales",
      label: "최근 집계 매출",
      value: row.currentSales,
      previousValue: row.previousSales,
      unit: "currency",
      note: "취소·반품 반영 기준이 확인되지 않은 집계 매출입니다.",
    },
    {
      key: "sales-change",
      label: "이전 동기간 대비",
      value: row.previousSales > 0 ? row.salesChangeRate : null,
      previousValue: null,
      unit: "rate",
      note: row.previousSales > 0 ? "동일 길이의 직전 기간과 비교했습니다." : "비교 기간 매출이 없어 변화율을 계산하지 않았습니다.",
    },
    {
      key: "purchase-count",
      label: "구매 수",
      value: row.currentPurchases,
      previousValue: row.previousPurchases,
      unit: "count",
      note: "원본 테이블의 PURCHASE_NUM 합계입니다.",
    },
    {
      key: "sales-rank",
      label: "조회 상품 내 매출 순위",
      value: row.salesRank,
      previousValue: null,
      unit: "rank",
      note: "전체 시장 순위가 아니라 해당 광고주의 조회 가능한 상품 내 순위입니다.",
    },
    {
      key: "exposures",
      label: "상품 노출",
      value: row.currentExposures,
      previousValue: row.previousExposures,
      unit: "count",
      note: "상품 단위 노출 합계입니다.",
    },
    {
      key: "conversion-rate",
      label: "노출 대비 구매율",
      value: row.conversionRate,
      previousValue: row.brandConversionRate,
      unit: "rate",
      note: "구매 수를 상품 노출 수로 나눈 참고 지표입니다.",
    },
  ];
}

export function buildCandidatesFromSignals(
  rows: BigQueryProductSignalRow[],
  context: CandidateContext
): BigQueryAdCandidate[] {
  return rows
    .map<BigQueryAdCandidate | null>((row) => {
      const detectedTypes = candidateTypes(row);
      if (!detectedTypes.length) return null;
      const primaryType = typePriority.find((type) => detectedTypes.includes(type)) || detectedTypes[0];
      const rateRatio =
        row.conversionRate !== null && row.brandConversionRate
          ? row.conversionRate / row.brandConversionRate
          : undefined;
      const score = weightedScore({
        salesScale:
          row.productCount > 1 ? 1 - (row.salesRank - 1) / (row.productCount - 1) : 1,
        salesGrowth:
          row.previousSales > 0 && row.salesChangeRate !== null
            ? clamp((row.salesChangeRate + 0.25) / 1.25)
            : undefined,
        conversionEfficiency: rateRatio === undefined ? undefined : clamp(rateRatio / 2),
        exposureOpportunity:
          row.averageExposures > 0
            ? clamp(1 - row.currentExposures / (row.averageExposures * 2))
            : undefined,
        purchaseEvidence: clamp(Math.log10(row.currentPurchases + 1) / 3),
      });
      const message = recommendation(primaryType, row);
      const cautions = [
        "후보 점수는 현재 사용할 수 있는 지표만 재정규화해 계산했습니다.",
        "취소·반품 반영 기준이 확인되지 않아 집계 매출 기준으로 표시합니다.",
        "원본 상품 집계가 전체 상품이 아닌 상위 또는 수집 가능한 일부 상품일 수 있습니다.",
        "테이블별 업데이트 주기가 달라 최신 기준일이 다른 데이터와 직접 합쳐지지 않았습니다.",
      ];
      if (!row.productIdHint) {
        cautions.push("안정적인 상품 ID가 없어 정규화한 상품명으로만 식별했습니다.");
      } else {
        cautions.push("상품명 끝 숫자를 원본 소스의 상품 ID 힌트로 사용했으며 상세페이지에서 확인이 필요합니다.");
      }

      return {
        id: context.candidateId(row),
        advertiserId: context.advertiserId,
        source: context.source,
        brandId: context.brandId,
        brandName: context.brandName,
        productId: row.productIdHint,
        productName: row.productName,
        category: context.category,
        productUrl: null,
        imageUrl: null,
        primaryType,
        secondaryTypes: detectedTypes.filter((type) => type !== primaryType),
        score,
        dataSufficiency: "analysis-ready",
        recommendationReason: message.reason,
        metrics: metrics(row),
        currentSales: row.currentSales,
        previousSales: row.previousSales,
        salesChangeRate: row.previousSales > 0 ? row.salesChangeRate : null,
        purchaseCount: row.currentPurchases,
        salesRank: row.salesRank,
        exposureCount: row.currentExposures,
        conversionRate: row.conversionRate,
        reviewCount: null,
        analysisPeriodStart: context.analysisPeriodStart,
        analysisPeriodEnd: context.analysisPeriodEnd,
        comparisonPeriodStart: context.comparisonPeriodStart,
        comparisonPeriodEnd: context.comparisonPeriodEnd,
        latestDataDate: row.latestDate,
        sourceTables: [context.sourceTable],
        cautions,
        recommendedHookTypes: message.hooks,
        recommendedMessageAngles: message.angles,
        productMatchConfidence: row.productIdHint ? "source-id-hint" : "temporary-name-key",
      };
    })
    .filter((candidate): candidate is BigQueryAdCandidate => candidate !== null)
    .sort((left, right) => right.score - left.score || (left.salesRank ?? 9999) - (right.salesRank ?? 9999));
}
