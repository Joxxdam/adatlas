import type { ProductDetailAnalysis, StoreCategoryAnalysis, StoreInfo } from "./types";
import { average, roundScore, stableId, uniqueStrings } from "./htmlUtils";

export function analyzeStoreCategories(products: ProductDetailAnalysis[], storeInfo: StoreInfo): StoreCategoryAnalysis[] {
  const groups = new Map<string, ProductDetailAnalysis[]>();
  for (const detail of products) {
    const category = detail.product.category?.trim() || "분류 미확인";
    groups.set(category, [...(groups.get(category) || []), detail]);
  }
  return [...groups.entries()]
    .map(([name, items]) => {
      const prices = items.map((item) => item.product.salePrice);
      const discounts = items.map((item) => item.product.discountRate);
      const reviewCounts = items.map((item) => item.product.reviewCount);
      const ratings = items.map((item) => item.product.rating);
      const newRatio = items.filter((item) => item.product.isNew).length / items.length;
      const discountedRatio = items.filter((item) => item.product.isDiscounted).length / items.length;
      const imageQualityScore = average(items.map((item) => item.advertisingAnalysis?.imageUsabilityScore));
      const contentPotentialScore = average(items.map((item) => item.advertisingAnalysis?.contentExpansionScore));
      const advertisingScores = items.map((item) => item.advertisingAnalysis?.overallScore);
      const recommendationScore = roundScore((average(advertisingScores) || 0) * 0.62 + Math.min(100, items.length * 14) * 0.12 + (imageQualityScore || 0) * 0.1 + (contentPotentialScore || 0) * 0.1 + discountedRatio * 100 * 0.04 + newRatio * 100 * 0.02);
      const reasons: string[] = [];
      const bestCount = items.filter((item) => item.product.isBest).length;
      if (bestCount) reasons.push(`베스트·인기 영역에서 ${bestCount}개 상품이 확인되었습니다.`);
      if ((average(reviewCounts) || 0) >= 20) reasons.push("카테고리 상품의 공개 리뷰 근거가 비교적 풍부합니다.");
      if (discountedRatio >= 0.3) reasons.push("할인 상품 비중이 높아 가격형 콘텐츠로 확장하기 좋습니다.");
      if (newRatio >= 0.25) reasons.push("신상품 비중이 있어 신규 테스트 콘텐츠를 구성하기 좋습니다.");
      if ((imageQualityScore || 0) >= 65) reasons.push("상품 이미지 후보가 광고 제작에 비교적 적합합니다.");
      if ((contentPotentialScore || 0) >= 70) reasons.push("서로 다른 구매 이유의 콘텐츠 가설로 확장하기 좋습니다.");
      if (!reasons.length) reasons.push("수집 가능한 공개 상품정보를 기준으로 상대 평가했습니다.");
      const angleTypes = items.flatMap((item) => item.advertisingAnalysis?.recommendedAngles.map((angle) => angle.type) || []);
      const categoryUrl = storeInfo.categoryUrls?.find((url) => decodeURIComponent(url).toLowerCase().includes(name.toLowerCase().replace(/\s+/g, "")));
      return {
        id: stableId("category", name),
        name,
        url: categoryUrl,
        productCount: items.length,
        averagePrice: average(prices),
        averageDiscountRate: average(discounts),
        averageReviewCount: average(reviewCounts),
        averageRating: average(ratings),
        newProductRatio: newRatio,
        discountedProductRatio: discountedRatio,
        imageQualityScore: imageQualityScore === undefined ? undefined : roundScore(imageQualityScore),
        contentPotentialScore: contentPotentialScore === undefined ? undefined : roundScore(contentPotentialScore),
        recommendationScore,
        reasons,
        recommendedAngleTypes: uniqueStrings(angleTypes, 4) as StoreCategoryAnalysis["recommendedAngleTypes"],
      };
    })
    .sort((a, b) => (b.recommendationScore || 0) - (a.recommendationScore || 0));
}
