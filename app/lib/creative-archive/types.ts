import type { CreativeAssetStatus } from "../creative-assets/types";
import type { GenerationResultStatus } from "../creative-generation/types";

export type CreativeArchiveSource = "creative-asset" | "generation-result";

export type CreativeArchiveMetadata = {
  entryId: string;
  savedAsReference: boolean;
  tags: string[];
  note: string;
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
  createdAt: string;
  updatedAt: string;
  savedAsReference: boolean;
  tags: string[];
  note: string;
};

export type CreativeArchiveResponse = {
  ok: true;
  entries: CreativeArchiveEntry[];
  generatedAt: string;
};
