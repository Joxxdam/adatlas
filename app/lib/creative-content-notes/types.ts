export const creativeContentNoteScopes = ["advertiser", "category", "product", "promotion"] as const;

export const creativeContentNoteTypes = ["TONE_AND_MANNER", "DESIGN_GUIDELINE", "TARGET_AUDIENCE", "REQUIRED_EVIDENCE", "LANDING_PAGE_CAUTION", "PRODUCT_IMAGE_RULE", "AVOIDED_HOOK", "ADVERTISER_FEEDBACK", "REVIEW_INSIGHT", "ADDITIONAL_NOTE", "TONE_OF_VOICE", "PREFERRED_HOOK", "MUST_INCLUDE", "PROHIBITED_EXPRESSION", "PRODUCT_USP", "PRICE_POLICY", "PROMOTION", "IMAGE_RULE", "BACKGROUND_STYLE", "LAYOUT_RULE", "COMPLIANCE", "FREEFORM"] as const;

export type CreativeContentNoteScope = (typeof creativeContentNoteScopes)[number];
export type CreativeContentNoteType = (typeof creativeContentNoteTypes)[number];

export type CreativeContentNote = {
  id: string;
  advertiserId: string;
  scope: CreativeContentNoteScope;
  scopeId: string;
  type: CreativeContentNoteType;
  title: string;
  content: string;
  required: boolean;
  prohibited: boolean;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  source: "user" | "feedback" | "import" | "system";
  createdAt: string;
  updatedAt: string;
  categoryId?: string | null;
  productId?: string | null;
  priority?: number;
  isRequired?: boolean;
  isActive?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  createdBy?: string;
};

export type CreativeContentNoteContext = {
  advertiserId: string;
  categoryId?: string;
  productId?: string;
  promotionId?: string;
  at?: string;
};

export type ResolvedCreativeContentNote = CreativeContentNote & {
  priority: number;
  appliedReason: string;
  conflictsWith: string[];
};

export type ContentNoteResolution = {
  notes: ResolvedCreativeContentNote[];
  conflicts: Array<{
    noteIds: string[];
    message: string;
    blocking: boolean;
  }>;
  resolvedAt: string;
};

export type CreativeNoteCompliance = {
  state: "passed" | "repaired" | "blocked";
  appliedNoteIds: string[];
  requiredMissing: string[];
  prohibitedFound: string[];
  repairs: string[];
  checkedAt: string;
};

export type CreativeOpportunityContext = {
  advertiserId: string;
  productId: string;
  opportunityId?: string;
  analysisRunId?: string;
  opportunityType?: string;
  recommendedObjective?: string;
  recommendedHookTypes?: string[];
  recommendedMessageAngles?: string[];
  reviewInsightIds?: string[];
  reviewInsightSummaries?: string[];
  appliedContentNotes?: ResolvedCreativeContentNote[];
  dataEvidence?: string[];
  dataAsOf?: string;
  dataSources?: string[];
  dataSufficiency?: "analysis-ready" | "reference-only" | "data-insufficient";
  analysisSource?: "BIGQUERY" | "SITE_PUBLIC_DATA" | "CREMA" | "STORE_ANALYSIS";
  adFitScore?: number;
  evidenceLevel?: "high" | "medium" | "low";
  recommendationReasons?: string[];
};
