import type { DetailPageQualityAnalysis, ProductReviewAnalysis, StoreProductSummary } from "./types";
import { roundScore } from "./htmlUtils";

export function analyzeDetailPageQuality(params: { product: StoreProductSummary; description?: string; uspCandidates: string[]; imageUrls: string[]; detailImageUrls: string[]; specifications: Record<string, string>; reviewAnalysis?: ProductReviewAnalysis; pageText: string }): DetailPageQualityAnalysis {
  const productNameClarity = params.product.name.length >= 3 ? 100 : params.product.name ? 45 : 0;
  const priceClarity = params.product.salePrice ? (params.product.originalPrice && params.product.discountRate ? 100 : 78) : 0;
  const uspVisibility = roundScore(Math.min(100, params.uspCandidates.length * 24 + (params.description ? 22 : 0)));
  const imageAvailability = roundScore(Math.min(100, params.imageUrls.length * 18 + params.detailImageUrls.length * 8));
  const reviewEvidence = params.reviewAnalysis ? roundScore(Math.min(100, (params.reviewAnalysis.sourceReviewCount || 0) * 8 + (params.reviewAnalysis.reviewCount ? 32 : 0) + (params.reviewAnalysis.averageRating ? 20 : 0))) : 0;
  const shippingInfoClarity = /무료\s*배송|배송비|배송\s*안내|택배/.test(params.pageText) ? 85 : 25;
  const compositionClarity = Object.keys(params.specifications).length >= 3 || /\d+\s*(?:개|팩|세트|입|장|병|g|kg|ml|L)\b/i.test(params.pageText) ? 90 : Object.keys(params.specifications).length ? 62 : 25;
  const score = roundScore(productNameClarity * 0.14 + priceClarity * 0.15 + uspVisibility * 0.2 + imageAvailability * 0.2 + reviewEvidence * 0.1 + shippingInfoClarity * 0.08 + compositionClarity * 0.13);
  const issues: string[] = [];
  const recommendations: string[] = [];
  if (!params.product.salePrice) issues.push("공개 페이지에서 판매가를 명확히 확인하지 못했습니다.");
  if (params.uspCandidates.length < 2) issues.push("광고에 활용할 핵심 USP 근거가 부족합니다.");
  if (params.imageUrls.length < 2) issues.push("광고에 활용할 상품 이미지 후보가 부족합니다.");
  if (params.detailImageUrls.length < 2) issues.push("상세 이미지가 적거나 자동 수집되지 않았습니다.");
  if (!params.reviewAnalysis) issues.push("공개 리뷰 근거를 확인하지 못했습니다.");
  if (shippingInfoClarity < 50) recommendations.push("배송비와 배송 조건을 더 명확히 표시해 주세요.");
  if (compositionClarity < 50) recommendations.push("용량·수량·구성 정보를 상단에 명확히 표시해 주세요.");
  if (uspVisibility < 60) recommendations.push("핵심 효용과 차별점을 상세페이지 상단에서 요약해 주세요.");
  if (imageAvailability < 60) recommendations.push("대표 구성과 실제 사용 장면 이미지를 보강해 주세요.");

  return {
    score,
    productNameClarity,
    priceClarity,
    uspVisibility,
    imageAvailability,
    reviewEvidence,
    shippingInfoClarity,
    compositionClarity,
    issues,
    recommendations,
  };
}
