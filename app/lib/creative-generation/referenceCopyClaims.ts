import { extractNumericTokens, extractPackOptionCounts, validateCopyAgainstTruth } from "./productTruth.ts";
import { hasVerifiedPriceFact, hasVerifiedSensoryFact } from "./referenceCopyAngles.ts";
import type { ProductFact, ProductTruth, ReferenceCopyCandidate, ReferenceCopyClaimMode } from "./types.ts";

const PERSONA_RISK_RULES: Array<{ pattern: RegExp; flag: string }> = [
  { pattern: /(?:\d+\s*년(?:째|차)?|평생)\s*(?:고기|정육|축산|화장품|뷰티|요리|장사)/u, flag: "검증되지 않은 경력·기간을 가진 인물 증언" },
  { pattern: /(?:울|우리|저희)\s*(?:아버지|어머니|엄마|아빠|남편|아내).*(?:원픽|인정|추천|보장)/u, flag: "실제 가족 증언으로 오인될 수 있는 페르소나" },
  { pattern: /(?:사장님|대표|직원|본사|담당자|경리팀).*(?:몰래|모르게|손해|허락|결재|뒤집|비밀)/u, flag: "실제 내부정보·손해 판매로 오인될 수 있는 표현" },
  { pattern: /(?:고객|구매자|단골|후기).*(?:계속|폭주|인정|추천|찾는|재구매)/u, flag: "실제 고객 반응·재구매 증거로 오인될 수 있는 표현" },
];

const UNSUPPORTED_OBJECTIVE_RULES: Array<{ pattern: RegExp; evidence: RegExp; label: string }> = [
  { pattern: /국내\s*(?:최저가|최저)|전국\s*(?:최저가|최저)|업계\s*(?:최저가|최초|1위)/u, evidence: /최저|최초|1위/u, label: "비교 우위·순위" },
  { pattern: /(?:판매량|매출|후기|리뷰|인기)\s*(?:1위|폭발|압도|최고)/u, evidence: /판매량|매출|후기|리뷰|인기.*(?:1위|폭발|압도|최고)/u, label: "판매·후기 성과" },
  { pattern: /(?:품절\s*임박|곧\s*품절|재고\s*소진|오늘만|이번\s*주만|마감\s*임박|한정\s*수량)/u, evidence: /품절|재고|오늘만|이번\s*주|마감|한정\s*수량/u, label: "재고·기간 긴급성" },
  { pattern: /(?:전문가|의사|셰프|명장|협회|기관).*(?:추천|인정|인증|선택)/u, evidence: /전문가|의사|셰프|명장|협회|기관.*(?:추천|인정|인증|선택)/u, label: "전문가·기관 보증" },
  { pattern: /(?:손해\s*보고|원가\s*이하|노마진|도매\s*원가|사입가보다\s*싸)/u, evidence: /손해|원가|노마진|도매/u, label: "원가·손해 판매" },
];

function normalized(value: string) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function supportedFacts(truth: ProductTruth, factIds: string[]) {
  const ids = new Set(factIds);
  return truth.facts.filter((fact) => ids.has(fact.id) && fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked");
}

function factCorpus(facts: ProductFact[]) {
  return facts.map((fact) => `${fact.label} ${fact.value}`).join(" ");
}

function isFood(truth: ProductTruth) {
  return /식품|음식|간식|고기|육류|한우|food|snack|meat|beef/u.test(`${truth.product.category || ""} ${truth.product.productSubCategory || ""} ${truth.product.detectedProductType || ""} ${truth.product.productName}`.toLowerCase());
}

const DIMENSION_DIFFERENCE_ABSENT_RULES: Array<{ dimension: string; fact: RegExp; oppositeCopy: RegExp }> = [
  {
    dimension: "등급",
    fact: /등급(?:별|마다)?[^.!?\n]{0,18}(?:차이(?:가|는)?\s*(?:거의\s*)?없|다르지\s*않|비슷)/u,
    oppositeCopy: /(?:등급(?:별|마다)?[^.!?\n]{0,18}(?:다르|달라|차이(?:가|는)?\s*(?:크|분명|확실))|(?:다르|달라|차이(?:가|는)?\s*(?:크|분명|확실))[^.!?\n]{0,18}등급(?:별|마다)?)/u,
  },
  {
    dimension: "구성",
    fact: /구성(?:별|마다)?[^.!?\n]{0,18}(?:차이(?:가|는)?\s*(?:거의\s*)?없|동일|같)/u,
    oppositeCopy: /(?:구성(?:별|마다)?[^.!?\n]{0,18}(?:다르|달라|차이(?:가|는)?\s*(?:크|분명|확실))|(?:다르|달라)[^.!?\n]{0,18}구성(?:별|마다)?)/u,
  },
];

/**
 * 허용된 사실 단어를 사용했더라도 사실의 방향을 반대로 바꾼 문구는 차단한다.
 * 예: `등급별 차이가 거의 없습니다`를 `등급별, 달라요`로 바꾸는 경우.
 */
export function findReferenceCopyTruthSemanticErrors(text: string, truth: ProductTruth) {
  const copy = normalized(text);
  const usableFactText = truth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked")
    .map((fact) => normalized(fact.value))
    .join("\n");
  const errors: string[] = [];
  const copyPackCounts = extractPackOptionCounts(copy);
  const resolvedPackCounts = extractPackOptionCounts([
    truth.normalized.composition,
    truth.normalized.packageOrOption,
  ].filter(Boolean).join(" "));
  if (copyPackCounts.length > 1) {
    errors.push("한 소재 안에 서로 다른 판매 팩 수가 함께 포함됐습니다.");
  }
  if (truth.normalized.optionSelectionRequired && copyPackCounts.length) {
    errors.push("판매 옵션이 확정되지 않아 팩 수를 광고 문구에 사용할 수 없습니다.");
  } else if (resolvedPackCounts.length === 1 && copyPackCounts.some((count) => count !== resolvedPackCounts[0])) {
    errors.push(`확정된 ${resolvedPackCounts[0]}팩 구성과 다른 팩 수가 문구에 포함됐습니다.`);
  }
  if (/(?:확인된\s*상품\s*표현|상세\s*페이지\s*혜택|상품명에서\s*확인된|ProductTruth|OCR)/iu.test(copy)) {
    errors.push("내부 분석 라벨이 소비자 광고 문구에 노출됐습니다.");
  }
  if (/[\u3400-\u9fff]/u.test(copy)) {
    errors.push("한국어 광고 문구에 정규화되지 않은 한자 OCR 문자가 포함됐습니다.");
  }
  for (const rule of DIMENSION_DIFFERENCE_ABSENT_RULES) {
    if (rule.fact.test(usableFactText) && rule.oppositeCopy.test(copy)) {
      errors.push(`ProductTruth의 ${rule.dimension} 차이 없음·동일 사실을 반대 의미로 바꿨습니다.`);
    }
  }
  if (/등급(?:별|마다)?\s*[,，]\s*(?:다르|달라|차이)/u.test(copy) || /저지방\s*부위로\s*등급(?:별|마다)?\s*[,，]/u.test(copy)) {
    errors.push("등급 표현이 의미 없는 쉼표로 끊겨 문법과 비교 대상이 불분명합니다.");
  }
  return [...new Set(errors)];
}

export function classifyReferenceCopyClaims(text: string): ReferenceCopyClaimMode[] {
  const value = normalized(text);
  const modes = new Set<ReferenceCopyClaimMode>();
  if (!value) return [];
  if (PERSONA_RISK_RULES.some((rule) => rule.pattern.test(value))) modes.add("dramatized-persona");
  if (/\d|\b(?:원|등급|원산지|국내산|국산|인증|함유|할인|용량|중량|개입|팩)\b|최저가|1위|품절|한정\s*수량/u.test(value)) modes.add("objective-fact");
  if (/(?:미쳤|대박|밥도둑|중독|못\s*참|생각\s*안\s*나|아쉽|놀랐|실화|왜\s*이래|ㄹㅇ|;;|ㅋㅋ)/u.test(value)) modes.add("subjective-reaction");
  if (/(?:가족|아버지|어머니|엄마|아빠|남편|아내|친구|동료|저녁|아침|식탁|냉장고|냉동실|욕실|샤워|운동\s*후|퇴근\s*후|캠핑|주말)/u.test(value)) modes.add("lifestyle-scenario");
  if (/(?:세상에|말도\s*안\s*돼|끝판왕|주인공|반칙|게임\s*끝|다른\s*.*생각\s*안)/u.test(value)) modes.add("obvious-puffery");
  if (!modes.size) modes.add("subjective-reaction");
  return [...modes];
}

function safePersonaAlternative(text: string, truth: ProductTruth) {
  const priceBacked = hasVerifiedPriceFact(truth);
  const identity = truth.normalized.baseProductName || truth.normalized.cleanProductName || truth.product.productName;
  if (/(?:사장님|대표|직원|본사|담당자|경리팀)/u.test(text)) {
    return priceBacked ? `${identity} 가격표, 한 번 더 보게 돼요` : `${identity}, 이 차이는 그냥 지나치기 어렵죠`;
  }
  if (/(?:아버지|아빠)/u.test(text)) return `${identity} 꺼낸 날엔 아버지 젓가락도 바빠져요`;
  if (/(?:어머니|엄마)/u.test(text)) return `${identity} 꺼낸 날엔 엄마도 먼저 한 번 더 봐요`;
  return `${identity}, 한 번 시작하면 다음 순간까지 떠올라요`;
}

export type ReferenceCopyClaimReview = {
  valid: boolean;
  claimModes: ReferenceCopyClaimMode[];
  copyReviewRequired: boolean;
  copyRiskFlags: string[];
  errors: string[];
  safeAlternative?: string;
};

/** 객관적 사실과 주관적 광고 반응을 분리해 모델의 자체 factualSafety 점수보다 먼저 실행합니다. */
export function reviewReferenceCopyClaims(input: { text: string; truth: ProductTruth; coreFactIds?: string[] }): ReferenceCopyClaimReview {
  const text = normalized(input.text);
  const coreFactIds = input.coreFactIds || [];
  const facts = supportedFacts(input.truth, coreFactIds);
  const allUsableFacts = input.truth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked");
  const linkedCorpus = factCorpus(facts);
  const allCorpus = factCorpus(allUsableFacts);
  const copyRiskFlags = PERSONA_RISK_RULES.filter((rule) => rule.pattern.test(text)).map((rule) => rule.flag);
  const errors: string[] = [];
  const modes = new Set(classifyReferenceCopyClaims(text));

  const numericTokens = extractNumericTokens(text);
  const allowed = new Set(input.truth.allowedNumericTokens.map((token) => token.replace(/\s+/g, "").toLowerCase()));
  const unsupportedNumeric = numericTokens.filter((token) => !allowed.has(token.replace(/\s+/g, "").toLowerCase()));
  if (unsupportedNumeric.length) errors.push(`ProductTruth에 없는 수치(${unsupportedNumeric.join(", ")})가 포함됐습니다.`);
  if (numericTokens.length && !facts.some((fact) => fact.numericTokens.some((token) => numericTokens.includes(token)))) {
    errors.push("객관적 수치 문구에 연결된 coreFactIds가 없습니다.");
  }

  for (const rule of UNSUPPORTED_OBJECTIVE_RULES) {
    if (rule.pattern.test(text) && !rule.evidence.test(linkedCorpus)) errors.push(`${rule.label} 주장을 뒷받침하는 coreFactIds가 없습니다.`);
  }
  if (/\b(?:1\+\+|1\+|2\+|A\+\+|특등급)\s*등급|(?:^|\s)1\+\+(?:\s|$)/u.test(text) && !/1\+\+|1\+|특등급/u.test(linkedCorpus)) {
    errors.push("등급 주장을 뒷받침하는 coreFactIds가 없습니다.");
  }
  if (/\d[\d,.]*\s*(?:톤|t)\b/iu.test(text) && !/\d[\d,.]*\s*(?:톤|t)\b/iu.test(linkedCorpus)) {
    errors.push("물량 주장을 뒷받침하는 coreFactIds가 없습니다.");
  }
  if (/가격.*(?:미쳤|실화|놀라|다시\s*보)|이\s*가격/u.test(text) && !hasVerifiedPriceFact(input.truth)) {
    errors.push("가격 반응 문구를 사용할 확인된 가격 fact가 없습니다.");
  }
  if (/육즙/u.test(text) && (!isFood(input.truth) || !hasVerifiedSensoryFact(input.truth) || !/육즙/u.test(allCorpus))) {
    errors.push("육즙 표현을 뒷받침하는 현재 식품의 감각 근거가 없습니다.");
  }
  const factual = validateCopyAgainstTruth(text, input.truth);
  if (!factual.valid) errors.push("ProductTruth 수치·차단 표현 검증을 통과하지 못했습니다.");
  errors.push(...findReferenceCopyTruthSemanticErrors(text, input.truth));

  const copyReviewRequired = copyRiskFlags.length > 0;
  if (errors.length) modes.add("prohibited-or-unsupported");
  return {
    valid: errors.length === 0,
    claimModes: [...modes],
    copyReviewRequired,
    copyRiskFlags: [...new Set(copyRiskFlags)],
    errors: [...new Set(errors)],
    safeAlternative: copyReviewRequired ? safePersonaAlternative(text, input.truth) : undefined,
  };
}

export function createAutomaticSafeCandidate(candidate: ReferenceCopyCandidate, truth: ProductTruth): ReferenceCopyCandidate | null {
  if (!candidate.copyReviewRequired) return candidate;
  const review = reviewReferenceCopyClaims({ text: candidate.fullCopy, truth, coreFactIds: candidate.coreFactIds });
  const safeText = candidate.safeAlternative?.trim() || review.safeAlternative;
  if (!safeText) return null;
  const blocks = candidate.copyBlocks.map((block, index) => index === 0 ? { ...block, text: safeText } : block);
  const fullCopy = blocks.map((block) => block.text).filter(Boolean).join("\n");
  const safeReview = reviewReferenceCopyClaims({ text: fullCopy, truth, coreFactIds: candidate.coreFactIds });
  if (!safeReview.valid || safeReview.copyReviewRequired) return null;
  return {
    ...candidate,
    id: `${candidate.id}-safe`,
    fullCopy,
    copyBlocks: blocks,
    claimModes: safeReview.claimModes,
    copyRiskFlags: [],
    copyReviewRequired: false,
    safeAlternative: undefined,
    selectionReason: "검토 필요 원안 대신 같은 광고 강도의 자동 제작용 안전 대체문을 사용했습니다.",
  };
}
