import type { ContentAngleRecommendation, ProductAdvertisingAnalysis, ProductDetailAnalysis, StoreProductSummary } from "./types";
import { average, roundScore, uniqueStrings } from "./htmlUtils";

const WEIGHTS = {
  productStrength: 15,
  priceAttractiveness: 15,
  reviewUsability: 15,
  imageUsability: 15,
  uspClarity: 15,
  seasonFit: 5,
  contentExpansion: 15,
  detailPageQuality: 5,
} as const;

function seasonalScore(detail: ProductDetailAnalysis) {
  const month = new Date().getMonth() + 1;
  const text = [detail.product.name, detail.product.category, detail.description, ...detail.uspCandidates].filter(Boolean).join(" ");
  const summer = /캠핑|바비큐|바베큐|냉감|수영|여름|휴가|과일|보양|선크림/;
  const winter = /선물|명절|겨울|보온|난방|크리스마스|연말|국물/;
  const spring = /봄|신학기|나들이|피크닉|선물/;
  const autumn = /추석|가을|캠핑|선물|수확/;
  const relevant = month >= 6 && month <= 8 ? summer : month >= 11 || month <= 2 ? winter : month <= 5 ? spring : autumn;
  return relevant.test(text) ? 86 : detail.product.isNew ? 68 : undefined;
}

function relativePriceScore(product: StoreProductSummary, peers: StoreProductSummary[]) {
  if (!product.salePrice) return undefined;
  const peerPrices = peers.map((peer) => peer.salePrice).filter((value): value is number => Boolean(value));
  let score = 48;
  if (product.discountRate) score += Math.min(34, product.discountRate * 0.85);
  if (product.freeShipping) score += 8;
  if (product.isSetProduct) score += 6;
  const peerAverage = average(peerPrices);
  if (peerAverage && peerPrices.length >= 3) {
    const ratio = product.salePrice / peerAverage;
    if (ratio <= 0.8) score += 12;
    else if (ratio <= 1) score += 7;
    else if (ratio >= 1.4) score -= 8;
  }
  return roundScore(score);
}

function weightedScore(scores: Record<keyof typeof WEIGHTS, number | undefined>) {
  let totalWeight = 0;
  let weighted = 0;
  for (const [key, weight] of Object.entries(WEIGHTS) as Array<[keyof typeof WEIGHTS, number]>) {
    const score = scores[key];
    if (score === undefined) continue;
    totalWeight += weight;
    weighted += score * weight;
  }
  return {
    score: totalWeight ? roundScore(weighted / totalWeight) : 0,
    availableWeight: totalWeight,
  };
}

export function scoreProductForAdvertising(params: { detail: ProductDetailAnalysis; categoryPeers: StoreProductSummary[]; angles: ContentAngleRecommendation[] }): ProductAdvertisingAnalysis {
  const { detail, categoryPeers, angles } = params;
  const { product } = detail;
  const productStrengthScore = roundScore(28 + (product.isSoldOut ? -35 : 18) + (product.isBest ? 18 : 0) + (product.isNew ? 9 : 0) + (product.isSetProduct ? 6 : 0) + (product.category ? 7 : 0) + (detail.description ? 8 : 0) + Math.min(12, detail.uspCandidates.length * 3));
  const priceAttractivenessScore = relativePriceScore(product, categoryPeers);
  const hasReviewSignal = Boolean(product.reviewCount || product.rating || detail.reviewAnalysis?.sourceReviewCount);
  const reviewUsabilityScore = hasReviewSignal ? roundScore(Math.min(55, Math.log10((product.reviewCount || 0) + 1) * 22) + (product.rating ? Math.max(0, Math.min(35, (product.rating - 3) * 18)) : 0) + Math.min(20, (detail.reviewAnalysis?.repeatedBenefits.length || 0) * 5)) : undefined;
  const imageCount = detail.imageUrls.length;
  const imageUsabilityScore = imageCount ? roundScore(42 + Math.min(42, imageCount * 8) + Math.min(16, detail.detailImageUrls.length * 3)) : undefined;
  const uspClarityScore = detail.uspCandidates.length || detail.description ? roundScore(Math.min(100, detail.uspCandidates.length * 17 + (detail.description ? 24 : 0))) : undefined;
  const seasonFitScore = seasonalScore(detail);
  const contentExpansionScore = angles.length ? roundScore(36 + Math.min(54, angles.length * 10) + Math.min(10, new Set(angles.map((angle) => angle.type)).size * 2)) : undefined;
  const detailPageQualityScore = detail.detailPageQuality?.score;
  const scores = {
    productStrength: productStrengthScore,
    priceAttractiveness: priceAttractivenessScore,
    reviewUsability: reviewUsabilityScore,
    imageUsability: imageUsabilityScore,
    uspClarity: uspClarityScore,
    seasonFit: seasonFitScore,
    contentExpansion: contentExpansionScore,
    detailPageQuality: detailPageQualityScore,
  };
  const weighted = weightedScore(scores);
  const confidence = Math.round(Math.max(0.18, Math.min(1, 0.12 + weighted.availableWeight / 115)) * 100) / 100;
  const reasons: string[] = [];
  const risks: string[] = [];
  if (product.isBest) reasons.push("사이트의 베스트·인기 영역에서 발견되었습니다.");
  if (product.isNew) reasons.push("신상품 영역에서 발견되어 신규 테스트 가치가 있습니다.");
  if (product.discountRate) reasons.push(`확인된 할인율 ${product.discountRate}%를 가격 소구에 활용할 수 있습니다.`);
  if (product.reviewCount) reasons.push(`공개 리뷰 ${product.reviewCount.toLocaleString("ko-KR")}개를 신뢰 근거로 활용할 수 있습니다.`);
  if (detail.reviewAnalysis?.repeatedBenefits.length) {
    reasons.push(`리뷰에서 ${detail.reviewAnalysis.repeatedBenefits.slice(0, 3).join(", ")} 장점이 반복 확인됩니다.`);
  }
  if (imageCount >= 3) reasons.push(`상품·상세 이미지 ${imageCount}개가 광고 제작 후보로 확인되었습니다.`);
  if (detail.uspCandidates.length >= 2) reasons.push("상세페이지에서 여러 USP 후보가 확인되었습니다.");
  if (angles.length >= 3) reasons.push(`서로 다른 콘텐츠 방향 ${angles.length}개로 확장할 수 있습니다.`);
  if (product.isSoldOut) risks.push("현재 품절 표시가 확인되어 광고 집행 우선순위가 낮습니다.");
  if (!product.salePrice) risks.push("공개 페이지에서 판매가를 확인하지 못했습니다.");
  if (!hasReviewSignal) risks.push("공개 리뷰 수·평점 또는 리뷰 본문을 확인하지 못했습니다.");
  if (!imageCount) risks.push("사용 가능한 상품 이미지를 확인하지 못했습니다.");
  if (!detail.uspCandidates.length) risks.push("광고 카피 근거가 될 USP가 부족합니다.");
  if (detail.reviewAnalysis?.repeatedComplaints.length) {
    risks.push(`리뷰에서 ${detail.reviewAnalysis.repeatedComplaints.slice(0, 3).join(", ")} 불만이 반복 확인됩니다.`);
  }
  for (const issue of detail.detailPageQuality?.issues.slice(0, 3) || []) {
    risks.push(`상세페이지: ${issue}`);
  }

  let recommendationType: ProductAdvertisingAnalysis["recommendationType"];
  if (product.isSoldOut || weighted.score < 43 || (!product.salePrice && !imageCount && !detail.uspCandidates.length)) {
    recommendationType = "low-priority";
  } else if (product.isNew && weighted.score >= 52) {
    recommendationType = "new-test-candidate";
  } else if ((product.isBest || (product.reviewCount || 0) >= 30) && weighted.score >= 58) {
    recommendationType = "proven-candidate";
  } else if (weighted.score >= 52) {
    recommendationType = "rediscovery-candidate";
  } else {
    recommendationType = "low-priority";
  }

  const recommendedTemplateIds = uniqueStrings(
    angles.flatMap((angle) => angle.templateIds || []),
    6
  );
  return {
    overallScore: weighted.score,
    productStrengthScore,
    priceAttractivenessScore: priceAttractivenessScore ?? 0,
    reviewUsabilityScore: reviewUsabilityScore ?? 0,
    imageUsabilityScore: imageUsabilityScore ?? 0,
    uspClarityScore: uspClarityScore ?? 0,
    seasonFitScore: seasonFitScore ?? 0,
    contentExpansionScore: contentExpansionScore ?? 0,
    detailPageQualityScore: detailPageQualityScore ?? 0,
    confidence,
    recommendationType,
    reasons: uniqueStrings(reasons, 8),
    risks: uniqueStrings(risks, 8),
    recommendedAngles: angles,
    recommendedTemplateIds,
    scoreAvailability: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, value !== undefined])) as ProductAdvertisingAnalysis["scoreAvailability"],
  };
}
