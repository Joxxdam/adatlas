import categoryData from "../../../data/category-profiles.json" with { type: "json" };
import { matchAdvertiserProfile } from "../creative/advertiserProfiles.ts";
import type { AdvertiserProfile } from "../creative/types";
import type { ProductInfoForPrompt } from "../mvp/types";
import type { BrandProfile, CategoryProfile, CreativeBlueprintId } from "./types";

const defaultBlueprints: CreativeBlueprintId[] = [
  "problem-solution-split",
  "editorial-story",
  "chat-ugc",
  "comparison-versus",
  "product-hero-lifestyle",
  "proof-data",
];

export const categoryProfiles = categoryData as CategoryProfile[];

function normalize(value: unknown) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function matchCategoryProfile(product: ProductInfoForPrompt) {
  const haystack = normalize(
    [product.category, product.productSubCategory, product.productName, product.mainBenefit].join(" ")
  );
  const scored = categoryProfiles.map((profile) => ({
    profile,
    score: profile.matchers.reduce(
      (total, matcher) => total + (haystack.includes(normalize(matcher)) ? 10 : 0),
      0
    ),
  }));
  return scored.sort((left, right) => right.score - left.score)[0]?.score
    ? scored.sort((left, right) => right.score - left.score)[0].profile
    : categoryProfiles.find((profile) => profile.id === "generic-commerce")!;
}

function adaptAdvertiserProfile(profile: AdvertiserProfile, category: CategoryProfile): BrandProfile {
  return {
    id: profile.id,
    name: profile.name,
    aliases: profile.aliases || [],
    domains: profile.domains || [],
    categories: profile.categories || [],
    brandKeywords: profile.brandKeywords || [],
    primaryColors: (profile.preferredColorHints || category.fallbackColors).slice(0, 2),
    secondaryColors: (profile.preferredColorHints || category.fallbackColors).slice(2, 4),
    toneOfVoice: profile.preferredTones || ["상품 사실 중심", "명확한 정보 위계"],
    preferredHookTypes: category.preferredHookTypes,
    allowedClaimPatterns: ["상품명", "가격", "상세페이지 확인 정보"],
    blacklistedClaims: profile.prohibitedClaims || category.forbiddenAssumptions,
    preferredSceneTypes: profile.scenePreferences || category.preferredSceneTypes,
    preferredBlueprints: (profile.preferredBlueprints || defaultBlueprints) as CreativeBlueprintId[],
    logoAssets: profile.logoAssets || [],
    defaultLogoPosition: profile.defaultLogoPosition || "top-left",
    logoMinSize: profile.logoMinSize || 120,
    minLogoClearSpace: profile.minLogoClearSpace || 24,
    fallbackPolicy: profile.preferredColorHints?.length ? "brand-colors" : "category-colors",
  };
}

function explicitlyMatches(profile: AdvertiserProfile, product: ProductInfoForPrompt) {
  const haystack = normalize(
    [product.advertiserName, product.brandName, product.productName, product.landingUrl].join(" ")
  );
  return [profile.name, ...(profile.aliases || [])].some(
    (value) => normalize(value) && haystack.includes(normalize(value))
  ) || (profile.domains || []).some((domain) => haystack.includes(normalize(domain)));
}

function genericBrandProfile(product: ProductInfoForPrompt, category: CategoryProfile): BrandProfile {
  return {
    id: `generic-${category.id}`,
    name: product.brandName || product.advertiserName || category.label,
    aliases: [],
    domains: [],
    categories: [category.label],
    brandKeywords: [],
    primaryColors: category.fallbackColors.slice(0, 2),
    secondaryColors: category.fallbackColors.slice(2, 4),
    toneOfVoice: ["상품 사실 중심", "명확한 정보 위계"],
    preferredHookTypes: category.preferredHookTypes,
    allowedClaimPatterns: ["상품명", "가격", "상세페이지 확인 정보"],
    blacklistedClaims: category.forbiddenAssumptions,
    preferredSceneTypes: category.preferredSceneTypes,
    preferredBlueprints: category.preferredBlueprints,
    logoAssets: [],
    defaultLogoPosition: "top-left",
    logoMinSize: 120,
    minLogoClearSpace: 24,
    fallbackPolicy: "category-colors",
  };
}

export function matchBrandProfile(product: ProductInfoForPrompt) {
  const category = matchCategoryProfile(product);
  const matched = matchAdvertiserProfile(product);
  return explicitlyMatches(matched, product)
    ? adaptAdvertiserProfile(matched, category)
    : genericBrandProfile(product, category);
}

export function withRequestedLogo(profile: BrandProfile, logoPath?: string) {
  if (!logoPath) return profile;
  return {
    ...profile,
    logoAssets: [
      { kind: "logo" as const, path: logoPath, variant: "color" as const, exact: true },
      ...profile.logoAssets.filter((asset) => asset.path !== logoPath),
    ],
  };
}
