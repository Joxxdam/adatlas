import type { ProductInfoForPrompt } from "../mvp/types";

export type StorePlatform =
  "cafe24" | "makeshop" | "shopify" | "smartstore" | "generic" | "unknown";

export type StoreAnalysisOptions = {
  storeUrl: string;
  storeName?: string;
  priorityCategories: string[];
  excludedCategories: string[];
  maxProducts: number;
  includeBest: boolean;
  includeNew: boolean;
  includeDiscounted: boolean;
  analyzeReviews: boolean;
};

export type StoreInfo = {
  storeUrl: string;
  domain: string;
  storeName?: string;
  brandName?: string;
  platform?: StorePlatform;
  siteTitle?: string;
  metaDescription?: string;
  logoUrl?: string;
  primaryColors?: string[];
  repeatedBrandPhrases?: string[];
  categoryUrls?: string[];
  bestPageUrls?: string[];
  newPageUrls?: string[];
  promotionPageUrls?: string[];
};

export type StoreCategoryAnalysis = {
  id: string;
  name: string;
  url?: string;
  productCount?: number;
  averagePrice?: number;
  averageDiscountRate?: number;
  averageReviewCount?: number;
  averageRating?: number;
  newProductRatio?: number;
  discountedProductRatio?: number;
  imageQualityScore?: number;
  contentPotentialScore?: number;
  recommendationScore?: number;
  reasons: string[];
  recommendedAngleTypes?: ContentAngleRecommendation["type"][];
};

export type StoreProductSummary = {
  id: string;
  name: string;
  url: string;
  category?: string;
  imageUrl?: string;
  originalPrice?: number;
  salePrice?: number;
  discountRate?: number;
  reviewCount?: number;
  rating?: number;
  isBest?: boolean;
  isNew?: boolean;
  isDiscounted?: boolean;
  isSoldOut?: boolean;
  isSetProduct?: boolean;
  freeShipping?: boolean;
  discoveredFrom?: string[];
};

export type ProductReviewAnalysis = {
  reviewCount?: number;
  averageRating?: number;
  positiveKeywords: string[];
  negativeKeywords: string[];
  purchaseSituations: string[];
  repeatedBenefits: string[];
  repeatedComplaints: string[];
  copyUsableInsights: string[];
  sourceReviewCount?: number;
  confidence?: number;
};

export type DetailPageQualityAnalysis = {
  score: number;
  productNameClarity: number;
  priceClarity: number;
  uspVisibility: number;
  imageAvailability: number;
  reviewEvidence: number;
  shippingInfoClarity: number;
  compositionClarity: number;
  issues: string[];
  recommendations: string[];
};

export type ContentAngleRecommendation = {
  id: string;
  name: string;
  type:
    | "price-shock"
    | "review"
    | "quality"
    | "family"
    | "camping"
    | "gift"
    | "ingredient"
    | "problem-solution"
    | "new-product"
    | "comparison"
    | "bundle-value"
    | "seasonal";
  reason: string;
  evidence: string[];
  headlineDirection?: string;
  bodyDirection?: string;
  templateIds?: string[];
  score: number;
};

export type ProductAdvertisingAnalysis = {
  overallScore: number;
  productStrengthScore: number;
  priceAttractivenessScore: number;
  reviewUsabilityScore: number;
  imageUsabilityScore: number;
  uspClarityScore: number;
  seasonFitScore: number;
  contentExpansionScore: number;
  detailPageQualityScore: number;
  confidence: number;
  recommendationType:
    "proven-candidate" | "new-test-candidate" | "rediscovery-candidate" | "low-priority";
  reasons: string[];
  risks: string[];
  recommendedAngles: ContentAngleRecommendation[];
  recommendedTemplateIds: string[];
  recommendedReferenceLabelIds?: string[];
  recommendedStyleName?: string;
  recommendedLayoutPattern?: string;
  recommendedVisualTone?: string;
  scoreAvailability?: Partial<
    Record<
      | "productStrength"
      | "priceAttractiveness"
      | "reviewUsability"
      | "imageUsability"
      | "uspClarity"
      | "seasonFit"
      | "contentExpansion"
      | "detailPageQuality",
      boolean
    >
  >;
};

export type ProductDetailAnalysis = {
  product: StoreProductSummary;
  description?: string;
  uspCandidates: string[];
  specifications: Record<string, string>;
  imageUrls: string[];
  detailImageUrls: string[];
  reviewAnalysis?: ProductReviewAnalysis;
  detailPageQuality?: DetailPageQualityAnalysis;
  advertisingAnalysis?: ProductAdvertisingAnalysis;
};

export type RecommendedProductCandidate = {
  rank: number;
  product: StoreProductSummary;
  analysis: ProductAdvertisingAnalysis;
};

export type CopyGuideMatch = {
  matched: boolean;
  guideId?: string;
  brandName?: string;
  matchedBy?: string;
  confidence: number;
};

export type StoreAnalysisStats = {
  categoryCount: number;
  discoveredProductCount: number;
  analyzedProductCount: number;
  reviewAnalyzedProductCount: number;
  failedProductCount: number;
};

export type StoreAnalysisResult = {
  analysisId: string;
  createdAt: string;
  options: StoreAnalysisOptions;
  storeInfo: StoreInfo;
  categories: StoreCategoryAnalysis[];
  products: ProductDetailAnalysis[];
  recommendedProducts: RecommendedProductCandidate[];
  copyGuideMatch: CopyGuideMatch;
  stats: StoreAnalysisStats;
  warnings: string[];
  limitations: string[];
};

export type StoreAnalysisSummary = {
  analysisId: string;
  storeUrl: string;
  storeName?: string;
  createdAt: string;
  productCount: number;
  platform?: StorePlatform;
};

export type DiscoveredStorePage = {
  url: string;
  label: string;
  kind: "home" | "category" | "best" | "new" | "promotion" | "product-list";
};

export type DiscoveredProductLink = {
  url: string;
  label?: string;
  category?: string;
  discoveredFrom: string[];
  isBest?: boolean;
  isNew?: boolean;
  isDiscounted?: boolean;
};

export interface StoreExtractor {
  canHandle(url: string, html?: string): boolean;
  extractStoreInfo(url: string, html: string): StoreInfo;
  discoverCategoryUrls(url: string, html: string): DiscoveredStorePage[];
  discoverProductUrls(
    url: string,
    html: string,
    source: DiscoveredStorePage
  ): DiscoveredProductLink[];
  extractProductSummary(
    url: string,
    html: string,
    discovered?: DiscoveredProductLink
  ): StoreProductSummary;
  extractProductDetail(
    url: string,
    html: string,
    summary: StoreProductSummary,
    analyzeReviews: boolean
  ): ProductDetailAnalysis;
}

export type ProductCreationHandoff = {
  analysisId: string;
  productId: string;
  productUrl: string;
  productInfo: ProductInfoForPrompt;
  productImagePaths: string[];
  reviewAnalysis?: ProductReviewAnalysis;
  selectedContentAngle?: ContentAngleRecommendation;
  availableContentAngles: ContentAngleRecommendation[];
  recommendedTemplateIds: string[];
  recommendedReferenceLabelIds: string[];
  recommendedStyleName?: string;
  matchedCopyGuideId?: string;
  advertiserName?: string;
  advertisingScore: number;
  confidence: number;
  creativeContext?: import("../creative-content-notes/types").CreativeOpportunityContext;
};

export type StoreAnalysisJobStatus =
  | "queued"
  | "discovering-store"
  | "discovering-products"
  | "analyzing-products"
  | "analyzing-reviews"
  | "scoring"
  | "generating-strategies"
  | "completed"
  | "failed";
