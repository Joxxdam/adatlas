const PROMOTION_BRACKETS = /[\[【(（][^\]】)）]*(?:한정|특가|할인|예약|무료배송|증정|쿠폰|이벤트|후기|판매|입고|배송|실속|비법|프리미엄)[^\]】)）]*[\]】)）]/gi;
const PROMOTION_WORDS = [
  /\b\d+\s*%\s*(?:할인|OFF)?\b/gi,
  /(?:사전\s*예약|한정\s*판매|무료\s*배송|오늘만|단독\s*특가|쿠폰\s*적용|후기\s*\d+등|베스트\s*상품)/gi,
  /(?:오르기\s*전|가격에|(?:추석|설날?|명절)\s*(?:사전\s*)?예약\s*가능|예약\s*가능|소량\s*입고|선별\s*상품)/gi,
  /(?:★|☆|♥|♡|◆|▶|\*{1,}|_{1,})/g,
];

const TITLE_PROMOTION_PATTERNS = [
  /(?:추석|설날?|명절)\s*(?:사전\s*)?예약\s*가능/gi,
  /사전\s*예약/gi,
  /후기\s*\d+등/gi,
  /무료\s*배송/gi,
  /(?:한정|단독)\s*(?:판매|특가)?/gi,
  /소량\s*입고/gi,
  /\d+\s*%\s*(?:할인|OFF)?/gi,
];

export function normalizeVideoProductName(value: unknown, brandName = "") {
  const raw = String(value || "")
    .replace(/&(?:amp|nbsp);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  let normalized = raw.replace(PROMOTION_BRACKETS, " ");
  for (const pattern of PROMOTION_WORDS) normalized = normalized.replace(pattern, " ");
  normalized = normalized
    .replace(/\s*[-|｜]\s*(?:네이버\s*)?(?:스마트스토어|공식몰|온라인몰|쇼핑몰).*$/i, "")
    .replace(/(?:가격에|가능|특별|실속|프리미엄)\s*[_·|]+/gi, " ")
    .replace(/[|｜]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (brandName) {
    const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    normalized = normalized.replace(new RegExp(`^(?:${escaped})\\s*[-|｜:]?\\s*`, "i"), "");
  }
  const segments = normalized
    .split(/\s*[|｜]\s*|\s+-\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  normalized = segments.find((item) => !/(할인|배송|이벤트|후기|예약)/i.test(item)) || normalized;
  return normalized.replace(/^[,.:;\-\s]+|[,.:;\-\s]+$/g, "").slice(0, 80);
}

export function containsRawSeoTitle(text: string, rawTitle = "", normalizedName = "") {
  const raw = String(rawTitle || "").replace(/\s+/g, " ").trim();
  if (!raw || raw === normalizedName || raw.length < 28) return false;
  return String(text || "").replace(/\s+/g, " ").includes(raw);
}

export function extractVideoTitleMetadata(value: unknown, brandName = "") {
  const rawTitle = String(value || "").replace(/\s+/g, " ").trim();
  const promotions = TITLE_PROMOTION_PATTERNS.flatMap(
    (pattern) => rawTitle.match(pattern) || []
  ).map((item) => item.replace(/\s+/g, " ").trim());
  const volumeOrOption = [
    ...rawTitle.matchAll(/\d+(?:[.,]\d+)?\s*(?:(?:kg|g|ml|l)\s*(?:박스|팩|세트)?|개|입|팩|박스|세트)(?![a-z가-힣])/gi),
  ].map((match) => match[0].replace(/\s+/g, "").trim())[0] || "";
  return {
    rawTitle,
    productName: normalizeVideoProductName(rawTitle, brandName),
    promotion: [...new Set(promotions)].join(" · "),
    volumeOrOption,
  };
}
