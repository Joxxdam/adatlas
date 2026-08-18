import type {
  DiscoveredProductLink,
  DiscoveredStorePage,
  StoreExtractor,
  StoreInfo,
  StoreProductSummary,
} from "../types";
import {
  absoluteHttpUrl,
  cleanText,
  extractLinks,
  metaContent,
  tagAttribute,
  titleContent,
  uniqueStrings,
} from "../htmlUtils";
import { isSameStoreDomain } from "../urlSafety";
import { extractProductDetailFromHtml, extractProductSummaryFromHtml } from "../productAnalyzer";

const PRODUCT_QUERY_PATTERN =
  /[?&](?:product_no|pseq|goodsno|goodsNo|branduid|itemid|item_id|productId)=/i;
const LIST_PATH_PATTERN =
  /\/(?:category|categories|collections|best|new|sale|event|promotion|exhibition|plan|shop|goods\/goods_list|products?\/products?_list\.php)(?:\/|\.|\?|$)|\/c\/[a-z0-9]+(?:x[a-z0-9]+)+(?:\/|$)/i;

function isLikelyProductUrl(url: string) {
  const parsed = new URL(url);
  const path = parsed.pathname;
  if (
    /(?:\/list|\/category|\/categories|\/collections(?:\/all)?\/?$|\/products?\/products?_list\.php|\/goods\/(?:lastitem|best|new|sale|event|category|list))/i.test(
      path
    )
  ) {
    return false;
  }
  return (
    PRODUCT_QUERY_PATTERN.test(parsed.search) ||
    /\/goods\/(?:detail|view)\//i.test(path) ||
    /\/goods\/(?:goods_view|view)\.(?:php|html)$/i.test(path) ||
    /\/shop\/shopdetail\.html$/i.test(path) ||
    /\/products?\/products?_view\.php$/i.test(path) ||
    /\/product\/detail\.html$/i.test(path) ||
    /\/product\/(?:[^/?#]+\/)?\d+(?:\/|$)/i.test(path) ||
    /\/products\/[^/?#]+\/?$/i.test(path) ||
    /\/p\/[^/?#]+(?:\/[^?#]*)?\/?$/i.test(path) ||
    /\/(?:item|product-detail|product_detail)\/[a-z0-9_-]+\/?$/i.test(path)
  );
}

function pageKind(url: string, text: string): DiscoveredStorePage["kind"] {
  const signal = `${url} ${text}`.toLowerCase();
  if (/베스트|best|popular|인기|랭킹|ranking/.test(signal)) return "best";
  if (/신상품|신제품|new|arrival|신상/.test(signal)) return "new";
  if (/할인|특가|세일|sale|기획전|프로모션|promotion|event|이벤트/.test(signal)) {
    return "promotion";
  }
  if (/카테고리|category|categories|collection|분류/.test(signal)) return "category";
  return "product-list";
}

function extractLogo(html: string, baseUrl: string) {
  const metaLogo = metaContent(html, "og:logo") || metaContent(html, "logo");
  if (metaLogo) return absoluteHttpUrl(metaLogo, baseUrl);
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const signal = `${tagAttribute(tag, "alt")} ${tagAttribute(tag, "class")} ${tagAttribute(tag, "id")}`;
    if (!/logo|로고/i.test(signal)) continue;
    const value = tagAttribute(tag, "data-src") || tagAttribute(tag, "src");
    const resolved = absoluteHttpUrl(value, baseUrl);
    if (resolved) return resolved;
  }
  return undefined;
}

function extractPrimaryColors(html: string) {
  const counts = new Map<string, number>();
  for (const match of html.matchAll(/#[0-9a-f]{6}\b/gi)) {
    const color = match[0].toLowerCase();
    if (["#ffffff", "#000000", "#f5f5f5", "#eeeeee", "#333333"].includes(color)) continue;
    counts.set(color, (counts.get(color) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([color]) => color);
}

function extractBrandPhrases(html: string) {
  const phrases: string[] = [];
  for (const match of html.matchAll(
    /<(?:h1|h2|h3|strong|em)[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|strong|em)>/gi
  )) {
    const text = cleanText(match[1], 100);
    if (text.length >= 4 && text.length <= 70 && !/로그인|회원가입|장바구니|검색|메뉴/.test(text)) {
      phrases.push(text);
    }
    if (phrases.length >= 20) break;
  }
  return uniqueStrings(phrases, 8);
}

export class GenericStoreExtractor implements StoreExtractor {
  canHandle(url: string, html?: string) {
    void url;
    void html;
    return true;
  }

  extractStoreInfo(url: string, html: string): StoreInfo {
    const parsed = new URL(url);
    const siteTitle = metaContent(html, "og:site_name") || titleContent(html);
    const titleBrand = siteTitle.split(/[|｜·–—-]/)[0]?.trim();
    return {
      storeUrl: parsed.toString(),
      domain: parsed.hostname.toLowerCase(),
      storeName: titleBrand || parsed.hostname,
      brandName: metaContent(html, "og:site_name") || titleBrand || undefined,
      siteTitle,
      metaDescription: metaContent(html, "og:description") || metaContent(html, "description"),
      logoUrl: extractLogo(html, parsed.toString()),
      primaryColors: extractPrimaryColors(html),
      repeatedBrandPhrases: extractBrandPhrases(html),
    };
  }

  discoverCategoryUrls(url: string, html: string): DiscoveredStorePage[] {
    const pages: DiscoveredStorePage[] = [];
    for (const link of extractLinks(html, url)) {
      if (!isSameStoreDomain(link.url, url) || isLikelyProductUrl(link.url)) continue;
      const signal = `${link.url} ${link.text}`;
      if (
        !LIST_PATH_PATTERN.test(link.url) &&
        !/베스트|신상품|신제품|할인|특가|카테고리|기획전|세일|전체상품|상품보기/i.test(signal)
      ) {
        continue;
      }
      if (/login|member|cart|order|board|notice|faq|review/i.test(link.url)) continue;
      pages.push({
        url: link.url,
        label: link.text || pageKind(link.url, link.text),
        kind: pageKind(link.url, link.text),
      });
    }
    const seen = new Set<string>();
    return pages.filter((page) => {
      if (seen.has(page.url)) return false;
      seen.add(page.url);
      return true;
    });
  }

  discoverProductUrls(
    url: string,
    html: string,
    source: DiscoveredStorePage
  ): DiscoveredProductLink[] {
    const discovered: DiscoveredProductLink[] = [];
    for (const link of extractLinks(html, url)) {
      if (!isSameStoreDomain(link.url, url) || !isLikelyProductUrl(link.url)) continue;
      if (/review|qna|inquiry|write|basket|cart|order/i.test(link.url)) continue;
      const sourceSignal = `${source.kind} ${source.label}`;
      discovered.push({
        url: link.url,
        label: link.text || undefined,
        category:
          source.kind === "category" || source.kind === "product-list" ? source.label : undefined,
        discoveredFrom: [source.label || source.kind],
        isBest: /best|베스트|인기|랭킹/.test(sourceSignal.toLowerCase()),
        isNew: /new|신상품|신제품|신상/.test(sourceSignal.toLowerCase()),
        isDiscounted: /sale|할인|특가|기획전|프로모션/.test(sourceSignal.toLowerCase()),
      });
    }
    return discovered;
  }

  extractProductSummary(
    url: string,
    html: string,
    discovered?: DiscoveredProductLink
  ): StoreProductSummary {
    return extractProductSummaryFromHtml(url, html, discovered);
  }

  extractProductDetail(
    url: string,
    html: string,
    summary: StoreProductSummary,
    analyzeReviews: boolean
  ) {
    return extractProductDetailFromHtml(url, html, summary, analyzeReviews);
  }
}

export const genericStoreExtractor = new GenericStoreExtractor();
