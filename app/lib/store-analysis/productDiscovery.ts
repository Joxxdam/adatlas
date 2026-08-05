import type { DiscoveredProductLink, StoreAnalysisOptions } from "./types";
import { uniqueStrings } from "./htmlUtils";

function productIdentity(value: string) {
  const url = new URL(value);
  const productNo = url.searchParams.get("product_no");
  if (productNo) return `${url.hostname}:cafe24:${productNo}`;
  const brandUid = url.searchParams.get("branduid");
  if (brandUid) return `${url.hostname}:makeshop:${brandUid}`;
  const goodsNo = url.searchParams.get("goodsNo") || url.searchParams.get("goodsno");
  if (goodsNo) return `${url.hostname}:goods:${goodsNo}`;
  const cafe24PathId = url.pathname.match(/\/product\/(?:[^/?#]+\/)?(\d+)(?:\/|$)/i)?.[1];
  if (cafe24PathId) return `${url.hostname}:cafe24:${cafe24PathId}`;
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "source"].forEach(
    (key) => url.searchParams.delete(key)
  );
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function includesAny(value: string, candidates: string[]) {
  const normalized = value.toLowerCase().replace(/\s+/g, "");
  return candidates.some((candidate) =>
    normalized.includes(candidate.toLowerCase().replace(/\s+/g, ""))
  );
}

export function mergeAndPrioritizeProductLinks(
  links: DiscoveredProductLink[],
  options: StoreAnalysisOptions
) {
  const merged = new Map<string, DiscoveredProductLink>();
  for (const link of links) {
    const signal = `${link.label || ""} ${link.category || ""} ${link.discoveredFrom.join(" ")}`;
    if (includesAny(signal, options.excludedCategories)) continue;
    const identity = productIdentity(link.url);
    const current = merged.get(identity);
    merged.set(identity, {
      ...(current || link),
      ...link,
      discoveredFrom: uniqueStrings(
        [...(current?.discoveredFrom || []), ...link.discoveredFrom],
        12
      ),
      isBest: Boolean(current?.isBest || link.isBest),
      isNew: Boolean(current?.isNew || link.isNew),
      isDiscounted: Boolean(current?.isDiscounted || link.isDiscounted),
      category: current?.category || link.category,
      label: current?.label || link.label,
    });
  }
  return [...merged.values()]
    .sort((a, b) => {
      const score = (item: DiscoveredProductLink) =>
        (includesAny(`${item.category || ""} ${item.label || ""}`, options.priorityCategories)
          ? 100
          : 0) +
        (item.isBest && options.includeBest ? 30 : 0) +
        (item.isNew && options.includeNew ? 20 : 0) +
        (item.isDiscounted && options.includeDiscounted ? 10 : 0);
      return score(b) - score(a);
    })
    .slice(0, options.maxProducts);
}
