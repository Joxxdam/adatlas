import { extractJsonLdNodes, jsonLdTypeIncludes, metaContent } from "../store-analysis/htmlUtils.ts";
import type { SitePageType } from "./types";

const PRODUCT_PATH =
  /\/(?:product\/(?:[^/?#]+\/)?\d+|products\/[^/?#]+|goods\/(?:detail|view)|shop\/shopdetail\.html|product[_-]?detail|items?\/[^/?#]+|p\/[^/?#]+)(?:\/|\.|\?|$)/i;
const PRODUCT_QUERY = /[?&](?:product_no|goodsno|branduid|itemid|item_id|productId)=/i;
const CATEGORY_SIGNAL =
  /\/(?:category|categories|collections|shop|goods\/goods_list|product\/list)(?:\/|\.|\?|$)|[?&](?:cate_no|category)=/i;
const PROMOTION_SIGNAL =
  /\/(?:event|events|promotion|promotions|exhibition|project|plan|sale)(?:\/|\.|\?|$)|기획전|프로모션|이벤트|특가/i;
const CONTENT_SIGNAL = /\/(?:board|blog|article|notice|faq|community|magazine)(?:\/|\.|\?|$)/i;

export function looksLikeProductPageUrl(value: string) {
  try {
    const url = new URL(value);
    return PRODUCT_PATH.test(url.pathname) || PRODUCT_QUERY.test(url.search);
  } catch {
    return false;
  }
}

export function detectSitePageType(url: string, html: string): SitePageType {
  const productStructuredData = extractJsonLdNodes(html).some((node) =>
    jsonLdTypeIncludes(node, "product")
  );
  if (
    productStructuredData ||
    /product/i.test(metaContent(html, "og:type")) ||
    looksLikeProductPageUrl(url)
  ) {
    return "product";
  }

  const parsed = new URL(url);
  const signal = `${parsed.pathname}${parsed.search}`;
  if (PROMOTION_SIGNAL.test(signal)) return "promotion";
  if (CATEGORY_SIGNAL.test(signal)) return "category";
  if (parsed.pathname === "/" || !parsed.pathname) return "homepage";
  if (CONTENT_SIGNAL.test(signal)) return "unsupported";
  return "unsupported";
}

export function normalizeSitePageUrl(value: string) {
  const url = new URL(value);
  const trackingKeys = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "fbclid",
    "gclid",
    "ref",
    "source",
  ];
  trackingKeys.forEach((key) => url.searchParams.delete(key));
  url.hash = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function deduplicateProductUrls<T extends { url: string }>(items: T[], limit = 30) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const normalized = normalizeSitePageUrl(item.url);
    const parsed = new URL(normalized);
    const productKey =
      parsed.searchParams.get("product_no") ||
      parsed.searchParams.get("goodsno") ||
      parsed.searchParams.get("goodsNo") ||
      parsed.searchParams.get("branduid") ||
      parsed.pathname.match(/\/(?:product|products|goods\/(?:detail|view))\/(?:[^/]+\/)?([^/?#]+)/i)?.[1];
    const identity = productKey
      ? `${parsed.hostname.toLowerCase()}:${productKey}`
      : normalized.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push({ ...item, url: normalized });
    if (result.length >= limit) break;
  }
  return result;
}
