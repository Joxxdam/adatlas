export const adCopyStatuses = ["generating", "ready", "needs-review", "approved", "excluded"] as const;

export type AdCopyStatus = (typeof adCopyStatuses)[number];

export type AdCopyQa = {
  passed: boolean;
  factualAccuracy: number;
  hookAlignment: number;
  metaReadability: number;
  failures: string[];
  checkedAt: string;
};

/**
 * Meta 광고 등록용 문구 레코드입니다.
 *
 * archiveEntryId가 있으면 아카이브 이미지 한 장에 귀속되는 신규 레코드이고,
 * 값이 없으면 과거 상품 작업 단위 레코드로 읽습니다.
 */
export type ProductAdCopy = {
  id: string;
  archiveEntryId?: string;
  jobId: string;
  advertiserId: string;
  productId: string;
  creativeId: string;
  representativeResultId: string;
  basedOnHookId: string;
  basedOnCreativeBriefId: string;
  primaryText?: string;
  /** Meta 광고에서 기본 문구 아래에 노출하는 짧은 광고 제목입니다. */
  adTitle?: string;
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

export type ApprovedAdCopyMemory = Pick<ProductAdCopy, "id" | "advertiserId" | "productId" | "basedOnHookId" | "primaryText" | "adTitle" | "approvedAt" | "approvalReason" | "performanceData" | "languageTraits">;
