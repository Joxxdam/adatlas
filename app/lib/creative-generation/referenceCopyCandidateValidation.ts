import { findReferenceCopyNaturalnessErrors } from "./referenceCopyNaturalness.ts";
import { reviewReferenceCopyClaims } from "./referenceCopyClaims.ts";
import { referenceCopyEvidenceDimensionForFact } from "./referenceCopyAngles.ts";
import type { ProductFact, ProductTruth, ReferenceCopyCandidate, ReferenceCopyEvidenceAssignment } from "./types.ts";

export const GENERIC_IMAGE_COPY_PHRASES = [
  "특별한 선택", "새로운 경험", "프리미엄", "완벽한 선택", "일상을 바꾸는", "당신을 위한", "더 나은", "스마트한 선택",
  "풍부한 맛", "산뜻한 마무리", "직접 느껴보세요", "지금 만나보세요", "구성을 확인하세요", "상품 자세히 보기", "놓치지 마세요",
  "합리적인 가격", "온 가족이 즐기는", "맛과 품질을 동시에", "부담 없이 즐겨보세요", "구성 확인", "지금 확인하세요",
  "한입부터 달라요", "차이부터 보세요", "차이는 분명해요", "오늘 식탁에 담기", "오늘 저녁에 딱", "식탁이 먼저 바빠져요",
] as const;

function comparable(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?:으로|에서|에게|한테|처럼|보다|까지|부터|은|는|이|가|을|를|만|도|의|에|로)(?=\s|$)/gu, " ")
    .replace(/[^0-9a-z가-힣]+/g, "")
    .trim();
}

function grams(value: string) {
  const normalized = comparable(value);
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) result.add(normalized.slice(index, index + 2));
  return result;
}

function wordSet(value: string) {
  return new Set(String(value || "").normalize("NFKC").toLowerCase().replace(/[^0-9a-z가-힣]+/g, " ").split(/\s+/).map((word) => word.replace(/(?:으로|에서|에게|한테|처럼|보다|까지|부터|은|는|이|가|을|를|만|도|의|에|로)$/u, "")).filter((word) => word.length >= 2));
}

function wordSimilarity(left: string, right: string) {
  const a = wordSet(left);
  const b = wordSet(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / Math.max(1, new Set([...a, ...b]).size);
}

export function referenceCopySemanticSimilarity(left: string, right: string) {
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return comparable(left) === comparable(right) ? 1 : 0;
  const intersection = [...a].filter((gram) => b.has(gram)).length;
  return (2 * intersection) / Math.max(1, a.size + b.size);
}

export function isReferenceCopySemanticDuplicate(left: string, right: string, threshold = 0.8) {
  const a = comparable(left);
  const b = comparable(right);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))) || wordSimilarity(left, right) >= 0.7 || referenceCopySemanticSimilarity(left, right) >= threshold;
}

export function genericImageCopyPenalty(text: string) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  return GENERIC_IMAGE_COPY_PHRASES.reduce((sum, phrase) => sum + (normalized.includes(phrase) ? 18 : 0), 0);
}

function categoryMismatchErrors(text: string, truth: ProductTruth) {
  const context = `${truth.product.category || ""} ${truth.product.productSubCategory || ""} ${truth.product.detectedProductType || ""} ${truth.product.productName}`.toLowerCase();
  const food = /식품|음식|간식|고기|육류|한우|food|snack|meat|beef/u.test(context);
  const personalCare = /화장품|뷰티|샤워|바디|세럼|크림|로션|beauty|personal/u.test(context);
  const errors: string[] = [];
  if (personalCare && /(?:굽자|육즙|밥도둑|한입|씹을수록|먹어|맛있|식탁|밥솥)/u.test(text)) errors.push("화장품·퍼스널케어 문구에 식품 감각·섭취 장면이 포함됐습니다.");
  if (food && /(?:피부에|샤워|거품|보습막|세안|흡수시켜|바르자|욕실)/u.test(text)) errors.push("식품 문구에 화장품·퍼스널케어 사용 장면이 포함됐습니다.");
  return errors;
}

function repeatedBlockErrors(candidate: ReferenceCopyCandidate, truth: ProductTruth) {
  const errors: string[] = [];
  const identity = comparable(truth.normalized.baseProductName || truth.normalized.cleanProductName || truth.product.productName);
  const identityMentions = candidate.copyBlocks.filter((block) => identity.length >= 4 && comparable(block.text).includes(identity)).length;
  if (identityMentions > 1) errors.push("같은 상품명이 여러 문구 블록에 반복됐습니다.");
  const observed = new Set<string>();
  for (const block of candidate.copyBlocks) {
    const signature = comparable(block.text);
    if (!signature || block.role === "cta") continue;
    if (observed.has(signature)) errors.push("같은 핵심 문구가 여러 블록에 반복됐습니다.");
    observed.add(signature);
  }
  const factualTokens = [truth.normalized.price, truth.normalized.quantity, truth.normalized.composition].filter(Boolean) as string[];
  for (const token of factualTokens) {
    if (candidate.copyBlocks.filter((block) => block.text.includes(token)).length > 1) errors.push(`같은 상품 사실(${token})이 여러 블록에 반복됐습니다.`);
  }
  return errors;
}

function hasConcreteProductContext(candidate: ReferenceCopyCandidate, truth: ProductTruth) {
  const linked = new Set(candidate.coreFactIds);
  const stopWords = new Set(["상품", "제품", "선택", "구성", "사용", "느낌", "가격"]);
  return truth.facts
    .filter((fact) => linked.has(fact.id))
    .flatMap((fact) => `${fact.label} ${fact.value}`.split(/[^0-9a-z가-힣]+/i))
    .some((token) => token.length >= 3 && !stopWords.has(token) && candidate.fullCopy.includes(token));
}

function incompleteErrors(candidate: ReferenceCopyCandidate) {
  const fakePlan = {
    referenceRawLines: [] as string[],
    adaptedLines: candidate.copyBlocks.map((block) => block.text),
    copySlots: candidate.copyBlocks.map((block, index) => ({ index, role: block.role, sourceText: "", targetText: block.text, emphasis: "none" as const })),
    headline: candidate.copyBlocks.find((block) => block.role === "headline")?.text || candidate.fullCopy,
    subCopy: candidate.copyBlocks.filter((block) => block.role === "support").map((block) => block.text).join(" "),
    proof: candidate.copyBlocks.filter((block) => block.role === "proof").map((block) => block.text).join(" "),
    offer: candidate.copyBlocks.filter((block) => block.role === "offer").map((block) => block.text).join(" "),
    cta: candidate.copyBlocks.filter((block) => block.role === "cta").map((block) => block.text).join(" "),
  };
  return findReferenceCopyNaturalnessErrors(fakePlan);
}

function candidateReflectsAssignedFact(candidate: ReferenceCopyCandidate, fact: ProductFact | undefined) {
  if (!fact) return false;
  const text = candidate.fullCopy.normalize("NFKC").toLowerCase();
  const dimension = referenceCopyEvidenceDimensionForFact(fact);
  if (dimension === "numeric-proof" && fact.numericTokens.length) return fact.numericTokens.some((token) => text.includes(token.toLowerCase()));
  const signals: Partial<Record<typeof dimension, RegExp>> = {
    "ingredient-provenance": /시칠리아|민트\s*벨트|히말라야|멕시코|페루|아프리카|수확|원료/u,
    process: /냉압착|증류|추출|공정|눌러/u,
    texture: /거품|제형|젤|쿠션|보습막|마무리/u,
    "usage-problem": /운동|퇴근|무더|아침|샤워|사용|필요한\s*순간/u,
    certification: /비건|peta|인증|크루얼티|천연\s*향료/u,
  };
  if (signals[dimension]?.test(text)) return true;
  const stopWords = new Set(["제품", "상품", "소개됨", "강조한", "사용감", "구성", "원료", "함유"]);
  return `${fact.label} ${fact.value}`.split(/[^0-9a-z가-힣]+/iu).filter((token) => token.length >= 3 && !stopWords.has(token)).some((token) => text.includes(token.toLowerCase()));
}

export type ReferenceCopyCandidateValidation = {
  candidate: ReferenceCopyCandidate;
  eligible: boolean;
  errors: string[];
  penalties: {
    genericCopyPenalty: number;
    duplicatePenalty: number;
    unsupportedClaimPenalty: number;
    templateCopyPenalty: number;
    categoryMismatchPenalty: number;
    clichéPenalty: number;
  };
};

export function validateReferenceCopyCandidate(input: {
  candidate: ReferenceCopyCandidate;
  truth: ProductTruth;
  evidenceAssignment?: ReferenceCopyEvidenceAssignment;
  comparisonCopies?: string[];
  siblingCopies?: string[];
}): ReferenceCopyCandidateValidation {
  const claimReview = reviewReferenceCopyClaims({ text: input.candidate.fullCopy, truth: input.truth, coreFactIds: input.candidate.coreFactIds });
  const rawGenericPenalty = genericImageCopyPenalty(input.candidate.fullCopy);
  const concreteContext = hasConcreteProductContext(input.candidate, input.truth);
  const genericCopyPenalty = concreteContext ? Math.ceil(rawGenericPenalty * 0.3) : rawGenericPenalty;
  const comparisonCopies = (input.comparisonCopies || []).filter(Boolean);
  const siblingCopies = (input.siblingCopies || []).filter(Boolean);
  const templateCopyMatches = comparisonCopies.filter((copy) => isReferenceCopySemanticDuplicate(input.candidate.fullCopy, copy, 0.62));
  const duplicateMatches = siblingCopies.filter((copy) => isReferenceCopySemanticDuplicate(input.candidate.fullCopy, copy, 0.78));
  const categoryErrors = categoryMismatchErrors(input.candidate.fullCopy, input.truth);
  const naturalnessErrors = incompleteErrors(input.candidate);
  const repeatedErrors = repeatedBlockErrors(input.candidate, input.truth);
  const assignment = input.evidenceAssignment;
  const assignedFact = assignment?.primaryFactId ? input.truth.facts.find((fact) => fact.id === assignment.primaryFactId) : undefined;
  const assignedFactLinked = !assignment?.primaryFactId || input.candidate.coreFactIds.includes(assignment.primaryFactId);
  const assignedBlockLinked = !assignment?.primaryFactId || input.candidate.copyBlocks.some((block) => block.coreFactIds.includes(assignment.primaryFactId));
  const assignedFactVisible = !assignment?.primaryFactId || candidateReflectsAssignedFact(input.candidate, assignedFact);
  const leadCopy = input.candidate.copyBlocks.filter((block) => block.role === "headline" || block.role === "support").map((block) => block.text).join(" ");
  const scentLedAgainstAssignment = Boolean(assignment && !assignment.sensoryLed && /향|향기|프루티|시트러스|아로마|기분\s*전환/u.test(leadCopy) && !assignedFactVisible);
  const errors = [
    ...claimReview.errors,
    ...categoryErrors,
    ...naturalnessErrors,
    ...repeatedErrors,
    ...(!assignedFactLinked ? [`서버가 배정한 중심 상품 근거(${assignment?.primaryFactId})가 후보 coreFactIds에 없습니다.`] : []),
    ...(!assignedBlockLinked ? [`서버가 배정한 중심 상품 근거(${assignment?.primaryFactId})가 실제 문구 블록에 연결되지 않았습니다.`] : []),
    ...(!assignedFactVisible ? [`서버가 배정한 중심 상품 근거(${assignment?.primaryFactId})의 실제 내용이 문구에 드러나지 않습니다.`] : []),
    ...(scentLedAgainstAssignment ? ["향이 아닌 근거가 배정된 소재를 향·기분 전환 중심 문구로 바꿨습니다."] : []),
    ...(rawGenericPenalty >= 18 && !concreteContext ? ["구체적인 상품 맥락 없이 범용 AI 광고 문구가 포함됐습니다."] : []),
    ...(templateCopyMatches.length ? ["사용자 예문 또는 레퍼런스 문장을 명사·조사만 바꿔 재사용했습니다."] : []),
    ...(duplicateMatches.length ? ["다른 후보와 의미가 지나치게 유사합니다."] : []),
    ...(!input.candidate.productDifferenceReason.trim() ? ["현재 상품의 차이를 설명하는 선택 이유가 없습니다."] : []),
    ...(!input.candidate.copyBlocks.some((block) => block.role === "headline" && block.text.trim()) ? ["헤드라인 블록이 없습니다."] : []),
  ];
  const updated: ReferenceCopyCandidate = {
    ...input.candidate,
    claimModes: claimReview.claimModes,
    copyRiskFlags: [...new Set([...input.candidate.copyRiskFlags, ...claimReview.copyRiskFlags])],
    copyReviewRequired: input.candidate.copyReviewRequired || claimReview.copyReviewRequired,
    safeAlternative: input.candidate.safeAlternative || claimReview.safeAlternative,
    rejectionReasons: [...new Set(errors)],
  };
  return {
    candidate: updated,
    eligible: errors.length === 0,
    errors: [...new Set(errors)],
    penalties: {
      genericCopyPenalty,
      duplicatePenalty: duplicateMatches.length * 30,
      unsupportedClaimPenalty: claimReview.errors.length * 100,
      templateCopyPenalty: templateCopyMatches.length * 40,
      categoryMismatchPenalty: categoryErrors.length * 100,
      clichéPenalty: /(?:최고|완벽|프리미엄|특별|혁신|놀라운)/u.test(input.candidate.fullCopy) ? 8 : 0,
    },
  };
}

export function deduplicateReferenceCopyCandidates(candidates: ReferenceCopyCandidate[], comparisonCopies: string[] = []) {
  const accepted: ReferenceCopyCandidate[] = [];
  for (const candidate of candidates) {
    if (comparisonCopies.some((copy) => isReferenceCopySemanticDuplicate(candidate.fullCopy, copy, 0.62))) continue;
    if (accepted.some((other) => isReferenceCopySemanticDuplicate(candidate.fullCopy, other.fullCopy, 0.78))) continue;
    accepted.push(candidate);
  }
  return accepted;
}
