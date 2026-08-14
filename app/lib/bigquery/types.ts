export const bigQueryCandidatePeriods = ["4w", "8w", "12w"] as const;
export type BigQueryCandidatePeriod = (typeof bigQueryCandidatePeriods)[number];

export const bigQueryCandidateTypes = [
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
  type: BigQueryCandidateType;
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
  primaryType: BigQueryCandidateType;
  secondaryTypes: BigQueryCandidateType[];
  score: number;
  dataSufficiency: BigQueryAvailability;
  recommendationReason: string;
  metrics: BigQueryCandidateMetric[];
  currentSales: number | null;
  previousSales: number | null;
  salesChangeRate: number | null;
  purchaseCount: number | null;
  salesRank: number | null;
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
  productMatchConfidence: "source-id-hint" | "temporary-name-key";
};

export type BigQueryCandidateResponse = {
  candidates: BigQueryAdCandidate[];
  advertiser: BigQueryAdvertiser;
  period: BigQueryCandidatePeriod;
  latestDataDate: string;
  capabilities: BigQueryCandidateCapability[];
  partial: boolean;
  processedBytes: number;
  cacheHit: boolean;
  generatedAt: string;
};
