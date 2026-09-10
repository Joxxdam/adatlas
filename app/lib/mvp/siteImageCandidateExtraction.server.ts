import type { ProductImageCandidate, SourceImageCandidate } from "./types";
import { decodeHtml } from "./productHtmlSignals.server.ts";

type PageImageSource = "meta" | "image" | "source" | "background" | "preload" | "capture";

export type PageImageCandidate = {
  url: string;
  label: string;
  order: number;
  source: PageImageSource;
};

const blockedAssetPattern = /(?:^|[\/_\-.])(?:favicon|sprite|spacer|tracking|tracker|pixel|beacon|analytics|loader|loading|placeholder|blank)(?:[\/_\-.]|$)/i;
const rasterImagePattern = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i;
const imagePathPattern = /(?:^|\/)(?:assets?|images?|imgs?|media|photos?|pictures?|uploads?|contents?|files?)\//i;
const transformParamPattern = /^(?:w|width|h|height|q|quality|format|fit|crop|resize|auto|dpr|rand|v|ver|version|cache|cb)$/i;

function attributeValue(tag: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp("(?:^|\\s)" + escapedName + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>]+))", "i"));
  return decodeHtml(match?.[1] || match?.[2] || match?.[3] || "").trim();
}

function positiveDimension(tag: string, name: "width" | "height") {
  const value = Number(attributeValue(tag, name).replace(/[^\d.]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function bestSrcsetUrl(value: string) {
  return value
    .split(",")
    .map((item) => {
      const [url = "", descriptor = ""] = item.trim().split(/\s+/);
      const size = Number(descriptor.replace(/[^\d.]/g, "")) || 0;
      return { url, size };
    })
    .filter((item) => item.url)
    .sort((left, right) => right.size - left.size)[0]?.url || "";
}

function normalizeForDedup(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    const entries = Array.from(parsed.searchParams.entries());
    parsed.search = "";
    for (const [key, parameterValue] of entries) {
      if (!transformParamPattern.test(key)) parsed.searchParams.append(key, parameterValue);
    }
    return parsed.toString();
  } catch {
    return value.replace(/#.*$/, "");
  }
}

function resolvePublicImageUrl(value: string, baseUrl: string) {
  const decoded = decodeHtml(String(value || "").trim()).replace(/^['"]|['"]$/g, "");
  if (!decoded || /^(?:data|blob|javascript|file):/i.test(decoded)) return "";

  try {
    const parsed = new URL(decoded, baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal") || /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isObviousUtilityAsset(url: string, context = "") {
  const signal = `${new URL(url).pathname} ${context}`.toLowerCase();
  return /\.(?:ico|svg)(?:[?#].*)?$/i.test(url) || blockedAssetPattern.test(signal);
}

function compactLabel(value: string, fallback: string) {
  const normalized = decodeHtml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 80) : fallback;
}

/**
 * 서비스·브랜드 페이지의 콘텐츠 이미지를 DOM 순서대로 수집합니다.
 * 상품 판별·OCR·추천상품 제거는 적용하지 않으며 명백한 UI 자산과 추적 픽셀만 제외합니다.
 */
export function collectSitePageImages(html: string, baseUrl: string): PageImageCandidate[] {
  const candidates: PageImageCandidate[] = [];
  const seen = new Set<string>();

  const push = (rawUrl: string, input: { label?: string; order: number; source: PageImageSource; context?: string; requireImageSignal?: boolean }) => {
    const url = resolvePublicImageUrl(rawUrl, baseUrl);
    if (!url) return;
    if (input.requireImageSignal && !rasterImagePattern.test(url) && !imagePathPattern.test(new URL(url).pathname)) return;
    if (isObviousUtilityAsset(url, input.context)) return;
    const key = normalizeForDedup(url);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({
      url,
      label: compactLabel(input.label || "", `페이지 이미지 ${candidates.length + 1}`),
      order: input.order,
      source: input.source,
    });
  };

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = `${attributeValue(tag, "property")} ${attributeValue(tag, "name")} ${attributeValue(tag, "itemprop")}`;
    if (!/(?:^|\s|:)image(?::|\s|$)|thumbnail/i.test(key)) continue;
    push(attributeValue(tag, "content"), { label: "사이트 대표 이미지", order: (match.index ?? 0) - html.length, source: "meta", context: key });
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = attributeValue(tag, "rel");
    const as = attributeValue(tag, "as");
    if (!/(?:image_src|preload)/i.test(rel) || (/preload/i.test(rel) && !/image/i.test(as))) continue;
    push(attributeValue(tag, "href"), { label: "미리 불러온 페이지 이미지", order: match.index ?? 0, source: "preload", context: `${rel} ${as}` });
  }

  for (const match of html.matchAll(/<(?:img|source|video)\b[^>]*>/gi)) {
    const tag = match[0];
    const order = match.index ?? 0;
    const width = positiveDimension(tag, "width");
    const height = positiveDimension(tag, "height");
    if ((width && width <= 32) || (height && height <= 32)) continue;

    const label = attributeValue(tag, "alt") || attributeValue(tag, "title");
    const context = `${label} ${attributeValue(tag, "class")} ${attributeValue(tag, "id")}`;
    const directAttributes = ["src", "data-src", "data-original", "data-lazy-src", "data-lazy", "data-image", "data-image-src", "data-bg", "data-background", "data-background-image", "ec-data-src", "poster"];
    for (const attribute of directAttributes) {
      const value = attributeValue(tag, attribute);
      if (value) push(value, { label, order, source: "image", context });
    }
    for (const attribute of ["srcset", "data-srcset"]) {
      const value = bestSrcsetUrl(attributeValue(tag, attribute));
      if (value) push(value, { label, order, source: "source", context });
    }
  }

  // 서비스 소개 페이지는 <section data-bg="...">처럼 img 태그가 아닌
  // 요소에 lazy/background 이미지를 두는 경우가 많다. 명시적인 이미지
  // 속성만 읽고 상품 판별이나 점수 선별은 하지 않는다.
  for (const match of html.matchAll(/<[a-z][^>]*>/gi)) {
    const tag = match[0];
    const order = match.index ?? 0;
    const context = `${attributeValue(tag, "class")} ${attributeValue(tag, "id")}`;
    for (const attribute of ["data-bg", "data-background", "data-background-image", "data-image", "data-image-src"]) {
      const value = attributeValue(tag, attribute);
      if (value) push(value, { label: "페이지 배경 이미지", order, source: "background", context });
    }
  }

  for (const match of html.matchAll(/url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/gi)) {
    push(match[2] || "", { label: "페이지 배경 이미지", order: match.index ?? 0, source: "background", requireImageSignal: true });
  }

  return candidates.sort((left, right) => left.order - right.order);
}

export function siteImageCandidatesForProductInfo(candidates: PageImageCandidate[], createdAt = new Date().toISOString()) {
  return {
    imageCandidates: candidates.map((candidate, index): ProductImageCandidate => ({
      url: candidate.url,
      type: index === 0 ? "main" : candidate.source === "background" ? "content" : "detail",
      score: 0,
      reason: "사이트 페이지에서 수집",
      pageOrder: candidate.order,
      alt: candidate.label,
    })),
    sourceImageCandidates: candidates.map((candidate, index): SourceImageCandidate => ({
      id: `site-image-${String(index + 1).padStart(3, "0")}`,
      type: index === 0 ? "hero" : "detail",
      imagePath: candidate.url,
      originalUrl: candidate.url,
      label: candidate.label,
      selected: index === 0,
      createdAt,
      sourceType: candidate.source === "meta" ? "open-graph" : "detail-content",
      analysisReason: candidate.source === "capture" ? "사이트 분석에서 렌더링된 화면 구간" : "사이트 분석에서 페이지 순서대로 수집한 이미지",
    })),
  };
}
