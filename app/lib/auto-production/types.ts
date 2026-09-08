import type { ProductInfoForPrompt } from "../mvp/types";
import type { GenerationResultStatus, HookMessageCode, ReferenceCategoryOverride } from "../creative-generation/types";
import type { ProductAdCopy } from "../ad-copy/types";

export const autoProductionRoles = ["core-expansion", "low-exposure-opportunity", "reactivation", "new-exploration"] as const;

export type AutoProductionRole = (typeof autoProductionRoles)[number];
export type AutoProductionDataSource = "auto" | "bigquery" | "crema" | "site" | "admin";
export type AutoProductionVisibilityMode = "site-visible-only" | "include-crema-ad" | "admin-only";

export type AutoProductionProductImageSelection = {
  productUrl: string;
  /** 이 상품의 광고 레퍼런스를 뽑을 풀. 없으면 상품 분석으로 자동 판정 */
  referenceCategoryOverride?: ReferenceCategoryOverride;
  /** Codex 직접 제작 프롬프트의 두 번째 첨부 이미지 */
  productImagePath: string;
  /** 선택 사항: 라벨 또는 분위기 참고용 세 번째 첨부 이미지 */
  supportingImagePath?: string;
  /** 선택 사항: 포장상품 참고용 네 번째 첨부 이미지 */
  packagingImagePath?: string;
  /** 선택 사항: 기본 이미지 생성 프롬프트 마지막에 덧붙일 상품별 지시 */
  additionalInstructions?: string;
};

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
  productFamilyCooldownDays: number;
  hookCooldownDays: number;
  maxImagesPerRun: number;
  dataSource: AutoProductionDataSource;
  bigQueryBrandMatch: string;
  siteUrl: string;
  excludedProductIds: string[];
  excludedCategories: string[];
  requiredProductIds: string[];
  adminProductUrls: string[];
  productImageSelections: AutoProductionProductImageSelection[];
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
  productCode?: string | null;
  sku?: string | null;
  canonicalProductUrl?: string;
  productFamilyKey?: string;
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
  imageVerificationStatus?: "verified" | "needs-review" | "rejected";
  imageVerificationReasons?: string[];
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
  targetCustomer: string;
  customerSituation: string;
  productEvidence: string[];
  verifiedEvidence: string[];
  intendedReaction: string;
  visualConcept: string;
  recommendedScene: string;
  selectionReason: string;
  prohibitedClaims: string[];
};

export const autoProductionRunStatuses = ["scheduled", "selecting-products", "analyzing-products", "generating-hooks", "queued", "generating-creatives", "completed", "partial", "failed", "cancelled", "skipped"] as const;
export type AutoProductionRunStatus = (typeof autoProductionRunStatuses)[number];

export const autoProductionProductStatuses = ["selected", "analyzing", "hooks-ready", "queued", "generating", "completed", "failed", "cancelled", "skipped-duplicate", "skipped-insufficient-data", "skipped-unavailable"] as const;
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
  adCopy?: ProductAdCopy;
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
  packageStatus?: "pending" | "building" | "ready" | "failed";
  packageReadyAt?: string;
  packageFileName?: string;
  packageImageCount?: number;
  packageError?: string;
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
  plannedImageCount: number;
  selectedProductCount: number;
  /** 과거 클라이언트 읽기 호환용. 신규 UI는 plannedImageCount를 사용한다. */
  plannedProductCount?: number;
  completedTodayCount: number;
  failedTodayCount: number;
  activeRunCount: number;
  maxImagesPerDay: number;
  paused: boolean;
  notification?: AutoProductionNotification;
};
