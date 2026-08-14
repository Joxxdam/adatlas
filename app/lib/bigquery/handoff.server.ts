import "server-only";

import type { ProductInfoForPrompt } from "../mvp/types";
import type { ProductCreationHandoff } from "../store-analysis/types";
import { getBigQueryCandidate } from "./candidateService.server";
import type { BigQueryAdCandidate, BigQueryCandidateMetric } from "./types";

function metricText(metric: BigQueryCandidateMetric) {
  if (metric.value === null) return `${metric.label}: 데이터 없음`;
  if (metric.unit === "currency") {
    return `${metric.label}: ${Math.round(metric.value).toLocaleString("ko-KR")}원`;
  }
  if (metric.unit === "rate") return `${metric.label}: ${(metric.value * 100).toFixed(1)}%`;
  if (metric.unit === "rank") return `${metric.label}: ${Math.round(metric.value)}위`;
  return `${metric.label}: ${Math.round(metric.value).toLocaleString("ko-KR")}`;
}

function productInfo(candidate: BigQueryAdCandidate): ProductInfoForPrompt {
  const evidence = candidate.metrics.slice(0, 6).map(metricText);
  return {
    productName: candidate.productName,
    category: candidate.category || "기타",
    price: "",
    originalPrice: "",
    oldPrice: "",
    advertiserName: candidate.brandName,
    brandName: candidate.brandName,
    discountInfo: "",
    mainBenefit: candidate.recommendedMessageAngles.join(" · "),
    targetCustomer: "실제 판매·노출·구매 근거를 확인하고 상품을 비교하는 고객",
    landingUrl: candidate.productUrl || "",
    productImagePath: candidate.imageUrl || "",
    secondaryProductImagePath: "",
    productImagePaths: candidate.imageUrl ? [candidate.imageUrl] : [],
    backgroundImagePath: "",
    extractedDescription: `${candidate.recommendationReason} ${evidence.join(" · ")}`,
    extractedMainImage: candidate.imageUrl || "",
    extractedGalleryImages: candidate.imageUrl ? [candidate.imageUrl] : [],
    selectedBackgroundSource: "",
    backgroundMode: "none",
    sourceImageCandidates: [],
    selectedSourceImageId: "",
    selectedSourceImagePath: "",
    verifiedBenefits: candidate.recommendedMessageAngles,
    creativeContext: {
      advertiserId: candidate.advertiserId,
      productId: candidate.productId || candidate.id,
      opportunityId: candidate.id,
      analysisRunId: `bigquery-${candidate.latestDataDate}-${candidate.analysisPeriodStart}`,
      opportunityType: candidate.primaryType,
      recommendedObjective: candidate.recommendationReason,
      recommendedHookTypes: candidate.recommendedHookTypes,
      recommendedMessageAngles: candidate.recommendedMessageAngles,
      dataEvidence: evidence,
      dataAsOf: candidate.latestDataDate,
      dataSources: candidate.sourceTables,
      dataSufficiency:
        candidate.dataSufficiency === "connection-required"
          ? "data-insufficient"
          : candidate.dataSufficiency,
      analysisSource: "BIGQUERY",
    },
  };
}

export async function buildBigQueryProductCreationHandoff(
  candidateId: string
): Promise<ProductCreationHandoff | null> {
  const candidate = await getBigQueryCandidate(candidateId);
  if (!candidate) return null;
  const info = productInfo(candidate);
  return {
    analysisId: `bigquery-${candidate.latestDataDate}`,
    productId: candidate.productId || candidate.id,
    productUrl: candidate.productUrl || "",
    productInfo: info,
    productImagePaths: info.productImagePaths || [],
    availableContentAngles: [],
    recommendedTemplateIds: [],
    recommendedReferenceLabelIds: [],
    recommendedStyleName: "데이터 근거 중심 퍼포먼스 광고",
    advertiserName: candidate.brandName,
    advertisingScore: candidate.score,
    confidence: candidate.dataSufficiency === "analysis-ready" ? 0.8 : 0.5,
    creativeContext: info.creativeContext,
  };
}
