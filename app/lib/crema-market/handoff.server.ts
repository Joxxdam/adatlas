import type { ProductInfoForPrompt } from "../mvp/types.ts";
import type { ProductCreationHandoff } from "../store-analysis/types.ts";
import { creativeContentNoteRepository } from "../creative-content-notes/repository.server.ts";
import { cremaMarketRepository } from "./repository.server.ts";

function currency(value: number | null) {
  return value === null ? "" : `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export async function buildOpportunityProductCreationHandoff(opportunityId: string): Promise<ProductCreationHandoff | null> {
  const found = await cremaMarketRepository.findOpportunity(opportunityId);
  if (!found) return null;
  const { dataset, opportunity } = found;
  const product = dataset.products.find((item) => item.id === opportunity.productId);
  const run = dataset.analysisRuns.find((item) => item.id === opportunity.analysisRunId);
  if (!product || !run) return null;
  const insights = dataset.reviewInsights.filter((insight) => insight.productId === product.id).slice(0, 5);
  const noteResolution = await creativeContentNoteRepository.resolve({
    advertiserId: dataset.advertiser.id,
    categoryId: product.categoryId || undefined,
    productId: product.id,
  });
  const creativeContext = {
    advertiserId: dataset.advertiser.id,
    productId: product.id,
    opportunityId: opportunity.id,
    analysisRunId: opportunity.analysisRunId,
    opportunityType: opportunity.type,
    recommendedObjective: opportunity.recommendation.objective,
    recommendedHookTypes: opportunity.recommendation.hookTypes,
    recommendedMessageAngles: opportunity.recommendation.messageAngles,
    reviewInsightIds: insights.map((insight) => insight.id),
    reviewInsightSummaries: insights.map((insight) => insight.summary),
    appliedContentNotes: noteResolution.notes,
  };
  const images = [product.imageUrl].filter((value): value is string => Boolean(value));
  const productInfo: ProductInfoForPrompt = {
    productName: product.name,
    category: product.categoryName || "기타",
    price: currency(product.finalPrice),
    originalPrice: currency(product.originalPrice),
    oldPrice: currency(product.originalPrice),
    advertiserName: dataset.advertiser.name,
    brandName: dataset.advertiser.brandName,
    discountInfo: product.originalPrice !== null && product.finalPrice !== null && product.originalPrice > product.finalPrice ? `${Math.round((1 - product.finalPrice / product.originalPrice) * 100)}% 할인` : "",
    mainBenefit: [...opportunity.recommendation.messageAngles, ...insights.filter((insight) => insight.polarity === "positive").map((insight) => insight.summary)].slice(0, 3).join(" · "),
    targetCustomer: "상품의 실제 효용과 구매 근거를 비교하는 고객",
    landingUrl: product.url || "",
    productImagePath: images[0] || "",
    secondaryProductImagePath: "",
    productImagePaths: images,
    backgroundImagePath: "",
    extractedDescription: opportunity.recommendation.rationale.join(" · "),
    extractedMainImage: images[0] || "",
    extractedGalleryImages: images,
    selectedBackgroundSource: images[0] || "",
    backgroundMode: images.length ? "auto-detail-blur-dark" : "none",
    sourceImageCandidates: images.map((imagePath, index) => ({
      id: `opportunity-image-${index + 1}`,
      type: index === 0 ? "hero" : "detail",
      imagePath,
      originalUrl: imagePath,
      label: index === 0 ? "크리마 상품 대표 이미지" : `상품 이미지 ${index + 1}`,
      selected: index === 0,
      createdAt: new Date().toISOString(),
    })),
    selectedSourceImageId: images.length ? "opportunity-image-1" : "",
    selectedSourceImagePath: images[0] || "",
    verifiedBenefits: insights.filter((insight) => insight.polarity === "positive").map((insight) => insight.summary),
    creativeContext,
  };
  return {
    analysisId: run.id,
    productId: product.id,
    productUrl: product.url || "",
    productInfo,
    productImagePaths: images,
    availableContentAngles: [],
    recommendedTemplateIds: [],
    recommendedReferenceLabelIds: [],
    recommendedStyleName: opportunity.recommendation.imageDirection,
    advertiserName: dataset.advertiser.name,
    advertisingScore: opportunity.score,
    confidence: opportunity.confidence / 100,
    creativeContext,
  };
}
