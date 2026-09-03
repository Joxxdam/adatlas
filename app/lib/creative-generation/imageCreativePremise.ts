import { resolveProductCopyDomain } from "./productCopySemantics.ts";
import type { ImageCreativePremise, ImageCreativePremiseKind, ProductFact, ProductTruth } from "./types.ts";

export const IMAGE_CREATIVE_PREMISE_POLICY_VERSION = "image-creative-premise-v2" as const;

type PremiseReference = {
  id: string;
  layoutFamily: string;
  compositionType?: string;
  photographyType?: string;
  nativeCopy?: { rawText?: string; rawLines?: string[] };
};

const currentPremiseKinds: ImageCreativePremiseKind[] = [
  "everyday-question-answer",
  "everyday-relationship",
  "obvious-ad-metaphor",
  "usp-focus",
  "comparison-benefit",
];

function referenceText(reference: PremiseReference) {
  return [
    reference.layoutFamily,
    reference.compositionType,
    reference.photographyType,
    reference.nativeCopy?.rawText,
    ...(reference.nativeCopy?.rawLines || []),
  ].filter(Boolean).join(" ").toLowerCase();
}

function referenceCopyText(reference: PremiseReference) {
  return [reference.nativeCopy?.rawText, ...(reference.nativeCopy?.rawLines || [])].filter(Boolean).join(" ").toLowerCase();
}

function referenceSupportsComparison(reference: PremiseReference) {
  return /compare|comparison|versus|\bvs\b|split|problem|objection|before.?after|대결|비교|전후/u.test(referenceText(reference));
}

function referenceSupportsEverydayRelationship(reference: PremiseReference) {
  return /울\s*(?:아버지|엄마)|우리\s*(?:아버지|엄마|가족|집)|아버지|아빠|엄마|어머니|남편|아내|아이|식구|가족|퇴근한\s*나/u.test(referenceCopyText(reference));
}

function referenceUsesQuestion(reference: PremiseReference) {
  return /[?？]|(?:나요|까요|어때요|뭐\s|왜\s|언제\s|어디서)/u.test(referenceCopyText(reference));
}

function referenceUsesObviousMetaphor(reference: PremiseReference) {
  return /임금|왕도|수라상|주인공|반칙|레전드|끝판왕|미쳤|천국|신이\s*내린/u.test(referenceCopyText(reference));
}

/**
 * 역할 수를 먼저 맞추지 않는다. 선택된 레퍼런스가 실제로 사용하는 수사
 * 장치를 따라가며, 특별한 장치가 없으면 한 가지 검증 USP에 집중한다.
 */
function kindForReference(reference: PremiseReference): ImageCreativePremiseKind {
  if (referenceSupportsComparison(reference)) return "comparison-benefit";
  if (referenceUsesQuestion(reference)) return "everyday-question-answer";
  if (referenceSupportsEverydayRelationship(reference)) return "everyday-relationship";
  if (referenceUsesObviousMetaphor(reference)) return "obvious-ad-metaphor";
  return "usp-focus";
}

function usablePremiseFacts(truth: ProductTruth) {
  const priority = (fact: ProductFact) =>
    fact.evidenceType === "usp" ? 100 :
      fact.evidenceType === "ingredient" ? 92 :
        fact.evidenceType === "composition" ? 88 :
          fact.evidenceType === "usage" ? 84 :
            fact.evidenceType === "quantity" ? 76 :
              fact.evidenceType === "price" || fact.evidenceType === "offer" ? 68 : 50;
  return truth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified" && fact.copyEligibility !== "blocked")
    .filter((fact) => !["shipping", "merchant-proof"].includes(fact.evidenceType || ""))
    .filter((fact) => !/배송|출고|도착|택배|판매원|고객센터|교환|환불|양해/u.test(fact.value))
    .sort((left, right) => priority(right) - priority(left));
}

function productIdentity(truth: ProductTruth) {
  return String(truth.normalized.baseProductName || truth.normalized.cleanProductName || truth.product.productName || "이 상품").trim();
}

function categoryPremiseParts(truth: ProductTruth, kind: ImageCreativePremiseKind) {
  const identity = productIdentity(truth);
  const domain = resolveProductCopyDomain(truth.product);
  const context = [truth.product.productName, truth.product.category, truth.product.productSubCategory, truth.product.detectedProductType]
    .filter(Boolean).join(" ").toLowerCase();
  const meat = /고기|갈비|한우|소고기|돼지|육류|정육|meat|beef|pork/u.test(context);

  const category = domain === "snack" ? {
    relation: "간식만 꺼내면 같이 모이는 우리 가족",
    relationSituation: "출출한 오후나 주말에 자연스럽게 권하는 순간",
    question: "오늘 간식은 또 뭘 먹을까요?",
    answer: "오늘은 이 간식으로 골라요",
    metaphor: "오늘 간식 시간의 주인공",
  } : domain === "food" && meat ? {
    relation: "고기 없으면 서운한 울 아버지",
    relationSituation: "밥상이나 가족 식사에서 고기를 찾는 익숙한 순간",
    question: "고기 사러 멀리 가세요?",
    answer: "오늘은 집에서 편하게 고르자는 짧은 대답",
    metaphor: "임금님 수라상도 부럽지 않은 한우 한 상",
  } : domain === "food" ? {
    relation: "오늘 메뉴를 함께 고민하는 우리 가족",
    relationSituation: "퇴근 뒤 저녁 메뉴를 정하거나 한 끼를 준비하는 순간",
    question: "오늘 저녁은 또 뭘 먹을까요?",
    answer: "오늘은 이 메뉴로 골라요",
    metaphor: "오늘 식탁의 진짜 주인공",
  } : domain === "personal-care" || domain === "beauty" ? {
    relation: "바쁜 하루 끝에 나부터 챙기고 싶은 사람",
    relationSituation: "아침 준비나 퇴근 뒤 짧게 루틴을 챙기는 순간",
    question: "매일 쓰는 제품, 아무거나 고르세요?",
    answer: "오늘 루틴에는 이걸 골라보세요",
    metaphor: "평범한 루틴을 바꾸는 오늘의 한 수",
  } : {
    relation: "매일 쓰는 물건은 꼼꼼히 고르는 우리 집",
    relationSituation: "비슷한 상품 사이에서 실제 쓸 이유를 고르는 순간",
    question: "매일 쓸 건데 아무거나 고르세요?",
    answer: "오늘은 확인된 장점부터 골라요",
    metaphor: "오늘 일상의 숨은 주인공",
  };

  if (kind === "everyday-question-answer") return {
    character: "상품을 고르는 평범한 소비자",
    situation: category.question,
    tension: category.answer,
  };
  if (kind === "everyday-relationship") return {
    character: category.relation,
    situation: category.relationSituation,
    tension: "설명하지 않아도 바로 이해되는 생활 장면 하나",
  };
  if (kind === "obvious-ad-metaphor") return {
    character: "누가 들어도 비유로 이해되는 짧은 광고 화자",
    situation: category.metaphor,
    tension: "실제 이력·인증·후기로 오해되지 않는 한 줄 과장",
  };
  if (kind === "comparison-benefit") return {
    character: "현재 상품을 고르는 소비자",
    situation: "이름 없는 일반 대안과 현재 상품의 확인된 차이를 바로 고르는 순간",
    tension: "경쟁사 비방이나 근거 없는 우월 표현 없이 구매 이유를 답하는 비교",
  };
  return {
    character: "현재 상품을 처음 보는 소비자",
    situation: `${identity}의 확인된 장점 하나를 소비자 말투로 이해하는 순간`,
    tension: "상품정보를 나열하지 않고 지금 볼 이유 하나만 짧게 전달",
  };
}

export function buildImageCreativePremiseSeed(truth: ProductTruth, reference: PremiseReference, index: number, assignedKind?: ImageCreativePremiseKind): ImageCreativePremise {
  const requestedKind = assignedKind || kindForReference(reference);
  const kind = currentPremiseKinds.includes(requestedKind) ? requestedKind : kindForReference(reference);
  const facts = usablePremiseFacts(truth);
  const selectedFacts = [facts[index % Math.max(1, facts.length)], facts[(index + 1) % Math.max(1, facts.length)]]
    .filter((fact): fact is ProductFact => Boolean(fact))
    .filter((fact, factIndex, all) => all.findIndex((candidate) => candidate.id === fact.id) === factIndex)
    .slice(0, 2);
  const parts = categoryPremiseParts(truth, kind);
  return {
    policyVersion: IMAGE_CREATIVE_PREMISE_POLICY_VERSION,
    kind,
    fictionalContext: true,
    ...parts,
    productBridge: selectedFacts[0]?.value || `${productIdentity(truth)}의 확인된 상품 특성`,
    supportingFactIds: selectedFacts.map((fact) => fact.id),
    factBoundary: "생활 장면과 명백한 광고 비유는 창작 맥락이며, 상품 속성·수치·가격·구성·후기는 supportingFactIds의 검증된 ProductTruth만 사용한다.",
  };
}

export function buildImageCreativePremiseSeeds(truth: ProductTruth, references: PremiseReference[]) {
  return references.map((reference, index) => buildImageCreativePremiseSeed(truth, reference, index));
}

export function findImageCreativePremiseErrors(premise: ImageCreativePremise | undefined, truth?: ProductTruth) {
  if (!premise) return ["최신 생활밀착형 CreativePremise가 없습니다."];
  const errors: string[] = [];
  if (premise.policyVersion !== IMAGE_CREATIVE_PREMISE_POLICY_VERSION) errors.push("CreativePremise 정책 버전이 최신이 아닙니다.");
  if (!currentPremiseKinds.includes(premise.kind)) errors.push("CreativePremise 역할이 올바르지 않습니다.");
  if (premise.fictionalContext !== true) errors.push("생활 장면·비유를 광고용 창작 맥락으로 분리하지 않았습니다.");
  for (const [label, value] of [["화자", premise.character], ["상황", premise.situation], ["긴장", premise.tension], ["상품 연결", premise.productBridge]] as const) {
    if (!String(value || "").trim()) errors.push(`CreativePremise ${label}이 비어 있습니다.`);
  }
  const contextCopy = [premise.character, premise.situation, premise.tension].join(" ");
  if (/알레르기|질병|환자|치료|완치|의사|전문의|약사|실제\s*(?:고객|구매자|후기)|임상/u.test(contextCopy)) {
    errors.push("의료 사실·전문가 보증·실제 고객 증언처럼 오인될 CreativePremise를 사용할 수 없습니다.");
  }
  if (!/창작|비유/u.test(premise.factBoundary) || !/ProductTruth|상품\s*(?:사실|속성)|검증/u.test(premise.factBoundary)) {
    errors.push("CreativePremise의 창작 맥락과 상품 사실 경계가 명시되지 않았습니다.");
  }
  if (truth) {
    const facts = new Map(truth.facts.map((fact) => [fact.id, fact]));
    if (!premise.supportingFactIds.length) errors.push("CreativePremise에 연결된 ProductTruth 근거가 없습니다.");
    for (const factId of premise.supportingFactIds) {
      const fact = facts.get(factId);
      if (!fact) errors.push(`존재하지 않는 CreativePremise ProductTruth fact id: ${factId}`);
      else if (!fact.usableInCopy || fact.copyEligibility === "blocked" || fact.verification === "unverified" || ["shipping", "merchant-proof"].includes(fact.evidenceType || "")) {
        errors.push(`CreativePremise에 사용할 수 없는 ProductTruth fact id: ${factId}`);
      }
    }
  }
  return [...new Set(errors)];
}

const planningRoleCopyPattern = /수라간\s*감별관|상품\s*큐레이터|욕실\s*집사|구매\s*담당|선택\s*담당|저녁밥\s*총무|메뉴\s*총무|간식\s*담당|메이크업\s*담당|집안의\s*(?:고기|선택)\s*담당/u;
const familiarEverydayCuePattern = /울\s*(?:아버지|엄마)|우리\s*(?:아버지|엄마|가족|집)|아버지|아빠|엄마|어머니|남편|아내|아이|식구|가족|퇴근|출근|아침|저녁|주말|집에서|밥상|식탁|명절|선물(?:을|은|로|할|할까|고민|챙|드리)/u;
const obviousMetaphorPattern = /임금님|왕도|수라상|주인공|반칙|레전드|끝판왕|천국|신이\s*내린|못\s*지나칠/u;
const productBridgeStopWords = new Set(["상품", "제품", "현재", "확인된", "검증된", "특징", "특성", "구성", "사용", "선택", "이유", "한가지"]);

function copyContainsProductBridge(copy: string, bridge: string) {
  const compactCopy = copy.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const compactBridge = bridge.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (compactBridge.length >= 3 && compactCopy.includes(compactBridge)) return true;
  const tokens = bridge.normalize("NFKC")
    .replace(/[^가-힣A-Za-z0-9]+/gu, " ")
    .split(/\s+/u)
    .map((token) => token.replace(/(?:으로|에서|부터|까지|처럼|보다|에게|한테|의|은|는|이|가|을|를|에|와|과)$/u, "").toLowerCase())
    .filter((token) => token.length >= 2 && !productBridgeStopWords.has(token));
  return tokens.some((token) => compactCopy.includes(token));
}

/** 짧은 생활 문구를 과설정 seed 단어에 억지로 맞추지 않는다. */
export function findImageCreativePremiseCopyErrors(premise: ImageCreativePremise | undefined, copy: string) {
  if (!premise) return ["최신 CreativePremise를 최종 문구에서 확인할 수 없습니다."];
  const normalizedCopy = String(copy || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalizedCopy) return ["CreativePremise를 표현할 최종 문구가 비어 있습니다."];

  const errors: string[] = [];
  if (planningRoleCopyPattern.test(normalizedCopy)) errors.push("소비자 문구에 과도한 직업·세계관형 기획 인물이 노출됐습니다.");

  if (premise.kind === "everyday-question-answer") {
    if (!/[?？]/u.test(normalizedCopy)) errors.push("생활 질문이 최종 문구에 드러나지 않습니다.");
  } else if (premise.kind === "everyday-relationship") {
    if (!familiarEverydayCuePattern.test(normalizedCopy)) errors.push("익숙한 관계 또는 생활 장면이 최종 문구에 드러나지 않습니다.");
  } else if (premise.kind === "obvious-ad-metaphor") {
    if (!obviousMetaphorPattern.test(normalizedCopy)) errors.push("사실 주장과 구분되는 짧고 명백한 광고 비유가 드러나지 않습니다.");
  } else if (premise.kind === "comparison-benefit") {
    const comparisonVisible = /(?:일반|평범|다른|비슷|대안|대신|반면|보다|아쉬|비싸|허전|빠진|VS|브이에스)/iu.test(normalizedCopy);
    if (!comparisonVisible || !copyContainsProductBridge(normalizedCopy, premise.productBridge)) errors.push("익명 일반 대안과 현재 상품 이점의 비교 관계가 최종 문구에 드러나지 않습니다.");
  } else if (premise.kind === "usp-focus") {
    if (!copyContainsProductBridge(normalizedCopy, premise.productBridge)) errors.push("배정된 한 가지 상품 USP가 최종 문구의 중심으로 드러나지 않습니다.");
  }

  return [...new Set(errors)];
}

export function normalizeImageCreativePremise(raw: ImageCreativePremise | undefined, seed: ImageCreativePremise, truth: ProductTruth) {
  const requestedKind = raw?.kind;
  const kind = requestedKind && currentPremiseKinds.includes(requestedKind) ? requestedKind : seed.kind;
  const candidate: ImageCreativePremise = {
    policyVersion: IMAGE_CREATIVE_PREMISE_POLICY_VERSION,
    kind,
    fictionalContext: true,
    character: String(raw?.character || seed.character).trim(),
    situation: String(raw?.situation || seed.situation).trim(),
    tension: String(raw?.tension || seed.tension).trim(),
    // 표현 역할은 레퍼런스에 맞게 고를 수 있지만 상품 사실 연결은 서버가 잠근다.
    productBridge: seed.productBridge,
    supportingFactIds: seed.supportingFactIds,
    factBoundary: seed.factBoundary,
  };
  return findImageCreativePremiseErrors(candidate, truth).length ? seed : candidate;
}

export function isCurrentImageCreativePremise(premise: ImageCreativePremise | undefined) {
  return Boolean(premise && premise.policyVersion === IMAGE_CREATIVE_PREMISE_POLICY_VERSION && premise.fictionalContext === true && !findImageCreativePremiseErrors(premise).length);
}

/** 새 작업은 여섯 개가 모두 v2이면 충분하며 특정 역할별 장수를 강제하지 않는다. */
export function hasCurrentImageCreativePremiseSet(premises: Array<ImageCreativePremise | undefined>) {
  return premises.length === 6 && premises.every(isCurrentImageCreativePremise);
}

/** 과거 import 이름과 개발 서버 캐시 호환용 별칭입니다. */
export const hasCurrentImageCreativePremiseDistribution = hasCurrentImageCreativePremiseSet;
