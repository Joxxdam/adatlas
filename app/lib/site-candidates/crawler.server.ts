import "server-only";

import { randomUUID } from "crypto";
import {
  absoluteHttpUrl,
  extractJsonLdNodes,
  firstRecord,
  jsonLdTypeIncludes,
  stringValue,
  uniqueStrings,
} from "../store-analysis/htmlUtils";
import { extractorForPlatform, detectStorePlatform } from "../store-analysis/platformDetector";
import type { DiscoveredProductLink, DiscoveredStorePage } from "../store-analysis/types";
import {
  isSameStoreDomain,
  readRobotsPolicy,
  robotsAllowsUrl,
  safeFetchHtml,
  safeFetchPublicText,
  validatePublicHttpUrl,
} from "../store-analysis/urlSafety";
import {
  deduplicateProductUrls,
  detectSitePageType,
  looksLikeProductPageUrl,
  normalizeSitePageUrl,
} from "./pageClassifier";
import type { SiteDiscoveredProduct, SiteDiscoveryResult } from "./types";

const MAX_PRODUCTS = 30;
const MAX_LIST_PAGES = 10;
const MAX_SITEMAP_CHILDREN = 3;
const MAX_PUBLIC_FEEDS = 2;
const REQUEST_GAP_MS = 140;
const TOTAL_TIMEOUT_MS = 55_000;

class RequestPacer {
  private nextAllowedAt = 0;

  async wait() {
    const waitMs = Math.max(0, this.nextAllowedAt - Date.now());
    this.nextAllowedAt = Math.max(Date.now(), this.nextAllowedAt) + REQUEST_GAP_MS;
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

function sitemapLocations(xml: string, baseUrl: string) {
  return uniqueStrings(
    Array.from(xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)).map((match) =>
      absoluteHttpUrl(match[1].trim(), baseUrl)
    ),
    500
  );
}

function linkedPublicFeeds(html: string, baseUrl: string) {
  const feeds: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/(?:rss|atom|feed|application\/xml|text\/xml)/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) feeds.push(absoluteHttpUrl(href, baseUrl));
  }
  return uniqueStrings(feeds, MAX_PUBLIC_FEEDS);
}

function publicFeedProductUrls(feed: string, baseUrl: string) {
  return uniqueStrings(
    Array.from(
      feed.matchAll(/<(?:g:)?link\b[^>]*>(?:<!\[CDATA\[)?\s*(https?:\/\/[^<\]\s]+)/gi)
    ).map((match) => absoluteHttpUrl(match[1].trim(), baseUrl)),
    MAX_PRODUCTS
  );
}

function jsonLdProductUrls(html: string, baseUrl: string) {
  const urls: string[] = [];
  for (const node of extractJsonLdNodes(html)) {
    if (jsonLdTypeIncludes(node, "product")) {
      urls.push(absoluteHttpUrl(stringValue(node.url), baseUrl));
    }
    if (jsonLdTypeIncludes(node, "itemlist")) {
      const items = Array.isArray(node.itemListElement) ? node.itemListElement : [];
      for (const item of items) {
        const record = firstRecord(item);
        const nested = firstRecord(record.item);
        urls.push(
          absoluteHttpUrl(stringValue(record.url) || stringValue(nested.url), baseUrl)
        );
      }
    }
  }
  return uniqueStrings(urls, MAX_PRODUCTS);
}

function sourceScore(link: DiscoveredProductLink) {
  const source = link.discoveredFrom.join(" ").toLowerCase();
  return (
    (/sitemap|사이트맵/.test(source) ? 80 : 0) +
    (/feed|피드/.test(source) ? 75 : 0) +
    (/json-ld/.test(source) ? 70 : 0) +
    (link.isBest ? 60 : 0) +
    (link.isNew ? 50 : 0) +
    (link.isDiscounted ? 40 : 0) +
    (/입력 페이지/.test(source) ? 30 : 0)
  );
}

function mergeLinks(links: DiscoveredProductLink[]) {
  const ordered = [...links].sort((a, b) => sourceScore(b) - sourceScore(a));
  return deduplicateProductUrls(ordered, MAX_PRODUCTS);
}

function toPublicProduct(link: DiscoveredProductLink): SiteDiscoveredProduct {
  const url = normalizeSitePageUrl(link.url);
  return {
    id: `discovered-${Buffer.from(url).toString("base64url").slice(0, 28)}`,
    url,
    label: link.label,
    category: link.category,
    discoveredFrom: uniqueStrings(link.discoveredFrom, 8),
    isBest: link.isBest,
    isNew: link.isNew,
    isDiscounted: link.isDiscounted,
  };
}

export async function discoverSiteCandidates(inputUrl: string): Promise<SiteDiscoveryResult> {
  const startedAt = Date.now();
  const pacer = new RequestPacer();
  const safeInput = await validatePublicHttpUrl(inputUrl);
  const robots = await readRobotsPolicy(safeInput.toString());
  if (!robotsAllowsUrl(robots, safeInput.toString())) {
    throw new Error("사이트의 robots.txt 정책에서 해당 페이지 자동 분석을 허용하지 않습니다.");
  }

  await pacer.wait();
  const firstPage = await safeFetchHtml(safeInput.toString(), { timeoutMs: 12_000 });
  const normalizedUrl = normalizeSitePageUrl(firstPage.finalUrl);
  const pageType = detectSitePageType(normalizedUrl, firstPage.html);
  const platform = detectStorePlatform(normalizedUrl, firstPage.html);
  const extractor = extractorForPlatform(platform);
  const storeInfo = extractor.extractStoreInfo(normalizedUrl, firstPage.html);
  const warnings: string[] = [];
  const links: DiscoveredProductLink[] = [];

  if (pageType === "product") {
    links.push({
      url: normalizedUrl,
      label: "입력한 상품 상세페이지",
      discoveredFrom: ["사용자 입력 상품 URL"],
    });
  } else if (pageType !== "unsupported") {
    const source: DiscoveredStorePage = {
      url: normalizedUrl,
      label:
        pageType === "homepage"
          ? "입력 홈페이지"
          : pageType === "category"
            ? "입력 카테고리"
            : "입력 기획전",
      kind:
        pageType === "homepage"
          ? "home"
          : pageType === "category"
            ? "category"
            : "promotion",
    };
    links.push(...extractor.discoverProductUrls(normalizedUrl, firstPage.html, source));
    for (const url of jsonLdProductUrls(firstPage.html, normalizedUrl)) {
      if (!isSameStoreDomain(url, normalizedUrl) || !looksLikeProductPageUrl(url)) continue;
      links.push({ url, discoveredFrom: ["JSON-LD 상품 목록"] });
    }

    const sitemapUrl = new URL("/sitemap.xml", normalizedUrl).toString();
    if (robotsAllowsUrl(robots, sitemapUrl)) {
      try {
        await pacer.wait();
        const sitemap = await safeFetchPublicText(sitemapUrl, {
          timeoutMs: 8_000,
          maxBytes: 1_200_000,
          allowedContentTypes: /(?:application|text)\/(?:xml|plain)|text\/html/i,
        });
        if (isSameStoreDomain(sitemap.finalUrl, normalizedUrl)) {
          let sitemapUrls = sitemapLocations(sitemap.html, sitemap.finalUrl);
          const childSitemaps = sitemapUrls
            .filter((url) => /\.xml(?:\?|$)/i.test(url) && isSameStoreDomain(url, normalizedUrl))
            .slice(0, MAX_SITEMAP_CHILDREN);
          for (const childUrl of childSitemaps) {
            if (Date.now() - startedAt >= TOTAL_TIMEOUT_MS) break;
            try {
              await pacer.wait();
              const child = await safeFetchPublicText(childUrl, {
                timeoutMs: 8_000,
                maxBytes: 1_200_000,
                allowedContentTypes: /(?:application|text)\/(?:xml|plain)|text\/html/i,
              });
              if (isSameStoreDomain(child.finalUrl, normalizedUrl)) {
                sitemapUrls = sitemapUrls.concat(sitemapLocations(child.html, child.finalUrl));
              }
            } catch {
              warnings.push("일부 하위 사이트맵은 접근할 수 없어 건너뛰었습니다.");
            }
          }
          for (const url of sitemapUrls) {
            if (!isSameStoreDomain(url, normalizedUrl) || !looksLikeProductPageUrl(url)) continue;
            links.push({ url, discoveredFrom: ["사이트맵"] });
          }
        }
      } catch {
        warnings.push("공개 사이트맵을 확인하지 못해 입력 페이지와 상품 목록을 기준으로 탐색했습니다.");
      }
    }

    for (const feedUrl of linkedPublicFeeds(firstPage.html, normalizedUrl)) {
      if (
        Date.now() - startedAt >= TOTAL_TIMEOUT_MS ||
        !isSameStoreDomain(feedUrl, normalizedUrl) ||
        !robotsAllowsUrl(robots, feedUrl)
      ) {
        continue;
      }
      try {
        await pacer.wait();
        const feed = await safeFetchPublicText(feedUrl, {
          timeoutMs: 8_000,
          maxBytes: 1_200_000,
          allowedContentTypes: /(?:application|text)\/(?:rss\+xml|atom\+xml|xml|plain)|text\/html/i,
        });
        if (!isSameStoreDomain(feed.finalUrl, normalizedUrl)) continue;
        for (const url of publicFeedProductUrls(feed.html, feed.finalUrl)) {
          if (!isSameStoreDomain(url, normalizedUrl) || !looksLikeProductPageUrl(url)) continue;
          links.push({ url, discoveredFrom: ["공개 상품 피드"] });
        }
      } catch {
        warnings.push("연결된 공개 상품 피드 일부는 접근할 수 없어 건너뛰었습니다.");
      }
    }

    const listPages = extractor
      .discoverCategoryUrls(normalizedUrl, firstPage.html)
      .filter((page) => isSameStoreDomain(page.url, normalizedUrl))
      .filter((page) => robotsAllowsUrl(robots, page.url))
      .slice(0, MAX_LIST_PAGES);
    for (const page of listPages) {
      if (Date.now() - startedAt >= TOTAL_TIMEOUT_MS) {
        warnings.push("전체 분석 시간 제한으로 일부 상품 목록만 확인했습니다.");
        break;
      }
      try {
        await pacer.wait();
        const response = await safeFetchHtml(page.url, { timeoutMs: 10_000 });
        if (!isSameStoreDomain(response.finalUrl, normalizedUrl)) continue;
        links.push(
          ...extractor.discoverProductUrls(response.finalUrl, response.html, {
            ...page,
            url: response.finalUrl,
          })
        );
      } catch {
        warnings.push(`${page.label || "상품 목록"} 페이지는 접근하지 못해 건너뛰었습니다.`);
      }
    }
  } else {
    warnings.push("상품 목록을 찾을 수 없는 일반 콘텐츠 페이지로 감지했습니다.");
  }

  const products = mergeLinks(links).map(toPublicProduct);
  if (!products.length) {
    warnings.push(
      "상품을 자동으로 찾지 못했습니다. 카테고리 또는 상품 상세페이지 URL을 입력해주세요."
    );
  }
  const analyzedAt = new Date().toISOString();
  return {
    discoveryId: `site-discovery-${randomUUID()}`,
    inputUrl: safeInput.toString(),
    normalizedUrl,
    pageType,
    platform,
    storeName: storeInfo.storeName,
    brandName: storeInfo.brandName,
    discoveredProductCount: products.length,
    analyzableProductCount: products.length,
    products,
    warnings: uniqueStrings(warnings, 20),
    analyzedAt,
  };
}
