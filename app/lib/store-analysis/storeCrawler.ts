import type { DiscoveredProductLink, DiscoveredStorePage, StoreAnalysisOptions, StoreExtractor, StoreInfo } from "./types";
import { extractorForPlatform, detectStorePlatform } from "./platformDetector";
import { mergeAndPrioritizeProductLinks } from "./productDiscovery";
import { isSameStoreDomain, readRobotsPolicy, robotsAllowsUrl, safeFetchHtml, type RobotsPolicy, type SafeHtmlResponse } from "./urlSafety";

const MAX_CATEGORY_PAGES = 10;
const MAX_LIST_PAGES = 20;
const MAX_TOTAL_PAGES = 64;

export type StoreDiscoveryResult = {
  storeInfo: StoreInfo;
  extractor: StoreExtractor;
  productLinks: DiscoveredProductLink[];
  warnings: string[];
};

function pageAllowedByOptions(page: DiscoveredStorePage, options: StoreAnalysisOptions) {
  if (page.kind === "best" && !options.includeBest) return false;
  if (page.kind === "new" && !options.includeNew) return false;
  if (page.kind === "promotion" && !options.includeDiscounted) return false;
  const signal = `${page.label} ${page.url}`.toLowerCase().replace(/\s+/g, "");
  return !options.excludedCategories.some((value) => signal.includes(value.toLowerCase().replace(/\s+/g, "")));
}

function prioritizePages(pages: DiscoveredStorePage[], options: StoreAnalysisOptions) {
  return pages.sort((a, b) => {
    const score = (page: DiscoveredStorePage) => {
      const signal = `${page.label} ${page.url}`.toLowerCase().replace(/\s+/g, "");
      const priority = options.priorityCategories.some((value) => signal.includes(value.toLowerCase().replace(/\s+/g, "")));
      return (priority ? 100 : 0) + (page.kind === "best" ? 30 : 0) + (page.kind === "new" ? 20 : 0) + (page.kind === "promotion" ? 10 : 0);
    };
    return score(b) - score(a);
  });
}

export class StoreCrawler {
  private readonly cache = new Map<string, Promise<SafeHtmlResponse>>();
  private pageCount = 0;
  private robotsPolicy: RobotsPolicy = { found: false, disallowedPaths: [] };
  private storeUrl = "";

  private async fetchPage(url: string) {
    if (!this.storeUrl) throw new Error("스토어 크롤러가 초기화되지 않았습니다.");
    if (!isSameStoreDomain(url, this.storeUrl)) {
      throw new Error("자동 탐색은 동일 쇼핑몰 도메인 안에서만 허용됩니다.");
    }
    if (!robotsAllowsUrl(this.robotsPolicy, url)) {
      throw new Error("robots.txt 정책에서 해당 경로의 자동 수집을 허용하지 않습니다.");
    }
    const normalized = new URL(url).toString();
    const cached = this.cache.get(normalized);
    if (cached) return cached;
    if (this.pageCount >= MAX_TOTAL_PAGES) {
      throw new Error("분석 페이지 수 제한에 도달했습니다.");
    }
    this.pageCount += 1;
    const pending = safeFetchHtml(normalized);
    this.cache.set(normalized, pending);
    try {
      return await pending;
    } catch (error) {
      this.cache.delete(normalized);
      throw error;
    }
  }

  async discover(options: StoreAnalysisOptions): Promise<StoreDiscoveryResult> {
    this.storeUrl = options.storeUrl;
    this.robotsPolicy = await readRobotsPolicy(options.storeUrl);
    if (!robotsAllowsUrl(this.robotsPolicy, options.storeUrl)) {
      throw new Error("robots.txt 정책에서 쇼핑몰 자동 분석을 허용하지 않습니다.");
    }
    const home = await this.fetchPage(options.storeUrl);
    this.storeUrl = home.finalUrl;
    const platform = detectStorePlatform(home.finalUrl, home.html);
    const extractor = extractorForPlatform(platform);
    const storeInfo = extractor.extractStoreInfo(home.finalUrl, home.html);
    storeInfo.platform = platform;
    storeInfo.storeUrl = home.finalUrl;
    storeInfo.domain = new URL(home.finalUrl).hostname.toLowerCase();
    if (options.storeName) {
      storeInfo.storeName = options.storeName;
      storeInfo.brandName = storeInfo.brandName || options.storeName;
    }
    const warnings: string[] = [];
    const homeSource: DiscoveredStorePage = {
      url: home.finalUrl,
      label: "쇼핑몰 메인",
      kind: "home",
    };
    const allProductLinks = extractor.discoverProductUrls(home.finalUrl, home.html, homeSource);
    const discoveredPages = prioritizePages(
      extractor
        .discoverCategoryUrls(home.finalUrl, home.html)
        .filter((page) => isSameStoreDomain(page.url, home.finalUrl))
        .filter((page) => pageAllowedByOptions(page, options)),
      options
    );
    const categoryPages = discoveredPages.filter((page) => page.kind === "category").slice(0, MAX_CATEGORY_PAGES);
    const nonCategoryPages = discoveredPages.filter((page) => page.kind !== "category");
    const pagesToVisit = [...categoryPages, ...nonCategoryPages].filter((page, index, pages) => pages.findIndex((candidate) => candidate.url === page.url) === index).slice(0, MAX_LIST_PAGES);

    for (const page of pagesToVisit) {
      try {
        const response = await this.fetchPage(page.url);
        allProductLinks.push(
          ...extractor.discoverProductUrls(response.finalUrl, response.html, {
            ...page,
            url: response.finalUrl,
          })
        );
      } catch (error) {
        warnings.push(`${page.label || page.url} 페이지를 분석하지 못했습니다: ${error instanceof Error ? error.message : "요청 실패"}`);
      }
    }

    storeInfo.categoryUrls = categoryPages.map((page) => page.url);
    storeInfo.bestPageUrls = pagesToVisit.filter((page) => page.kind === "best").map((page) => page.url);
    storeInfo.newPageUrls = pagesToVisit.filter((page) => page.kind === "new").map((page) => page.url);
    storeInfo.promotionPageUrls = pagesToVisit.filter((page) => page.kind === "promotion").map((page) => page.url);
    const productLinks = mergeAndPrioritizeProductLinks(allProductLinks, options);
    if (!pagesToVisit.length) {
      warnings.push("상품 목록 또는 카테고리 구조를 자동으로 찾지 못해 메인 페이지 링크만 분석했습니다.");
    }
    if (!productLinks.length) {
      warnings.push("상품 링크를 자동으로 찾지 못했습니다. 상품 URL을 직접 추가하거나 선택 상품 제작하기를 사용해 주세요.");
    } else if (productLinks.length < options.maxProducts) {
      warnings.push(`요청한 ${options.maxProducts}개 중 공개 HTML에서 ${productLinks.length}개 상품 후보를 찾았습니다.`);
    }
    if (platform === "smartstore") {
      warnings.push("스마트스토어는 동적 렌더링과 접근 정책에 따라 일부 공개 상품만 수집될 수 있습니다.");
    } else if (platform === "generic" || platform === "unknown") {
      warnings.push("일반 HTML 구조로 분석했습니다. 일부 카테고리·리뷰·상품 상태를 가져오지 못할 수 있습니다.");
    }
    return { storeInfo, extractor, productLinks, warnings };
  }

  async fetchProductPage(url: string) {
    return this.fetchPage(url);
  }
}
