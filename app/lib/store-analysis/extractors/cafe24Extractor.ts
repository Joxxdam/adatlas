import type { DiscoveredProductLink, DiscoveredStorePage } from "../types";
import { extractLinks } from "../htmlUtils";
import { isSameStoreDomain } from "../urlSafety";
import { GenericStoreExtractor } from "./genericStoreExtractor";

const CAFE24_PRODUCT_PATTERN =
  /\/product\/(?:[^/?#]+\/)?\d+(?:\/category\/\d+)?|\/product\/detail\.html\?[^#]*product_no=\d+/i;

export class Cafe24Extractor extends GenericStoreExtractor {
  canHandle(url: string, html = "") {
    return (
      /cafe24|EC_SHOP|CAFE24API|shop_no|xans-product/i.test(html) ||
      /\.cafe24\.com$/i.test(new URL(url).hostname)
    );
  }

  discoverCategoryUrls(url: string, html: string): DiscoveredStorePage[] {
    const base = super.discoverCategoryUrls(url, html);
    const extras = extractLinks(html, url)
      .filter(
        (link) =>
          isSameStoreDomain(link.url, url) &&
          /\/product\/(?:list|best|new|project|search)\.html|[?&]cate_no=\d+/i.test(link.url) &&
          !CAFE24_PRODUCT_PATTERN.test(link.url)
      )
      .map((link): DiscoveredStorePage => {
        const signal = `${link.text} ${link.url}`.toLowerCase();
        const kind: DiscoveredStorePage["kind"] = /best|베스트|인기/.test(signal)
          ? "best"
          : /new|신상품|신상/.test(signal)
            ? "new"
            : /project|sale|할인|기획전/.test(signal)
              ? "promotion"
              : "category";
        return { url: link.url, label: link.text || "카테고리", kind };
      });
    return [...base, ...extras].filter(
      (page, index, pages) => pages.findIndex((candidate) => candidate.url === page.url) === index
    );
  }

  discoverProductUrls(
    url: string,
    html: string,
    source: DiscoveredStorePage
  ): DiscoveredProductLink[] {
    const base = super.discoverProductUrls(url, html, source);
    const extras = extractLinks(html, url)
      .filter((link) => isSameStoreDomain(link.url, url) && CAFE24_PRODUCT_PATTERN.test(link.url))
      .map((link): DiscoveredProductLink => {
        const signal = `${source.kind} ${source.label}`.toLowerCase();
        return {
          url: link.url,
          label: link.text || undefined,
          category: source.kind === "category" ? source.label : undefined,
          discoveredFrom: [source.label || source.kind],
          isBest: /best|베스트|인기/.test(signal),
          isNew: /new|신상품|신상/.test(signal),
          isDiscounted: /sale|할인|특가|project|기획전/.test(signal),
        };
      });
    return [...base, ...extras].filter(
      (item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index
    );
  }
}

export const cafe24Extractor = new Cafe24Extractor();
