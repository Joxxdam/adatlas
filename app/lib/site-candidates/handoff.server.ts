import "server-only";

import type { ProductInfoForPrompt, SourceImageCandidate } from "../mvp/types";
import type { ContentAngleRecommendation, ProductCreationHandoff } from "../store-analysis/types";
import { siteCandidateCache } from "./cache.server";
import type { SiteAdCandidate, SiteRecommendationType } from "./types";

const UNIVERSAL_HOOKS = ["감각형", "문제 해결형", "상황형", "호기심형", "핵심 USP형", "타깃형", "후기·신뢰형", "가격·혜택형"];

const TYPE_TO_HOOK: Record<SiteRecommendationType, string> = {
  "review-trust": "후기·신뢰형",
  "core-usp": "핵심 USP형",
  "price-benefit": "가격·혜택형",
  "problem-solution": "문제 해결형",
  situation: "상황형",
  "visual-hook": "감각형",
  "new-product-test": "호기심형",
  "seasonal-test": "상황형",
  "bundle-value": "가격·혜택형",
  "clear-target": "타깃형",
};

const TYPE_LABEL: Record<SiteRecommendationType, string> = {
  "review-trust": "후기·신뢰형",
  "core-usp": "핵심 USP형",
  "price-benefit": "가격·혜택형",
  "problem-solution": "문제 해결형",
  situation: "상황형",
  "visual-hook": "시각 후킹형",
  "new-product-test": "신상품 실험형",
  "seasonal-test": "시즌 실험형",
  "bundle-value": "세트·구성형",
  "clear-target": "타깃 명확형",
};

function won(value?: number) {
  return value ? `${Math.round(value).toLocaleString("ko-KR")}원` : "";
}

function sourceImages(candidate: SiteAdCandidate): SourceImageCandidate[] {
  const product = candidate.product;
  return [product.representativeImage, ...product.additionalImages]
    .filter((image): image is string => Boolean(image))
    .map((imagePath, index) => ({
      id: `site-${product.id}-${index + 1}`,
      type: index === 0 ? "hero" : "detail",
      imagePath,
      originalUrl: imagePath,
      label: index === 0 ? "대표 이미지" : `상세 이미지 ${index}`,
      selected: index === 0,
      createdAt: product.analyzedAt,
      sourceType: index === 0 ? "open-graph" : "product-gallery",
      analysisReason: "상품 상세페이지 공개 이미지",
    }));
}

function contentAngle(candidate: SiteAdCandidate): ContentAngleRecommendation {
  const type = candidate.primaryRecommendationType;
  return {
    id: `site-angle-${candidate.id}`,
    name: TYPE_LABEL[type],
    type: type === "review-trust" ? "review" : type === "price-benefit" ? "price-shock" : type === "problem-solution" ? "problem-solution" : type === "new-product-test" ? "new-product" : type === "seasonal-test" || type === "situation" ? "seasonal" : type === "bundle-value" ? "bundle-value" : "quality",
    reason: candidate.recommendationReasons[0] || "페이지 공개정보에서 확인된 상품 근거를 광고 메시지로 검증합니다.",
    evidence: candidate.recommendationReasons,
    headlineDirection: `${TYPE_LABEL[type]} 후킹`,
    bodyDirection: candidate.product.uspCandidates.slice(0, 2).join(" · "),
    score: candidate.score.total,
  };
}

export function siteCandidateToProductInfo(candidate: SiteAdCandidate): ProductInfoForPrompt {
  const product = candidate.product;
  const images = [product.representativeImage, ...product.additionalImages].filter((image): image is string => Boolean(image));
  const prioritizedHook = TYPE_TO_HOOK[candidate.primaryRecommendationType];
  const recommendedHookTypes = [prioritizedHook, ...UNIVERSAL_HOOKS.filter((hook) => hook !== prioritizedHook)];
  return {
    productName: product.productName,
    category: product.category || "기타",
    price: won(product.salePrice),
    originalPrice: won(product.regularPrice),
    oldPrice: won(product.regularPrice),
    advertiserName: product.brandName,
    brandName: product.brandName,
    discountInfo: product.benefits.join(" · "),
    mainBenefit: product.uspCandidates.slice(0, 3).join(" · "),
    targetCustomer: product.targetSignals.slice(0, 3).join(" · ") || product.usageContexts.slice(0, 2).join(" · ") || "상품 상세페이지에서 확인된 정보를 비교하는 고객",
    landingUrl: product.productUrl,
    productImagePath: product.representativeImage || "",
    secondaryProductImagePath: product.additionalImages[0] || "",
    productImagePaths: images,
    backgroundImagePath: "",
    extractedDescription: product.description,
    extractedMainImage: product.representativeImage,
    extractedGalleryImages: product.additionalImages,
    selectedBackgroundSource: "",
    backgroundMode: "none",
    sourceImageCandidates: sourceImages(candidate),
    selectedSourceImageId: images.length ? `site-${product.id}-1` : "",
    selectedSourceImagePath: product.representativeImage || "",
    ingredients: product.ingredients,
    verifiedBenefits: product.uspCandidates,
    creativeContext: {
      advertiserId: product.brandName || new URL(product.productUrl).hostname,
      productId: product.id,
      opportunityId: candidate.id,
      analysisRunId: `site-${product.analyzedAt}`,
      opportunityType: candidate.primaryRecommendationType,
      recommendedObjective: candidate.recommendationReasons[0],
      recommendedHookTypes,
      recommendedMessageAngles: product.uspCandidates.slice(0, 4),
      reviewInsightSummaries: product.extractedReviewPhrases,
      dataEvidence: candidate.recommendationReasons,
      dataAsOf: product.analyzedAt.slice(0, 10),
      dataSources: ["SITE_PUBLIC_DATA", product.productUrl],
      dataSufficiency: candidate.evidenceLevel === "high" ? "analysis-ready" : candidate.evidenceLevel === "medium" ? "reference-only" : "data-insufficient",
      analysisSource: "SITE_PUBLIC_DATA",
      adFitScore: candidate.score.total,
      evidenceLevel: candidate.evidenceLevel,
      recommendationReasons: candidate.recommendationReasons,
    },
  };
}

export function buildSiteCandidateProductCreationHandoff(selectionId: string): ProductCreationHandoff | null {
  const selection = siteCandidateCache.getSelection(selectionId);
  if (!selection) return null;
  const candidate = selection.candidate;
  const productInfo = siteCandidateToProductInfo(candidate);
  const angle = contentAngle(candidate);
  return {
    analysisId: selection.analysisId,
    productId: candidate.product.id,
    productUrl: candidate.product.productUrl,
    productInfo,
    productImagePaths: productInfo.productImagePaths || [],
    reviewAnalysis:
      candidate.product.reviewCount || candidate.product.rating
        ? {
            reviewCount: candidate.product.reviewCount,
            averageRating: candidate.product.rating,
            positiveKeywords: [],
            negativeKeywords: [],
            purchaseSituations: candidate.product.usageContexts,
            repeatedBenefits: candidate.product.extractedReviewPhrases,
            repeatedComplaints: [],
            copyUsableInsights: candidate.product.extractedReviewPhrases,
            sourceReviewCount: candidate.product.reviewCount,
            confidence: candidate.evidenceLevel === "high" ? 0.85 : 0.55,
          }
        : undefined,
    selectedContentAngle: angle,
    availableContentAngles: [angle],
    recommendedTemplateIds: [],
    recommendedReferenceLabelIds: [],
    recommendedStyleName: "사이트 공개정보 기반 광고 실험",
    advertiserName: candidate.product.brandName,
    advertisingScore: candidate.score.total,
    confidence: candidate.evidenceLevel === "high" ? 0.85 : candidate.evidenceLevel === "medium" ? 0.65 : 0.4,
    creativeContext: productInfo.creativeContext,
  };
}
