import "server-only";

import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { POST as extractProduct } from "../../api/extract/product/route";
import { autoProductionAdvertiserRepository } from "../auto-production/advertiserConfig.server";
import { getBigQueryCandidates, listBigQueryAdvertisers } from "../bigquery/candidateService.server";
import { defaultFashionCategories } from "../category-candidates/normalization";
import { readCreativeRasterAsset } from "../creative-generation/assets.server";
import { discoverSiteCandidates } from "../site-candidates/crawler.server";
import { analyzeDiscoveredSite, cacheSiteDiscovery } from "../site-candidates/service.server";
import type { SiteAdCandidate, SiteDiscoveryResult } from "../site-candidates/types";
import { listCategoryCreativeSources, saveCategoryCreativeSource } from "./repository.server";
import type { CategoryCreativeSource } from "./types";
import type { ExtractedProductInfo } from "../mvp/types";

type AutoSourceInput = {
  advertiserId: string;
  advertiserName?: string;
  categoryId: string;
};

type ProductImageCandidate = {
  productName: string;
  productUrl: string;
  images: Array<{ url: string; source: "product-page" | "candidate-thumbnail" }>;
  score: number;
};

declare global {
  var __adatlasCategoryCreativeAutoSourceLock: Promise<unknown> | undefined;
}

function normalize(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "");
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function categoryForText(value: string) {
  const normalized = String(value || "").normalize("NFKC").toLowerCase();
  const categoryPriority = [
    "fashion.cardigans",
    "fashion.dresses",
    "fashion.outerwear",
    "fashion.bottoms",
    "fashion.sets",
    "fashion.shoes",
    "fashion.bags",
    "fashion.accessories",
    "fashion.tops",
  ];
  const matches = defaultFashionCategories.flatMap((category) => {
    const matchedKeywords = category.keywords.filter((keyword) => {
      const token = keyword.toLowerCase();
      if (token === "티") {
        return /(?:^|[\s()[\]{}·,/_-])티(?:$|[\s()[\]{}·,/_-])|반팔티|긴팔티|티셔츠|티$/i.test(normalized);
      }
      if (token === "백") {
        return /(?:^|[\s()[\]{}·,/_-])백(?:$|[\s()[\]{}·,/_-])|숄더백|토트백|크로스백/i.test(normalized);
      }
      return normalized.includes(token);
    });
    if (!matchedKeywords.length) return [];
    return [{
      categoryId: category.id,
      keywordLength: Math.max(...matchedKeywords.map((keyword) => keyword.length)),
      priority: categoryPriority.indexOf(category.id),
    }];
  });
  matches.sort((left, right) => right.keywordLength - left.keywordLength || left.priority - right.priority);
  return matches[0]?.categoryId || null;
}

function sameCategory(productName: string, category: string | undefined, categoryId: string) {
  return categoryForText(`${productName} ${category || ""}`) === categoryId;
}

function sourceIdentity(source: CategoryCreativeSource) {
  return normalize(source.productUrl || source.productName || source.id);
}

function chooseSources(sources: CategoryCreativeSource[], limit = 5) {
  const selected: CategoryCreativeSource[] = [];
  const seen = new Set<string>();
  const ordered = [...sources].sort((left, right) => {
    const priority = (source: CategoryCreativeSource) => source.sourceType === "upload" ? 3 : source.imageSource === "product-page" ? 2 : 1;
    return priority(right) - priority(left) || right.createdAt.localeCompare(left.createdAt);
  });
  for (const source of ordered) {
    const identity = sourceIdentity(source);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    selected.push(source);
    if (selected.length >= limit) break;
  }
  return selected;
}

function reusableProductSources(sources: CategoryCreativeSource[]) {
  return sources.filter((source) => source.sourceType === "upload" || source.imageSource === "product-page");
}

function categoryEligibleSources(sources: CategoryCreativeSource[], categoryId: string) {
  return sources.filter((source) => source.sourceType !== "automatic" || sameCategory(source.productName, source.categoryName, categoryId));
}

async function serialize<T>(work: () => Promise<T>) {
  const previous = globalThis.__adatlasCategoryCreativeAutoSourceLock || Promise.resolve();
  const next = previous.then(work, work);
  globalThis.__adatlasCategoryCreativeAutoSourceLock = next.catch(() => undefined);
  return next;
}

async function resolveAdvertiser(input: AutoSourceInput) {
  let bigQueryAdvertiser: Awaited<ReturnType<typeof listBigQueryAdvertisers>>["advertisers"][number] | undefined;
  try {
    bigQueryAdvertiser = (await listBigQueryAdvertisers()).advertisers.find((item) => item.id === input.advertiserId);
  } catch {
    // BigQuery 연결이 없어도 저장된 자동제작 광고주 설정으로 계속 시도합니다.
  }

  const requestedNames = unique([input.advertiserName, bigQueryAdvertiser?.name]).map(normalize);
  const configs = await autoProductionAdvertiserRepository.list().catch(() => []);
  const config = configs.find((item) => {
    if (item.advertiserId === input.advertiserId) return true;
    const identities = unique([item.advertiserName, item.bigQueryBrandMatch, ...item.aliases]).map(normalize);
    return identities.some((identity) => identity && requestedNames.includes(identity));
  });

  return {
    advertiserName: bigQueryAdvertiser?.name || input.advertiserName || config?.advertiserName || "광고주",
    storeUrl: bigQueryAdvertiser?.storeUrl || config?.siteUrl || config?.adminProductUrls[0] || "",
  };
}

async function bigQueryProductImages(input: AutoSourceInput) {
  try {
    const result = await getBigQueryCandidates({ advertiserId: input.advertiserId, period: "4w", type: "all" });
    const candidates = result.candidates
      .filter((candidate) => sameCategory(candidate.productName, candidate.category || undefined, input.categoryId))
      .map<ProductImageCandidate>((candidate) => ({
        productName: candidate.productName,
        productUrl: candidate.productUrl || "",
        images: unique([candidate.imageUrl]).map((url) => ({ url, source: "candidate-thumbnail" as const })),
        score: candidate.recommendationScore,
      }))
      .filter((candidate) => candidate.productUrl || candidate.images.length > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    const hydrated: ProductImageCandidate[] = [];
    for (let index = 0; index < candidates.length; index += 2) {
      const batch = candidates.slice(index, index + 2);
      hydrated.push(...await Promise.all(batch.map(hydrateProductPageImages)));
    }
    return hydrated;
  } catch {
    return [];
  }
}

async function hydrateProductPageImages(candidate: ProductImageCandidate): Promise<ProductImageCandidate> {
  if (!candidate.productUrl) return candidate;
  try {
    const response = await extractProduct(new Request("http://adatlas.internal/api/extract/product", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productUrl: candidate.productUrl }),
    }));
    const payload = (await response.json()) as { productInfo?: ExtractedProductInfo };
    if (!response.ok || !payload.productInfo) return candidate;
    const product = payload.productInfo;
    const productImages = unique([
      ...(product.sourceImageCandidates || []).map((item) => item.imagePath),
      product.mainImage,
      ...(product.galleryImages || []),
      ...(product.detailImages || []),
    ]).map((url) => ({ url, source: "product-page" as const }));
    return {
      ...candidate,
      productName: product.productName || candidate.productName,
      images: [...productImages, ...candidate.images.filter((image) => !productImages.some((item) => normalize(item.url) === normalize(image.url)))],
    };
  } catch {
    return candidate;
  }
}

function discoveryForCategory(discovery: SiteDiscoveryResult, categoryId: string) {
  const matching = discovery.products.filter((product) => sameCategory(product.label || "", product.category, categoryId));
  const unknown = discovery.products.filter((product) => categoryForText(`${product.label || ""} ${product.category || ""}`) === null);
  const products = [...matching, ...unknown.filter((product) => !matching.some((item) => item.url === product.url))].slice(0, 24);
  return {
    ...discovery,
    discoveryId: `site-discovery-category-${randomUUID()}`,
    products: products.length ? products : discovery.products.slice(0, 24),
    discoveredProductCount: products.length || Math.min(discovery.products.length, 24),
    analyzableProductCount: products.length || Math.min(discovery.products.length, 24),
  };
}

function siteProductImages(candidate: SiteAdCandidate, categoryId: string): ProductImageCandidate | null {
  const product = candidate.product;
  if (!sameCategory(product.productName, product.category, categoryId)) return null;
  const images = unique([product.representativeImage, ...product.additionalImages]).map((url) => ({ url, source: "product-page" as const }));
  if (!images.length) return null;
  return {
    productName: product.productName,
    productUrl: product.productUrl,
    images,
    score: candidate.score.total,
  };
}

async function storefrontProductImages(storeUrl: string, categoryId: string) {
  if (!storeUrl) return { candidates: [] as ProductImageCandidate[], warnings: ["광고주의 쇼핑몰 주소가 등록되어 있지 않습니다."] };
  try {
    const discovery = discoveryForCategory(await discoverSiteCandidates(storeUrl), categoryId);
    cacheSiteDiscovery(discovery);
    const analysis = await analyzeDiscoveredSite(discovery.discoveryId);
    return {
      candidates: analysis.candidates.map((candidate) => siteProductImages(candidate, categoryId)).filter((candidate): candidate is ProductImageCandidate => Boolean(candidate)).sort((a, b) => b.score - a.score),
      warnings: analysis.warnings,
    };
  } catch (error) {
    return { candidates: [] as ProductImageCandidate[], warnings: [error instanceof Error ? error.message : "쇼핑몰 상품을 불러오지 못했습니다."] };
  }
}

async function saveCandidate(input: AutoSourceInput, advertiserName: string, categoryName: string, candidate: ProductImageCandidate) {
  let lastError: unknown;
  for (const image of candidate.images.slice(0, 8)) {
    try {
      const imageUrl = image.url;
      const raw = await readCreativeRasterAsset(imageUrl);
      const normalized = await sharp(raw, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toBuffer();
      const id = `category-source-auto-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
      const urlName = path.basename(new URL(imageUrl).pathname) || `${id}.jpg`;
      const source: CategoryCreativeSource = {
        id,
        advertiserId: input.advertiserId,
        advertiserName: advertiserName.slice(0, 120),
        categoryId: input.categoryId,
        categoryName: categoryName.slice(0, 80),
        productName: candidate.productName.slice(0, 160),
        originalFileName: urlName.slice(0, 200),
        mimeType: "image/jpeg",
        fileName: `${id}.jpg`,
        sourceType: "automatic",
        imageSource: image.source,
        productUrl: candidate.productUrl.slice(0, 1200),
        originalImageUrl: imageUrl.slice(0, 1600),
        createdAt: new Date().toISOString(),
      };
      return saveCategoryCreativeSource(source, normalized);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("상품 이미지를 저장하지 못했습니다.");
}

export async function autoFillCategoryCreativeSources(input: AutoSourceInput) {
  return serialize(async () => {
    const category = defaultFashionCategories.find((item) => item.id === input.categoryId);
    if (!input.advertiserId || !category) throw new Error("광고주와 지원되는 카테고리를 선택해 주세요.");
    const categoryName = category.name;

    let allSources = categoryEligibleSources(
      await listCategoryCreativeSources({ advertiserId: input.advertiserId, categoryId: input.categoryId }),
      input.categoryId,
    );
    let selectedSources = chooseSources(reusableProductSources(allSources));
    if (selectedSources.length >= 3) {
      return { sources: allSources, selectedSources, importedCount: 0, warnings: [] as string[] };
    }

    const advertiser = await resolveAdvertiser(input);
    const warnings: string[] = [];
    const existingIdentities = new Set(reusableProductSources(allSources).map(sourceIdentity));
    const existingImages = new Set(allSources.map((source) => normalize(source.originalImageUrl || "")).filter(Boolean));
    let importedCount = 0;

    async function importCandidates(candidates: ProductImageCandidate[]) {
      for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
        if (chooseSources(reusableProductSources(allSources)).length >= 5) break;
        const identity = normalize(candidate.productUrl || candidate.productName);
        if (!identity || existingIdentities.has(identity) || candidate.images.every((image) => existingImages.has(normalize(image.url)))) continue;
        try {
          const source = await saveCandidate(input, advertiser.advertiserName, categoryName, candidate);
          allSources = [source, ...allSources];
          existingIdentities.add(identity);
          candidate.images.forEach((image) => existingImages.add(normalize(image.url)));
          importedCount += 1;
        } catch {
          warnings.push(`${candidate.productName}: 대표 이미지를 가져오지 못했습니다.`);
        }
      }
    }

    // 이미 수집·분석된 광고 후보가 가장 빠르고 정확하므로 먼저 사용합니다.
    await importCandidates(await bigQueryProductImages(input));

    // 후보 데이터만으로 제작 최소 수량을 채우지 못했을 때만 공개 쇼핑몰을 탐색합니다.
    if (chooseSources(reusableProductSources(allSources)).length < 3) {
      const storefront = await storefrontProductImages(advertiser.storeUrl, input.categoryId);
      warnings.push(...storefront.warnings);
      await importCandidates(storefront.candidates);
    }

    allSources = categoryEligibleSources(
      await listCategoryCreativeSources({ advertiserId: input.advertiserId, categoryId: input.categoryId }),
      input.categoryId,
    );
    selectedSources = chooseSources(reusableProductSources(allSources));
    if (selectedSources.length < 3) {
      warnings.unshift(`선택한 ${category.name} 카테고리에서 사용할 수 있는 실제 상품 이미지를 ${selectedSources.length}장만 찾았습니다.`);
    }
    return { sources: allSources, selectedSources, importedCount, warnings: unique(warnings).slice(0, 12) };
  });
}
