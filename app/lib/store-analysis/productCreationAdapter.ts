import type { ProductInfoForPrompt, SourceImageCandidate } from "../mvp/types";
import type {
  ContentAngleRecommendation,
  ProductCreationHandoff,
  ProductDetailAnalysis,
  StoreAnalysisResult,
} from "./types";
import { uniqueStrings } from "./htmlUtils";
import { applyKnownProductAssets } from "../creative/knownProductAssets.ts";

function formatCurrency(value?: number) {
  return value ? `${Math.round(value).toLocaleString("ko-KR")}원` : "";
}

function mvpCategory(value = "", productName = "") {
  const text = `${value} ${productName}`;
  if (/식품|한우|고기|농산|수산|과일|채소|선물|먹거리|food|meat/i.test(text)) return "식품/선물";
  if (/뷰티|화장품|스킨|바디|향수|beauty|cosmetic/i.test(text)) return "뷰티/스킨케어";
  if (/패션|의류|신발|가방|fashion|apparel/i.test(text)) return "패션/의류";
  if (/건강|영양|비타민|유산균|supplement/i.test(text)) return "건강기능식품";
  if (/생활|주방|청소|수납|household/i.test(text)) return "생활용품";
  if (/인테리어|리빙|가구|침구|interior|living/i.test(text)) return "인테리어/리빙";
  return value || "기타";
}

function angleTarget(angle?: ContentAngleRecommendation) {
  if (!angle) return "";
  if (angle.type === "family") return "가족 사용 상황을 중요하게 보는 고객";
  if (angle.type === "camping") return "캠핑·야외 사용 상품을 찾는 고객";
  if (angle.type === "gift") return "선물용 상품을 비교하는 고객";
  if (angle.type === "review") return "구매 전 후기 근거를 확인하는 고객";
  if (angle.type === "price-shock" || angle.type === "bundle-value")
    return "가격과 구성을 비교하는 고객";
  if (angle.type === "new-product") return "새로운 상품을 먼저 경험하려는 고객";
  return "상품의 구체적인 효용을 비교하는 고객";
}

function sourceCandidates(images: string[]): SourceImageCandidate[] {
  const createdAt = new Date().toISOString();
  return images.map((imagePath, index) => ({
    id: index === 0 ? "analysis-hero-001" : `analysis-detail-${String(index).padStart(3, "0")}`,
    type: index === 0 ? "hero" : "detail",
    imagePath,
    originalUrl: imagePath,
    label: index === 0 ? "분석 대표 이미지" : `분석 상세 이미지 ${index}`,
    selected: index === 0,
    createdAt,
  }));
}

export function productDetailToProductInfo(params: {
  result: StoreAnalysisResult;
  detail: ProductDetailAnalysis;
  angle?: ContentAngleRecommendation;
}): ProductInfoForPrompt {
  const { result, detail, angle } = params;
  const images = uniqueStrings(
    [detail.product.imageUrl, ...detail.imageUrls, ...detail.detailImageUrls],
    30
  );
  const primaryImages = uniqueStrings(images, 4);
  const benefit = uniqueStrings(
    [angle?.bodyDirection, ...detail.uspCandidates, detail.description],
    4
  ).join(" · ");
  return applyKnownProductAssets({
    productName: detail.product.name,
    category: mvpCategory(detail.product.category, detail.product.name),
    price: formatCurrency(detail.product.salePrice),
    originalPrice: formatCurrency(detail.product.originalPrice),
    oldPrice: formatCurrency(detail.product.originalPrice),
    advertiserName: result.storeInfo.storeName || result.storeInfo.brandName,
    brandName: result.storeInfo.brandName || result.storeInfo.storeName,
    copyGuideId: result.copyGuideMatch.guideId || "",
    discountInfo: detail.product.discountRate ? `${detail.product.discountRate}% 할인` : "",
    mainBenefit: benefit.slice(0, 500),
    targetCustomer: angleTarget(angle),
    landingUrl: detail.product.url,
    productImagePath: primaryImages[0] || "",
    secondaryProductImagePath: primaryImages[1] || "",
    productImagePaths: primaryImages,
    backgroundImagePath: "",
    extractedDescription: detail.description || "",
    extractedMainImage: primaryImages[0] || "",
    extractedGalleryImages: images,
    selectedBackgroundSource: primaryImages[0] || "",
    backgroundMode: primaryImages.length ? "auto-detail-blur-dark" : "none",
    sourceImageCandidates: sourceCandidates(uniqueStrings(primaryImages.concat(images), 30)),
    selectedSourceImageId: primaryImages.length ? "analysis-hero-001" : "",
    selectedSourceImagePath: primaryImages[0] || "",
  });
}

export function buildProductCreationHandoff(params: {
  result: StoreAnalysisResult;
  productId: string;
  angleIdOrType?: string;
}): ProductCreationHandoff | null {
  const detail = params.result.products.find((item) => item.product.id === params.productId);
  const analysis = detail?.advertisingAnalysis;
  if (!detail || !analysis) return null;
  const selectedContentAngle =
    analysis.recommendedAngles.find(
      (angle) => angle.id === params.angleIdOrType || angle.type === params.angleIdOrType
    ) || analysis.recommendedAngles[0];
  const productInfo = productDetailToProductInfo({
    result: params.result,
    detail,
    angle: selectedContentAngle,
  });
  return {
    analysisId: params.result.analysisId,
    productId: detail.product.id,
    productUrl: detail.product.url,
    productInfo,
    productImagePaths: productInfo.productImagePaths || [],
    reviewAnalysis: detail.reviewAnalysis,
    selectedContentAngle,
    availableContentAngles: analysis.recommendedAngles,
    recommendedTemplateIds: analysis.recommendedTemplateIds,
    recommendedReferenceLabelIds: analysis.recommendedReferenceLabelIds || [],
    recommendedStyleName: analysis.recommendedStyleName,
    matchedCopyGuideId: params.result.copyGuideMatch.guideId,
    advertiserName: params.result.copyGuideMatch.brandName || params.result.storeInfo.brandName,
    advertisingScore: analysis.overallScore,
    confidence: analysis.confidence,
  };
}
