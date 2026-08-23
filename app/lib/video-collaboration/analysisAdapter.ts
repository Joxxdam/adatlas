import type { ProductAnalysisSnapshot } from "./types.ts";
import { buildVideoProductAnalysis } from "./workflow.ts";
import { extractVideoTitleMetadata } from "./productName.ts";

type ExtractResponse = {
  productInfo?: Parameters<typeof buildVideoProductAnalysis>[1];
};

export function adaptExtractedProductToVideoSnapshot(response: ExtractResponse, sourceUrl: string): ProductAnalysisSnapshot {
  const product = response.productInfo || {};
  const rawTitle = String(product.productName || "").trim();
  const titleMetadata = extractVideoTitleMetadata(rawTitle, String(product.brandName || ""));
  return {
    ...buildVideoProductAnalysis(sourceUrl, {
      ...product,
      productName: titleMetadata.productName || rawTitle,
    }),
    rawTitle,
    promotion: [String(product.discountInfo || "").trim(), titleMetadata.promotion].filter(Boolean).join(" · "),
    volumeOrOption: titleMetadata.volumeOrOption,
  };
}
