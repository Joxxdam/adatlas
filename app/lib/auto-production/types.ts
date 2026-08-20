import type { ProductInfoForPrompt } from "../mvp/types";
import type { GenerationResultStatus, HookMessageCode } from "../creative-generation/types";

export const autoProductionRoles = [
  "core-expansion",
  "low-exposure-opportunity",
  "reactivation",
  "new-exploration",
] as const;

export type AutoProductionRole = (typeof autoProductionRoles)[number];
export type AutoProductionDataSource = "auto" | "bigquery" | "crema" | "site" | "admin";
export type AutoProductionVisibilityMode =
  | "site-visible-only"
  | "include-crema-ad"
  | "admin-only";

export type AutoProductionAdvertiserConfig = {
  advertiserId: string;
  advertiserName: string;
  aliases: string[];
  enabled: boolean;
  timezone: "Asia/Seoul";
  scheduleTime: string;
  scheduleDays: number[];
  productsPerRun: number;
  creativesPerProduct: number;
  fullHookTestForNewProducts: boolean;
  productCooldownDays: number;
  hookCooldownDays: number;
  maxImagesPerRun: number;
  dataSource: AutoProductionDataSource;
  bigQueryBrandMatch: string;
  siteUrl: string;
  excludedProductIds: string[];
  excludedCategories: string[];
  requiredProductIds: string[];
  adminProductUrls: string[];
  productVisibilityMode: AutoProductionVisibilityMode;
  selectionPriorities: AutoProductionRole[];
  adObjective: "purchase" | "signup" | "awareness" | "retargeting";
  explorationRatio: number;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
};

export type AutoProductionProductCandidate = {
  id: string;
  externalId?: string | null;
  advertiserId: string;
  productName: string;
  productUrl: string;
  category: string;
  imageUrl: string;
  source: "bigquery" | "crema" | "site" | "admin";
  sourceReason: string;
  recommendationRole: AutoProductionRole;
  recommendationReason: string;
  verifiedEvidence: string[];
  recommendedHookDirections: string[];
  selectionScore: number;
  currentSales: number | null;
  previousSales: number | null;
  orders: number | null;
  revenue: number | null;
  impressions: number | null;
  views: number | null;
  conversionRate: number | null;
  reviewCount: number | null;
  rating: number | null;
  isNew: boolean;
  isSeasonal: boolean;
  siteVisible: boolean | null;
  soldOut: boolean;
  productInfo: ProductInfoForPrompt;
};

export type AutoHookHypothesis = {
  code: HookMessageCode;
  hookType: string;
  primaryTag?: string;
  mainHook: string;
  subCopy: string;
  messageHypothesis: string;
  customerInsight: string;
  productEvidence: string[];
  recommendedScene: string;
  selectionReason: string;
};

export const autoProductionRunStatuses = [
  "scheduled",
  "selecting-products",
  "analyzing-products",
  "generating-hooks",
  "queued",
  "generating-creatives",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "skipped",
] as const;
export type AutoProductionRunStatus = (typeof autoProductionRunStatuses)[number];

export const autoProductionProductStatuses = [
  "selected",
  "analyzing",
  "hooks-ready",
  "queued",
  "generating",
  "completed",
  "failed",
  "skipped-duplicate",
  "skipped-insufficient-data",
  "skipped-unavailable",
] as const;
export type AutoProductionProductStatus = (typeof autoProductionProductStatuses)[number];

export type AutoProductionResult = {
  generationResultId: string;
  hookCode: HookMessageCode;
  status: GenerationResultStatus;
  imageUrl?: string;
  downloadUrl?: string;
  assetCode?: string;
  adName?: string;
  utm?: string;
  createdAt?: string;
};

export type AutoProductionProductTask = {
  id: string;
  candidate: AutoProductionProductCandidate;
  status: AutoProductionProductStatus;
  selectedRole: AutoProductionRole;
  selectedReason: string;
  hookHypotheses: AutoHookHypothesis[];
  selectedHookCode?: HookMessageCode;
  hookSelectionReason?: string;
  generationJobId?: string;
  results: AutoProductionResult[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type AutoProductionRun = {
  id: string;
  runKey: string;
  trigger: "scheduled" | "manual" | "cli";
  businessDate: string;
  advertiserId: string;
  advertiserName: string;
  status: AutoProductionRunStatus;
  dataSourceUsed?: AutoProductionProductCandidate["source"];
  fallbackUsed: boolean;
  fallbackReason?: string;
  automaticExpectedImages?: number;
  expectedImages: number;
  completedImages: number;
  failedImages: number;
  tasks: AutoProductionProductTask[];
  warnings: string[];
  errors: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type AutoProductionPreview = {
  advertiserId: string;
  advertiserName: string;
  source: AutoProductionProductCandidate["source"] | "none";
  fallbackUsed: boolean;
  fallbackReason?: string;
  expectedImages: number;
  candidates: AutoProductionProductCandidate[];
  warnings: string[];
};

export type AutoProductionNotification = {
  level: "progress" | "success" | "warning";
  message: string;
  href: string;
};

export type AutoProductionDashboardStatus = {
  nextRunAt?: string;
  activeAdvertiserCount: number;
  plannedProductCount: number;
  completedTodayCount: number;
  failedTodayCount: number;
  activeRunCount: number;
  maxImagesPerDay: number;
  paused: boolean;
  notification?: AutoProductionNotification;
};
