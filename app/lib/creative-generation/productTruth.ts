import type { ProductInfoForPrompt } from "../mvp/types";
import type { FactVerification, ProductFact, ProductTruth } from "./types";

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
  const imagePaths = compact([
    ...(input.selectedAdImages || []),
    ...(input.productImagePaths || []),
    ...(product.productImagePaths || []),
    product.productImagePath,
    product.secondaryProductImagePath,
    product.extractedMainImage,
    ...(product.extractedGalleryImages || []),
  ]);
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
    imagePaths,
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
