export const creativeAssetStatuses = ["draft", "generated", "exported", "running", "performance_linked", "learning_completed"] as const;

export type CreativeAssetStatus = (typeof creativeAssetStatuses)[number];

export type CreativeAsset = {
  id: string;
  assetCode: string;
  brandId: string;
  brandName: string;
  brandCode: string;
  productId: string;
  productName: string;
  productCode: string;
  originalHostProductNo?: string;
  advertiserId?: string;
  opportunityId?: string;
  analysisRunId?: string;
  opportunityType?: string;
  recommendedHookType?: string;
  appliedContentNoteIds?: string[];
  reviewInsightIds?: string[];
  category: string;
  hookType: string;
  hookCode: string;
  materialCode?: string;
  copyPlanMode?: "reference-adapted" | "legacy-hook-first";
  referenceId?: string;
  mainMessage?: string;
  visualDirection?: string;
  generationRound?: number;
  variant?: string;
  experimentId?: string;
  testCode?: string;
  hookVariantCode?: string;
  explorationCode?: string;
  conceptCode?: string;
  primaryHookTag?: string;
  secondaryHookTags?: string[];
  customerReason?: string;
  hypothesisId?: string;
  advertisingHypothesis: string;
  headline: string;
  subCopy: string;
  benefitCopy: string;
  templateId: string;
  layoutType: string;
  backgroundType: string;
  backgroundId?: string;
  sourceProductImage: string;
  generatedImageUrl: string;
  fileName: string;
  recommendedAdName: string;
  utmContent: string;
  objective: string;
  status: CreativeAssetStatus;
  version: number;
  parentAssetCode?: string;
  generationRequestKey?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreativeAssetSnapshot = Pick<CreativeAsset, "id" | "assetCode" | "brandName" | "productName" | "hookType" | "hookCode" | "materialCode" | "copyPlanMode" | "referenceId" | "generatedImageUrl" | "fileName" | "recommendedAdName" | "utmContent" | "status" | "version" | "parentAssetCode" | "createdAt" | "advertiserId" | "opportunityId" | "analysisRunId" | "opportunityType" | "recommendedHookType" | "appliedContentNoteIds" | "reviewInsightIds" | "originalHostProductNo" | "mainMessage" | "visualDirection" | "generationRound" | "variant" | "experimentId" | "testCode" | "hookVariantCode" | "explorationCode" | "conceptCode" | "primaryHookTag" | "secondaryHookTags" | "customerReason" | "hypothesisId">;

export type CreateCreativeAssetInput = {
  brandId?: string;
  brandName?: string;
  productId?: string;
  productName?: string;
  originalHostProductNo?: string;
  advertiserId?: string;
  opportunityId?: string;
  analysisRunId?: string;
  opportunityType?: string;
  recommendedHookType?: string;
  appliedContentNoteIds?: string[];
  reviewInsightIds?: string[];
  category?: string;
  hookType?: string;
  materialCode?: string;
  copyPlanMode?: "reference-adapted" | "legacy-hook-first";
  referenceId?: string;
  mainMessage?: string;
  visualDirection?: string;
  generationRound?: number;
  variant?: string;
  experimentId?: string;
  testCode?: string;
  hookVariantCode?: string;
  explorationCode?: string;
  conceptCode?: string;
  primaryHookTag?: string;
  secondaryHookTags?: string[];
  customerReason?: string;
  hypothesisId?: string;
  advertisingHypothesis?: string;
  headline?: string;
  subCopy?: string;
  benefitCopy?: string;
  templateId?: string;
  layoutType?: string;
  backgroundType?: string;
  backgroundId?: string;
  sourceProductImage?: string;
  generatedImageUrl: string;
  objective?: string;
  parentAssetCode?: string;
  generationRequestKey?: string;
  createdAt?: string;
};

export type CreativeAssetFilters = {
  query?: string;
  assetCode?: string;
  brand?: string;
  product?: string;
  hook?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: CreativeAssetStatus;
  limit?: number;
};

export type PerformanceRecord = {
  id: string;
  assetCode: string;
  dateStart: string;
  dateEnd: string;
  adId: string;
  adName: string;
  campaignName: string;
  adsetName: string;
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  linkClicks: number | null;
  purchases: number | null;
  purchaseValue: number | null;
  ctr: number | null;
  cpc: number | null;
  cvr: number | null;
  cpa: number | null;
  roas: number | null;
  importedAt: string;
  source: string;
};

export type CreativeAssetMatchResult = { status: "matched"; assetCode: string; asset: CreativeAsset; matchType: "exact-code" } | { status: "not-found"; assetCode?: string; reason: string } | { status: "needs-review"; assetCode?: string; reason: "code-missing" | "duplicate-code" };

export function toCreativeAssetSnapshot(asset: CreativeAsset): CreativeAssetSnapshot {
  return {
    id: asset.id,
    assetCode: asset.assetCode,
    brandName: asset.brandName,
    productName: asset.productName,
    hookType: asset.hookType,
    hookCode: asset.hookCode,
    materialCode: asset.materialCode,
    copyPlanMode: asset.copyPlanMode,
    referenceId: asset.referenceId,
    generatedImageUrl: asset.generatedImageUrl,
    fileName: asset.fileName,
    recommendedAdName: asset.recommendedAdName,
    utmContent: asset.utmContent,
    status: asset.status,
    version: asset.version,
    parentAssetCode: asset.parentAssetCode,
    createdAt: asset.createdAt,
    advertiserId: asset.advertiserId,
    opportunityId: asset.opportunityId,
    analysisRunId: asset.analysisRunId,
    opportunityType: asset.opportunityType,
    recommendedHookType: asset.recommendedHookType,
    appliedContentNoteIds: asset.appliedContentNoteIds,
    reviewInsightIds: asset.reviewInsightIds,
    originalHostProductNo: asset.originalHostProductNo,
    mainMessage: asset.mainMessage,
    visualDirection: asset.visualDirection,
    generationRound: asset.generationRound,
    variant: asset.variant,
    experimentId: asset.experimentId,
    testCode: asset.testCode,
    hookVariantCode: asset.hookVariantCode,
    explorationCode: asset.explorationCode,
    conceptCode: asset.conceptCode,
    primaryHookTag: asset.primaryHookTag,
    secondaryHookTags: asset.secondaryHookTags,
    customerReason: asset.customerReason,
    hypothesisId: asset.hypothesisId,
  };
}
