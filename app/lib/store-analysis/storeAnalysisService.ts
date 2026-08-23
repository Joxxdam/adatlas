import { randomUUID } from "crypto";
import { loadCopyGuideForProduct } from "../mvp/copyGuideLoader";
import { enrichAnalysisNarratives } from "./analysisNarrativeEnricher";
import { analyzeStoreCategories } from "./categoryAnalyzer";
import { recommendContentAngles } from "./contentAngleRecommender";
import { scoreProductForAdvertising } from "./productScorer";
import { recommendReferencesForProducts } from "./referenceRecommender";
import { StoreCrawler } from "./storeCrawler";
import { storeAnalysisRepository, type StoreAnalysisRepository } from "./storeAnalysisRepository";
import type { CopyGuideMatch, ProductDetailAnalysis, StoreAnalysisOptions, StoreAnalysisResult } from "./types";
import { uniqueStrings } from "./htmlUtils";
import { validatePublicHttpUrl, validateRemoteImageUrl } from "./urlSafety";

function normalizeList(value: unknown) {
  if (Array.isArray(value)) return uniqueStrings(value.map(String), 20);
  return uniqueStrings(String(value || "").split(/[,\n]/), 20);
}

export async function normalizeStoreAnalysisOptions(input: Partial<StoreAnalysisOptions>): Promise<StoreAnalysisOptions> {
  const safeUrl = await validatePublicHttpUrl(String(input.storeUrl || ""));
  const maxProducts = Math.max(1, Math.min(30, Number(input.maxProducts) || 30));
  return {
    storeUrl: safeUrl.toString(),
    storeName:
      String(input.storeName || "")
        .trim()
        .slice(0, 100) || undefined,
    priorityCategories: normalizeList(input.priorityCategories),
    excludedCategories: normalizeList(input.excludedCategories),
    maxProducts,
    includeBest: input.includeBest !== false,
    includeNew: input.includeNew !== false,
    includeDiscounted: input.includeDiscounted !== false,
    analyzeReviews: input.analyzeReviews !== false,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function filterVerifiedImages(detail: ProductDetailAnalysis) {
  const candidates = uniqueStrings([detail.product.imageUrl, ...detail.imageUrls, ...detail.detailImageUrls], 4);
  const checked = await mapWithConcurrency(candidates, 2, async (url) => ({
    url,
    valid: await validateRemoteImageUrl(url).catch(() => false),
  }));
  const verified = checked.filter((item) => item.valid).map((item) => item.url);
  const allowed = uniqueStrings(verified, 4);
  return {
    ...detail,
    product: { ...detail.product, imageUrl: allowed[0] },
    imageUrls: allowed,
    detailImageUrls: allowed.filter((url) => url !== allowed[0]),
  };
}

async function copyGuideMatchFor(result: { storeUrl: string; storeName?: string; brandName?: string; category?: string }): Promise<CopyGuideMatch> {
  const guide = await loadCopyGuideForProduct({
    productUrl: result.storeUrl,
    advertiserName: result.storeName,
    brandName: result.brandName,
    category: result.category,
  });
  if (!guide) return { matched: false, confidence: 0 };
  const matchedBy = guide.matchedBy[0] || "brandName";
  const confidence = guide.matchedBy.includes("domain") ? 1 : guide.matchedBy.some((value) => value === "brandName" || value === "advertiserName") ? 0.9 : 0.7;
  return {
    matched: true,
    guideId: guide.guideId,
    brandName: guide.brandName,
    matchedBy,
    confidence,
  };
}

export class StoreAnalysisService {
  constructor(
    private readonly repository: StoreAnalysisRepository = storeAnalysisRepository,
    private readonly createCrawler: () => Pick<StoreCrawler, "discover" | "fetchProductPage"> = () => new StoreCrawler()
  ) {}

  async analyze(input: Partial<StoreAnalysisOptions>): Promise<StoreAnalysisResult> {
    const options = await normalizeStoreAnalysisOptions(input);
    const crawler = this.createCrawler();
    const discovery = await crawler.discover(options);
    const warnings = [...discovery.warnings];
    const analyzed = await mapWithConcurrency(discovery.productLinks, 3, async (link): Promise<ProductDetailAnalysis | null> => {
      try {
        const page = await crawler.fetchProductPage(link.url);
        const summary = discovery.extractor.extractProductSummary(page.finalUrl, page.html, link);
        const detail = discovery.extractor.extractProductDetail(page.finalUrl, page.html, summary, options.analyzeReviews);
        return await filterVerifiedImages(detail);
      } catch (error) {
        warnings.push(`${link.label || link.url} 상품 분석 실패: ${error instanceof Error ? error.message : "요청 실패"}`);
        return null;
      }
    });
    const details = analyzed.filter((item): item is ProductDetailAnalysis => Boolean(item));
    for (const detail of details) {
      const peers = details.filter((item) => item.product.category === detail.product.category).map((item) => item.product);
      const angles = recommendContentAngles(detail);
      detail.advertisingAnalysis = scoreProductForAdvertising({
        detail,
        categoryPeers: peers,
        angles,
      });
    }
    const narrativeEnrichment = await enrichAnalysisNarratives(details);
    if (narrativeEnrichment.warning) warnings.push(narrativeEnrichment.warning);
    const referenceMatches = await recommendReferencesForProducts(details);
    for (const detail of details) {
      const recommendation = referenceMatches.get(detail.product.id);
      if (!detail.advertisingAnalysis || !recommendation) continue;
      detail.advertisingAnalysis.recommendedReferenceLabelIds = recommendation.ids;
      detail.advertisingAnalysis.recommendedStyleName = recommendation.styleName;
      detail.advertisingAnalysis.recommendedLayoutPattern = recommendation.layoutPattern;
      detail.advertisingAnalysis.recommendedVisualTone = recommendation.visualTone;
    }
    const categories = analyzeStoreCategories(details, discovery.storeInfo);
    const copyGuideMatch = await copyGuideMatchFor({
      storeUrl: discovery.storeInfo.storeUrl,
      storeName: discovery.storeInfo.storeName,
      brandName: discovery.storeInfo.brandName,
      category: categories[0]?.name,
    });
    const recommendedProducts = details
      .filter((detail) => detail.advertisingAnalysis && detail.advertisingAnalysis.recommendationType !== "low-priority")
      .sort((a, b) => (b.advertisingAnalysis?.overallScore || 0) - (a.advertisingAnalysis?.overallScore || 0))
      .map((detail, index) => ({
        rank: index + 1,
        product: detail.product,
        analysis: detail.advertisingAnalysis!,
      }));
    const missingReviewCount = details.filter((detail) => !detail.reviewAnalysis).length;
    const limitations = ["광고 적합도는 공개된 상품정보, 가격, 후기, 이미지, USP를 바탕으로 계산하며 실제 매출 성과를 보장하지 않습니다.", "실제 판매량, 매출, 재고, 마진, 전환율, ROAS는 외부 데이터 연동 없이 확인할 수 없습니다.", "동적 로딩·로그인·외부 리뷰 위젯의 정보는 공개 HTML에서 수집되지 않을 수 있습니다."];
    if (missingReviewCount) {
      limitations.push(`${missingReviewCount}개 상품은 공개 리뷰 본문 또는 리뷰 지표를 확인하지 못해 confidence를 낮췄습니다.`);
    }
    if (details.length < discovery.productLinks.length) {
      warnings.push(`상품 ${discovery.productLinks.length}개 중 ${details.length}개 상세 분석을 완료했습니다. 실패 상품은 제외하고 결과를 계산했습니다.`);
    }
    const createdAt = new Date().toISOString();
    const analysisId = `store-${createdAt.slice(0, 10).replace(/-/g, "")}-${randomUUID().slice(0, 8)}`;
    const result: StoreAnalysisResult = {
      analysisId,
      createdAt,
      options,
      storeInfo: discovery.storeInfo,
      categories,
      products: details,
      recommendedProducts,
      copyGuideMatch,
      stats: {
        categoryCount: categories.length,
        discoveredProductCount: discovery.productLinks.length,
        analyzedProductCount: details.length,
        reviewAnalyzedProductCount: details.filter((detail) => Boolean(detail.reviewAnalysis)).length,
        failedProductCount: discovery.productLinks.length - details.length,
      },
      warnings: uniqueStrings(warnings, 50),
      limitations: uniqueStrings(limitations, 20),
    };
    await this.repository.save(result);
    return result;
  }
}

export const storeAnalysisService = new StoreAnalysisService();
