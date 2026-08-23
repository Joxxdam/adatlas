import type { ProductTruth } from "../creative-generation/types";

export const BANNED_GENERIC_AD_COPY = ["지금 만나보세요", "새로운 경험", "일상을 바꾸는", "특별한 선택", "당신을 위한", "프리미엄 라이프", "더 나은 내일", "스마트한 선택"] as const;

const unsupportedClaimPattern = /(?:무조건|완벽(?:히|한)?|100%\s*(?:효과|해결|제거)|즉시\s*(?:치료|개선|제거)|임상(?:적으로)?\s*입증|체감온도|체취.{0,8}(?:지우|제거|없애)|체취\s*-?\d+%)/iu;
const urgencyPattern = /(?:지금만|오늘만|마감\s*임박|선착순|한정\s*수량|품절\s*임박|단\s*\d+일)/iu;
const evidenceRequiredPattern = /(?:도축현장|도매가|도매특가|최저가|판매량\s*1위|국내\s*1위|영국\s*1위|괜히\s*1등|무료\s*배송|잡내\s*(?:1도|0|제로|없))/giu;
const numericPattern = /(?:₩|￦)?\s*\d[\d,.]*(?:\s*(?:원|%|kg|g|mg|ml|l|개|입|팩|장|점))?/giu;

function normalize(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").replace(/[,.]/g, "").toLowerCase();
}

function lines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function extractEmojiCount(value: string) {
  return Array.from(value.matchAll(/\p{Extended_Pictographic}/gu)).length;
}

export function verifiedFactText(truth: ProductTruth) {
  return [truth.product.productName, truth.product.price, truth.product.originalPrice, truth.product.oldPrice, truth.product.discountInfo, truth.product.mainBenefit, truth.product.targetCustomer, ...(truth.product.verifiedBenefits || []), ...(truth.product.ingredients || []), ...truth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified").flatMap((fact) => [fact.label, fact.value])].filter(Boolean).join(" ");
}

export function validateAdCopyAgainstTruth(input: { primaryText: string; adTitle?: string; truth: ProductTruth; hookHeadline: string; approvedCopies?: string[] }) {
  const failures: string[] = [];
  const primaryText = input.primaryText.trim();
  const adTitle = input.adTitle?.trim() || "";
  const copyLines = lines(primaryText);
  const facts = verifiedFactText(input.truth);
  const normalizedFacts = normalize(facts);
  const combinedCopy = [primaryText, adTitle].filter(Boolean).join("\n");
  const normalizedCopy = normalize(combinedCopy);

  if (copyLines.length < 5 || copyLines.length > 8) failures.push("Meta 기본 문구는 5~8개의 읽기 쉬운 문장 줄이어야 합니다.");
  if (primaryText.length > 520) failures.push("Meta 기본 문구가 너무 깁니다.");
  if (adTitle && (adTitle.length < 4 || adTitle.length > 40 || /[\r\n]/.test(adTitle))) failures.push("광고 제목은 4~40자의 한 줄이어야 합니다.");
  for (const phrase of BANNED_GENERIC_AD_COPY) if (combinedCopy.includes(phrase)) failures.push(`일반적인 AI 문구를 사용할 수 없습니다: ${phrase}`);
  if (unsupportedClaimPattern.test(combinedCopy)) failures.push("확인되지 않은 효과·임상·수치 표현이 포함되었습니다.");
  if (urgencyPattern.test(combinedCopy) && !urgencyPattern.test(facts)) failures.push("확인되지 않은 긴급성 또는 한정 표현이 포함되었습니다.");
  const evidenceRequiredClaims = [...combinedCopy.matchAll(evidenceRequiredPattern)].map((match) => match[0]);
  for (const claim of evidenceRequiredClaims) {
    if (!normalizedFacts.includes(normalize(claim))) failures.push(`상품 근거가 필요한 표현이 포함되었습니다: ${claim}`);
  }

  const numericTokens = [...combinedCopy.matchAll(numericPattern)].map((match) => normalize(match[0])).filter(Boolean);
  for (const token of numericTokens) {
    if (!normalizedFacts.includes(token)) failures.push(`확인되지 않은 숫자·가격·구성 표현이 포함되었습니다: ${token}`);
  }
  const emojiCount = extractEmojiCount(primaryText);
  if (emojiCount === 1 || emojiCount > 6) failures.push("이모지는 사용하지 않거나 2~6개만 자연스럽게 사용해야 합니다.");
  if (input.hookHeadline.trim()) {
    const hookWords = input.hookHeadline
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 2);
    if (hookWords.length && !hookWords.some((word) => normalizedCopy.includes(normalize(word)))) failures.push("대표 후킹과 광고문구의 메시지가 연결되지 않습니다.");
  }
  for (const approved of input.approvedCopies || []) {
    if (approved && normalize(approved) === normalizedCopy) failures.push("기존 승인 문구를 그대로 복사할 수 없습니다.");
  }
  return { passed: failures.length === 0, failures, lineCount: copyLines.length, emojiCount };
}

export type AdCopyChange = {
  hookChanged?: boolean;
  messageChanged?: boolean;
  priceChanged?: boolean;
  productTruthChanged?: boolean;
  compositionChanged?: boolean;
  representativeImageChanged?: boolean;
  colorOnlyChanged?: boolean;
  productPositionOnlyChanged?: boolean;
};

export function shouldRegenerateAdCopy(change: AdCopyChange) {
  if (change.hookChanged || change.messageChanged || change.priceChanged || change.productTruthChanged || change.compositionChanged || change.representativeImageChanged) return true;
  if (change.colorOnlyChanged || change.productPositionOnlyChanged) return false;
  return false;
}

export function selectRepresentativeResultId(input: { representativeResultId?: string; executionResultIds?: string[]; results: Array<{ id: string; status: string }> }) {
  const approved = input.results.filter((result) => ["success", "approved"].includes(result.status));
  const preferred = input.representativeResultId || input.executionResultIds?.[0];
  return approved.find((result) => result.id === preferred)?.id || approved[0]?.id;
}

export function canGenerateAdCopyAfterQa(input: { resultStatus?: string; imageQaPassed?: boolean; nativeQaRecommendation?: string; groupRequired?: boolean; groupRecommendation?: string }) {
  if (!["success", "approved"].includes(input.resultStatus || "")) return false;
  const imagePassed = input.nativeQaRecommendation ? input.nativeQaRecommendation === "approve" : input.imageQaPassed === true;
  if (!imagePassed) return false;
  return !input.groupRequired || input.groupRecommendation === "approve";
}

export function adCopyFingerprint(parts: string[]) {
  let hash = 2166136261;
  const value = parts.map(normalize).join("|");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function csvCell(value: unknown) {
  const text = String(value ?? "").replace(/\r?\n/g, "\n");
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildAdCopyCsv(
  rows: Array<{
    productName: string;
    primaryText: string;
    adName?: string;
    utm?: string;
    assetCode?: string;
    hookId?: string;
  }>
) {
  const header = ["상품명", "Meta 기본 문구", "광고명", "UTM", "소재코드", "대표 후킹"];
  return `\uFEFF${[header, ...rows.map((row) => [row.productName, row.primaryText, row.adName, row.utm, row.assetCode, row.hookId])].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
