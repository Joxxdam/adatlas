import type { ProductAnalysisSnapshot } from "./types.ts";
import { buildVideoProductAnalysis } from "./workflow.ts";

type ExtractResponse = {
  productInfo?: Parameters<typeof buildVideoProductAnalysis>[1];
};

export function adaptExtractedProductToVideoSnapshot(
  response: ExtractResponse,
  sourceUrl: string
): ProductAnalysisSnapshot {
  return buildVideoProductAnalysis(sourceUrl, response.productInfo || {});
}
