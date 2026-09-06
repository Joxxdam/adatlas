const PRODUCT_ID_QUERY_KEYS = new Set([
  "goodsno",
  "goods_no",
  "goodsid",
  "goods_id",
  "productno",
  "product_no",
  "productid",
  "product_id",
  "itemno",
  "item_no",
  "itemid",
  "item_id",
  "prdno",
  "prd_no",
  "prdid",
  "prd_id",
]);

function normalizeIdentity(value: string) {
  return decodeURIComponent(value)
    .normalize("NFKC")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function safeUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function keyedProductIds(value: string) {
  const parsed = safeUrl(value);
  const ids = new Set<string>();
  if (parsed) {
    parsed.searchParams.forEach((entry, key) => {
      if (!PRODUCT_ID_QUERY_KEYS.has(key.toLowerCase())) return;
      const normalized = normalizeIdentity(entry);
      if (normalized.length >= 4) ids.add(normalized);
    });
  }
  const decoded = decodeURIComponent(value).normalize("NFKC");
  for (const match of decoded.matchAll(/(?:goods|product|item|prd)[_\-/]?(?:no|id)?[_\-/=:]?([a-z]*\d[a-z0-9_-]{3,})/giu)) {
    const normalized = normalizeIdentity(match[1]);
    if (normalized.length >= 4) ids.add(normalized);
  }
  return [...ids];
}

/**
 * 상품 URL에서 비교에 쓸 수 있는 명시적 상품 번호만 읽습니다. 일반 경로의
 * 날짜·이미지 크기 숫자를 상품 번호로 오인하지 않도록 쿼리 키와 상품 경로
 * 표식이 있는 값에 우선순위를 둡니다.
 */
export function extractDeclaredProductIds(value: string | undefined) {
  if (!value) return [];
  const keyed = keyedProductIds(value);
  if (keyed.length) return keyed;
  const parsed = safeUrl(value);
  if (!parsed) return [];
  const pathMatch = parsed.pathname.match(/\/(?:goods|products?|items?|prd)\/(?:detail\/)?([a-z]*\d[a-z0-9_-]{3,})(?:[/?#.]|$)/iu);
  const normalized = pathMatch?.[1] ? normalizeIdentity(pathMatch[1]) : "";
  return normalized.length >= 4 ? [normalized] : [];
}

function imageProductIds(imageUrl: string, targetIds: string[]) {
  const keyed = keyedProductIds(imageUrl);
  if (keyed.length) return keyed;
  const normalizedUrl = decodeURIComponent(imageUrl).normalize("NFKC").toLowerCase();
  const directMatches = targetIds.filter((id) => normalizedUrl.includes(id));
  if (directMatches.length) return directMatches;

  // 숫자형 상품 번호가 파일명·폴더명에 직접 들어가는 쇼핑몰을 지원합니다.
  // 대상 번호와 자릿수가 같은 6~12자리 독립 숫자만 비교해 CDN 날짜·리사이즈
  // 파라미터를 다른 상품 번호로 오인할 가능성을 낮춥니다.
  const numericTargets = targetIds.filter((id) => /^\d{6,12}$/.test(id));
  const numericTokens = Array.from(normalizedUrl.matchAll(/(?:^|[^0-9])(\d{6,12})(?=$|[^0-9])/g)).map((match) => match[1]);
  return numericTokens.filter((token) => numericTargets.some((target) => token.length === target.length));
}

export type ProductImageIdentityResult = {
  status: "match" | "mismatch" | "unknown";
  productIds: string[];
  imageProductIds: string[];
};

export function evaluateProductImageIdentity(productUrl: string | undefined, imageUrl: string | undefined): ProductImageIdentityResult {
  const productIds = extractDeclaredProductIds(productUrl);
  if (!imageUrl || !productIds.length) return { status: "unknown", productIds, imageProductIds: [] };
  const detectedImageIds = imageProductIds(imageUrl, productIds);
  if (!detectedImageIds.length) return { status: "unknown", productIds, imageProductIds: [] };
  const matches = detectedImageIds.some((imageId) => productIds.includes(imageId));
  return { status: matches ? "match" : "mismatch", productIds, imageProductIds: detectedImageIds };
}

export function isDifferentProductImage(productUrl: string | undefined, imageUrl: string | undefined) {
  return evaluateProductImageIdentity(productUrl, imageUrl).status === "mismatch";
}

export function filterCurrentProductImages<T>(productUrl: string | undefined, values: T[], imageUrl: (value: T) => string | undefined) {
  return values.filter((value) => !isDifferentProductImage(productUrl, imageUrl(value)));
}

/**
 * 상품 상세와 무관한 추천·연관상품 섹션은 텍스트, 이미지, OCR 후보를 만들기
 * 전에 통째로 제거합니다. 일부 쇼핑몰은 상품 링크를 href가 아닌
 * data-mgcode/onclick으로 렌더링하므로 개별 링크 검사만으로는 충분하지 않습니다.
 */
const recommendationLabelPattern = /(?:오늘의\s*추천상품|추천\s*상품|관련\s*상품|함께\s*구매|최근\s*본\s*상품|recommended\s*products?|related\s*products?)/iu;
const recommendationAttributePattern = /(?:추천|연관|관련|함께|recommen(?:d)?|related|cross[-_\s]?sell|recent)/iu;

type RecommendationContainerTag = "aside" | "nav" | "section" | "div";

type HtmlRange = { start: number; end: number };

function mergeHtmlRanges(ranges: HtmlRange[]) {
  const sorted = ranges
    .filter((range) => range.start >= 0 && range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: HtmlRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.start > previous.end) merged.push({ ...range });
    else previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

function removeHtmlRanges(html: string, ranges: HtmlRange[]) {
  const merged = mergeHtmlRanges(ranges);
  if (!merged.length) return html;
  const chunks: string[] = [];
  let cursor = 0;
  for (const range of merged) {
    chunks.push(html.slice(cursor, range.start), " ");
    cursor = range.end;
  }
  chunks.push(html.slice(cursor));
  return chunks.join("");
}

function findTagEnd(html: string, start: number) {
  const end = html.indexOf(">", start);
  return end < 0 ? html.length : end + 1;
}

/**
 * 정규식의 `.*? ... </동일태그>`가 2MB HTML 전체를 반복 탐색하면 잘못
 * 중첩된 쇼핑몰 마크업에서 catastrophic backtracking이 발생할 수 있습니다.
 * 태그 경계만 정규식으로 찾고 본문 이동은 index 기반으로 수행해 입력 크기에
 * 비례하는 시간 안에 끝냅니다.
 */
function findMatchingContainerEnd(html: string, contentStart: number, tagName: RecommendationContainerTag) {
  const tagPattern = new RegExp(`<\\/?${tagName}\\b`, "giu");
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(html))) {
    const tagEnd = findTagEnd(html, match.index);
    const token = html.slice(match.index, Math.min(tagEnd, match.index + 24));
    if (/^<\//u.test(token)) depth -= 1;
    else if (!/\/\s*>$/u.test(html.slice(match.index, tagEnd))) depth += 1;
    if (depth === 0) return tagEnd;
    tagPattern.lastIndex = Math.max(tagPattern.lastIndex, tagEnd);
  }
  // 닫는 태그가 깨진 경우 페이지 나머지를 통째로 지우지 않습니다.
  return contentStart;
}

function openingTagSignalsRecommendation(openingTag: string) {
  const attributes = openingTag.match(/(?:aria-label|id|class)\s*=\s*["']([^"']*)["']/giu) || [];
  return attributes.some((attribute) => recommendationAttributePattern.test(attribute));
}

function firstHeadingSignalsRecommendation(html: string, contentStart: number) {
  // 컨테이너 시작부만 확인하므로 하단의 우연한 추천 문구 때문에 상품 본문
  // 전체가 제거되지 않습니다. 길이도 제한해 정규식 비용을 고정합니다.
  const prefix = html.slice(contentStart, Math.min(html.length, contentStart + 1_200));
  const withoutLeadingComments = prefix.replace(/^(?:\s|<!--[\s\S]{0,400}?-->)*/u, "").trimStart();
  const heading = withoutLeadingComments.match(/^<(h[1-6]|header)\b[^>]{0,500}>([\s\S]{0,500}?)(?:<\/\1\s*>|$)/iu);
  return Boolean(heading?.[2] && recommendationLabelPattern.test(heading[2].replace(/<[^>]{0,300}>/gu, " ")));
}

function commentDelimitedRecommendationRanges(html: string) {
  const comments = Array.from(html.matchAll(/<!--[\s\S]{0,400}?-->/gu));
  const ranges: HtmlRange[] = [];
  for (let index = 0; index < comments.length; index += 1) {
    const comment = comments[index];
    const text = comment[0];
    if (!recommendationLabelPattern.test(text) || /<!--\s*\/\//u.test(text)) continue;
    for (let closingIndex = index + 1; closingIndex < comments.length; closingIndex += 1) {
      const closing = comments[closingIndex];
      if (!/<!--\s*\/\//u.test(closing[0]) || !recommendationLabelPattern.test(closing[0])) continue;
      ranges.push({ start: comment.index, end: closing.index + closing[0].length });
      index = closingIndex;
      break;
    }
  }
  return ranges;
}

function semanticRecommendationRanges(html: string) {
  const ranges: HtmlRange[] = [];
  // 운영 쇼핑몰은 추천 목록을 semantic section이 아니라 일반 div로 감쌉니다.
  // opening tag 속성만 먼저 검사하므로 div 전체를 닫는 태그까지 탐색하지 않습니다.
  const openingPattern = /<(aside|nav|section|div)\b/giu;
  let match: RegExpExecArray | null;
  while ((match = openingPattern.exec(html))) {
    const start = match.index;
    const openingEnd = findTagEnd(html, start);
    const openingTag = html.slice(start, openingEnd);
    if (!openingTagSignalsRecommendation(openingTag) && !firstHeadingSignalsRecommendation(html, openingEnd)) {
      openingPattern.lastIndex = Math.max(openingPattern.lastIndex, openingEnd);
      continue;
    }
    const tagName = match[1].toLowerCase() as RecommendationContainerTag;
    const end = findMatchingContainerEnd(html, openingEnd, tagName);
    if (end > openingEnd) {
      ranges.push({ start, end });
      openingPattern.lastIndex = end;
    }
  }
  return ranges;
}

function stripRecommendationSections(html: string) {
  return removeHtmlRanges(html, [
    ...commentDelimitedRecommendationRanges(html),
    ...semanticRecommendationRanges(html),
  ]);
}

function stripDifferentProductAnchors(productUrl: string, html: string) {
  const ranges: HtmlRange[] = [];
  const lowerHtml = html.toLowerCase();
  const openingPattern = /<a\b/giu;
  let match: RegExpExecArray | null;
  while ((match = openingPattern.exec(html))) {
    const start = match.index;
    const openingEnd = findTagEnd(html, start);
    const openingTag = html.slice(start, openingEnd);
    const href = openingTag.match(/\bhref\s*=\s*["']([^"']+)["']/iu)?.[1];
    openingPattern.lastIndex = Math.max(openingPattern.lastIndex, openingEnd);
    if (!href || !isDifferentProductImage(productUrl, href)) continue;
    const closingStart = lowerHtml.indexOf("</a", openingEnd);
    if (closingStart < 0) continue;
    ranges.push({ start, end: findTagEnd(html, closingStart) });
  }
  return removeHtmlRanges(html, ranges);
}

/**
 * 상품 상세 HTML 안에 추천·연관상품 카드가 섞여 있어도 다른 상품 링크 블록은
 * 텍스트와 이미지 수집 전에 제거합니다. 클래스명에 의존하지 않고 URL의 명시적
 * 상품번호만 비교하므로 쇼핑몰이 추천 영역 이름을 바꿔도 같은 경계가 유지됩니다.
 */
export function stripDifferentProductLinkBlocks(productUrl: string | undefined, html: string) {
  if (!html) return html;
  const withoutRecommendationSections = stripRecommendationSections(html);
  if (!extractDeclaredProductIds(productUrl).length) return withoutRecommendationSections;
  return stripDifferentProductAnchors(productUrl || "", withoutRecommendationSections);
}
