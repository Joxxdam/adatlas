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
export type VideoDuration = 15 | 30 | 60;
export type VideoFormat = "short-form" | "reels" | "feed" | "other";
export type VideoObjective = "purchase" | "interest" | "new-product" | "benefit";

export type VideoReferenceAsset = {
  id: string;
  name: string;
  filePath: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
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
  additionalRequests: string;
  productionNotes: string;
  deadline: string;
  referenceAssets: VideoReferenceAsset[];
  productAnalysis: ProductAnalysisSnapshot;
  brandGuideline: BrandGuideline;
  status: VideoProjectStatus;
  concepts: VideoConcept[];
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
  | "additionalRequests"
  | "referenceAssets"
  | "productAnalysis"
  | "brandGuideline"
> & {
  marketerName?: string;
};

export type VideoCollaborationStore = {
  version: "video-collaboration-v2";
  projects: VideoProject[];
};
