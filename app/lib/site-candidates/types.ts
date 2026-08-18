import type { StorePlatform } from "../store-analysis/types";

export type SitePageType =
  | "homepage"
  | "category"
  | "promotion"
  | "product"
  | "unsupported";

export type SiteEvidenceState =
  | "present"
  | "absent"
  | "unavailable"
  | "extraction_failed"
  | "not_applicable";

export type SiteEvidenceLevel = "high" | "medium" | "low";

export type SiteRecommendationType =
  | "review-trust"
  | "core-usp"
  | "price-benefit"
  | "problem-solution"
  | "situation"
  | "visual-hook"
  | "new-product-test"
  | "seasonal-test"
  | "bundle-value"
  | "clear-target";

export type SiteCandidateTier = "evidence-backed" | "content-potential" | "experiment";

export type SiteEvidenceField = {
  key: string;
  label: string;
  state: SiteEvidenceState;
  value?: string | number | boolean | string[] | null;
  source: "json-ld" | "open-graph" | "page-html" | "derived";
  note?: string;
};

export type SiteProductRecord = {
  id: string;
  productName: string;
  brandName?: string;
  category?: string;
  productUrl: string;
  representativeImage?: string;
  additionalImages: string[];
  regularPrice?: number;
  salePrice?: number;
  discountRate?: number;
  benefits: string[];
  coupon?: string;
  freeShipping?: boolean;
  setComposition?: string;
  giftBenefit?: string;
  membershipBenefit?: string;
  stockStatus: "in-stock" | "sold-out" | "unavailable";
  options: string[];
  description?: string;
  uspCandidates: string[];
  ingredients: string[];
  origin?: string;
  certifications: string[];
  reviewCount?: number;
  rating?: number;
  extractedReviewPhrases: string[];
  badges: string[];
  promotionEndsAt?: string;
  hasPurchaseButton?: boolean;
  shippingInfo?: string;
  usageContexts: string[];
  targetSignals: string[];
  discoveredFrom: string[];
  analyzedAt: string;
  evidence: SiteEvidenceField[];
};

export type SiteAdFitSectionKey =
  | "messageUsp"
  | "trust"
  | "offer"
  | "creative"
  | "season"
  | "landing";

export type SiteAdFitSection = {
  key: SiteAdFitSectionKey;
  label: string;
  score: number;
  maxScore: number;
  reasons: string[];
  evidenceCount: number;
  indicatorCount: number;
  evidenceSufficiency: number;
  status: "scored" | "limited" | "unavailable";
};

export type SiteCandidateScore = {
  total: number;
  sections: Record<SiteAdFitSectionKey, SiteAdFitSection>;
};

export type SiteCandidateStrength = {
  sectionKey: SiteAdFitSectionKey;
  label: string;
  score: number;
  maxScore: number;
  evidence: string;
};

export type SiteCandidateRecommendationSummary = {
  coreReason: string;
  topStrengths: SiteCandidateStrength[];
  recommendedTest: string;
  insufficientData: boolean;
};

export type SiteAdCandidate = {
  id: string;
  rank: number;
  tier: SiteCandidateTier;
  product: SiteProductRecord;
  score: SiteCandidateScore;
  evidenceLevel: SiteEvidenceLevel;
  recommendationTypes: SiteRecommendationType[];
  primaryRecommendationType: SiteRecommendationType;
  recommendationSummary: SiteCandidateRecommendationSummary;
  recommendationReasons: string[];
  cautions: string[];
  unavailableInformation: string[];
};

export type SiteDiscoveredProduct = {
  id: string;
  url: string;
  label?: string;
  category?: string;
  discoveredFrom: string[];
  isBest?: boolean;
  isNew?: boolean;
  isDiscounted?: boolean;
};

export type SiteDiscoveryResult = {
  discoveryId: string;
  inputUrl: string;
  normalizedUrl: string;
  pageType: SitePageType;
  platform: StorePlatform;
  storeName?: string;
  brandName?: string;
  discoveredProductCount: number;
  analyzableProductCount: number;
  products: SiteDiscoveredProduct[];
  warnings: string[];
  analyzedAt: string;
};

export type SiteCandidateAnalysisResult = {
  analysisId: string;
  discovery: SiteDiscoveryResult;
  candidates: SiteAdCandidate[];
  analyzedProductCount: number;
  excludedProductCount: number;
  failedProductCount: number;
  warnings: string[];
  analyzedAt: string;
  disclaimer: string;
};

export type SiteCandidateSelection = {
  selectionId: string;
  analysisId: string;
  candidate: SiteAdCandidate;
  createdAt: string;
};
