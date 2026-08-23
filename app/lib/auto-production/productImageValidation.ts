import type { ProductInfoForPrompt, SourceImageCandidate } from "../mvp/types";

export type AutoProductionImageVerification = {
  status: "verified" | "needs-review" | "rejected";
  selectedPaths: string[];
  rejectedPaths: string[];
  reasons: string[];
};

const rejectedCue = /(?:추천\s*상품|관련\s*상품|함께\s*(?:구매|본)|리뷰|후기|이벤트|event|banner|배너|배송\s*안내|shipping|쿠폰|coupon|logo(?:only)?|로고만|size\s*chart|사이즈표|아이콘|icon|품절|sold\s*out|모바일\s*(?:화면|ui)|스크린샷|thumbnail|thumb\b|processed-products|product-cutouts|removebg|cutout)/iu;
const setCue = /(?:세트|구성|전체|패키지|묶음|골라담기|\d+\s*(?:팩|개|입|봉|병|박스)|\d+\s*\+\s*\d+|set|bundle|pack)/iu;
const productCue = /(?:제품|상품|패키지|정면|라벨|사용|조리|원물|질감|hero|gallery|detail|product)/iu;

function descriptor(image: SourceImageCandidate) {
  return [image.label, image.originalUrl, image.imagePath, image.analysisReason, ...(image.warnings || [])].filter(Boolean).join(" ");
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function verifyAutoProductionProductImages(productName: string, product: ProductInfoForPrompt): AutoProductionImageVerification {
  const structured = product.sourceImageCandidates || [];
  const rawFallbacks = unique([...(product.productImagePaths || []), product.productImagePath || "", product.extractedMainImage || "", ...(product.extractedGalleryImages || [])]);
  const acceptedStructured = structured.filter((image) => {
    const text = descriptor(image);
    if (!image.imagePath || rejectedCue.test(text)) return false;
    if (image.sourceImageQualityScore !== undefined && image.sourceImageQualityScore < 35) return false;
    if (image.salesUnitMatchScore !== undefined && image.salesUnitMatchScore < 45) return false;
    return image.type === "hero" || image.sourceType === "product-gallery" || productCue.test(text) || image.multipleObjectsAreSalesUnit === true;
  });
  const rejectedPaths = unique([...structured.filter((image) => !acceptedStructured.includes(image)).map((image) => image.imagePath), ...rawFallbacks.filter((path) => rejectedCue.test(path))]);
  const selectedPaths = unique([...acceptedStructured.map((image) => image.imagePath), ...rawFallbacks.filter((path) => !rejectedCue.test(path))]).slice(0, 5);
  if (!selectedPaths.length) {
    return { status: "rejected", selectedPaths: [], rejectedPaths, reasons: ["해당 상품으로 확인할 수 있는 원본 이미지가 없습니다."] };
  }

  const isSet = setCue.test(productName);
  const hasSetComposition = acceptedStructured.some((image) => image.multipleObjectsAreSalesUnit === true || setCue.test(descriptor(image)));
  if (isSet && !hasSetComposition) {
    return {
      status: "needs-review",
      selectedPaths,
      rejectedPaths,
      reasons: ["세트 상품의 실제 판매 구성 전체가 이미지에서 확인되지 않습니다."],
    };
  }
  return {
    status: "verified",
    selectedPaths,
    rejectedPaths,
    reasons: [structured.length ? "상세페이지의 상품 영역과 판매 단위 일치 정보를 확인했습니다." : "대표 상품 원본을 확인했습니다."],
  };
}
