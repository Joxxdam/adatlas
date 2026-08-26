export type Cafe24BundlePricing = {
  price: string;
  originalPrice: string;
  discountInfo: string;
  source: "cafe24-required-bundle-option";
};

function numberValue(value: string) {
  const parsed = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatPrice(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function textContent(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstNumber(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = numberValue(match?.[1] || "");
    if (value) return value;
  }
  return 0;
}

function requiredBundleOption(html: string, productName: string) {
  const isCafe24 = /(?:CAFE24|EC_SHOP|xans-product|option_stock_data)/i.test(html);
  const isBundle = /(?:\d{1,2}\s*(?:종|개|입|팩|세트|묶음|박스)|골라\s*담기|풀\s*패키지|컴플리트\s*팩)/i.test(productName);
  const hasRequiredOption = /(?:product_option[^>]{0,400}required=["']true|option_msg\s*=\s*["'][^"']*필수|is_mandatory\\?["']?\s*:\s*\\?["']?T)/i.test(html);
  return isCafe24 && isBundle && hasRequiredOption;
}

function amountRangePricing(html: string) {
  const row = html.match(/<tr[^>]*>[\s\S]{0,1200}?금액범위[\s\S]{0,800}?<td[^>]*>([\s\S]{0,500}?)<\/td>[\s\S]{0,200}?<\/tr>/i)?.[1] || "";
  const text = textContent(row);
  const match = text.match(/(\d{1,2})\s*%\s*[,·/]?\s*([\d,]+)\s*원/i);
  return {
    rate: Number(match?.[1] || 0),
    price: numberValue(match?.[2] || ""),
  };
}

function optionPrices(html: string) {
  return Array.from(html.matchAll(/option_price\\?["']?\s*:\s*\\?["']?([\d,.]+)/gi))
    .map((match) => numberValue(match[1]))
    .filter(Boolean);
}

/**
 * Cafe24는 묶음 상품에서도 화면의 `판매가`에 단품 기준가를 노출하고,
 * 실제 필수 옵션 총액은 option_price/금액범위에 따로 저장할 수 있습니다.
 * 명확한 필수 묶음 옵션 하나의 총액을 확인한 경우에만 일반 판매가를 교체합니다.
 * 모호한 경우에는 null을 반환해 기존 추출값으로 계속하며 자동생성을 차단하지 않습니다.
 */
export function resolveCafe24RequiredBundlePricing(html: string, productName: string): Cafe24BundlePricing | null {
  if (!requiredBundleOption(html, productName)) return null;

  const basePrice = firstNumber(html, [
    /\bdata-price=["']([\d,.]+)["']/i,
    /id=["']span_product_price_text["'][^>]*>[\s\S]{0,80}?([\d,.]+)\s*원/i,
  ]);
  const originalPrice = firstNumber(html, [
    /id=["']span_product_price_custom["'][^>]*>[\s\S]{0,80}?([\d,.]+)\s*원/i,
    /\bdata-custom=["']([\d,.]+)["']/i,
  ]);
  const range = amountRangePricing(html);
  const uniqueOptionPrices = Array.from(new Set(optionPrices(html)));
  const optionPrice = range.price || (uniqueOptionPrices.length === 1 ? uniqueOptionPrices[0] : 0);

  if (!optionPrice || !basePrice || optionPrice <= basePrice) return null;

  const calculatedRate = originalPrice > optionPrice ? Math.round(((originalPrice - optionPrice) / originalPrice) * 100) : 0;
  const discountRate = calculatedRate > 0 && calculatedRate < 90 ? calculatedRate : range.rate > 0 && range.rate < 90 ? range.rate : 0;

  return {
    price: formatPrice(optionPrice),
    originalPrice: originalPrice > optionPrice ? formatPrice(originalPrice) : "",
    discountInfo: discountRate ? `${discountRate}% 할인` : "",
    source: "cafe24-required-bundle-option",
  };
}

/**
 * Cafe24 상품 설명에는 필수 묶음 옵션이 바뀐 뒤에도 단품/과거 할인율이
 * JSON-LD 문구로 남는 경우가 있다. 옵션 총액이 확인된 경우 광고 카피의
 * 사실 소스에도 같은 할인율만 남겨 ProductTruth 내부 충돌을 막는다.
 * 가격 판정이 모호하면 이 함수 자체가 호출되지 않아 기존 설명을 보존한다.
 */
export function normalizeCafe24BundlePricingClaims(value: string, pricing: Cafe24BundlePricing) {
  const discountRate = pricing.discountInfo.match(/(\d{1,2})\s*%/)?.[1];
  if (!value || !discountRate) return value;

  return value.replace(/\b\d{1,2}\s*%\s*할인/gi, `${discountRate}% 할인`);
}
