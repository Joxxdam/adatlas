export const VIDEO_PROJECT_STATUSES = [
  "script_pending",
  "script_review",
  "concept_selected",
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
  "loss-aversion",
  "unexpected-comparison",
  "origin-material",
  "before-after",
  "seasonal-situation",
  "myth-busting",
  "user-monologue",
  "product-self-introduction",
] as const;

export type VideoHookType = (typeof VIDEO_HOOK_TYPES)[number];
export type VideoDuration = 15 | 20 | 30 | 45 | 60;
export type VideoDurationMode = "auto" | "fixed";
export const VIDEO_DESIGNER_OPTIONS = ["조이", "애니"] as const;
export type VideoDesignerName = (typeof VIDEO_DESIGNER_OPTIONS)[number];
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
  "auto" | "smartphone-ugc" | "ad-real" | "clay-miniature" | "3d" | "live-ai" | "mixed";
export const VIDEO_CONCEPT_FORMATS = [
  "drama-movie-parody",
  "game-quest",
  "influencer-demo",
  "home-shopping",
  "industry-expert",
  "classic-usp",
  "clay-animation",
] as const;
export type VideoConceptFormat = (typeof VIDEO_CONCEPT_FORMATS)[number];

export const VIDEO_CONCEPT_ARCHETYPES = [
  // These IDs are persisted in existing projects. Keep them stable while the
  // user-facing meanings follow the current story-mechanism taxonomy below.
  "parody",
  "real-review",
  "usp-focus",
  "secret-benefit",
] as const;
export type VideoConceptArchetype = (typeof VIDEO_CONCEPT_ARCHETYPES)[number];

export const VIDEO_PARODY_GENRES = [
  "historical-world-parody",
  "price-negotiation",
  "audition-interview",
  "news-report",
  "quiz-show",
  "blind-test",
  "competition-judging",
  "family-office-sitcom",
  "mystery-investigation",
  "live-auction",
  "courtroom",
] as const;
export type VideoParodyGenre = (typeof VIDEO_PARODY_GENRES)[number];

export const VIDEO_CONCEPT_ARCHETYPE_OPTIONS: Array<{
  id: VideoConceptArchetype;
  label: string;
  description: string;
  direction: string;
}> = [
  {
    id: "parody",
    label: "창작 인물·상황극형",
    description: "가상의 인물·관계·시대·직업과 사건을 만들어 상품을 이야기의 반전이나 해결로 연결합니다.",
    direction:
      "가족·직장·시장 같은 현실 관계부터 역사·미래·법정·뉴스·오디션·경매·탐정 같은 창작 세계까지 상품과 맞는 장르 하나를 고른다. 인물과 사건은 자유롭게 창작하되 실제 인물·후기로 사칭하지 않고, 상품의 가격·구성·원료·효능·성과는 검증된 사실만 사용한다. 가상의 의사 가족 추천은 허용하되 의학적 효능이나 보증의 근거로 사용하지 않는다.",
  },
  {
    id: "real-review",
    label: "가족·지인 생활 반응형",
    description: "아버지·배우자·아이·친구의 평소 습관과 한마디를 화자가 시청자에게 들려줍니다.",
    direction:
      "가족끼리 긴 대사를 주고받지 않는다. ‘아니 여러분, 고기 없으면 숟가락부터 내려놓는 저희 아버지가 한 팩 더 없냐시더라고요’처럼 주 화자가 관계·평소 습관·이번 반응·직접 확인한 이유를 한 흐름으로 이어 말한다. 실제 구매자 후기인 척하지 않는다.",
  },
  {
    id: "usp-focus",
    label: "직접 확인·조리·사용형",
    description: "포장을 열고 조리하거나 사용하면서 질감·구성·원료·공정의 차이를 화면으로 확인합니다.",
    direction:
      "한 가지 현실적인 의심에서 시작해 개봉·조리·절단·한입·손동작·원료·공정 중 상품에 맞는 증거를 바로 보여준다. 관련 없는 경쟁 상품이나 거창한 실험실을 만들지 않고 검증된 사실과 카메라로 보이는 감각만 말한다.",
  },
  {
    id: "secret-benefit",
    label: "구매 고민·가격 발견형",
    description: "외식비·선물비·구성·가격처럼 실제 구매 전에 망설이는 이유를 상품 근거로 풀어갑니다.",
    direction:
      "‘좋지만 비싸서 망설였다’, ‘어디서 사야 할지 매번 비교했다’처럼 실제 구매 고민을 먼저 말한다. 구성·가격·품질 이유를 욕구가 생긴 뒤 공개하고, 확인된 혜택이 없으면 억지 할인이나 비밀 설정 대신 선택 기준과 쓰임으로 마무리한다. 상품 의인화는 자동 생성하지 않는다.",
  },
];

export const VIDEO_CONCEPT_FORMAT_OPTIONS: Array<{
  id: VideoConceptFormat;
  kicker: string;
  title: string;
  description: string;
  flow: string;
  creativeStyle: VideoCreativeStyle;
  direction: string;
}> = [
  {
    id: "drama-movie-parody",
    kicker: "SCENE",
    title: "드라마·영화 패러디",
    description: "익숙한 장르 문법으로 갈등과 반전을 만들고 상품을 해결 장치로 등장시킵니다.",
    flow: "갈등 → 반전 → 상품 등장",
    creativeStyle: "ad-real",
    direction:
      "저작권이 있는 작품·대사·캐릭터를 복제하지 않고 드라마와 영화의 보편적인 장르 문법만 활용한다.",
  },
  {
    id: "game-quest",
    kicker: "QUEST",
    title: "게임·퀘스트 형식",
    description: "문제를 미션과 게이지로 바꾸고 상품 사용을 클리어 과정처럼 전개합니다.",
    flow: "미션 발생 → 아이템 사용 → 클리어",
    creativeStyle: "mixed",
    direction:
      "게임 HUD, 퀘스트, 레벨업, 선택지 같은 화면 문법을 실제 촬영 가능한 장면 설명과 함께 구성한다.",
  },
  {
    id: "influencer-demo",
    kicker: "REVIEW",
    title: "인플루언서 상품소개",
    description: "카메라를 보며 직접 써보고 솔직한 반응과 사용 장면으로 상품을 소개합니다.",
    flow: "첫 반응 → 직접 사용 → 한줄 결론",
    creativeStyle: "smartphone-ugc",
    direction:
      "자연스러운 셀프 촬영, 손동작, 실제 사용 순서, 짧은 리액션을 중심으로 과장 없는 UGC형 장면을 만든다.",
  },
  {
    id: "home-shopping",
    kicker: "LIVE",
    title: "홈쇼핑 상품소개",
    description: "진행자가 핵심 구성과 사용법을 빠르게 시연하며 구매 이유를 명확히 정리합니다.",
    flow: "혜택 선언 → 시연 → 구성 정리",
    creativeStyle: "ad-real",
    direction:
      "진행자와 시연 테이블, 상품 클로즈업, 구성 비교를 활용하되 확인된 가격과 혜택만 말한다.",
  },
  {
    id: "industry-expert",
    kicker: "EXPERT",
    title: "업계 관계자 형식",
    description: "개발자·바이어·생산자 등 상품을 잘 아는 역할이 선택 기준을 설명합니다.",
    flow: "업계 질문 → 선택 기준 → 상품 근거",
    creativeStyle: "ad-real",
    direction:
      "실제 인물의 경력이나 자격을 허위로 만들지 않는다. 업계 관계자 역할극임을 전제로 검증된 상품 근거를 설명한다.",
  },
  {
    id: "classic-usp",
    kicker: "USP",
    title: "상품 USP 형식",
    description: "상품의 가장 강한 차별점 하나를 실제 사용 장면과 근거로 선명하게 보여줍니다.",
    flow: "문제 → 핵심 USP → 사용 결과",
    creativeStyle: "ad-real",
    direction:
      "한 영상에서 하나의 핵심 USP를 중심으로 상품, 사용 행동, 검증된 수치나 특징을 이해하기 쉽게 연결한다.",
  },
  {
    id: "clay-animation",
    kicker: "CLAY",
    title: "클레이 애니메이션",
    description: "점토 세계와 미니어처 움직임으로 상품 특징을 짧고 기억에 남게 표현합니다.",
    flow: "클레이 문제 장면 → 변형 → 해결",
    creativeStyle: "clay-miniature",
    direction:
      "이미지를 생성하지 않는다. 클레이 질감, 미니어처 세트, 프레임 단위 움직임이 보이도록 촬영·제작 가능한 장면 설명만 쓴다.",
  },
];
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
  rawTitle?: string;
  promotion?: string;
  volumeOrOption?: string;
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
  productType?: string;
  composition?: string[];
  weightOrVolume?: string;
  minimumOrderQuantity?: string;
  shippingConditions?: string[];
  manufacturingProcess?: string[];
  certifications?: string[];
  actualBenefits?: string[];
  adUsableFacts?: ProductEvidence[];
  evidenceCoverage?: "sufficient" | "limited";
};

export type VideoGenerationStage =
  | "product-analysis"
  | "reference-analysis"
  | "hook-candidates"
  | "concept-summaries"
  | "detailed-script"
  | "json-parse"
  | "schema-validation"
  | "quality-review"
  | "automatic-revision";

export type VideoGenerationFailure = {
  stage: VideoGenerationStage;
  code: string;
  message: string;
  retryable: boolean;
  attempts: number;
  failedAt: string;
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

export type VideoPlanningBlueprintSelection = {
  primaryId: string;
  secondaryId?: string;
  reason: string;
  transferableRules: string[];
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
  generationSource: "openai" | "codex-local";
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
  detailStatus?: "not-generated" | "generating" | "ready" | "failed";
  generationFailure?: VideoGenerationFailure;
  evidenceIds?: string[];
  speaker?: string;
  narrativeStructure?: string;
  conceptFormat?: VideoConceptFormat;
  conceptArchetype?: VideoConceptArchetype;
  centralIncident?: string;
  speakerPointOfView?: string;
  keyAppeal?: string;
  recommendedVisualStyle?: string;
  supportingDevices?: string[];
  differenceFromPrevious?: string;
  /** 레퍼런스의 말끝·호칭·문장 파편 리듬을 상품 상황에 맞게 옮긴 자막 톤 지시. */
  copyVoiceDirection?: string;
  /** 분석형 타깃명이 아니라 첫 3초 자막에 바로 쓸 수 있는 구체적이고 자극적인 타깃 호명. */
  targetCallout?: string;
  benefitAvailability?: "verified" | "insufficient";
  blueprintSelection?: VideoPlanningBlueprintSelection;
  /** 창작 인물·상황극형에서 자동 선택되어 요약과 상세 대본을 끝까지 고정하는 세부 장르. */
  parodyGenre?: VideoParodyGenre;
  /** 이름·관계·직업·습관·경력 중 두 가지 이상이 드러나는 기억 가능한 창작 인물. */
  distinctiveCharacter?: string;
  /** 현재·과거·미래·가상 사회를 포함해 한 장면으로 떠오르는 구체적인 세계와 맥락. */
  socialWorld?: string;
  /** 상품이 등장하기 전에 인물과 배경에서 실제로 벌어지는 한 가지 창작 사건. */
  storyTrigger?: string;
  /** 창작 사건을 상세페이지의 검증된 USP 두세 가지로 설득하는 연결 방식. */
  truthBridge?: string;
  /** 상황극 설정과 검증된 상품 사실을 제작 과정에서 혼동하지 않기 위한 내부 경계. */
  dramatizationBoundary?: string;
};

export type VideoConceptSlotStatus = "pending" | "generating" | "ready" | "failed";

/**
 * Four fixed summary slots let a project expose valid concepts immediately
 * without pretending that a failed archetype is a completed concept.
 * The actual ready payload remains in `project.concepts` for backwards
 * compatibility with selection, detailed-script and production flows.
 */
export type VideoConceptSlot = {
  archetype: VideoConceptArchetype;
  status: VideoConceptSlotStatus;
  conceptId?: string;
  failure?: VideoGenerationFailure;
  attempts: number;
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

export type DesignerAssignmentHistoryEntry = {
  id: string;
  previousDesigner: string;
  nextDesigner: string;
  changedBy: string;
  changedAt: string;
};

export type VideoProductionRequest = {
  requestedAt: string;
  requestedBy: string;
  designerName: string;
  deadline: string;
  note: string;
  conceptId: string;
  scriptRevisionId: string;
  referenceAssetIds: string[];
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
  conceptFormat?: VideoConceptFormat;
  planningMode?: "four-concepts";
  videoPlanningEngineVersion?:
    | "reference-imaginative-v6"
    | "reference-lifestyle-v5"
    | "story-mechanism-v4"
    | "reference-dialogue-v3"
    | "specific-world-v2"
    | "legacy";
  durationMode?: VideoDurationMode;
  advancedTarget?: string;
  advancedTone?: string;
  additionalRequests: string;
  requiredContent?: string;
  excludedContent?: string;
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
  conceptSlots?: VideoConceptSlot[];
  hookCandidates?: VideoHookCandidate[];
  pipelineProgress?: VideoPipelineProgress[];
  selectedConceptId?: string;
  finalScript?: VideoConcept;
  scriptRevisions: VideoScriptRevision[];
  versions: VideoVersion[];
  comments: ReviewComment[];
  approvedVersionId?: string;
  statusHistory: StatusHistoryEntry[];
  designerAssignmentHistory?: DesignerAssignmentHistoryEntry[];
  generationFailure?: VideoGenerationFailure;
  productionRequest?: VideoProductionRequest;
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
  | "duration"
  | "status"
  | "selectedConceptId"
  | "deadline"
  | "createdAt"
  | "updatedAt"
> & {
  productName: string;
  hookType?: VideoHookType;
  conceptFormat?: VideoConceptFormat;
  materialCode?: string;
  latestVersionNumber?: number;
  selectedConceptTitle?: string;
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
  | "conceptFormat"
  | "durationMode"
  | "advancedTarget"
  | "advancedTone"
  | "additionalRequests"
  | "requiredContent"
  | "excludedContent"
  | "referenceAssets"
  | "productOriginalAsset"
  | "productAnalysis"
  | "brandGuideline"
> & {
  marketerName?: string;
  deadline?: string;
};

export type VideoCollaborationStore = {
  version: "video-collaboration-v2";
  projects: VideoProject[];
};
