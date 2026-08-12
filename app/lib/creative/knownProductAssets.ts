import type { ProductInfoForPrompt, SourceImageCandidate } from "../mvp/types";
import { advertiserProfiles } from "./advertiserProfiles.ts";
import type { AdvertiserProfile } from "./types";

export type KnownProductAssetMatch = {
  advertiserId: string;
  advertiserName: string;
  productId: string;
  productName: string;
  cutoutPath: string;
  backgroundPrefix: string;
};

const genericProductTokens = new Set([
  "오리지널소스",
  "오리지널",
  "소스",
  "original",
  "source",
  "샤워젤",
  "바디워시",
  "제품",
  "상품",
  "세트",
  "250ml",
]);

function decode(value: unknown) {
  const source = String(value || "");
  try {
    return decodeURIComponent(source);
  } catch {
    return source;
  }
}

function normalize(value: unknown) {
  return decode(value).toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

function tokens(value: unknown) {
  return decode(value)
    .toLowerCase()
    .replace(/[·&/+()[\],]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/[^0-9a-z가-힣]/g, ""))
    .filter((token) => token.length >= 2 && !genericProductTokens.has(token));
}

function unique(values: Array<string | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function profileExplicitlyMatches(profile: AdvertiserProfile, product: ProductInfoForPrompt) {
  const haystack = normalize([
    product.advertiserName,
    product.brandName,
    product.productName,
    product.landingUrl,
  ].join(" "));
  return (
    (profile.domains || []).some((domain) => haystack.includes(normalize(domain))) ||
    [profile.name, ...(profile.aliases || [])].some(
      (alias) => normalize(alias) && haystack.includes(normalize(alias))
    )
  );
}

function urlProductIds(product: ProductInfoForPrompt) {
  const values = [
    product.creativeContext?.productId,
    ...Array.from(
      decode(product.landingUrl).matchAll(
        /(?:product_no=|\/)(\d{1,12})(?=\/category\/|[/?#&]|$)/gi
      )
    ).map((match) => match[1]),
  ];
  return new Set(values.map((value) => String(value || "").trim()).filter(Boolean));
}

/**
 * Finds a previously approved product cutout/background collection.
 * The match is data-driven from advertiser profiles so URL extraction,
 * store-analysis handoff, and rendering all use the same product identity.
 */
export function matchKnownProductAsset(
  product: ProductInfoForPrompt
): KnownProductAssetMatch | null {
  const productName = normalize(product.productName);
  const productTokens = new Set(tokens(product.productName));
  const ids = urlProductIds(product);
  let best: { match: KnownProductAssetMatch; score: number } | null = null;

  for (const profile of advertiserProfiles) {
    if (!profile.productAssets?.length || !profileExplicitlyMatches(profile, product)) continue;
    for (const asset of profile.productAssets) {
      let score = 0;
      if (ids.has(asset.productId)) score += 240;
      const assetName = normalize(asset.productName);
      if (
        assetName &&
        productName &&
        (productName.includes(assetName) || assetName.includes(productName))
      ) {
        score += 120;
      }
      const assetTokens = tokens(asset.productName);
      const overlap = assetTokens.filter((token) => productTokens.has(token));
      score += overlap.length * 28;
      if (assetTokens.length && overlap.length === assetTokens.length) score += 50;
      if (score < 56) continue;
      const match = {
        advertiserId: profile.id,
        advertiserName: profile.name,
        productId: asset.productId,
        productName: asset.productName,
        cutoutPath: asset.cutoutPath,
        backgroundPrefix: asset.backgroundPrefix,
      };
      if (!best || score > best.score) best = { match, score };
    }
  }
  return best?.match || null;
}

function registeredSourceCandidate(
  match: KnownProductAssetMatch,
  existing: SourceImageCandidate[]
): SourceImageCandidate[] {
  const previous = existing.find((candidate) => candidate.imagePath === match.cutoutPath);
  const registered: SourceImageCandidate = previous
    ? { ...previous, selected: true, alreadyTransparent: true }
    : {
        id: `registered-${match.advertiserId}-${match.productId}`,
        type: "hero",
        imagePath: match.cutoutPath,
        originalUrl: match.cutoutPath,
        label: "등록된 상품 누끼",
        selected: true,
        createdAt: new Date().toISOString(),
        sourceType: "product-gallery",
        sourceImageQualityScore: 1,
        salesUnitMatchScore: 1,
        recommendationScore: 1,
        analysisReason: "광고주·상품 URL과 일치하는 검수 완료 누끼",
        expectedRepresentationType: "already-transparent",
        expectedExtractionScope: "visible-all",
        alreadyTransparent: true,
        warnings: [],
      };
  return [
    registered,
    ...existing
      .filter((candidate) => candidate.imagePath !== match.cutoutPath)
      .map((candidate) => ({ ...candidate, selected: false })),
  ];
}

export function applyKnownProductAssets(product: ProductInfoForPrompt): ProductInfoForPrompt {
  const match = matchKnownProductAsset(product);
  if (!match) return product;
  const paths = unique([
    match.cutoutPath,
    ...(product.productImagePaths || []),
    product.productImagePath,
    product.secondaryProductImagePath,
  ]).slice(0, 12);
  const gallery = unique([
    ...(product.extractedGalleryImages || []),
    product.extractedMainImage,
    product.productImagePath,
    product.secondaryProductImagePath,
  ]).filter((path) => path !== match.cutoutPath);
  return {
    ...product,
    advertiserName: product.advertiserName || match.advertiserName,
    brandName: product.brandName || match.advertiserName,
    productImagePath: match.cutoutPath,
    secondaryProductImagePath: paths.find((path) => path !== match.cutoutPath) || "",
    productImagePaths: paths,
    extractedMainImage: match.cutoutPath,
    extractedGalleryImages: gallery,
    selectedSourceImageId: `registered-${match.advertiserId}-${match.productId}`,
    selectedSourceImagePath: match.cutoutPath,
    sourceImageCandidates: registeredSourceCandidate(match, product.sourceImageCandidates || []),
    productCutoutAvailable: true,
    productRepresentation: {
      type: "already-transparent",
      confidence: 1,
      reason: "광고주 상품 카탈로그에 등록된 검수 완료 누끼",
      recommendedExtractionScope: "visible-all",
      selectedExtractionScope: "visible-all",
      expectedUnitCount: 1,
    },
  };
}
