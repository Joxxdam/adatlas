import type { CreativeAssetStatus } from "../creative-assets/types";
import type { GenerationResultStatus } from "../creative-generation/types";
import type { ProductAdCopy } from "../ad-copy/types";

export type CreativeArchiveSource = "creative-asset" | "generation-result";

export type CreativeArchiveDeliveryBranding = {
  logoId?: string;
  aiDisclosure: boolean;
  updatedAt: string;
};

export type StoredCreativeArchiveDeliveryBranding = CreativeArchiveDeliveryBranding & {
  imagePath: string;
  sourceImagePath: string;
};

export type CreativeArchiveMetadata = {
  entryId: string;
  savedAsReference: boolean;
  tags: string[];
  note: string;
  deliveryBranding?: StoredCreativeArchiveDeliveryBranding;
  deletedAt?: string;
  updatedAt: string;
};

export type CreativeArchiveEntry = {
  id: string;
  source: CreativeArchiveSource;
  assetCode?: string;
  advertiserId?: string;
  advertiserName: string;
  brandName: string;
  productId?: string;
  productName: string;
  category: string;
  hookCode: string;
  materialCode?: string;
  copyPlanMode?: "reference-adapted" | "legacy-hook-first";
  referenceId?: string;
  hookType: string;
  headline: string;
  subCopy: string;
  mainMessage: string;
  visualDirection: string;
  imageUrl: string;
  downloadUrl: string;
  fileName: string;
  status: CreativeAssetStatus | GenerationResultStatus;
  qaScore?: number;
  jobId?: string;
  resultId?: string;
  resultUrl?: string;
  landingUrl?: string;
  utmContent?: string;
  recommendedAdName?: string;
  templateId?: string;
  createdAt: string;
  updatedAt: string;
  savedAsReference: boolean;
  tags: string[];
  note: string;
  brandingEligible: boolean;
  deliveryBranding?: CreativeArchiveDeliveryBranding;
  /** 사용자가 이 이미지에서 개별 생성한 Meta 광고 문구와 제목입니다. */
  adCopy?: ProductAdCopy;
};

export type CreativeArchiveResponse = {
  ok: true;
  entries: CreativeArchiveEntry[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  generatedAt: string;
};
