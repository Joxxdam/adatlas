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
 * 상품 상세 HTML 안에 추천·연관상품 카드가 섞여 있어도 다른 상품 링크 블록은
 * 텍스트와 이미지 수집 전에 제거합니다. 클래스명에 의존하지 않고 URL의 명시적
 * 상품번호만 비교하므로 쇼핑몰이 추천 영역 이름을 바꿔도 같은 경계가 유지됩니다.
 */
export function stripDifferentProductLinkBlocks(productUrl: string | undefined, html: string) {
  if (!extractDeclaredProductIds(productUrl).length || !html) return html;
  return html.replace(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/giu, (block, href: string) =>
    isDifferentProductImage(productUrl, href) ? " " : block
  );
}
