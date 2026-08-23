import type { CreativeOpportunityContext } from "../creative-content-notes/types.ts";

export const cremaConnectionStatuses = ["crema_connected", "crema_partial", "crema_disconnected", "crema_error"] as const;
export type CremaConnectionStatus = (typeof cremaConnectionStatuses)[number];
export type CremaInputProvider = "crema_api" | "file_upload" | "development_fixture";

export const productOpportunityTypes = ["HIDDEN_WINNER", "RISING_PRODUCT", "SCALE_CANDIDATE", "UNDEREXPOSED", "HIGH_INTEREST_LOW_CONVERSION", "CART_ABANDONMENT", "REVIEW_POWERED", "REVIEW_RISK", "REPEAT_PURCHASE", "BUNDLE_CANDIDATE", "NEW_PRODUCT_TEST", "DECLINING_BESTSELLER", "INVENTORY_OPPORTUNITY", "EXCLUDE_FROM_ADS"] as const;
export type ProductOpportunityType = (typeof productOpportunityTypes)[number];

export type Advertiser = {
  id: string;
  name: string;
  brandName: string;
  domain: string | null;
  timezone: "Asia/Seoul";
  connectionStatus: CremaConnectionStatus;
  provider: CremaInputProvider | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type Product = {
  id: string;
  advertiserId: string;
  externalId: string | null;
  code: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  url: string | null;
  imageUrl: string | null;
  originalPrice: number | null;
  finalPrice: number | null;
  stockCount: number | null;
  status: string | null;
  display: boolean | null;
  createdAt: string | null;
  firstSeenAt: string;
  updatedAt: string;
  provenance: Record<string, CremaInputProvider>;
  cremaProductId: string | null;
  productCode: string | null;
  productName: string;
  sellingPrice: number | null;
  discountPrice: number | null;
  cost: number | null;
  margin: number | null;
  stockQuantity: number | null;
  productUrl: string | null;
  representativeImageUrl: string | null;
  registeredAt: string | null;
};

export type ProductDailyMetric = {
  advertiserId: string;
  productId: string;
  date: string;
  impressions: number | null;
  views: number | null;
  cartAdds: number | null;
  paidOrders: number | null;
  paidQuantity: number | null;
  revenue: number | null;
  refunds: number | null;
  refundAmount: number | null;
  repeatOrders: number | null;
  stockCount: number | null;
  reviewCount: number | null;
  photoReviewCount: number | null;
  ratingSum: number | null;
  ratingCount: number | null;
  source: CremaInputProvider;
  id?: string;
  productImpressions?: number | null;
  uniqueVisitors?: number | null;
  checkoutStarts?: number | null;
  grossRevenue?: number | null;
  cancelledOrders?: number | null;
  cancelledQuantity?: number | null;
  cancelledRevenue?: number | null;
  refundedOrders?: number | null;
  refundedRevenue?: number | null;
  netOrders?: number | null;
  netQuantity?: number | null;
  netRevenue?: number | null;
  stockQuantity?: number | null;
  newCustomers?: number | null;
  returningCustomers?: number | null;
  newReviewCount?: number | null;
  averageRating?: number | null;
  createdAt?: string;
  updatedAt?: string;
  fieldProvenance?: Record<string, CremaInputProvider>;
};

export type ProductWeeklyMetric = {
  advertiserId: string;
  productId: string;
  startsOn: string;
  endsOn: string;
  impressions: number | null;
  views: number | null;
  cartAdds: number | null;
  paidOrders: number | null;
  paidQuantity: number | null;
  revenue: number | null;
  refunds: number | null;
  viewToCartRate: number | null;
  cartToOrderRate: number | null;
  viewToOrderRate: number | null;
};

export type ProductReviewMetric = {
  advertiserId: string;
  productId: string;
  date: string;
  reviewCount: number | null;
  photoReviewCount: number | null;
  averageRating: number | null;
  positiveCount: number | null;
  negativeCount: number | null;
};

export type ReviewInsight = {
  id: string;
  advertiserId: string;
  productId: string;
  polarity: "positive" | "negative" | "mixed";
  topic: string;
  summary: string;
  evidenceCount: number;
  averageRating: number | null;
  sourceReviewIds: string[];
  createdAt: string;
  mentionShare?: number | null;
  confidence?: number;
  analysisStartsOn?: string | null;
  analysisEndsOn?: string | null;
};

export type CremaMarketSyncJob = {
  id: string;
  advertiserId: string;
  provider: CremaInputProvider;
  status: "queued" | "running" | "completed" | "partial" | "failed";
  startedAt: string;
  completedAt: string | null;
  productsRead: number;
  metricsRead: number;
  reviewsRead: number;
  warnings: string[];
  error: string | null;
};

export type DataQualityIssue = {
  code: string;
  severity: "info" | "warning" | "error";
  productId: string | null;
  field: string | null;
  message: string;
};

export type DataQualityReport = {
  id: string;
  advertiserId: string;
  runAt: string;
  score: number;
  completeness: Record<string, number>;
  issues: DataQualityIssue[];
  usableForAnalysis: boolean;
};

export type OpportunityEvidence = {
  metric: string;
  label: string;
  current: number | null;
  previous: number | null;
  categoryMedian: number | null;
  changeRate: number | null;
  unit: "count" | "currency" | "rate" | "score" | "days";
  source: CremaInputProvider | "derived";
  message: string;
};

export type OpportunityRecommendation = {
  objective: string;
  hookTypes: string[];
  messageAngles: string[];
  imageDirection: string;
  promotionSuggestion: string | null;
  rationale: string[];
};

export type ProductOpportunity = {
  id: string;
  advertiserId: string;
  productId: string;
  analysisRunId: string;
  type: ProductOpportunityType;
  title: string;
  score: number;
  confidence: number;
  status: "recommended" | "later" | "excluded" | "creative_generated";
  evidence: OpportunityEvidence[];
  recommendation: OpportunityRecommendation;
  createdAt: string;
  updatedAt: string;
  primaryType: ProductOpportunityType;
  secondaryTypes: ProductOpportunityType[];
  opportunityScore: number;
  confidenceScore: number;
  recommendationStatus: "detected" | "reviewed" | "accepted" | "rejected" | "creative_requested" | "creative_generated" | "archived";
  summary: string;
  risks: string[];
  recommendedAction: string;
  recommendedHookTypes: string[];
  recommendedObjective: string;
  analysisPeriodStart: string;
  analysisPeriodEnd: string;
  comparisonPeriodStart: string;
  comparisonPeriodEnd: string;
  scoringVersion: string;
};

export type AnalysisRun = {
  id: string;
  advertiserId: string;
  status: "running" | "completed" | "failed";
  periodDays: 1 | 7 | 14 | 28;
  currentStartsOn: string;
  currentEndsOn: string;
  previousStartsOn: string;
  previousEndsOn: string;
  productCount: number;
  opportunityIds: string[];
  qualityReportId: string;
  algorithmVersion: string;
  createdAt: string;
  completedAt: string | null;
};

export type CremaMarketDataset = {
  advertiser: Advertiser;
  products: Product[];
  dailyMetrics: ProductDailyMetric[];
  weeklyMetrics: ProductWeeklyMetric[];
  reviewMetrics: ProductReviewMetric[];
  reviewInsights: ReviewInsight[];
  syncJobs: CremaMarketSyncJob[];
  qualityReports: DataQualityReport[];
  analysisRuns: AnalysisRun[];
  opportunities: ProductOpportunity[];
  updatedAt: string;
};

export type CremaMarketImport = {
  advertiser: Omit<Advertiser, "connectionStatus" | "provider" | "lastSyncedAt" | "lastError">;
  products: Product[];
  dailyMetrics: ProductDailyMetric[];
  reviewMetrics: ProductReviewMetric[];
  reviewInsights: ReviewInsight[];
  warnings: string[];
};

export type OpportunityCreationHandoff = {
  creativeContext: CreativeOpportunityContext;
  opportunity: ProductOpportunity;
  product: Product;
};
