import "server-only";
import { createHash } from "node:crypto";
import type { ExtractedProductInfo, ProductInfoForPrompt } from "../mvp/types";
import type { AutoProductionAdvertiserConfig, AutoProductionProductCandidate } from "./types";

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export function directProductInfo(extracted: ExtractedProductInfo, productUrl: string, config: Pick<AutoProductionAdvertiserConfig, "advertiserId" | "advertiserName">): ProductInfoForPrompt {
  const sourceCandidates = (extracted.sourceImageCandidates || []).filter((candidate, index, candidates) => candidate.imagePath && candidates.findIndex((item) => item.imagePath === candidate.imagePath) === index);
  const imagePaths = unique([
    ...sourceCandidates.map((candidate) => candidate.imagePath),
    extracted.mainImage,
    extracted.heroImage,
    ...(extracted.galleryImages || []),
    ...(extracted.detailImages || []),
  ]).slice(0, 12);
  const mainImage = imagePaths[0] || "";
  return {
    productName: extracted.productName || "",
    category: extracted.category || "기타",
    productSubCategory: extracted.productSubCategory,
    detectedProductType: extracted.detectedProductType,
    price: extracted.price || "",
    originalPrice: extracted.originalPrice || extracted.oldPrice || "",
    oldPrice: extracted.oldPrice || extracted.originalPrice || "",
    discountInfo: extracted.discountInfo || "",
    advertiserName: config.advertiserName,
    brandName: extracted.brandName || config.advertiserName,
    mainBenefit: extracted.mainBenefit || extracted.extractedDescription || extracted.description || "",
    targetCustomer: extracted.targetCustomer || "",
    landingUrl: extracted.landingUrl || productUrl,
    productImagePath: mainImage,
    secondaryProductImagePath: imagePaths[1] || "",
    productImagePaths: imagePaths,
    backgroundImagePath: "",
    extractedDescription: extracted.extractedDescription || extracted.description || "",
    extractedMainImage: mainImage,
    extractedGalleryImages: imagePaths,
    sourceImageCandidates: sourceCandidates,
    selectedSourceImageId: sourceCandidates[0]?.id || "",
    selectedSourceImagePath: sourceCandidates[0]?.imagePath || mainImage,
    productRepresentation: extracted.productRepresentation,
    reviewSources: extracted.reviewSources || [],
    detailImageOcrInsights: extracted.detailImageOcrInsights || [],
    productCopyConstraints: extracted.productCopyConstraints || [],
    verifiedBenefits: extracted.verifiedBenefits || [],
    ingredients: extracted.ingredients || [],
    vendorResearch: extracted.vendorResearch,
    creativeContext: {
      advertiserId: config.advertiserId,
      productId: `direct-${createHash("sha256").update(productUrl).digest("hex").slice(0, 16)}`,
      recommendedHookTypes: [],
      recommendedMessageAngles: extracted.verifiedBenefits || [],
      dataEvidence: extracted.vendorResearch
        ? extracted.vendorResearch.facts
            .filter((fact) => fact.copyEligibility !== "blocked")
            .map((fact) => `${fact.label}: ${fact.value}`)
            .slice(0, 12)
        : [],
      dataSources: extracted.vendorResearch ? ["DIRECT_PRODUCT_URL", "VENDOR_PROVIDED_RESEARCH"] : ["DIRECT_PRODUCT_URL"],
      analysisSource: "SITE_PUBLIC_DATA",
    },
  };
}

export function directProductCandidate(config: AutoProductionAdvertiserConfig, product: ProductInfoForPrompt, productUrl: string): AutoProductionProductCandidate {
  const id = product.creativeContext?.productId || `direct-${createHash("sha256").update(productUrl).digest("hex").slice(0, 16)}`;
  const evidence = unique([product.price, product.discountInfo, product.mainBenefit, ...(product.verifiedBenefits || [])]).slice(0, 6);
  return {
    id,
    externalId: id,
    productCode: id,
    canonicalProductUrl: productUrl,
    advertiserId: config.advertiserId,
    productName: product.productName,
    productUrl,
    category: product.category || "기타",
    imageUrl: product.productImagePath || product.extractedMainImage || "",
    source: "admin",
    sourceReason: "자동제작 화면에서 직접 입력한 상품 URL",
    recommendationRole: "new-exploration",
    recommendationReason: "사용자가 직접 지정한 상품으로 바로 광고를 제작합니다.",
    verifiedEvidence: evidence,
    recommendedHookDirections: [],
    selectionScore: 100,
    currentSales: null,
    previousSales: null,
    orders: null,
    revenue: null,
    impressions: null,
    views: null,
    conversionRate: null,
    reviewCount: null,
    rating: null,
    isNew: false,
    isSeasonal: false,
    siteVisible: true,
    soldOut: false,
    imageVerificationStatus: product.productImagePaths?.length ? "verified" : "needs-review",
    imageVerificationReasons: product.productImagePaths?.length ? ["입력한 상세페이지에서 상품 원본 이미지를 불러왔습니다."] : ["상세페이지에서 상품 원본 이미지를 찾지 못했습니다."],
    productInfo: product,
  };
}
