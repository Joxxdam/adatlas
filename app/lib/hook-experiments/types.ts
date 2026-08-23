import type { ProductInfoForPrompt } from "../mvp/types";

export const experimentObjectives = ["AWR", "TRF", "SLS", "ENG", "ETC"] as const;
export type ExperimentObjective = (typeof experimentObjectives)[number];

export const experimentStages = ["DISCOVERY", "VALIDATION", "REFINEMENT"] as const;
export type ExperimentStage = (typeof experimentStages)[number];

export const experimentStatuses = ["draft", "generating", "ready_for_registration", "running", "analyzing", "additional_data_required", "completed"] as const;
export type ExperimentStatus = (typeof experimentStatuses)[number];

export const experimentHookCodes = ["SEN", "CUR", "PRB", "BRD", "PRC", "REV", "USP", "EMP", "URG", "VAL", "EVT", "RPT", "CRT", "BND", "NEW", "GRW", "CTL"] as const;
export type ExperimentHookCode = (typeof experimentHookCodes)[number];

export type VisualExpressionType = "COPY_INFORMATION" | "SCENE_VISUAL" | "PRODUCT_HERO" | "USAGE_SCENE" | "INFORMATION_FOCUS" | "TRUST_PROOF" | "PROMOTION_VISUAL" | "PROBLEM_EMPATHY";

export type HookRecommendation = {
  hookType: string;
  hookCode: ExperimentHookCode;
  label: string;
  mainMessage: string;
  hypothesis: string;
  recommendationReason: string;
  eligible: boolean;
  warnings: string[];
  factIds: string[];
};

export type ExperimentRuleConfig = {
  minimumSpend: number;
  minimumImpressions: number;
  minimumClicks: number;
  minimumLandingPageViews: number;
  minimumPurchases: number;
  maximumSpendImbalanceRatio: number;
  maximumSingleAssetSpendShare: number;
  minimumEligibleAssetsPerHook: number;
};

export type MetaTestMode = "SINGLE_BATCH" | "BALANCED_BATCH" | "EQUAL_ADSETS";

export type MetaTestPlan = {
  campaignObjective: ExperimentObjective;
  campaignName: string;
  adsetName: string;
  target: string;
  placements: string;
  attributionSetting: string;
  startDate?: string;
  endDate?: string;
  budgetPerHook?: number;
  assetsPerHook: number;
  testMode: MetaTestMode;
  manager?: string;
  notes?: string;
  batches: Array<{ label: string; hookCodes: ExperimentHookCode[] }>;
};

export type CreativeExperiment = {
  id: string;
  experimentCode: string;
  advertiserId: string;
  advertiserName: string;
  brandId: string;
  brandName: string;
  brandCode: string;
  categoryId: string;
  productId: string;
  originalHostProductNo: string;
  product: ProductInfoForPrompt;
  objective: ExperimentObjective;
  stage: ExperimentStage;
  testRound: number;
  status: ExperimentStatus;
  parentExperimentId?: string;
  generationJobId?: string;
  hookCount: number;
  variantsPerHook: number;
  totalAssetCount: number;
  useControl: boolean;
  contentNoteIds: string[];
  ruleConfig: ExperimentRuleConfig;
  metaTestPlan: MetaTestPlan;
  startDate?: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
};

export type HookGroup = {
  id: string;
  experimentId: string;
  hookType: string;
  hookCode: ExperimentHookCode;
  categoryCode: string;
  hypothesis: string;
  recommendationReason: string;
  primaryTag?: string;
  secondaryTags?: string[];
  customerReason?: string;
  status: "planned" | "generated" | "testing" | "additional_data_required" | "ranked";
  rank?: number;
  isWinner: boolean;
  stability?: "STABLE_WINNER" | "SINGLE_ASSET_WINNER" | "UNSTABLE" | "INSUFFICIENT_DATA";
  createdAt: string;
  updatedAt: string;
};

export type ExperimentAsset = {
  id: string;
  experimentId: string;
  assetId?: string;
  assetCode?: string;
  generationResultId: string;
  hookGroupId: string;
  hookCode: ExperimentHookCode;
  hookType: string;
  mainMessage: string;
  variant: string;
  visualDirection: VisualExpressionType;
  hypothesisId?: string;
  primaryTag?: string;
  secondaryTags?: string[];
  customerReason?: string;
  isControl: boolean;
  hostingRegistrationStatus: "not_registered" | "registered" | "failed";
  registeredHostProductNo?: string;
  cremaCollectionStatus: "not_requested" | "pending" | "collected" | "failed";
  catalogProductId?: string;
  productMatchStatus: "not_checked" | "matched" | "needs_review" | "not_found";
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

export type PerformanceMatchStatus = "matched" | "needs_review" | "code_missing" | "duplicate_code" | "asset_not_found";

export type PerformanceRecord = {
  id: string;
  experimentId: string;
  assetId?: string;
  assetCode?: string;
  hookGroupId?: string;
  advertiserId?: string;
  productId?: string;
  category?: string;
  subCategory?: string;
  hookCode?: string;
  hypothesisId?: string;
  primaryTag?: string;
  secondaryTags?: string[];
  creativeId?: string;
  creativeCode?: string;
  visualConcept?: string;
  platform: "META" | "GOOGLE" | "OTHER";
  objective: ExperimentObjective;
  campaignId?: string;
  campaignName: string;
  adsetId?: string;
  adsetName: string;
  adId: string;
  adName: string;
  dateStart: string;
  dateEnd: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  clicks: number | null;
  linkClicks: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
  engagements: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  cpm?: number | null;
  ctr?: number | null;
  outboundCtr?: number | null;
  cpc?: number | null;
  costPerLandingPageView?: number | null;
  cvr?: number | null;
  cpa?: number | null;
  roas?: number | null;
  dataSufficiency?: string;
  resultStatus?: "validated-winner" | "promising" | "loser" | "needs-more-data";
  matchStatus: PerformanceMatchStatus;
  matchMessage?: string;
  importedAt: string;
  source: string;
};

export type AggregatedMetrics = {
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  frequency: number | null;
  cpm: number | null;
  clicks: number | null;
  linkClicks: number | null;
  outboundClicks: number | null;
  landingPageViews: number | null;
  ctr: number | null;
  outboundCtr: number | null;
  cpc: number | null;
  costPerLandingPageView: number | null;
  landingPageArrivalRate: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  engagements: number | null;
  engagementRate: number | null;
  costPerEngagement: number | null;
};

export type HookPerformanceResult = {
  hookGroupId: string;
  hookCode: ExperimentHookCode;
  hookType: string;
  metrics: AggregatedMetrics;
  connectedAssetCount: number;
  eligibleAssetCount: number;
  topAssetCode?: string;
  bottomAssetCode?: string;
  spendConcentration: number | null;
  medianPrimaryMetric: number | null;
  primaryMetric: string;
  primaryMetricValue: number | null;
  eligible: boolean;
  warnings: string[];
  rank?: number;
  stability: "STABLE_WINNER" | "SINGLE_ASSET_WINNER" | "UNSTABLE" | "INSUFFICIENT_DATA";
};

export type ExperimentAnalysis = {
  experimentId: string;
  objective: ExperimentObjective;
  stage: ExperimentStage;
  comparable: boolean;
  needsMoreData: boolean;
  warnings: string[];
  groups: HookPerformanceResult[];
  selectedHookCodes: ExperimentHookCode[];
  winnerHookCode?: ExperimentHookCode;
  analyzedAt: string;
};

export type ObjectiveHookInsight = {
  id: string;
  advertiserId: string;
  categoryId: string;
  productId: string;
  objective: ExperimentObjective;
  hookType: string;
  hookCode: ExperimentHookCode;
  experimentCount: number;
  eligibleExperimentCount: number;
  assetCount: number;
  medianLift: number | null;
  averageLift: number | null;
  confidenceScore: number;
  status: "EXPLORATION" | "EARLY_SIGNAL" | "REPEATED" | "VERIFIED";
  lastUpdatedAt: string;
};

export type HookExperimentStore = {
  version: "hook-experiments-v1";
  experiments: CreativeExperiment[];
  hookGroups: HookGroup[];
  experimentAssets: ExperimentAsset[];
  performanceRecords: PerformanceRecord[];
  analyses: ExperimentAnalysis[];
  insights: ObjectiveHookInsight[];
};

export type CreateExperimentInput = {
  advertiserId?: string;
  advertiserName?: string;
  brandId?: string;
  brandName?: string;
  categoryId?: string;
  productId?: string;
  originalHostProductNo: string;
  product: ProductInfoForPrompt;
  objective: ExperimentObjective;
  stage?: ExperimentStage;
  parentExperimentId?: string;
  selectedHookCodes?: ExperimentHookCode[];
  variantsPerHook?: number;
  useControl?: boolean;
  ruleConfig?: Partial<ExperimentRuleConfig>;
  metaTestPlan?: Partial<MetaTestPlan>;
};

export type CreateExperimentPlanResult = {
  experiment: CreativeExperiment;
  hookGroups: HookGroup[];
  experimentAssets: ExperimentAsset[];
  recommendations: HookRecommendation[];
};
