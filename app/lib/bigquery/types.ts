export const bigQueryCandidatePeriods = ["4w", "8w", "12w"] as const;
export type BigQueryCandidatePeriod = (typeof bigQueryCandidatePeriods)[number];

export const bigQueryCandidateTypes = [
  "core-scale",
  "core-recovery",
  "hidden-potential",
  "creative-improvement",
  "sales-rising",
  "bestseller",
  "review-strength",
  "exposure-efficient",
  "exposure-potential",
  "improvement-needed",
  "new-product",
  "price-competitive",
] as const;
export type BigQueryCandidateType = (typeof bigQueryCandidateTypes)[number];
export const bigQueryRecommendationTypes = [
  "core-scale",
  "core-recovery",
  "hidden-potential",
  "creative-improvement",
] as const;
export type BigQueryRecommendationType = (typeof bigQueryRecommendationTypes)[number];

export type BigQueryTrendState =
  | "strong-growth"
  | "growth"
  | "stable"
  | "short-term-decline"
  | "sustained-decline"
  | "insufficient-period-data";

export type BigQueryOfferVariant =
  | "single"
  | "one-plus-one"
  | "two-plus-one"
  | "set"
  | "planning-pack"
  | "bundle"
  | "large-capacity"
  | "discount"
  | "free-shipping"
  | "gift"
  | "mix-and-match";

export type BigQueryProductFamilyMatchSource =
  | "stable-product-id"
  | "normalized-product-name"
  | "product-only";

export type BigQueryProductFamily = {
  familyId: string;
  familyName: string;
  products: Array<{
    productId: string | null;
    productName: string;
    sales: number;
    purchases: number;
    offerVariant: BigQueryOfferVariant;
  }>;
  productIds: string[];
  productNames: string[];
  totalSales: number;
  totalPurchases: number;
  salesShare: number;
  purchaseShare: number;
  topProduct: string;
  topOfferVariant: BigQueryOfferVariant;
  trendState: BigQueryTrendState;
  recommendedAction: string;
  matchSource: BigQueryProductFamilyMatchSource;
};

export type BigQueryScoreBreakdown = {
  businessImportance: {
    salesShare: number;
    purchaseShare: number;
    salesRank: number;
    purchaseRank: number;
    mediumTermStability: number;
  };
  adOpportunity: {
    efficiency: number;
    momentum: number | null;
    exposureHeadroom: number;
    purchaseEvidence: number;
    improvementHeadroom: number;
  };
  efficiencyScore: number;
  positiveMomentumScore: number | null;
  recoveryOpportunityScore: number;
  exposureHeadroomScore: number;
  exposureScaleScore: number;
  efficiencyGapScore: number;
  purchaseEvidenceScore: number;
};

export type BigQueryAvailability =
  | "analysis-ready"
  | "reference-only"
  | "data-insufficient"
  | "connection-required";

export type BigQueryErrorCode =
  | "auth-unavailable"
  | "permission-denied"
  | "table-not-found"
  | "location-mismatch"
  | "cost-limit"
  | "query-timeout"
  | "read-only-violation"
  | "invalid-request"
  | "query-failed";

export type BigQueryConnectionStatus = {
  connected: boolean;
  projectId: string;
  location: string;
  readOnly: true;
  datasets: string[];
  datasetCount: number;
  checkedAt: string;
  errorCode?: BigQueryErrorCode;
  message?: string;
};

export type BigQueryAdvertiser = {
  id: string;
  source: "host24" | "hostmk";
  name: string;
  brandId: string | null;
  category: string | null;
  storeUrl: string | null;
  latestDataDate: string;
  productCount: number;
  brandMatchConfidence: "exact" | "unmatched";
};

export type BigQueryCandidateCapability = {
  type: BigQueryRecommendationType;
  availability: BigQueryAvailability;
  reason: string;
  sourceTables: string[];
};

export type BigQueryCandidateMetric = {
  key:
    | "current-sales"
    | "sales-change"
    | "purchase-count"
    | "sales-rank"
    | "purchase-rank"
    | "sales-share"
    | "purchase-share"
    | "exposures"
    | "conversion-rate"
    | "review-count";
  label: string;
  value: number | null;
  previousValue: number | null;
  unit: "currency" | "count" | "rate" | "rank";
  note: string;
};

export type BigQueryAdCandidate = {
  id: string;
  advertiserId: string;
  source: "host24" | "hostmk";
  brandId: string | null;
  brandName: string;
  productId: string | null;
  productName: string;
  category: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  primaryType: BigQueryRecommendationType;
  secondaryTypes: BigQueryRecommendationType[];
  score: number;
  recommendationScore: number;
  businessImportanceScore: number;
  adOpportunityScore: number;
  scoreBreakdown: BigQueryScoreBreakdown;
  dataSufficiency: BigQueryAvailability;
  recommendationReason: string;
  metrics: BigQueryCandidateMetric[];
  currentSales: number | null;
  previousSales: number | null;
  salesChangeRate: number | null;
  purchaseCount: number | null;
  purchaseRank: number | null;
  salesRank: number | null;
  salesShare: number;
  purchaseShare: number;
  brandTotalSales: number;
  brandTotalPurchases: number;
  exposureCount: number | null;
  conversionRate: number | null;
  reviewCount: number | null;
  analysisPeriodStart: string;
  analysisPeriodEnd: string;
  comparisonPeriodStart: string;
  comparisonPeriodEnd: string;
  latestDataDate: string;
  sourceTables: string[];
  cautions: string[];
  recommendedHookTypes: string[];
  recommendedMessageAngles: string[];
  recommendedAction: string;
  trendState: BigQueryTrendState;
  trendLabel: string;
  offerVariant: BigQueryOfferVariant;
  offerSignals: string[];
  productFamilyId: string;
  productFamilyName: string;
  productFamilyMatchSource: BigQueryProductFamilyMatchSource;
  productFamilySummary: string;
  productMatchConfidence: "source-id-hint" | "temporary-name-key";
};

export type BigQueryCandidateResponse = {
  candidates: BigQueryAdCandidate[];
  productFamilies: BigQueryProductFamily[];
  typeCounts: Record<BigQueryRecommendationType, number>;
  advertiser: BigQueryAdvertiser;
  period: BigQueryCandidatePeriod;
  latestDataDate: string;
  capabilities: BigQueryCandidateCapability[];
  partial: boolean;
  processedBytes: number;
  cacheHit: boolean;
  generatedAt: string;
};
