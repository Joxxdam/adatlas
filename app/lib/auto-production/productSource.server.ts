import "server-only";
import { getBigQueryCandidates, listBigQueryAdvertisers } from "../bigquery/candidateService.server";
import { bigQueryCandidateToProductInfo } from "../bigquery/handoff.server";
import type { BigQueryAdCandidate } from "../bigquery/types";
import { cremaMarketRepository } from "../crema-market/repository.server";
import type { CremaMarketDataset, Product } from "../crema-market/types";
import { discoverSiteCandidates } from "../site-candidates/crawler.server";
import { siteCandidateToProductInfo } from "../site-candidates/handoff.server";
import { analyzeDiscoveredSite, cacheSiteDiscovery } from "../site-candidates/service.server";
import type { SiteAdCandidate } from "../site-candidates/types";
import type { ProductInfoForPrompt } from "../mvp/types";
import type { AutoProductionAdvertiserConfig, AutoProductionProductCandidate, AutoProductionRole } from "./types";
import { runCandidateSourceFallback } from "./sourceFallback";
import { canonicalProductUrl, productFamilyKey } from "./productIdentity";
import { verifyAutoProductionProductImages } from "./productImageValidation";

function verifiedCandidate(candidate: AutoProductionProductCandidate): AutoProductionProductCandidate {
  const verification = verifyAutoProductionProductImages(candidate.productName, candidate.productInfo);
  const selected = verification.selectedPaths;
  const next = {
    ...candidate,
    canonicalProductUrl: candidate.canonicalProductUrl || canonicalProductUrl(candidate.productUrl),
    imageUrl: selected[0] || "",
    imageVerificationStatus: verification.status,
    imageVerificationReasons: verification.reasons,
    productInfo: {
      ...candidate.productInfo,
      productImagePath: selected[0] || "",
      productImagePaths: selected,
      extractedMainImage: selected[0] || "",
      extractedGalleryImages: selected.slice(1),
    },
  };
  return { ...next, productFamilyKey: candidate.productFamilyKey || productFamilyKey(next) };
}

function matchesBrand(config: AutoProductionAdvertiserConfig, value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  return [config.bigQueryBrandMatch, config.advertiserName, ...config.aliases].filter(Boolean).some((item) => normalized === item.toLowerCase().replace(/\s+/g, ""));
}

function bigQueryRole(candidate: BigQueryAdCandidate): AutoProductionRole {
  if (candidate.primaryType === "hidden-potential") return "low-exposure-opportunity";
  if (candidate.primaryType === "core-recovery" || candidate.trendState === "short-term-decline" || candidate.trendState === "sustained-decline") return "reactivation";
  if (candidate.primaryType === "core-scale") return "core-expansion";
  return "new-exploration";
}

function bigQueryCandidate(config: AutoProductionAdvertiserConfig, candidate: BigQueryAdCandidate): AutoProductionProductCandidate {
  const info = bigQueryCandidateToProductInfo(candidate);
  return {
    id: candidate.productId || candidate.id,
    externalId: candidate.productId,
    productCode: candidate.productId,
    sku: candidate.productId,
    productFamilyKey: candidate.productFamilyId || undefined,
    advertiserId: config.advertiserId,
    productName: candidate.productName,
    productUrl: candidate.productUrl || "",
    category: candidate.category || "기타",
    imageUrl: candidate.imageUrl || "",
    source: "bigquery",
    sourceReason: "BigQuery 읽기 전용 판매·노출 집계",
    recommendationRole: bigQueryRole(candidate),
    recommendationReason: candidate.recommendationReason,
    verifiedEvidence: candidate.metrics
      .filter((item) => item.value !== null)
      .slice(0, 6)
      .map((item) => `${item.label}: ${item.note}`),
    recommendedHookDirections: candidate.recommendedHookTypes,
    selectionScore: candidate.score,
    currentSales: candidate.currentSales,
    previousSales: candidate.previousSales,
    orders: candidate.purchaseCount,
    revenue: candidate.currentSales,
    impressions: candidate.exposureCount,
    views: null,
    conversionRate: candidate.conversionRate,
    reviewCount: candidate.reviewCount,
    rating: null,
    isNew: candidate.primaryType === "creative-improvement" && candidate.salesRank === null,
    isSeasonal: candidate.recommendedHookTypes.some((item) => /season|시즌/i.test(item)),
    siteVisible: Boolean(candidate.productUrl),
    soldOut: false,
    productInfo: {
      ...info,
      advertiserName: config.advertiserName,
      brandName: config.advertiserName,
      creativeContext: { ...info.creativeContext, advertiserId: config.advertiserId, productId: info.creativeContext?.productId || candidate.productId || candidate.id },
    },
  };
}

function siteRole(candidate: SiteAdCandidate): AutoProductionRole {
  const type = candidate.primaryRecommendationType;
  if (type === "new-product-test" || type === "seasonal-test") return "new-exploration";
  if (type === "review-trust" || type === "core-usp") return "core-expansion";
  if (type === "situation" || type === "visual-hook") return "reactivation";
  return "low-exposure-opportunity";
}

function siteCandidate(config: AutoProductionAdvertiserConfig, candidate: SiteAdCandidate, source: "site" | "admin" = "site"): AutoProductionProductCandidate {
  const product = candidate.product;
  const info = siteCandidateToProductInfo(candidate);
  return {
    id: product.id,
    productCode: product.id,
    sku: product.id,
    advertiserId: config.advertiserId,
    productName: product.productName,
    productUrl: product.productUrl,
    category: product.category || "기타",
    imageUrl: product.representativeImage || "",
    source,
    sourceReason: source === "admin" ? "관리자가 지정한 공개 상품 URL" : "사이트 공개 상세페이지",
    recommendationRole: siteRole(candidate),
    recommendationReason: candidate.recommendationSummary.coreReason,
    verifiedEvidence: candidate.recommendationReasons.slice(0, 6),
    recommendedHookDirections: candidate.recommendationTypes,
    selectionScore: candidate.score.total,
    currentSales: null,
    previousSales: null,
    orders: null,
    revenue: null,
    impressions: null,
    views: null,
    conversionRate: null,
    reviewCount: product.reviewCount ?? null,
    rating: product.rating ?? null,
    isNew: candidate.recommendationTypes.includes("new-product-test"),
    isSeasonal: candidate.recommendationTypes.includes("seasonal-test"),
    siteVisible: true,
    soldOut: product.stockStatus !== "in-stock",
    productInfo: {
      ...info,
      advertiserName: config.advertiserName,
      brandName: config.advertiserName,
      creativeContext: { ...info.creativeContext, advertiserId: config.advertiserId, productId: info.creativeContext?.productId || product.id },
    },
  };
}

function cremaProductInfo(config: AutoProductionAdvertiserConfig, product: Product, evidence: string[]): ProductInfoForPrompt {
  const price = product.discountPrice ?? product.finalPrice ?? product.sellingPrice;
  const images = [product.representativeImageUrl, product.imageUrl].filter((item): item is string => Boolean(item));
  const landingUrl = product.productUrl || product.url || "";
  return {
    productName: product.productName || product.name,
    category: product.categoryName || "기타",
    price: price === null || price === undefined ? "" : `${price.toLocaleString("ko-KR")}원`,
    originalPrice: product.originalPrice ? `${product.originalPrice.toLocaleString("ko-KR")}원` : "",
    discountInfo: "",
    advertiserName: config.advertiserName,
    brandName: config.advertiserName,
    mainBenefit: evidence.join(" · "),
    targetCustomer: "상품 상세정보를 확인하고 구매를 비교하는 고객",
    landingUrl,
    productImagePath: images[0] || "",
    productImagePaths: images,
    backgroundImagePath: "",
    extractedMainImage: images[0] || "",
    extractedGalleryImages: images,
    verifiedBenefits: evidence,
    sourceImageCandidates: [],
    creativeContext: {
      advertiserId: config.advertiserId,
      productId: product.id,
      recommendedHookTypes: [],
      recommendedMessageAngles: evidence,
      dataEvidence: evidence,
      dataSources: ["CREMA_READ_ONLY"],
      analysisSource: "CREMA",
    },
  };
}

function cremaCandidates(config: AutoProductionAdvertiserConfig, dataset: CremaMarketDataset): AutoProductionProductCandidate[] {
  return dataset.products.map((product) => {
    const metrics = dataset.dailyMetrics.filter((item) => item.productId === product.id);
    const sums = (key: "netRevenue" | "revenue" | "netOrders" | "paidOrders" | "impressions" | "views") => {
      const values = metrics.map((item) => item[key]).filter((value): value is number => typeof value === "number");
      return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    };
    const opportunity = dataset.opportunities.find((item) => item.productId === product.id && item.status !== "excluded");
    const evidence =
      opportunity?.evidence
        .map((item) => item.message)
        .filter(Boolean)
        .slice(0, 6) || [];
    const info = cremaProductInfo(config, product, evidence);
    const role: AutoProductionRole = opportunity?.primaryType === "HIDDEN_WINNER" || opportunity?.primaryType === "UNDEREXPOSED" ? "low-exposure-opportunity" : opportunity?.primaryType === "DECLINING_BESTSELLER" ? "reactivation" : opportunity?.primaryType === "NEW_PRODUCT_TEST" ? "new-exploration" : "core-expansion";
    const revenue = sums("netRevenue") ?? sums("revenue");
    const orders = sums("netOrders") ?? sums("paidOrders");
    const impressions = sums("impressions");
    const views = sums("views");
    return {
      id: product.id,
      externalId: product.externalId,
      productCode: product.productCode || product.code,
      sku: product.productCode || product.code || product.externalId,
      advertiserId: config.advertiserId,
      productName: product.productName || product.name,
      productUrl: info.landingUrl,
      category: product.categoryName || "기타",
      imageUrl: info.productImagePath,
      source: "crema",
      sourceReason: "크리마 읽기 전용 상품·주문 집계",
      recommendationRole: role,
      recommendationReason: opportunity?.summary || "확인된 상품·주문 정보를 바탕으로 광고 후보를 선정했습니다.",
      verifiedEvidence: evidence,
      recommendedHookDirections: opportunity?.recommendedHookTypes || [],
      selectionScore: opportunity?.opportunityScore || Math.log10((revenue || 0) + 1) * 10,
      currentSales: revenue,
      previousSales: null,
      orders,
      revenue,
      impressions,
      views,
      conversionRate: impressions && orders ? orders / impressions : views && orders ? orders / views : null,
      reviewCount: null,
      rating: null,
      isNew: role === "new-exploration",
      isSeasonal: false,
      siteVisible: product.display,
      soldOut: /sold|품절|중지/i.test(product.status || "") || product.stockCount === 0,
      productInfo: info,
    };
  });
}

async function fromBigQuery(config: AutoProductionAdvertiserConfig) {
  const advertisers = await listBigQueryAdvertisers();
  const advertiser = advertisers.advertisers.find((item) => matchesBrand(config, item.name));
  if (!advertiser) throw new Error("BigQuery에서 광고주 매칭값을 찾지 못했습니다.");
  const response = await getBigQueryCandidates({ advertiserId: advertiser.id, period: "4w", type: "all" });
  return response.candidates.map((candidate) => bigQueryCandidate(config, candidate));
}

async function fromCrema(config: AutoProductionAdvertiserConfig) {
  const datasets = await cremaMarketRepository.list();
  const dataset = datasets.find((item) => matchesBrand(config, item.advertiser.name) || item.advertiser.id === config.advertiserId);
  if (!dataset) throw new Error("저장된 크리마 상품 데이터를 찾지 못했습니다.");
  return cremaCandidates(config, dataset);
}

async function fromSite(config: AutoProductionAdvertiserConfig, url = config.siteUrl, source: "site" | "admin" = "site") {
  if (!url) throw new Error("사이트 URL이 설정되지 않았습니다.");
  const discovery = cacheSiteDiscovery(await discoverSiteCandidates(url));
  const analysis = await analyzeDiscoveredSite(discovery.discoveryId);
  return { candidates: analysis.candidates.map((candidate) => siteCandidate(config, candidate, source)), warnings: analysis.warnings };
}

function sameProductUrl(left: string, right: string) {
  return Boolean(left && right && canonicalProductUrl(left) === canonicalProductUrl(right));
}

async function fromPlannedProductUrls(config: AutoProductionAdvertiserConfig) {
  const batches = await Promise.allSettled(config.adminProductUrls.slice(0, config.productsPerRun).map((url) => fromSite(config, url, "admin")));
  const candidates: AutoProductionProductCandidate[] = [];
  const warnings: string[] = [];
  batches.forEach((batch, index) => {
    const plannedUrl = config.adminProductUrls[index];
    if (batch.status === "rejected") {
      warnings.push(`${index + 1}번 예정 상품을 불러오지 못했습니다: ${batch.reason instanceof Error ? batch.reason.message : "상품 페이지 확인 실패"}`);
      return;
    }
    const exact = batch.value.candidates.find((candidate) => sameProductUrl(candidate.productUrl, plannedUrl));
    const selected = exact || batch.value.candidates[0];
    if (!selected) {
      warnings.push(`${index + 1}번 예정 상품에서 제작할 상품정보를 찾지 못했습니다.`);
      return;
    }
    candidates.push({
      ...selected,
      productUrl: plannedUrl,
      canonicalProductUrl: canonicalProductUrl(plannedUrl),
      source: "admin",
      sourceReason: "자동제작 화면에서 확정한 다음 제작 예정 상품 URL",
      recommendationReason: "사용자가 몰별 다음 제작 예정 상품으로 확정했습니다.",
      productInfo: {
        ...selected.productInfo,
        landingUrl: plannedUrl,
      },
    });
    warnings.push(...batch.value.warnings);
  });
  if (!candidates.length) throw new Error("저장한 예정 상품 URL에서 제작할 상품정보를 찾지 못했습니다.");
  return { candidates, source: "admin" as const, warnings: Array.from(new Set(warnings)) };
}

export async function loadAutoProductionCandidates(config: AutoProductionAdvertiserConfig) {
  const attempts: Array<() => Promise<{ candidates: AutoProductionProductCandidate[]; source: AutoProductionProductCandidate["source"]; warnings?: string[] }>> = [];
  // 화면에서 확정한 URL은 단순 fallback이 아니라 다음 예약 실행의 고정 상품 목록이다.
  // 네 URL을 한 번에 수집해야 첫 번째 URL의 탐색 결과만 쓰는 과거 동작을 피할 수 있다.
  if (config.adminProductUrls.length) {
    attempts.push(() => fromPlannedProductUrls(config));
  } else if (config.productVisibilityMode === "admin-only" || config.dataSource === "admin") {
    attempts.push(async () => {
      throw new Error("관리자 지정 상품 모드에는 다음 제작 예정 상품 URL이 필요합니다.");
    });
  } else {
    if (["auto", "bigquery"].includes(config.dataSource)) attempts.push(async () => ({ candidates: await fromBigQuery(config), source: "bigquery" as const }));
    if (["auto", "crema"].includes(config.dataSource)) attempts.push(async () => ({ candidates: await fromCrema(config), source: "crema" as const }));
    if (["auto", "site", "bigquery", "crema"].includes(config.dataSource)) attempts.push(async () => ({ ...(await fromSite(config)), source: "site" as const }));
  }
  const result = await runCandidateSourceFallback(attempts, "site" as const);
  return {
    ...result,
    candidates: result.candidates.map(verifiedCandidate),
  };
}
