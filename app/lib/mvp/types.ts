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
  originalPrice?: string;
  oldPrice?: string;
  advertiserName?: string;
  brandName?: string;
  copyGuideId?: string;
  copyGuideContext?: CopyGuideContext;
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
  sourceImageCandidates?: SourceImageCandidate[];
  selectedSourceImageId?: string;
  selectedSourceImagePath?: string;
};

export type CopyGuideContext = {
  guideId: string;
  brandName: string;
  content: string;
  matchedBy: string[];
};

export type ProductImageMode =
  | "original"
  | "cutout"
  | "styled-cutout";

export type ProductImageEffectPreset =
  | "none"
  | "clean-outline"
  | "soft-glow"
  | "commerce-shadow"
  | "outline-glow-shadow";

export type ProductImageRenderEffect = {
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
  shadow: boolean;
  shadowBaseColor?: string;
  shadowOpacity?: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  glow: boolean;
  glowBaseColor?: string;
  glowOpacity?: number;
  glowColor: string;
  glowBlur: number;
  productScale: number;
  productOffsetX: number;
  productOffsetY: number;
  productRotation: number;
};

export type ProductImageState = {
  originalImagePath: string;
  cutoutImagePath?: string;
  styledCutoutImagePath?: string;
  selectedImageMode: ProductImageMode;
  cutoutApplied: boolean;
  effectPreset?: ProductImageEffectPreset;
};

export type SourceImageCandidate = {
  id: string;
  type: "hero" | "detail" | "upload";
  imagePath: string;
  originalUrl?: string;
  label: string;
  selected: boolean;
  createdAt: string;
};

export type ProductImageCandidate = {
  url: string;
  type: "main" | "gallery" | "detail" | "content" | "unknown";
  score: number;
  reason?: string;
  alt?: string;
  width?: number;
  height?: number;
};

export type SourceImageSelectionState = {
  candidates: SourceImageCandidate[];
  selectedSourceImageId?: string;
  selectedSourceImagePath?: string;
};

export type GptImageGenerationMode =
  | "visual-only"
  | "text-in-image";

export type ImageCreativeDirection = {
  visualTone: string;
  composition: string;
  textPolicy: string;
  productPreservationPolicy: string;
  whyThisPrompt: string;
};

export type GeneratedImageAsset = {
  imagePath: string;
  mode: GptImageGenerationMode;
  imageSourceMode?: GptImageSourceMode;
  preservationMode?: GptImagePreservationMode;
  promptMode?: GptPromptMode;
  selectedSourceImagePath?: string;
  basePrompt?: string;
  revisionPrompt?: string;
  failureReasons?: GptImageFailureReason[];
  customFeedback?: string;
  attempt?: number;
  parentCandidateId?: string;
  promptUsed: string;
  createdAt: string;
};

export type GptImageFailureReason =
  | "original-subject-changed"
  | "turned-into-packaged-product"
  | "cooked-food-turned-raw"
  | "product-too-small"
  | "bad-background"
  | "unwanted-text"
  | "unwanted-label-or-logo"
  | "copied-reference-product"
  | "weak-advertising-mood"
  | "too-ai-looking"
  | "wrong-composition"
  | "other";

export type GptImageEvaluation = {
  originalPreservationScore?: number;
  advertisingMoodScore?: number;
  subjectPreservationScore?: number;
  commercialMoodScore?: number;
  compositionScore?: number;
  hasUnwantedText?: boolean;
  hasInventedPackaging?: boolean;
  hasInventedLogoOrLabel?: boolean;
  subjectTooDifferent?: boolean;
  shouldRegenerate?: boolean;
  hasUnwantedPackaging?: boolean;
  copiedReferenceTooClosely?: boolean;
  flags?: GptImageFailureReason[];
  reasons?: string[];
};

export type GptImageFeedbackState = {
  selectedCandidateId?: string | null;
  failureReasons: GptImageFailureReason[];
  customFeedback?: string;
  revisionPrompt?: string;
};

export type GptImageCandidate = {
  id: string;
  imagePath: string;
  imageProvider?: ImageGenerationProvider;
  sourceImagePath?: string;
  promptUsed: string;
  autoPrompt?: string;
  customPromptNote?: string;
  basePrompt?: string;
  revisionPrompt?: string;
  failureReasons?: GptImageFailureReason[];
  customFeedback?: string;
  imageGenerationMode: GptImageGenerationMode;
  imageSourceMode: GptImageSourceMode;
  preservationMode: GptImagePreservationMode;
  promptTemplateMode: GptPromptTemplateMode;
  canvasPreset: GptOutputCanvasPreset;
  productName?: string;
  category?: string;
  selectedSourceImagePath?: string;
  attempt: number;
  parentCandidateId?: string;
  createdAt: string;
  evaluation?: GptImageEvaluation;
};

export type ImageGenerationProvider =
  | "openai"
  | "gemini";

export type GptImageSourceMode =
  | "text-to-image"
  | "image-edit";

export type GptImagePreservationMode =
  | "free-generate"
  | "preserve-product";

export type GptPromptTemplateMode =
  | "ad-image-with-copy"
  | "visual-only";

export type GptOutputCanvasPreset =
  | "sns-square-1200";

export type GptPromptTemplateInput = {
  templateMode: GptPromptTemplateMode;
  outputCanvasPreset: GptOutputCanvasPreset;
  productName?: string;
  category?: string;
  targetCustomer?: string;
  mainBenefit?: string;
  discountInfo?: string;
  price?: string;
  headline?: string;
  bodyCopy?: string;
  highlightCopy?: string;
  bottomBarCopy?: string;
  cta?: string;
  referenceVisualTone?: string;
  referenceLayoutPattern?: string;
  referenceAppealPoint?: string;
  referenceHookType?: string;
  referenceCopyNuance?: string;
  selectedSourceImagePath?: string;
  referenceImagePaths?: string[];
  preservationMode?: GptImagePreservationMode;
  customPromptNote?: string;
};

export type GptPromptTemplateResult = {
  mode: GptPromptTemplateMode;
  canvasPreset: GptOutputCanvasPreset;
  promptText: string;
};

export type GptImageFeedbackRecord = {
  id: string;
  sourceImagePath?: string;
  generatedImagePath?: string;
  parentCandidateId?: string;
  candidateId?: string;
  promptTemplateMode: GptPromptTemplateMode;
  canvasPreset: GptOutputCanvasPreset;
  imageGenerationMode: GptImageGenerationMode;
  imageSourceMode: GptImageSourceMode;
  preservationMode: GptImagePreservationMode;
  productName?: string;
  category?: string;
  failureReasons: GptImageFailureReason[];
  customFeedback: string;
  autoPrompt?: string;
  basePrompt?: string;
  revisionPrompt: string;
  promptUsed?: string;
  attempt: number;
  createdAt: string;
};

export type GptImageGenerationRequest = {
  imageGenerationMode: GptImageGenerationMode;
  imageSourceMode: GptImageSourceMode;
  preservationMode: GptImagePreservationMode;
  selectedSourceImagePath?: string;
  selectedSourceImageType?: "hero" | "detail" | "upload";
  selectedSourceImageLabel?: string;
  productName?: string;
  category?: string;
  mainBenefit?: string;
  targetCustomer?: string;
  generatedCopy?: Partial<GeneratedAdCopy>;
  selectedReferenceLabels?: unknown[];
  templateId?: string;
};

export type GptPromptMode =
  | "auto"
  | "custom";

export type GptCustomPromptState = {
  promptMode: GptPromptMode;
  autoPrompt: string;
  customPrompt: string;
  customPromptNote?: string;
  finalPrompt: string;
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
  originalPrice?: string;
  oldPrice?: string;
  discountInfo: string;
  brandName?: string;
  productSubCategory?: string;
  detectedProductType?: string;
  categoryKeywords?: string[];
  mainImage: string;
  galleryImages: string[];
  description: string;
  extractedDescription?: string;
  landingUrl: string;
  heroImage?: string;
  detailImages?: string[];
  imageCandidates?: ProductImageCandidate[];
  sourceImageCandidates?: SourceImageCandidate[];
};

export type CopySlotKey =
  | "headline"
  | "bodyCopy"
  | "highlightCopy"
  | "bottomBarCopy"
  | "cta"
  | "price";

export type CopyOverflowStrategy =
  | "shrink"
  | "wrap"
  | "ellipsis"
  | "shrink-wrap"
  | "shrink-ellipsis"
  | "shrink-wrap-ellipsis";

export type CopyLimit = {
  maxChars: number;
  maxLines: number;
  minFontSize: number;
  maxFontSize: number;
  overflowStrategy: CopyOverflowStrategy;
};

export type TemplateCopyLimits = Partial<Record<CopySlotKey, CopyLimit>>;

export type TemplateFitInfo = {
  templateId?: string;
  templateName?: string;
  usedCopyLimits?: Partial<Record<CopySlotKey, number>>;
  fitNotes?: string;
};

export type TemplateCopySlotFit = {
  key: CopySlotKey;
  originalText: string;
  fittedText: string;
  maxChars: number;
  currentChars: number;
  status: "ok" | "trimmed" | "too-long" | "empty" | "needs-review";
  message?: string;
};

export type TemplateFittedCopy = {
  headline: string;
  bodyCopy: string;
  highlightCopy: string;
  bottomBarCopy: string;
  cta: string;
  price?: string;
  templateId: string;
  slotFits: TemplateCopySlotFit[];
  createdAt: string;
};

export type GeneratedAdCopyVariant = {
  headline: string;
  bodyCopy: string;
  highlightCopy: string;
  bottomBarCopy: string;
  cta: string;
  price?: string;
};

export type ReferencePatternUsage = {
  usedReferenceIds?: string[];
  appliedPatterns?: string[];
  avoidedDirectCopy?: boolean;
  usedHookPattern?: string;
  usedCopyStructure?: string;
  usedToneOfVoice?: string;
  usedConsumerInsight?: string;
  usedPurchaseTrigger?: string;
  usedReusablePattern?: string;
  usedVisualCopyRelation?: string;
};

export type GeneratedCopyValidation = {
  bodyCopy?: {
    ok: boolean;
    reasons: string[];
    original?: string;
    normalized?: string;
    finalLength: number;
  };
};

export type GeneratedCopyReasoning = {
  headlineReason?: string;
  bodyReason?: string;
  highlightReason?: string;
  referencePatternUsed?: string;
  consumerInsightUsed?: string;
  purchaseTriggerUsed?: string;
  headlineQualityCheck?: string;
};

export type GeneratedAdCopy = GeneratedAdCopyVariant & {
  price: string;
  hookType: string;
  appealPoint: string;
  whyThisWorks: string;
  copyGuideUsage?: {
    guideId: string;
    brandName: string;
    usedSections: string[];
    toneApplied: string[];
  };
  reasoning?: GeneratedCopyReasoning;
  templateFit?: TemplateFitInfo;
  referencePatternUsage?: ReferencePatternUsage;
  copyValidation?: GeneratedCopyValidation;
  copyVariants?: {
    short: GeneratedAdCopyVariant;
    medium: GeneratedAdCopyVariant;
    long: GeneratedAdCopyVariant;
  };
};

export type TemplateCopyApplyMode =
  | "original"
  | "auto-variant"
  | "force-fit";

export type CopyVariantKey = "short" | "medium" | "long" | "base";

export type TemplateCopyVariantSelection = {
  templateId: string;
  templateName: string;
  selectedVariant: CopyVariantKey;
  reason: string;
  beforeFitCopy: GeneratedAdCopyVariant;
  fittedCopy: TemplateFittedCopy;
  hasOverflow: boolean;
  overflowSlots: CopySlotKey[];
  slotFits: TemplateCopySlotFit[];
};

export type TemplateCopyPreview = {
  templateId: string;
  templateName: string;
  mode: TemplateCopyApplyMode;
  selectedVariant: CopyVariantKey;
  originalCopy: GeneratedAdCopy;
  selectedCopy: GeneratedAdCopyVariant;
  fittedCopy: TemplateFittedCopy;
  hasOverflow: boolean;
  overflowSlots: CopySlotKey[];
  slotFits: TemplateCopySlotFit[];
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
