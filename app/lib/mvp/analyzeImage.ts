import { CollectedAdImage, ImageAnalysis } from "./types";

export function analyzeCollectedImage(image: CollectedAdImage): ImageAnalysis {
  const source = `${image.brandName} ${image.imageUrl} ${image.originalAdUrl ?? ""}`.toLowerCase();
  const hasSaleSignal = /(sale|discount|coupon|event|promo|특가|할인|세일)/i.test(source);
  const hasReviewSignal = /(review|testimonial|ugc|후기|리뷰)/i.test(source);
  const hasCta = /(shop|buy|learn|event|promo|click|구매|보기|확인)/i.test(source);

  return {
    extractedText: image.brandName,
    hookType: hasSaleSignal
      ? "가격/혜택 후킹"
      : hasReviewSignal
        ? "리뷰/UGC 후킹"
        : "브랜드 인지 후킹",
    appealPoint: hasSaleSignal ? "할인과 즉시 행동 유도" : "브랜드 이미지와 상품 분위기 전달",
    designTone: "이미지 기반 레퍼런스",
    hasCta,
    categoryTags: [image.sourcePlatform, hasSaleSignal ? "프로모션" : "브랜드 콘텐츠"],
    analyzedAt: new Date().toISOString(),
  };
}
