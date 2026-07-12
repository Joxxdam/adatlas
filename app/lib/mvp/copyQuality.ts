import type {
  AdImageLabel,
  CopySlotKey,
  GeneratedAdCopy,
  GeneratedAdCopyVariant,
  ProductInfoForPrompt,
} from "./types";

const emojiRegex = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu;

const forbiddenPhraseReplacements: Array<[RegExp, string]> = [
  [/만나보세요/g, "확인해보세요"],
  [/기다립니다/g, "준비되어 있습니다"],
  [/필수 아이템/g, "없으면 아쉬운 구성"],
  [/특별한 선택/g, "괜찮은 선택"],
  [/자세한 정보/g, "구성"],
  [/여기를 클릭/g, "구성 보기"],
  [/새로워진 즐거움/g, "지금 필요한 이유"],
  [/만족을 줄 수 있음/g, "만족스럽게 준비했습니다"],
  [/여러분을 기다립니다/g, "지금 확인해보세요"],
  [/지금 바로 확인하기/g, "구성 보러가기"],
];

const genericHeadlinePatterns = [
  /새로운\s*즐거움/,
  /특별한\s*선택/,
  /필수\s*아이템/,
  /만나보세요/,
  /기다립니다/,
  /고급스러운\s*선택/,
  /가격\s*있는\s*하루/,
  /여러분/,
  /undefined|null|NaN/i,
];

const brokenHeadlinePatterns = [
  /^[0-9,\s원만원대]+$/,
  /[0-9]+이면/,
  /분만함|분만한|분만/,
  /나와버르/,
  /성색|생색\s*제대로\s*내는\s*선물\s*찾았습니다/i,
  /[0-9]{2,}\s*이면\s*\S{1,4}함/,
];

const informalBodyEndings = [
  /[^요]다$/,
  /듯$/,
  /각$/,
  /임$/,
  /함$/,
  /됨$/,
  /템$/,
  /없음$/,
  /좋음$/,
];

export function stripEmoji(value: string): string {
  return String(value || "")
    .replace(emojiRegex, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function visibleCopyLength(value: string): number {
  return [
    ...String(value || "")
      .replace(/\s+/g, "")
      .trim(),
  ].length;
}

export function cleanGeneratedText(value: string): string {
  let text = stripEmoji(value)
    .replace(/["""']/g, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of forbiddenPhraseReplacements) {
    text = text.replace(pattern, replacement);
  }

  return text.trim();
}

export function normalizeKoreanPricePhrase(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const digits = raw.replace(/[^0-9]/g, "");
  const num = Number(digits);

  if (!digits || Number.isNaN(num)) {
    return raw;
  }

  if (num >= 10000) {
    const man = Math.floor(num / 10000);
    return `${man}만원대`;
  }

  if (num >= 1000) {
    return `${num.toLocaleString("ko-KR")}원`;
  }

  return "";
}

export function trimCopyToLimit(value: string, maxChars: number): string {
  const normalized = cleanGeneratedText(value);
  if (!maxChars || visibleCopyLength(normalized) <= maxChars) return normalized;

  const phrase = normalized
    .split(/[,.!?\n]/)
    .map((part) => part.trim())
    .find((part) => part && visibleCopyLength(part) <= maxChars);
  if (phrase) return phrase;

  const words = normalized.split(/\s+/).filter(Boolean);
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (visibleCopyLength(next) > maxChars) break;
    current = next;
  }

  if (current) return current;

  let output = "";
  for (const char of normalized) {
    if (/\s/.test(char)) continue;
    if (visibleCopyLength(output + char) > maxChars) break;
    output += char;
  }

  return output;
}

export function isBadHeadline(headline: string): boolean {
  const text = cleanGeneratedText(headline);
  if (!text || visibleCopyLength(text) < 4) return true;
  if (genericHeadlinePatterns.some((pattern) => pattern.test(text))) return true;
  if (brokenHeadlinePatterns.some((pattern) => pattern.test(text))) return true;
  if (/^[0-9,]+/.test(text) && !/(원|만원대|할인|구성)/.test(text)) return true;
  return false;
}

function textPool(product: ProductInfoForPrompt, reference?: AdImageLabel): string {
  const finalLabel = reference?.finalLabel;

  return [
    product.productName,
    product.category,
    product.price,
    product.discountInfo,
    product.mainBenefit,
    product.targetCustomer,
    product.extractedDescription,
    finalLabel?.ocrText,
    finalLabel?.hookType,
    finalLabel?.appealPoint,
    finalLabel?.copyNuance,
    finalLabel?.whyItWorks,
    finalLabel?.firstLineHook,
    finalLabel?.copyStructure,
    finalLabel?.toneOfVoice,
    finalLabel?.trendElements,
    finalLabel?.consumerInsight,
    finalLabel?.purchaseTrigger,
    finalLabel?.reusableCopyPattern,
    finalLabel?.visualCopyRelation,
  ]
    .filter(Boolean)
    .join(" ");
}

export function buildSafeHeadlineFallback(params: {
  product: ProductInfoForPrompt;
  reference?: AdImageLabel;
}): string {
  const { product, reference } = params;
  const pool = textPool(product, reference);
  const price = normalizeKoreanPricePhrase(product.price || product.discountInfo);
  const hasFreeShipping = /무료\s*배송|무배/.test(pool);
  const isFood = /식품|고기|소고기|한우|등심|갈비|스테이크|정육|육류|beef|steak/i.test(pool);
  const hasGift = /선물|명절|부모님|집들이|고급|프리미엄/.test(pool);
  const hasSet = /구성|세트|박스|대용량|1kg|2kg|팩|묶음/.test(pool);
  const hasReviewTone = /후기|리뷰|반응|평점|먹어보/.test(pool);
  const hasMemeTone = /나와버|코어|야호|POV|저장각|장바구니각|SNS|밈|유행어/.test(pool);

  if (hasMemeTone && isFood) return `${foodKeyword(product, pool)} 야호`;
  if (hasFreeShipping) return "2세트 이상 무료배송";
  if (isFood && hasGift) return "선물용 고기 찾았습니다";
  if (isFood && hasSet) return "구성 좋은 고기 세트";
  if (isFood && price) return `${price} 고기 구성`;
  if (hasReviewTone) return "후기로 확인한 구성";
  if (price) return `${price} 구성 확인`;
  if (product.mainBenefit) return product.mainBenefit;
  if (product.productName) return `${product.productName} 구성`;

  return "구성 좋은 상품";
}

function foodKeyword(product: ProductInfoForPrompt, pool: string): string {
  if (/한우/.test(pool)) return "한우";
  if (/갈비/.test(pool)) return "갈비";
  if (/등심/.test(pool)) return "등심";
  if (/스테이크/.test(pool)) return "스테이크";
  if (/소고기|쇠고기/.test(pool)) return "소고기";
  return product.category || "고기";
}

export function repairHeadline(params: {
  headline: string;
  product: ProductInfoForPrompt;
  reference?: AdImageLabel;
  maxChars?: number;
}): {
  headline: string;
  repaired: boolean;
  reason: string;
} {
  const maxChars = params.maxChars || 18;
  const cleaned = trimCopyToLimit(params.headline, maxChars);

  if (!isBadHeadline(cleaned)) {
    return { headline: cleaned, repaired: false, reason: "model headline accepted" };
  }

  const fallback = trimCopyToLimit(
    buildSafeHeadlineFallback({
      product: params.product,
      reference: params.reference,
    }),
    maxChars
  );

  return {
    headline: fallback,
    repaired: true,
    reason: `bad headline repaired: ${cleaned || "(empty)"}`,
  };
}

export function normalizeBodyCopyPolite(value: string, fallback: string, maxChars: number): string {
  let text = cleanGeneratedText(value || fallback);

  text = text
    .replace(/놓치지 말$/, "놓치지 마세요")
    .replace(/놓치면 후회$/, "놓치면 아쉬워요")
    .replace(/좋음$/, "좋습니다")
    .replace(/가능함$/, "가능합니다")
    .replace(/추천$/, "추천드려요")
    .replace(/사야 함$/, "확인해보세요")
    .replace(/임$/, "입니다")
    .replace(/됨$/, "됩니다")
    .replace(/함$/, "합니다")
    .replace(/듯$/, "것 같아요");

  if (informalBodyEndings.some((pattern) => pattern.test(text))) {
    text = fallback;
  }

  if (!/(요|니다|세요|예요|이에요)$/.test(text)) {
    text = `${text.replace(/[.!?]$/, "")}입니다`;
  }

  return trimCopyToLimit(text, maxChars) || fallback;
}

export function normalizeCopyVariant(
  variant: Partial<GeneratedAdCopyVariant> | undefined,
  fallback: GeneratedAdCopyVariant,
  copyLimits?: Partial<Record<CopySlotKey, { maxChars?: number }>>
): GeneratedAdCopyVariant {
  return {
    headline: trimCopyToLimit(
      variant?.headline || fallback.headline,
      copyLimits?.headline?.maxChars || 18
    ),
    bodyCopy: normalizeBodyCopyPolite(
      variant?.bodyCopy || fallback.bodyCopy,
      fallback.bodyCopy,
      copyLimits?.bodyCopy?.maxChars || 36
    ),
    highlightCopy: trimCopyToLimit(
      variant?.highlightCopy || fallback.highlightCopy,
      copyLimits?.highlightCopy?.maxChars || 28
    ),
    bottomBarCopy: trimCopyToLimit(
      variant?.bottomBarCopy || fallback.bottomBarCopy,
      copyLimits?.bottomBarCopy?.maxChars || 32
    ),
    cta: trimCopyToLimit(
      variant?.cta || fallback.cta || "구성 보러가기",
      copyLimits?.cta?.maxChars || 10
    ),
    price: cleanGeneratedText(variant?.price || fallback.price || ""),
  };
}

export function removeForbiddenCopy(copy: GeneratedAdCopy): GeneratedAdCopy {
  return {
    ...copy,
    headline: cleanGeneratedText(copy.headline),
    bodyCopy: cleanGeneratedText(copy.bodyCopy),
    highlightCopy: cleanGeneratedText(copy.highlightCopy),
    bottomBarCopy: cleanGeneratedText(copy.bottomBarCopy),
    cta: cleanGeneratedText(copy.cta),
    price: cleanGeneratedText(copy.price),
  };
}
