import type { AdBrief, ProductInfoForPrompt } from "./types";

export const defaultAdBrief: AdBrief = {
  productName: "",
  category: "기타",
  price: "",
  originalPrice: "",
  discountInfo: "",
  mainBenefit: "",
  targetCustomer: "",
  landingUrl: "",
  adObjective: "purchase",
  additionalEmphasis: "",
  mandatoryInfo: [],
  prohibitedClaims: [],
  creativeIntensity: "balanced",
};

export function productInfoToAdBrief(
  product: ProductInfoForPrompt,
  current: AdBrief = defaultAdBrief
): AdBrief {
  return {
    ...current,
    productName: product.productName || "",
    category: product.category || "기타",
    price: product.price || "",
    originalPrice: product.originalPrice || product.oldPrice || "",
    discountInfo: product.discountInfo || "",
    mainBenefit: product.mainBenefit || "",
    targetCustomer: product.targetCustomer || "",
    landingUrl: product.landingUrl || "",
  };
}

export function applyAdBriefToProductInfo(
  brief: AdBrief,
  product: ProductInfoForPrompt
): ProductInfoForPrompt {
  return {
    ...product,
    productName: brief.productName,
    category: brief.category,
    price: brief.price,
    originalPrice: brief.originalPrice || product.originalPrice,
    oldPrice: brief.originalPrice || product.oldPrice,
    discountInfo: brief.discountInfo,
    mainBenefit: brief.mainBenefit,
    targetCustomer: brief.targetCustomer,
    landingUrl: brief.landingUrl,
  };
}

export function parseBriefList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatBriefList(value: string[] = []): string {
  return value.join(", ");
}
