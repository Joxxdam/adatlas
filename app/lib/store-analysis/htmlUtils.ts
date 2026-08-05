import { createHash } from "crypto";

export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    );
}

export function cleanText(value: string, maxLength = 500) {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
      "i"
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(match[1]);
  }
  return "";
}

export function titleContent(html: string) {
  return cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "", 160);
}

export function absoluteHttpUrl(value: string, baseUrl: string) {
  const decoded = decodeHtmlEntities(String(value || "").trim());
  if (!decoded || /^(?:data|blob|javascript|file|mailto|tel):/i.test(decoded)) return "";
  try {
    const resolved = new URL(decoded, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) return "";
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return "";
  }
}

export function tagAttribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`\\s${escaped}\\s*=\\s*["']([^"']*)["']`, "i"));
  return match?.[1] ? decodeHtmlEntities(match[1]).trim() : "";
}

export function extractLinks(html: string, baseUrl: string) {
  const links: Array<{ url: string; text: string; rel: string }> = [];
  for (const match of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const href = tagAttribute(tag, "href");
    const url = absoluteHttpUrl(href, baseUrl);
    if (!url) continue;
    links.push({
      url,
      text: cleanText(tag, 160),
      rel: tagAttribute(tag, "rel"),
    });
  }
  return links;
}

export function extractImageUrls(html: string, baseUrl: string, max = 40) {
  const images: string[] = [];
  const push = (value: string) => {
    const url = absoluteHttpUrl(value, baseUrl);
    if (!url || images.includes(url)) return;
    if (
      /(?:logo|icon|sprite|button|arrow|favicon|kakao|naver|facebook|instagram|youtube)/i.test(url)
    ) {
      return;
    }
    images.push(url);
  };
  [metaContent(html, "og:image"), metaContent(html, "twitter:image")].forEach(push);
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const width = Number(tagAttribute(tag, "width")) || 0;
    const height = Number(tagAttribute(tag, "height")) || 0;
    if ((width && width < 120) || (height && height < 120)) continue;
    push(
      tagAttribute(tag, "data-original") ||
        tagAttribute(tag, "data-src") ||
        tagAttribute(tag, "src")
    );
    if (images.length >= max) break;
  }
  return images.slice(0, max);
}

function collectJsonNodes(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(collectJsonNodes);
  if (typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const graph = Array.isArray(object["@graph"]) ? collectJsonNodes(object["@graph"]) : [];
  return [object, ...graph];
}

export function extractJsonLdNodes(html: string) {
  const nodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    const raw = decodeHtmlEntities(match[1]).trim();
    if (!raw) continue;
    try {
      nodes.push(...collectJsonNodes(JSON.parse(raw)));
    } catch {
      // Invalid JSON-LD is common on commerce sites. Other public signals are still usable.
    }
  }
  return nodes;
}

export function jsonLdTypeIncludes(node: Record<string, unknown>, expected: string) {
  const raw = node["@type"];
  const types = Array.isArray(raw) ? raw : [raw];
  return types.some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(expected.toLowerCase())
  );
}

export function stringValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return cleanText(String(value));
  return "";
}

export function firstRecord(value: unknown): Record<string, unknown> {
  const first = Array.isArray(value) ? value[0] : value;
  return first && typeof first === "object" ? (first as Record<string, unknown>) : {};
}

export function numberFromUnknown(value: unknown) {
  const raw = stringValue(value).replace(/,/g, "");
  const match = raw.match(/\d+(?:\.\d+)?/);
  const parsed = match ? Number(match[0]) : undefined;
  return parsed && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function discountRateFromPrices(originalPrice?: number, salePrice?: number) {
  if (!originalPrice || !salePrice || originalPrice <= salePrice) return undefined;
  const rate = Math.round(((originalPrice - salePrice) / originalPrice) * 100);
  return rate > 0 && rate < 95 ? rate : undefined;
}

export function uniqueStrings(values: Array<string | undefined>, limit = 50) {
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean))
  ).slice(0, limit);
}

export function stableId(prefix: string, value: string) {
  return `${prefix}-${createHash("sha1").update(value).digest("hex").slice(0, 12)}`;
}

export function roundScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function average(values: Array<number | undefined>) {
  const available = values.filter((value): value is number => typeof value === "number");
  if (!available.length) return undefined;
  return available.reduce((sum, value) => sum + value, 0) / available.length;
}

export function normalizeCategoryName(value: string) {
  return cleanText(value, 80)
    .replace(/^(?:홈|home)\s*[>/·-]\s*/i, "")
    .replace(/\s*[>/·]\s*/g, " > ")
    .trim();
}
