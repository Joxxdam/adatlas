import type { ProductInfoForPrompt } from "../mvp/types";
import type {
  CreativeImageAsset,
  CreativeImageRole,
  FactVerification,
  ProductFact,
  ProductTruth,
} from "./types";

export const PRODUCT_TRUTH_VERSION = "product-truth-v1";

function compact(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

export function extractNumericTokens(value: string) {
  return Array.from(
    new Set(
      String(value || "")
        .match(/-?\d[\d,.]*(?:\s?(?:%|°c|℃|원|ml|mL|l|L|g|kg|개|팩|병|점|명|회|배))?/gi)
        ?.map((token) => token.replace(/\s+/g, "").toLowerCase()) || []
    )
  );
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function imageAsset(params: {
  path: string | undefined;
  role: CreativeImageRole;
  source: CreativeImageAsset["source"];
  verified: boolean;
  reason: string;
  hasText?: boolean;
  transparent?: boolean;
}): CreativeImageAsset | null {
  const imagePath = String(params.path || "").trim();
  if (!imagePath) return null;
  return {
    id: `image-${params.role}-${stableId(imagePath)}`,
    path: imagePath,
    role: params.role,
    source: params.source,
    verified: params.verified,
    reason: params.reason,
    hasText: params.hasText,
    transparent: params.transparent,
  };
}

function uniqueImageAssets(values: Array<CreativeImageAsset | null>) {
  const seen = new Set<string>();
  return values.filter((asset): asset is CreativeImageAsset => {
    if (!asset) return false;
    const key = `${asset.role}|${asset.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildImageAssets(input: {
  product: ProductInfoForPrompt;
  productImagePaths?: string[];
  selectedAdImages?: string[];
  imageAssets?: CreativeImageAsset[];
}) {
  const product = input.product;
  const sourceCandidates = new Map(
    (product.sourceImageCandidates || []).map((candidate) => [candidate.imagePath, candidate])
  );
  const selectedReferences = new Set(
    (input.selectedAdImages || []).map((value) => String(value || "").trim()).filter(Boolean)
  );
  const roleFor = (imagePath: string, fallback: CreativeImageRole) => {
    const candidate = sourceCandidates.get(imagePath);
    if (candidate?.hasText) return "detail-image" as const;
    if (candidate?.alreadyTransparent) return "product-cutout" as const;
    return fallback;
  };
  const candidateAsset = (
    imagePath: string | undefined,
    fallback: CreativeImageRole,
    source: CreativeImageAsset["source"],
    reason: string,
    verified = true
  ) => {
    const path = String(imagePath || "").trim();
    if (!path) return null;
    const candidate = sourceCandidates.get(path);
    const role = roleFor(path, fallback);
    return imageAsset({
      path,
      role,
      source,
      verified: verified && role !== "detail-image",
      reason:
        role === "detail-image"
          ? "이미지 분석에서 글자 또는 상세페이지 콘텐츠가 확인되어 상품 합성에서 제외"
          : reason,
      hasText: candidate?.hasText,
      transparent: candidate?.alreadyTransparent,
    });
  };
  // Explicit role assignments come from the product workbench or the known
  // product registry. selectedAdImages itself still creates reference-only
  // assets below and never promotes an image to a product role.
  const explicitAssets = (input.imageAssets || []).map((asset) => ({ ...asset }));
  const requestedProductAssets = (input.productImagePaths || [])
    .filter((path) => !selectedReferences.has(String(path || "").trim()))
    .map((path) =>
      candidateAsset(path, "product-packshot", "user-confirmed", "사용자가 상품 이미지로 확정")
    );
  const productAssets = [
    ...explicitAssets,
    ...requestedProductAssets,
    ...(product.productImagePaths || []).filter((path) => !selectedReferences.has(path)).map((path) =>
      candidateAsset(path, "product-packshot", "product-page", "상품정보의 제품 이미지")
    ),
    selectedReferences.has(product.productImagePath)
      ? null
      : candidateAsset(
          product.productImagePath,
          product.productCutoutAvailable ? "product-cutout" : "product-packshot",
          "product-page",
          product.productCutoutAvailable ? "확정된 상품 누끼" : "상품정보의 대표 제품 이미지"
        ),
    selectedReferences.has(product.secondaryProductImagePath || "")
      ? null
      : candidateAsset(
          product.secondaryProductImagePath,
          "product-packshot",
          "product-page",
          "상품정보의 보조 제품 이미지"
        ),
    selectedReferences.has(product.selectedSourceImagePath || "")
      ? null
      : candidateAsset(
          product.selectedSourceImagePath,
          "product-packshot",
          "source-candidate",
          "상품 이미지 작업대에서 선택된 제품 이미지"
        ),
    selectedReferences.has(product.extractedMainImage || "")
      ? null
      : candidateAsset(
          product.extractedMainImage,
          "product-packshot",
          "product-page",
          "상세페이지의 대표 제품 이미지"
        ),
    ...(product.extractedGalleryImages || []).map((path) =>
      imageAsset({
        path,
        role: "detail-image",
        source: "product-page",
        verified: false,
        reason: "상세 갤러리 이미지는 문구·배너 포함 가능성이 있어 합성 후보에서 제외",
      })
    ),
  ];
  const referenceAssets = (input.selectedAdImages || []).map((path) =>
    imageAsset({
      path,
      role: "ad-reference",
      source: "selected-reference",
      verified: true,
      reason: "레이아웃·색감·정보 위계 참고 전용이며 상품 합성에는 사용하지 않음",
      hasText: sourceCandidates.get(path)?.hasText,
    })
  );
  const all = uniqueImageAssets([...productAssets, ...referenceAssets]);
  const compositableRoles = new Set<CreativeImageRole>([
    "product-cutout",
    "product-packshot",
    "product-lifestyle",
  ]);
  const compositable = all.filter(
    (asset) => asset.verified && compositableRoles.has(asset.role)
  );
  compositable.sort((left, right) => {
    const score = (asset: CreativeImageAsset) =>
      (asset.role === "product-cutout" ? 300 : asset.role === "product-packshot" ? 200 : 100) +
      (asset.source === "known-product" ? 80 : asset.source === "user-confirmed" ? 60 : 0);
    return score(right) - score(left);
  });
  return {
    imageAssets: all,
    referenceImages: all.filter((asset) => asset.role === "ad-reference"),
    productImages: compositable,
  };
}

function fact(
  key: string,
  label: string,
  value: string | undefined,
  verification: FactVerification,
  source: ProductFact["source"],
  sourceUrl?: string
): ProductFact | null {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return {
    id: `fact-${key}-${stableId(normalized)}`,
    key,
    label,
    value: normalized,
    verification,
    source,
    sourceUrl,
    usableInCopy: verification !== "unverified",
    numericTokens: extractNumericTokens(normalized),
  };
}

function freeTextClaims(product: ProductInfoForPrompt) {
  return compact([
    product.mainBenefit,
    ...(product.verifiedBenefits || []),
    ...(product.ingredients || []).map((ingredient) => `${ingredient} 함유`),
  ]);
}

export function buildProductTruth(input: {
  product: ProductInfoForPrompt;
  productImagePaths?: string[];
  selectedAdImages?: string[];
  imageAssets?: CreativeImageAsset[];
  source?: "landing-page" | "user-input";
}): ProductTruth {
  const product = input.product;
  const contentNotes = product.creativeContext?.appliedContentNotes || [];
  const landingSource = input.source === "landing-page" && Boolean(product.landingUrl);
  const verification: FactVerification = landingSource ? "source-backed" : "user-provided";
  const source: ProductFact["source"] = landingSource ? "landing-page" : "user-input";
  const candidates = [
    fact("product-name", "상품명", product.productName, verification, source, product.landingUrl),
    fact("brand-name", "브랜드", product.brandName || product.advertiserName, verification, source, product.landingUrl),
    fact("category", "카테고리", product.category, verification, source, product.landingUrl),
    fact("price", "판매가", product.price, verification, source, product.landingUrl),
    fact(
      "original-price",
      "기존가",
      product.originalPrice || product.oldPrice,
      verification,
      source,
      product.landingUrl
    ),
    fact("discount", "할인 정보", product.discountInfo, verification, source, product.landingUrl),
    fact("main-benefit", "핵심 혜택", product.mainBenefit, verification, source, product.landingUrl),
    fact("target", "추천 대상", product.targetCustomer, verification, source, product.landingUrl),
    ...(product.verifiedBenefits || []).map((benefit, index) =>
      fact(`verified-benefit-${index + 1}`, "상세페이지 혜택", benefit, verification, source, product.landingUrl)
    ),
    ...(product.ingredients || []).map((ingredient, index) =>
      fact(`ingredient-${index + 1}`, "성분", ingredient, verification, source, product.landingUrl)
    ),
    ...(product.reviewSources || [])
      .map((review) => review.keySentence || review.sourceContext || "")
      .filter(Boolean)
      .map((review, index) =>
        fact(`review-${index + 1}`, "확인된 후기", review, verification, source, product.landingUrl)
      ),
    ...(product.creativeContext?.reviewInsightSummaries || []).map((review, index) =>
      fact(`review-insight-${index + 1}`, "후기 인사이트", review, verification, source, product.landingUrl)
    ),
    ...contentNotes
      .filter((note) => !note.prohibited && ["PRODUCT_USP", "REVIEW_INSIGHT", "TARGET_AUDIENCE", "PROMOTION"].includes(note.type))
      .map((note, index) =>
        fact(
          note.type === "REVIEW_INSIGHT"
            ? `review-note-${index + 1}`
            : `content-note-${note.type.toLowerCase()}-${index + 1}`,
          note.title || note.type,
          note.content,
          "user-provided",
          "user-input"
        )
      ),
  ].filter((item): item is ProductFact => Boolean(item));
  const claims = freeTextClaims(product);
  const unverifiedClaims = claims.filter(
    (claim) => !landingSource && extractNumericTokens(claim).length > 0
  );
  const verifiedClaims = claims.filter((claim) => !unverifiedClaims.includes(claim));
  const allowedNumericTokens = compact(
    candidates
      .filter((item) => item.usableInCopy && !unverifiedClaims.includes(item.value))
      .flatMap((item) => item.numericTokens)
  );
  const images = buildImageAssets(input);
  const imagePaths = images.productImages.map((asset) => asset.path);
  const required = [product.productName, product.category, product.price, product.mainBenefit, imagePaths[0]];
  const completeness = Math.round((required.filter(Boolean).length / required.length) * 100);
  return {
    productId: product.creativeContext?.productId || `product-${stableId(product.landingUrl || product.productName)}`,
    product,
    facts: candidates,
    verifiedClaims,
    unverifiedClaims,
    allowedNumericTokens,
    blockedClaimPatterns: [
      "판매량",
      "매출",
      "재고",
      "마진",
      "roas",
      "회원 수",
      "구매 수",
      "의학적으로",
      "100% 효과",
      ...contentNotes
        .filter((note) => (note.prohibited && note.type !== "AVOIDED_HOOK") || note.type === "PROHIBITED_EXPRESSION")
        .map((note) => note.content),
      ...unverifiedClaims,
    ],
    imageAssets: images.imageAssets,
    referenceImages: images.referenceImages,
    imagePaths,
    confirmedProductImage: images.productImages[0],
    completeness,
    createdAt: new Date().toISOString(),
  };
}

export function validateCopyAgainstTruth(copy: string, truth: ProductTruth) {
  const numericTokens = extractNumericTokens(copy);
  const unauthorizedNumericTokens = numericTokens.filter(
    (token) => !truth.allowedNumericTokens.includes(token)
  );
  const lowerCopy = copy.toLowerCase();
  const blockedClaims = truth.blockedClaimPatterns.filter(
    (pattern) => pattern && lowerCopy.includes(pattern.toLowerCase())
  );
  return {
    valid: unauthorizedNumericTokens.length === 0 && blockedClaims.length === 0,
    numericTokens,
    unauthorizedNumericTokens,
    blockedClaims,
  };
}
