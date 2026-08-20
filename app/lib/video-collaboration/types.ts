export const VIDEO_PROJECT_STATUSES = [
  "script_pending",
  "script_review",
  "production_requested",
  "in_production",
  "marketer_review",
  "revision_requested",
  "approved",
] as const;

export type VideoProjectStatus = (typeof VIDEO_PROJECT_STATUSES)[number];

export const VIDEO_HOOK_TYPES = [
  "problem-solution",
  "price-benefit",
  "feature-usp",
  "sensory-scene",
  "curiosity",
  "review-trust",
  "brand-message",
] as const;

export type VideoHookType = (typeof VIDEO_HOOK_TYPES)[number];
export type VideoDuration = 15 | 20 | 30 | 60;
export type VideoFormat = "short-form" | "reels" | "feed" | "other";
export type VideoObjective =
  | "purchase"
  | "new-customer-hook"
  | "retargeting"
  | "usp"
  | "review-ugc"
  | "interest"
  | "new-product"
  | "benefit";
export type VideoPlatform = "meta" | "instagram" | "tiktok" | "youtube-shorts";
export type VideoCreativeStyle =
  | "auto"
  | "smartphone-ugc"
  | "ad-real"
  | "clay-miniature"
  | "3d"
  | "live-ai"
  | "mixed";
export type EvidenceBucket = "verified" | "inferred" | "unsupported";

export type ProductEvidence = {
  id: string;
  label: string;
  value: string;
  source: string;
  bucket: EvidenceBucket;
};

export type VideoReferenceAsset = {
  id: string;
  name: string;
  filePath: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  role?: "product-original" | "reference";
};

export type ReferenceVideoAnalysis = {
  assetId: string;
  assetName: string;
  analysisStatus: "analyzed" | "limited" | "not-applicable";
  openingHookMethod: string;
  openingTiming: string;
  cutCount: number | null;
  averageCutLength: number | null;
  cameraAndGaze: string[];
  actions: string[];
  informationDensity: string;
  subtitlePosition: string;
  transitions: string[];
  timingMap: { problem: string; product: string; usp: string; cta: string };
  compositionRatio: {
    liveAction: number | null;
    animation: number | null;
    composite: number | null;
  };
  emotionalTone: string;
  reusablePrinciples: string[];
  limitations: string[];
};

export type VideoSceneReferenceImage = {
  id: string;
  source: "upload" | "external";
  filePath: string;
  name: string;
  mimeType: string;
  size: number;
  description: string;
  required: boolean;
  createdAt: string;
};

export type ProductAnalysisSnapshot = {
  productName: string;
  brandName: string;
  category: string;
  productUrl: string;
  price: string;
  originalPrice: string;
  discountInfo: string;
  coreUsps: string[];
  keyFeatures: string[];
  targetCustomers: string[];
  customerProblems: string[];
  trustSignals: string[];
  cautionPhrases: string[];
  imageUrls: string[];
  rawDescription: string;
  source: "existing-product-extractor" | "manual";
  analyzedAt: string;
  editedAt?: string;
  inferredFields?: Array<"targetCustomers" | "customerProblems">;
  analysisNotes?: string[];
  countryOfOrigin?: string;
  ingredients?: string[];
  attributes?: string[];
  expectedChanges?: string[];
  verifiedNumbers?: string[];
  repeatedReviewPhrases?: string[];
  differentiators?: string[];
  useSituations?: string[];
  visualizableElements?: string[];
  verifiedFacts?: ProductEvidence[];
  inferredAngles?: ProductEvidence[];
  unsupportedClaims?: ProductEvidence[];
};

export type HookScore = {
  stopPower: number;
  specificity: number;
  productRelevance: number;
  visualPotential: number;
  evidenceStrength: number;
  conversionPotential: number;
  originality: number;
  policySafety: number;
  total: number;
};

export type VideoHookCandidate = {
  id: string;
  hookType: VideoHookType;
  hook: string;
  customerProblem: string;
  evidenceIds: string[];
  visualIdea: string;
  score: HookScore;
  rejectionReasons: string[];
};

export type VideoConceptScore = HookScore & { narrativeFlow: number };

export type VideoVisualBible = {
  visualMode: string;
  aspectRatio: "9:16";
  mainCharacter: string;
  characterAppearance: string;
  wardrobe: string;
  backgroundWorld: string;
  colorPalette: string[];
  lighting: string;
  materialTexture: string;
  cameraStyle: string;
  productPresentation: string;
  textSafeArea: string;
  transitionRules: string[];
  continuityRules: string[];
  negativePrompt: string[];
};

export type ProductLockedAsset = {
  assetId: string;
  filePath: string;
  originalFileName: string;
  preserveRules: string[];
  availableAngles: string[];
  limitations: string[];
};

export type PipelineStageName =
  | "productAnalysis"
  | "hookCandidates"
  | "conceptCandidates"
  | "conceptScoring"
  | "selectedConcept"
  | "storyboard"
  | "visualBible"
  | "scenePrompts"
  | "validation"
  | "finalRevision";
export type PipelineStageStatus = "pending" | "running" | "complete" | "warning" | "failed";
export type VideoPipelineProgress = {
  stage: PipelineStageName;
  status: PipelineStageStatus;
  message: string;
  updatedAt: string;
};
export type VideoPlanValidation = {
  valid: boolean;
  score: number;
  revised: boolean;
  checks: Array<{ key: string; passed: boolean; message: string }>;
};

export type BrandGuideline = {
  toneAndManner: string;
  primaryAudience: string;
  coreUsps: string;
  requiredPhrases: string[];
  forbiddenPhrases: string[];
  advertiserRequests: string;
  designerNotes: string;
  matchedCopyGuideId?: string;
  matchedCopyGuideName?: string;
};

export type VideoCut = {
  id: string;
  cutNumber: number;
  sceneName: string;
  startSecond: number;
  endSecond: number;
  sceneDescription: string;
  caption: string;
  narration: string;
  requiredSources: string[];
  referenceImages: VideoSceneReferenceImage[];
  productionMemo: string;
  sceneFormat?: string;
  cameraComposition?: string;
  motionDirection?: string;
  transition?: string;
  generationPrompt?: string;
  productLockInstruction?: {
    useOriginalComposite: boolean;
    position: string;
    size: string;
    cameraAngle: string;
    handInteraction: string;
    labelVisibility: string;
    matchCut: string;
    editMargin: string;
  };
};

export type VideoConcept = {
  id: string;
  title: string;
  hookType: VideoHookType;
  coreTarget: string;
  objective: VideoObjective;
  openingHook: string;
  fullScript: string;
  cuts: VideoCut[];
  requiredSources: string[];
  cta: string;
  productionCautions: string[];
  materialCode: string;
  generationSource: "openai" | "grounded-rules";
  generationWarnings: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  customerProblem?: string;
  usp?: string;
  creativeStyle?: VideoCreativeStyle;
  narrativeSummary?: string;
  recommendationReason?: string;
  claimsToVerify?: string[];
  score?: VideoConceptScore;
  visualBible?: VideoVisualBible;
  validation?: VideoPlanValidation;
};

export type VideoScriptRevision = {
  id: string;
  conceptId: string;
  revision: number;
  changedAt: string;
  changedBy: string;
  reason: "generated" | "regenerated" | "manual-edit" | "finalized";
  stage?: "ai-generated" | "marketer-final" | "post-request-latest";
  snapshot: VideoConcept;
};

export type VideoProjectMilestones = {
  scriptCreatedAt?: string;
  scriptFinalizedAt?: string;
  productionRequestedAt?: string;
  productionStartedAt?: string;
  videoUploadedAt?: string;
  revisionRequestedAt?: string;
  approvedAt?: string;
};

export type VideoVersionReviewStatus = "pending" | "changes_requested" | "approved";

export type VideoVersion = {
  id: string;
  versionNumber: number;
  filePath: string;
  originalFileName: string;
  storedFileName: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
  reviewStatus: VideoVersionReviewStatus;
};

export type ReviewComment = {
  id: string;
  versionId: string;
  body: string;
  author: string;
  timecodeSeconds?: number;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
};

export type StatusHistoryEntry = {
  id: string;
  from: VideoProjectStatus | null;
  to: VideoProjectStatus;
  actor: string;
  note: string;
  changedAt: string;
};

export type VideoProject = {
  id: string;
  projectName: string;
  advertiserName: string;
  productUrl: string;
  marketerName: string;
  designerName: string;
  duration: VideoDuration;
  format: VideoFormat;
  objective: VideoObjective;
  platform?: VideoPlatform;
  aspectRatio?: "9:16";
  creativeStyle?: VideoCreativeStyle;
  advancedTarget?: string;
  advancedTone?: string;
  additionalRequests: string;
  productionNotes: string;
  deadline: string;
  referenceAssets: VideoReferenceAsset[];
  productOriginalAsset?: VideoReferenceAsset;
  productLockedAsset?: ProductLockedAsset;
  referenceAnalyses?: ReferenceVideoAnalysis[];
  productAnalysis: ProductAnalysisSnapshot;
  brandGuideline: BrandGuideline;
  status: VideoProjectStatus;
  concepts: VideoConcept[];
  hookCandidates?: VideoHookCandidate[];
  pipelineProgress?: VideoPipelineProgress[];
  selectedConceptId?: string;
  finalScript?: VideoConcept;
  scriptRevisions: VideoScriptRevision[];
  versions: VideoVersion[];
  comments: ReviewComment[];
  approvedVersionId?: string;
  statusHistory: StatusHistoryEntry[];
  milestones: VideoProjectMilestones;
  scriptLastEditedBy: string;
  sourceProjectId?: string;
  createdAt: string;
  updatedAt: string;
};

export type VideoProjectSummary = Pick<
  VideoProject,
  | "id"
  | "projectName"
  | "advertiserName"
  | "productUrl"
  | "marketerName"
  | "designerName"
  | "status"
  | "selectedConceptId"
  | "deadline"
  | "createdAt"
  | "updatedAt"
> & {
  productName: string;
  hookType?: VideoHookType;
  materialCode?: string;
  latestVersionNumber?: number;
};

export type CreateVideoProjectInput = Pick<
  VideoProject,
  | "projectName"
  | "advertiserName"
  | "productUrl"
  | "designerName"
  | "duration"
  | "format"
  | "objective"
  | "platform"
  | "aspectRatio"
  | "creativeStyle"
  | "advancedTarget"
  | "advancedTone"
  | "additionalRequests"
  | "referenceAssets"
  | "productOriginalAsset"
  | "productAnalysis"
  | "brandGuideline"
> & {
  marketerName?: string;
};

export type VideoCollaborationStore = {
  version: "video-collaboration-v2";
  projects: VideoProject[];
};
