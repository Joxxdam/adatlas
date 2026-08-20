export const adCopyStatuses = [
  "generating",
  "ready",
  "needs-review",
  "approved",
  "excluded",
] as const;

export type AdCopyStatus = (typeof adCopyStatuses)[number];

export type AdCopyQa = {
  passed: boolean;
  factualAccuracy: number;
  hookAlignment: number;
  metaReadability: number;
  failures: string[];
  checkedAt: string;
};

/** 상품 하나에 하나만 존재하는 Meta 기본 문구 레코드입니다. */
export type ProductAdCopy = {
  id: string;
  jobId: string;
  advertiserId: string;
  productId: string;
  creativeId: string;
  representativeResultId: string;
  basedOnHookId: string;
  basedOnCreativeBriefId: string;
  primaryText?: string;
  assetCode?: string;
  adName?: string;
  utm?: string;
  verifiedFacts: string[];
  languageTraits: string[];
  generatedAt: string;
  updatedAt: string;
  status: AdCopyStatus;
  revision: number;
  promptVersion: string;
  sourceFingerprint: string;
  qa?: AdCopyQa;
  approvedAt?: string;
  approvalReason?: string;
  performanceData?: Record<string, number>;
};

export type ApprovedAdCopyMemory = Pick<
  ProductAdCopy,
  | "id"
  | "advertiserId"
  | "productId"
  | "basedOnHookId"
  | "primaryText"
  | "approvedAt"
  | "approvalReason"
  | "performanceData"
  | "languageTraits"
>;
