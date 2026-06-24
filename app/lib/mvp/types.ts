export type MvpBrand = {
  id: string;
  brandName: string;
  category: string;
  metaLibraryUrl: string;
  tiktokUrl: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CollectedAdImage = {
  id: string;
  brandName: string;
  category?: string;
  hookType?: string;
  appealPoint?: string;
  sourcePlatform: "Meta" | "TikTok" | "Manual" | "meta" | "tiktok" | "manual";
  imageUrl?: string;
  localImagePath?: string;
  originalAdUrl?: string;
  collectedAt: string;
  analysis?: ImageAnalysis;
};

export type AdImageAnalysisDraft = {
  ocrText: string;
  category: string;
  hookType: string;
  appealPoint: string;
  targetEmotion: string;
  copyNuance: string;
  visualTone: string;
  layoutPattern: string;
  whyItWorks: string;
  recommendedUse: string;
  firstLineHook: string;
  copyStructure: string;
  toneOfVoice: string;
  trendElements: string;
  consumerInsight: string;
  purchaseTrigger: string;
  reusableCopyPattern: string;
  visualCopyRelation: string;
};

export type AdImageLabel = {
  imageId: string;
  category: string;
  brandName: string;
  sourcePlatform: string;
  localImagePath?: string;
  aiDraft: AdImageAnalysisDraft;
  finalLabel: AdImageAnalysisDraft;
  labeledAt: string;
};

export type ProductInfoForPrompt = {
  productName: string;
  category: string;
  price: string;
  discountInfo: string;
  mainBenefit: string;
  targetCustomer: string;
  landingUrl: string;
  productImagePath: string;
  secondaryProductImagePath?: string;
  productImagePaths?: string[];
  backgroundImagePath: string;
  extractedDescription?: string;
  extractedMainImage?: string;
  extractedGalleryImages?: string[];
  selectedBackgroundSource?: string;
  backgroundMode?: "none" | "auto-detail-blur-dark" | "selected-detail-blur-dark";
};

export type GeneratedAdStrategyPrompt = {
  hookType: string;
  appealPoint: string;
  headline: string;
  subCopy: string;
  cta: string;
  imageGenerationPrompt: string;
  textOverlayPlan: {
    canvasSize: "1200x1200";
    headlineArea: string;
    productArea: string;
    priceBadgeArea: string;
    ctaArea: string;
    style: string;
  };
};

export type ExtractedProductInfo = {
  productName: string;
  category: string;
  price: string;
  discountInfo: string;
  mainImage: string;
  galleryImages: string[];
  description: string;
  landingUrl: string;
};

export type GeneratedAdCopy = {
  headline: string;
  bodyCopy: string;
  highlightCopy: string;
  bottomBarCopy: string;
  cta: string;
  price: string;
  hookType: string;
  appealPoint: string;
  whyThisWorks: string;
};

export type ImageAnalysis = {
  extractedText: string;
  hookType: string;
  appealPoint: string;
  designTone: string;
  hasCta: boolean;
  categoryTags: string[];
  analyzedAt: string;
};

export type GeneratedAdImage = {
  id: string;
  sourceWebsiteUrl: string;
  productName: string;
  price: string;
  description: string;
  referenceImageId?: string;
  dataUrl: string;
  createdAt: string;
};

export type CollectionStatus = {
  totalBrands: number;
  completedBrands: number;
  collectedImages: number;
  failedBrands: number;
  failures: { brandName: string; error: string }[];
};
