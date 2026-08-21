export type MetaOperation =
  | "connection"
  | "accounts"
  | "campaigns"
  | "adsets"
  | "ads"
  | "insights"
  | "media.upload"
  | "adset.create"
  | "creative.create"
  | "ad.create";

export type MetaAccount = {
  id: string;
  name: string;
  currency: string;
  timezoneName: string;
};

export type MetaCampaign = {
  id: string;
  accountId: string;
  name: string;
  objective: string;
  status: string;
  budgetMode: "ABO" | "CBO";
  isAdvantagePlus?: boolean;
  specialAdCategories?: string[];
};

export type MetaBaselineAdSet = {
  id: string;
  accountId: string;
  campaignId: string;
  name: string;
  targeting: Record<string, unknown>;
  placements: string[];
  promotedObject: {
    pixelId?: string;
    datasetId?: string;
    customEventType?: string;
  };
  optimizationGoal: string;
  billingEvent: string;
  attributionSpec?: Array<Record<string, unknown>>;
};

export type MetaAdvertiserAssetMap = {
  advertiserId: string;
  advertiserName: string;
  adAccountIds: string[];
  pageId?: string;
  instagramActorId?: string;
  pixelId?: string;
  datasetId?: string;
  defaultCampaignId?: string;
  defaultBaselineAdSetId?: string;
};

export type MetaCreativeDraft = {
  hookCode: `H0${1 | 2 | 3 | 4 | 5 | 6}`;
  materialCode: string;
  mediaPath: string;
  mediaHash?: string;
  mediaType: "image" | "video";
  mediaRatio: string;
  primaryText: string;
  headline: string;
  description: string;
  landingUrl: string;
  utm: string;
  approved: boolean;
};

export type MetaDraftRegistrationInput = {
  requestKey: string;
  advertiserId: string;
  advertiserName: string;
  productId: string;
  productName: string;
  testRound: number;
  adAccount: MetaAccount;
  campaign: MetaCampaign;
  baselineAdSet: MetaBaselineAdSet;
  pageId: string;
  instagramActorId?: string;
  pixelId?: string;
  datasetId?: string;
  conversionEvent: "PURCHASE";
  creatives: MetaCreativeDraft[];
};

export type MetaBudgetResolution = {
  ok: boolean;
  display: string;
  currency: string;
  dailyBudgetMinor?: number;
  reason?: string;
};

export type MetaPreflightResult = {
  ok: boolean;
  status: "ready" | "blocked" | "safety_verification_incomplete";
  checks: Array<{ key: string; label: string; ok: boolean; detail: string }>;
  budget: MetaBudgetResolution;
  draft: {
    adSetName: string;
    adSetStatus: "PAUSED";
    adStatuses: "PAUSED";
    ctaLabel: "지금 구매하기";
    ctaEnum: "SHOP_NOW";
    featurePolicy: "ALL_AUTOMATIONS_OFF";
  };
  payloadHash: string;
};

export type MetaRegistrationItem = {
  hookCode: string;
  materialCode: string;
  status: "success" | "failed" | "safety_verification_incomplete";
  mediaId?: string;
  creativeId?: string;
  adId?: string;
  error?: string;
};

export type MetaRegistrationJob = {
  id: string;
  requestKey: string;
  advertiserId: string;
  productId: string;
  adAccountId: string;
  campaignId: string;
  baselineAdSetId: string;
  adSetId?: string;
  status: "pending" | "success" | "partial" | "failed" | "safety_verification_incomplete";
  items: MetaRegistrationItem[];
  createdAt: string;
  updatedAt: string;
};

export type MetaInsightSnapshot = {
  adId: string;
  dateStart: string;
  dateStop: string;
  impressions: number;
  reach: number;
  spend: number;
  clicks: number;
  outboundClicks: number;
  landingPageViews: number;
  purchases: number;
  purchaseValue: number;
  fetchedAt: string;
};

export type PerformanceHookRow = {
  hookCode: string;
  materialCode: string;
  adId: string;
  adName: string;
  impressions: number;
  spend: number;
  outboundClicks: number;
  landingPageViews: number;
  purchases: number;
  purchaseValue: number;
  ctr: number;
  cpc: number;
  cpa: number;
  roas: number;
  spendShare: number;
  status: string;
};

export type PerformanceExperiment = {
  id: string;
  advertiserId: string;
  advertiserName: string;
  productId: string;
  productName: string;
  landingUrl?: string;
  testRound?: number;
  source?: "meta" | "legacy-hook-experiment";
  adAccountId: string;
  adAccountName: string;
  currency: string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  metaStatus: string;
  trackingEnabled: boolean;
  trackingStatus: "draft" | "prelaunch" | "collecting" | "completed" | "archived" | "error";
  lastRequestedAt?: string;
  lastSuccessfulAt?: string;
  timezoneName: string;
  attributionSetting: string;
  rows: PerformanceHookRow[];
};
