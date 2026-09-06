import type { ProductFact } from "./types.ts";
import type { ProductCopyDomain } from "./productCopySemantics.ts";
import { isIncompleteOcrCopyFragment, isMalformedProductSignal, isPackageLabelOcrCopyNoise } from "./productSignalHygiene.ts";

function compact(value: string) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function characterCount(value: string) {
  return Array.from(value.replace(/\s/g, "")).length;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const signature = compact(value).replace(/[^0-9a-z가-힣]+/giu, "").toLowerCase();
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function isSafeMinimalOfferFact(fact: ProductFact) {
  const signal = compact(`${fact.key} ${fact.label} ${fact.value}`);
  return fact.copyEligibility === "offerOnly" ||
    ["price", "offer"].includes(fact.evidenceType || "") ||
    ["price", "original-price", "discount", "promotion"].includes(fact.key) ||
    /(?:판매가|정가|기존가|할인가|가격|특가|할인|혜택가|\d[\d,.]*\s*원)/iu.test(signal);
}

export function isSafeMinimalFactCandidate(fact: ProductFact, merchantNames: string[] = []) {
  const value = compact(fact.value);
  if (!fact.usableInCopy || fact.verification === "unverified" || fact.copyEligibility === "blocked" || fact.copyEligibility === "identityOnly") return false;
  if (["identity", "shipping", "merchant-proof"].includes(fact.evidenceType || "")) return false;
  if (["base-product-name", "brand-name", "category", "target", "package-option"].includes(fact.key)) return false;
  if (!value || /^(?:향|사용감|제품|상품|구성|원료)$/u.test(value) || /(?:리뷰|후기)\s*$/u.test(value)) return false;
  if (isMalformedProductSignal(value) || isIncompleteOcrCopyFragment(value) || isPackageLabelOcrCopyNoise(value)) return false;
  if (/(?:확인된\s*상품\s*표현|상세\s*페이지\s*혜택|상품명에서\s*확인된|ProductTruth|OCR)/iu.test(value)) return false;
  if (/[\u3400-\u9fff]/u.test(value) || /^\s*(?:[-–—]|[📢🚨✅★☆*"'])/u.test(value) || /\d+\s*만\s*넘는/u.test(value)) return false;
  if (fact.evidenceType === "ingredient" && /(?:샤워젤|바디\s*워시|세럼|크림|로션|상품)\b.*\d+\s*(?:ml|g)\b/iu.test(value)) return false;
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  if (merchantNames.some((name) => {
    const merchant = compact(name).replace(/\s+/g, "").toLowerCase();
    return merchant.length >= 2 && normalized.includes(merchant);
  })) return false;
  return true;
}

/**
 * 안전 최소 문구는 새로운 효능·상황을 창작하지 않고 검증된 fact를 광고에서
 * 읽기 쉬운 완결 명사구로만 정리한다. 문자열을 중간에서 자르지 않는다.
 */
export function safeMinimalFactText(
  fact: ProductFact,
  domain: ProductCopyDomain,
  merchantNames: string[] = [],
  maximumCharacters = 46
) {
  let clean = compact(fact.value);
  merchantNames.filter(Boolean).forEach((name) => {
    clean = clean.replace(new RegExp(escapeRegExp(compact(name)), "giu"), " ");
  });
  clean = compact(clean)
    .replace(/^(.+?)(?:을|를)\s*사용한\s*제품으로\s*소개됨\s*$/u, "$1 사용")
    .replace(/\s*(?:제품|상품|것)?\s*(?:으로|라고)?\s*소개됨\s*$/u, "")
    .replace(/\s*(?:이라고|라고|으로|로|을|를)?\s*(?:소개|정리|표현|평가|해석)(?:된|한)?\s*(?:제품|것)?\s*$/u, "")
    .replace(/\s*(?:을|를)\s*담(?:았다고|은\s*것으로)\s*$/u, "")
    .replace(/\s*(?:을|를)\s*사용한다고\s*$/u, "")
    .replace(/\s*강조한\s*제품\s*$/u, "")
    .replace(/\s*어울리는\s*방향\s*$/u, "")
    .replace(/[.!?~]+$/u, "")
    .trim();

  const candidates: string[] = [];
  const volume = clean.match(/(\d[\d,.]*\s*(?:ml|l|g|kg))\b/iu)?.[1]?.replace(/\s+/g, "");
  const count = clean.match(/([가-힣A-Za-z]+(?:\s+[가-힣A-Za-z]+){0,3}\s+\d[\d,.]*\s*(?:개\s*분량|방울))/u)?.[1];
  const leadingDrops = clean.match(/^(\d[\d,.]*\s*방울)의\s+(.{2,24}?(?:오일|원료))/u);
  if (leadingDrops) candidates.push(`${compact(leadingDrops[2])} ${leadingDrops[1].replace(/\s+/g, "")}`);
  if (count && volume) candidates.push(`${compact(count)} · ${volume}`);
  if (count) candidates.push(compact(count));
  if (/냉압착/u.test(clean)) {
    candidates.push("열 대신 눌러 얻는 냉압착 방식");
  }
  const origin = clean.match(/((?:시칠리아|히말라야|멕시코|페루|아프리카|민트\s*벨트)[^,.]{0,24}(?:레몬|민트|원료))/u)?.[1];
  if (origin) candidates.push(compact(origin).replace(/에서\s*손으로\s*수확한/u, " 손수확"));
  const foam = clean.match(/([^,.]{0,22}(?:미세하고\s*가벼운\s*거품|풍성한\s*거품|부드러운\s*거품))/u)?.[1];
  if (foam) candidates.push(compact(foam).replace(/^.*물과\s*만나/u, "물과 만나"));
  const finish = clean.match(/((?:산뜻하고|촉촉하고|가볍고|개운한)[^,.]{0,18}마무리)/u)?.[1];
  if (finish) candidates.push(compact(finish));
  const usage = clean.match(/((?:상쾌한\s*)?아침\s*샤워(?:나|와)?\s*운동\s*후)/u)?.[1];
  if (usage) candidates.push(compact(usage));
  candidates.push(clean);
  const numericTokens = unique([...clean.matchAll(/\d[\d,.]*\s*(?:%|ml|l|g|kg|개|병|팩|세트|방울|원)/giu)].map((match) => match[0].replace(/\s+/g, "")));
  if (numericTokens.length) {
    const consumerTokens = numericTokens.map((token) => /(?:개|병|팩|세트)$/u.test(token) ? `${token} 구성` : token);
    candidates.push(consumerTokens.join(" · "));
  }

  const categorySafe = unique(candidates).filter((candidate) => {
    if (domain === "personal-care" || domain === "beauty") return !/(?:한입|먹어|맛있|식탁|메뉴|씹을수록|육즙|밥도둑)/u.test(candidate);
    if (domain === "food" || domain === "snack") return !/(?:피부에|샤워|세안|바르|욕실|보습막)/u.test(candidate);
    return true;
  });
  return categorySafe.find((candidate) => characterCount(candidate) <= maximumCharacters) ||
    [...categorySafe].sort((left, right) => characterCount(left) - characterCount(right))[0] || "";
}

export function safeMinimalCta(domain: ProductCopyDomain, index: number) {
  const options = domain === "personal-care" || domain === "beauty"
    ? ["원료 정보 보기", "사용감 확인하기", "샤워 정보 보기", "제품 확인하기", "사용 정보 보기", "구성 살펴보기"]
    : domain === "food" || domain === "snack"
      ? ["원료 정보 보기", "구성 확인하기", "제품 확인하기", "판매 정보 보기", "상품 살펴보기", "구매 정보 보기"]
      : ["제품 확인하기", "사용 정보 보기", "구성 확인하기", "상품 살펴보기", "원료 정보 보기", "판매 정보 보기"];
  return options[index % options.length];
}

export function applySafeMinimalRhetoric(source: string, value: string) {
  const clean = compact(value).replace(/(?:\.{2,3}|;;|[!?]{1,3}|ㅋ+)$/u, "").trim();
  const marker = source.match(/(ㅋㅋ+|ㅎㅎ+|\.{3}|\.{2}|;;|\?!|!\?|\?\?|!!)/u)?.[1] || source.match(/([!?])\s*$/u)?.[1] || "";
  return marker ? `${clean}${marker}` : clean;
}
