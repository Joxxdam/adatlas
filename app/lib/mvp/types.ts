import type { CreativeAsset } from "../creative-assets/types";
import type { CreativeOpportunityContext } from "../creative-content-notes/types";
import type { VendorProductResearchContext } from "../product-research/types";

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
  structuredLabels?: {
    hookTypes: string[];
    appealPoints: string[];
    weights?: Partial<Record<"hook" | "appeal" | "tone" | "visual", number>>;
  };
  labeledAt: string;
};

export type ProductTargetAgeGroup = "teens" | "twenties" | "thirties" | "forties" | "fifties" | "senior" | "kids" | "family" | "couple" | "friends" | "no_people";

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
  /** 대표 이미지·JSON-LD·사용자 선택처럼 현재 상품으로 확정된 원본만 포함합니다. */
  confirmedProductImagePaths?: string[];
  backgroundImagePath: string;
  extractedDescription?: string;
  extractedMainImage?: string;
  extractedGalleryImages?: string[];
  selectedBackgroundSource?: string;
  backgroundMode?: "none" | "auto-detail-blur-dark" | "selected-detail-blur-dark";
  sourceImageCandidates?: SourceImageCandidate[];
  selectedSourceImageId?: string;
  selectedSourceImagePath?: string;
  productSubCategory?: string;
  detectedProductType?: string;
  targetAgeGroups?: ProductTargetAgeGroup[];
  productColors?: string[];
  brandColors?: string[];
  ingredients?: string[];
  verifiedBenefits?: string[];
  packageType?: string;
  imageType?: string;
  modelIncluded?: boolean;
  productCutoutAvailable?: boolean;
  productRepresentation?: ProductRepresentation;
  reviewSources?: ReviewSourceCandidate[];
  detailImageOcrInsights?: ProductDetailImageOcrInsight[];
  productCopyConstraints?: string[];
  vendorResearch?: VendorProductResearchContext;
  creativeContext?: CreativeOpportunityContext;
};

export type AdObjective = "purchase" | "signup" | "awareness" | "retargeting";

export type TargetPlatform = "meta-feed" | "instagram-feed" | "naver-gfa";

export type AwarenessStage = "unaware" | "problem-aware" | "solution-aware" | "comparing";

export type CreativeIntensity = "brand" | "balanced" | "performance";

export type AdBrief = {
  productName: string;
  category: string;
  price: string;
  originalPrice?: string;
  discountInfo: string;
  mainBenefit: string;
  targetCustomer: string;
  landingUrl: string;
  adObjective: AdObjective;
  creativeIntensity: CreativeIntensity;
  additionalEmphasis?: string;
  mandatoryInfo: string[];
  prohibitedClaims: string[];

  // Backward-compatible fields. New briefs infer these values automatically.
  targetPlatform?: TargetPlatform;
  awarenessStage?: AwarenessStage;
  customerProblem?: string;
  purchaseBarrier?: string;
  proofElements?: string[];
  desiredHookType?: string;
  offerType?: string;
  tonePreference?: string;
};

export type AutoReferenceContext = {
  referenceId: string;
  category?: string;
  hookTypes?: string[];
  appealPoints?: string[];
  copyNuance?: string;
  consumerInsight?: string;
  purchaseTrigger?: string;
  reusablePattern?: string;
  visualTone?: string;
  layoutPattern?: string;
  ocrText?: string;
};

export type ReferenceMatchResult = {
  referenceId: string;
  score: number;
  matchedReasons: string[];
  context: AutoReferenceContext;
};

export type ReferenceUsageAspect = "headline-structure" | "hook-style" | "appeal-point" | "tone" | "information-hierarchy" | "price-emphasis" | "product-layout" | "color-mood" | "background-mood" | "cta-style";

export type ReferenceUsageSelection = {
  imageId: string;
  aspects: ReferenceUsageAspect[];
  weight: number;
};

export type AdHookType = "price-benefit" | "feature-usp" | "lifestyle" | "season-event" | "problem-solution" | "social-proof" | "curiosity" | "sensory" | "gift" | "brand-story";

export type AdTextSafeArea = "top-left" | "top-center" | "top-right" | "center-left" | "center-right" | "bottom-left" | "bottom-center" | "bottom-right";

export type AdProductPosition = "left" | "center-left" | "center" | "center-right" | "right" | "bottom-left" | "bottom-center" | "bottom-right";

export type CreativeStrategy = {
  id: string;
  title: string;
  hookType: AdHookType;
  headline: string;
  subCopy: string;
  keyAppeal: string;
  sceneDescription: string;
  mood: string[];
  textSafeArea: AdTextSafeArea;
  productPosition: AdProductPosition;
  backgroundTags: string[];
  appeal: string;
  mainCopy: string;
  audience: string;
  explanation: string;
  mainHookAngle: string;
  coreAppealPoint: string;
  audienceFit: string;
  referenceFit: string;
  suggestedVisualEmphasis: string;
  risk: string;
  expectedCustomerProblem: string;
  purchaseBarrierResponse: string;
  recommendedTone: string;
  inferredEvidence: string[];
  matchedReferenceIds: string[];
  matchedReferencePatterns: string[];
  backgroundHookType?: "problem_solution" | "price_offer" | "usp_proof" | "sensory" | "situation" | "review_ugc" | "urgency" | "premium" | "styling" | "freshness" | "origin_story" | "family" | "convenience" | "gifting";
  targetAgeGroups?: ProductTargetAgeGroup[];
  preferredAssetTypes?: Array<"lifestyle_photo" | "people_photo" | "product_set" | "pattern_texture" | "ingredient_scene" | "ai_generated" | "designed_asset" | "user_uploaded">;
  preferredColors?: string[];
};

export type MessageHierarchy = {
  primaryMessage: string;
  secondaryMessage: string;
  proofMessage: string;
  offerMessage: string;
  actionMessage: string;
};

export type CreationStepId = "brief" | "strategy" | "copy" | "visual" | "edit" | "export";

export type CopyQualityDimension = "specificity" | "benefitClarity" | "differentiation" | "priceClarity" | "targetFit" | "naturalKoreanTone" | "overclaimSafety" | "repetitionSafety";

export type CopyQualityFinding = {
  id: string;
  severity: "info" | "warning" | "error";
  slot?: CopySlotKey;
  message: string;
  suggestion?: string;
};

export type CopyQualityReport = {
  totalScore: number;
  scores: Record<CopyQualityDimension, number>;
  findings: CopyQualityFinding[];
  checkedAt: string;
};

export type CopyGuideContext = {
  guideId: string;
  brandName: string;
  content: string;
  matchedBy: string[];
};

export type ProductImageMode = "original" | "cutout" | "styled-cutout";

export type ProductRepresentationType = "single-product" | "multi-unit-set" | "irregular-product" | "packaged-product" | "product-package-group" | "bundle-components" | "plated-product" | "apparel-or-soft-product" | "transparent-or-reflective-product" | "already-transparent";

export type ProductExtractionScope = "single-item" | "visible-all" | "sales-unit" | "product-and-package" | "food-only" | "food-and-plate" | "manual-region" | "original";

export type NormalizedImageBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectedProductObject = {
  id: string;
  box: NormalizedImageBox;
  confidence: number;
  relativeArea: number;
  selected: boolean;
  role?: "primary" | "component" | "package" | "plate" | "unknown";
};

export type ProductRepresentation = {
  type: ProductRepresentationType;
  confidence: number;
  reason: string;
  recommendedExtractionScope: ProductExtractionScope;
  selectedExtractionScope: ProductExtractionScope;
  expectedUnitCount?: number;
};

export type ProductCutoutQuality = {
  usable: boolean;
  score: number;
  transparencyRatio: number;
  opaqueEdgeRatio: number;
  foregroundRatio: number;
  componentCount: number;
  clippedEdgeCount: number;
  haloRatio: number;
  warnings: string[];
  foregroundBox?: NormalizedImageBox;
};

export type ProductImageEffectPreset = "none" | "clean-outline" | "soft-glow" | "commerce-shadow" | "outline-glow-shadow";

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
  representation?: ProductRepresentation;
  selectedExtractionScope?: ProductExtractionScope;
  selectedObjectIds?: string[];
  selectedGroupBox?: NormalizedImageBox;
  quality?: ProductCutoutQuality;
  retryCount?: number;
  manualEdited?: boolean;
  processingProvider?: string;
};

export type SelectedAdImageSource = "detail" | "upload" | "gpt" | "background" | "product" | "unknown";

export type SelectedAdImageState = {
  selectedImagePaths: string[];
  primaryImagePath: string;
  secondaryImagePath?: string;
  source: SelectedAdImageSource;
  updatedAt: string;
};

export type SourceImageCandidate = {
  id: string;
  type: "hero" | "detail" | "upload";
  imagePath: string;
  originalUrl?: string;
  label: string;
  selected: boolean;
  createdAt: string;
  width?: number;
  height?: number;
  sourceType?: "structured-data" | "open-graph" | "product-gallery" | "detail-content" | "option-image" | "upload" | "unknown";
  sourceImageQualityScore?: number;
  salesUnitMatchScore?: number;
  recommendationScore?: number;
  analysisReason?: string;
  expectedRepresentationType?: ProductRepresentationType;
  expectedExtractionScope?: ProductExtractionScope;
  detectedObjects?: DetectedProductObject[];
  detectedGroupBox?: NormalizedImageBox;
  hasText?: boolean;
  hasMultipleObjects?: boolean;
  multipleObjectsAreSalesUnit?: boolean;
  contentHash?: string;
  perceptualHash?: string;
  alreadyTransparent?: boolean;
  warnings?: string[];
};

export type ProductImageCandidate = {
  url: string;
  type: "main" | "gallery" | "detail" | "content" | "unknown";
  score: number;
  reason?: string;
  alt?: string;
  /** 이미지 태그 주변의 공개 상세페이지 문맥입니다. 상품 사진과 판매자 배너를 구분할 때만 사용합니다. */
  context?: string;
  width?: number;
  height?: number;
  /** HTML 안에서의 원래 위치입니다. 상세페이지 앞부분만 OCR하는 편향을 막는 데 사용합니다. */
  pageOrder?: number;
  /** 상품 이미지 선택과 별개로, 이 이미지를 OCR할 때 기대하는 근거 유형입니다. */
  evidenceRoles?: ProductDetailOcrEvidenceRole[];
  /** 구조화 대표 이미지와 상세 본문·일반 갤러리를 OCR 후보에서 구분합니다. */
  evidenceScope?: "structured-main" | "product-detail" | "gallery";
};

export type ProductDetailOcrEvidenceRole = "identity" | "offer" | "composition" | "benefit" | "ingredient" | "usage" | "unknown";

export type SourceImageSelectionState = {
  candidates: SourceImageCandidate[];
  selectedSourceImageId?: string;
  selectedSourceImagePath?: string;
};

export type ReviewSourceType = "product-review" | "detail-testimonial" | "community-capture" | "before-after" | "upload";

export type ReviewType = "review-text-screenshot" | "review-photo-with-text" | "review-photo-only" | "community-reaction" | "before-after" | "review-card" | "testimonial-graphic" | "not-review";

export type ReviewRegionRole = "text" | "review-body" | "author" | "profile" | "date-order" | "rating" | "social-ui" | "face" | "photo" | "unknown";

export type ReviewImageRegion = {
  id: string;
  box: NormalizedImageBox;
  role: ReviewRegionRole;
  text?: string;
  confidence: number;
};

export type ReviewPrivacyMaskStyle = "blur" | "mosaic" | "solid";

export type ReviewPrivacyRegion = ReviewImageRegion & {
  reason: string;
  enabled: boolean;
  maskStyle: ReviewPrivacyMaskStyle;
};

export type ReviewSourceCandidate = {
  id: string;
  imagePath: string;
  originalUrl?: string;
  width: number;
  height: number;
  sourceType: ReviewSourceType;
  sourceContext?: string;
  reviewType: ReviewType;
  classificationConfidence: number;
  ocrText: string;
  ocrProvider: "openai-vision" | "apple-vision" | "manual" | "unavailable";
  ocrConfidence: number;
  keySentence: string;
  imageQualityScore: number;
  productRelevanceScore: number;
  hookStrengthScore: number;
  specificityScore: number;
  privacyRiskScore: number;
  policyRiskScore: number;
  overallReviewScore: number;
  textRegions: ReviewImageRegion[];
  photoRegions: ReviewImageRegion[];
  privacyRegions: ReviewPrivacyRegion[];
  recommendedCrop: NormalizedImageBox;
  cropConfidence: number;
  automaticCropAvailable: boolean;
  contentHash?: string;
  perceptualHash?: string;
  selected?: boolean;
  recommended?: boolean;
  warnings: string[];
};

export type ProductDetailImageOcrInsight = {
  id: string;
  imageUrl: string;
  contentHash: string;
  ocrText: string;
  ocrProvider: ReviewSourceCandidate["ocrProvider"];
  ocrConfidence: number;
  /** 검증 후 광고 문구 근거로 사용할 수 있는 문장만 들어갑니다. */
  copyFacts: string[];
  /** 광고에는 쓰지 않지만 상품을 과장하지 않도록 생성기에 전달할 조건입니다. */
  productConstraints: string[];
  /** 패키지 동일성 확인에만 쓰고 광고 문구로는 승격하지 않는 라벨·인증·영문 마이크로카피입니다. */
  identityOnlyLabels?: string[];
  /** 배송·CS·양해·판매원·부정 표현처럼 광고 근거에서 폐기한 문장입니다. */
  discardedNotices: string[];
  warnings: string[];
};

export type ReviewCreativeTemplate = "reaction-comment" | "real-review-focus" | "review-collection" | "before-after-usage";

export type ReviewCreativeState = {
  status: "idle" | "analyzing" | "ready" | "rendering" | "completed" | "error";
  selectedReviewIds: string[];
  template: ReviewCreativeTemplate;
  headline: string;
  cropByReviewId: Record<string, NormalizedImageBox>;
  privacyMasksByReviewId: Record<string, ReviewPrivacyRegion[]>;
  manualEdited: boolean;
  generatedImagePath?: string;
  warnings: string[];
};

export type GptImageGenerationMode = "visual-only" | "text-in-image";

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

export type GptImageFailureReason = "original-subject-changed" | "turned-into-packaged-product" | "cooked-food-turned-raw" | "product-too-small" | "bad-background" | "unwanted-text" | "unwanted-label-or-logo" | "copied-reference-product" | "weak-advertising-mood" | "too-ai-looking" | "wrong-composition" | "other";

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

export type ImageGenerationProvider = "openai" | "gemini";

export type GptImageSourceMode = "text-to-image" | "image-edit";

export type GptImagePreservationMode = "free-generate" | "preserve-product";

export type GptPromptTemplateMode = "ad-image-with-copy" | "visual-only";

export type GptOutputCanvasPreset = "sns-square-1200";

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

export type GptPromptMode = "auto" | "custom";

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
  /** 자동 수집 갤러리와 분리된 현재 상품 확정 이미지입니다. */
  confirmedProductImages?: string[];
  description: string;
  extractedDescription?: string;
  mainBenefit?: string;
  targetCustomer?: string;
  landingUrl: string;
  heroImage?: string;
  detailImages?: string[];
  imageCandidates?: ProductImageCandidate[];
  sourceImageCandidates?: SourceImageCandidate[];
  productRepresentation?: ProductRepresentation;
  reviewSources?: ReviewSourceCandidate[];
  detailImageOcrInsights?: ProductDetailImageOcrInsight[];
  productCopyConstraints?: string[];
  verifiedBenefits?: string[];
  ingredients?: string[];
  vendorResearch?: VendorProductResearchContext;
};

export type CopySlotKey = "headline" | "bodyCopy" | "highlightCopy" | "bottomBarCopy" | "cta" | "price";

export type CopyOverflowStrategy = "shrink" | "wrap" | "ellipsis" | "shrink-wrap" | "shrink-ellipsis" | "shrink-wrap-ellipsis";

export type CopyLimit = {
  maxChars: number;
  maxLines: number;
  minFontSize: number;
  maxFontSize: number;
  overflowStrategy: CopyOverflowStrategy;
};

export type TemplateCopyLimits = Partial<Record<CopySlotKey, CopyLimit>>;

export type PalettePolicy = "full-auto" | "accent-only" | "protected-palette" | "fixed";

export type ExtractedPalette = {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textDarkColor: string;
  textLightColor: string;
  mutedColor: string;
  highlightColor: string;
  dangerColor: string;
  sourceImagePath?: string;
  confidence?: number;
};

export type TemplateSlotType = "text" | "image" | "price" | "cta" | "badge" | "background" | "chip" | "decoration";

export type TemplateSlot = {
  id: string;
  type: TemplateSlotType;
  role?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
  safePadding?: number;
  allowAutoFit?: boolean;
  allowMultiLine?: boolean;
  allowShrink?: boolean;
  allowMove?: boolean;
  allowHide?: boolean;
  maxLines?: number;
  priority?: number;
  anchor?: "top-left" | "top-center" | "top-right" | "center" | "bottom-left" | "bottom-center" | "bottom-right";
  preferredVariant?: "short" | "medium" | "long";
  fallbackVariants?: Array<"short" | "medium" | "long">;
  imageFit?: "cover" | "contain" | "smart-cover" | "transparent-product" | "background-image" | "split-image" | "repeat-product";
  intentionalOverlapWith?: string[];
  requiresDistinctImage?: boolean;
};

export type TemplateVariantPreference = {
  preferred: "short" | "medium" | "long";
  fallbackOrder: Array<"short" | "medium" | "long">;
  allowBaseCopy?: boolean;
};

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RenderFitStatus = "exact" | "wrapped" | "shrunk" | "variant-changed" | "ellipsis" | "failed";

export type BannerFitResult = {
  slotId: string;
  status: RenderFitStatus;
  originalText: string;
  finalText: string;
  fontSize: number;
  lineHeight: number;
  lines: string[];
  usedVariant?: "short" | "medium" | "long" | "base";
  boundingBox: BoundingBox;
  overflowX: boolean;
  overflowY: boolean;
  warnings: string[];
};

export type CollisionResolutionAction = "none" | "wrap-text" | "shrink-text" | "change-variant" | "move" | "reduce-decoration" | "hide-low-priority" | "failed";

export type CollisionItem = {
  id: string;
  type: TemplateSlotType;
  boundingBox: BoundingBox;
  priority: number;
  allowMove?: boolean;
  allowShrink?: boolean;
  allowHide?: boolean;
  intentionalOverlapWith?: string[];
};

export type CollisionResult = {
  hasCollision: boolean;
  collisions: Array<{
    firstId: string;
    secondId: string;
    overlapArea: number;
  }>;
  actions: Array<{
    targetId: string;
    action: CollisionResolutionAction;
    reason: string;
  }>;
  finalItems: CollisionItem[];
  warnings: string[];
};

export type RenderDiagnostics = {
  templateId: string;
  paletteApplied: boolean;
  palettePolicy?: PalettePolicy;
  palette: ExtractedPalette;
  preferredVariant?: CopyVariantKey;
  selectedVariant?: CopyVariantKey;
  variantReason?: string;
  fitResults: BannerFitResult[];
  collisionResult: CollisionResult;
  imagePathsUsed: string[];
  hiddenElements: string[];
  optimizationFlags: {
    autoPaletteApplied: boolean;
    textFittingApplied: boolean;
    collisionResolved: boolean;
    lowPriorityElementsHidden: boolean;
  };
  warnings: string[];
  qualityScore: number;
  qualityStatus: "stable" | "review" | "risk";
};

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
  selectedKookdaePattern?: string;
  rejectedGenericExpressions?: string[];
  productFactsUsed?: string[];
};

export type GeneratedAdCopy = GeneratedAdCopyVariant & {
  price: string;
  hookType: string;
  appealPoint: string;
  whyThisWorks: string;
  messageHierarchy?: MessageHierarchy;
  copyGuideUsage?: {
    guideId: string;
    brandName: string;
    usedSections: string[];
    toneApplied: string[];
    selectedPatterns?: Array<{
      variant: "short" | "medium" | "long";
      patternGroup: string;
      sourcePattern: string;
      tone: string;
    }>;
  };
  reasoning?: GeneratedCopyReasoning;
  templateFit?: TemplateFitInfo;
  referencePatternUsage?: ReferencePatternUsage;
  copyValidation?: GeneratedCopyValidation;
  copyVariants?: {
    short?: GeneratedAdCopyVariant;
    medium?: GeneratedAdCopyVariant;
    long?: GeneratedAdCopyVariant;
  };
};

export type TemplateCopyApplyMode = "original" | "auto-variant" | "force-fit";

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

export type BatchRenderStatus = "idle" | "running" | "success" | "partial-success" | "error";

export type BatchRenderItemStatus = "pending" | "running" | "success" | "error";

export type BatchRenderResult = {
  id: string;
  templateId: string;
  templateName: string;
  status: BatchRenderItemStatus;
  imagePath?: string;
  downloadUrl?: string;
  errorMessage?: string;
  selectedVariant?: CopyVariantKey;
  hasOverflow?: boolean;
  overflowSlots?: CopySlotKey[];
  copyPreview?: TemplateCopyPreview;
  diagnostics?: RenderDiagnostics;
  creativeAsset?: CreativeAsset;
  createdAt: string;
};

export type BatchRenderSummary = {
  status: BatchRenderStatus;
  total: number;
  successCount: number;
  errorCount: number;
  results: BatchRenderResult[];
  startedAt?: string;
  finishedAt?: string;
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
