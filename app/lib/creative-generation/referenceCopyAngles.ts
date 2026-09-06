import type { NativeAdReference } from "./referenceCreativeLibrary.server.ts";
import type { CreativeAngle, ImageCreativePremise, ProductFact, ProductTruth, ReferenceCopyClaimMode, ReferenceCopyEvidenceAssignment, ReferenceCopyEvidenceDimension, ReferenceCopyHookIdea } from "./types.ts";
import { isSafeMinimalFactCandidate, isSafeMinimalOfferFact } from "./referenceCopySafeMinimal.ts";

const PRICE_ANGLES = new Set<CreativeAngle>(["price-shock", "insider-secret"]);

function productContext(truth: ProductTruth) {
  return [truth.product.productName, truth.product.category, truth.product.productSubCategory, truth.product.detectedProductType, truth.normalized.category]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function usableFacts(truth: ProductTruth) {
  const merchantNames = [truth.product.advertiserName, truth.product.brandName, truth.normalized.brandName].filter(Boolean) as string[];
  return truth.facts.filter((fact) =>
    fact.evidenceType !== "shipping" &&
    (isSafeMinimalFactCandidate(fact, merchantNames) || isSafeMinimalOfferFact(fact))
  );
}

export function hasVerifiedPriceFact(truth: ProductTruth) {
  const verifiedPrice = String(truth.normalized.price || truth.product.price || "").replace(/\s+/g, "").trim();
  if (!verifiedPrice) return false;
  // 상세 이미지 OCR의 동일 판매가가 먼저 들어오면 값 중복 제거 과정에서
  // 구조화 price fact 대신 offer fact가 남을 수 있습니다. 타입명이 아니라
  // 실제 확정 판매가 토큰과 사용 가능한 근거가 일치하는지를 확인합니다.
  return usableFacts(truth).some((fact) =>
    ["price", "offer"].includes(fact.evidenceType || "") &&
    fact.value.replace(/\s+/g, "").includes(verifiedPrice)
  );
}

export function hasVerifiedSensoryFact(truth: ProductTruth) {
  return usableFacts(truth).some((fact) => /육즙|식감|향|거품|질감|쿨링|온도|바삭|쫀득|부드러|촉촉|상쾌|산뜻|풍미|맛/u.test(`${fact.label} ${fact.value}`));
}

export function availableCreativeAngles(truth: ProductTruth): CreativeAngle[] {
  const context = productContext(truth);
  const facts = usableFacts(truth);
  const food = /식품|음식|간식|고기|한우|육류|food|snack|meat|beef/u.test(context);
  const personalCare = /화장품|뷰티|샤워|바디|세럼|크림|로션|beauty|personal/u.test(context);
  const hasSpecificUsp = facts.some((fact) => ["usp", "ingredient", "composition", "quantity", "numeric", "usage"].includes(fact.evidenceType || "") && fact.key !== "base-product-name");
  const hasUsage = Boolean(truth.normalized.usageOccasions.length || truth.normalized.useSituations.length) || facts.some((fact) => fact.evidenceType === "usage");
  const angles: CreativeAngle[] = [];
  if (hasVerifiedPriceFact(truth)) angles.push("price-shock", "insider-secret");
  if (hasVerifiedSensoryFact(truth)) angles.push("sensory-explosion");
  if (hasSpecificUsp) angles.push("concrete-usp-discovery", "expectation-reversal");
  angles.push("alternative-rebuttal", "purchase-twist", "problem-callout", "usage-moment", "meme-reaction", "category-replacement");
  if (food || personalCare) angles.push("family-reaction", "stock-up-scene", "social-reaction");
  if (hasUsage) angles.unshift("usage-moment");
  return [...new Set(angles)];
}

export function referenceRhetoricalMechanism(reference: NativeAdReference | undefined) {
  const raw = reference?.nativeCopy?.rawText || "";
  const layout = `${reference?.layoutFamily || ""} ${reference?.compositionType || ""}`.toLowerCase();
  if (/compare|versus|before-after|comparison/.test(layout)) return "비교 → 결론";
  if (/chat|review|dialogue/.test(layout)) return "대화 → 반응";
  if (/(?:아들|딸|남자친구|여자친구|남편|아내|와이프|여보|엄마|아빠)/u.test(raw)) return "관계 문제 → 반응 → 해결";
  if (/(?:선수|전문가|인증|점유율|카테고리\s*1위|추천)/u.test(raw)) return "권위·증거 → 문제 해결";
  if (/\d/u.test(raw) && /(?:한\s*통|한\s*병|이\s*안에|이\s*한통|개가|장이|방울|초\s*만에)/u.test(raw)) return "숫자 놀람 → 상품 근거";
  if (/problem|objection/.test(layout)) return "문제 → 해결";
  if (/\?/u.test(raw)) return "질문 → 대답";
  if (/하지만|그런데|알고 보니|오히려/u.test(raw)) return "예상 → 반전";
  if (/!|ㅋㅋ|;;|\.\./u.test(raw)) return "감탄 → 구매 이유";
  if (/price|offer|proof|data/.test(layout)) return "근거 → 반응";
  return "경험 → 반응";
}

function normalizedFactText(fact: ProductFact) {
  return `${fact.key} ${fact.label} ${fact.value}`.normalize("NFKC").toLowerCase();
}

export function referenceCopyEvidenceDimensionForFact(fact: ProductFact): ReferenceCopyEvidenceDimension {
  const text = normalizedFactText(fact);
  if (["price", "offer"].includes(fact.evidenceType || "")) return "offer";
  if (fact.evidenceType === "certification" || /비건|peta|인증|크루얼티/u.test(text)) return "certification";
  if (fact.evidenceType === "usage" || fact.evidenceType === "target" || /운동\s*후|퇴근\s*후|무더운|아침\s*샤워|사용\s*상황|필요한\s*순간/u.test(text)) return "usage-problem";
  if (/냉압착|증류|추출\s*방식|수확[^.!?]{0,20}(?:바로|직후)|공정|제조\s*방식/u.test(text)) return "process";
  if (/거품|제형|젤\s*타입|쿠션감|보습막|마무리감|펴\s*발/u.test(text)) return "texture";
  if (["numeric", "quantity", "composition"].includes(fact.evidenceType || "")) return "numeric-proof";
  if (/향|향기|프루티|시트러스|아로마|발향/u.test(text)) return "sensory";
  if (/\d/u.test(fact.value)) return "numeric-proof";
  if (/산맥|민트\s*벨트|시칠리아|멕시코|페루|아프리카|자란|손으로\s*수확|희소\s*원료|원료\s*스토리/u.test(text)) return "ingredient-provenance";
  if (fact.evidenceType === "ingredient" || fact.evidenceType === "usp") return "product-usp";
  return "product-usp";
}

function isOriginalSourceProduct(truth: ProductTruth) {
  return /오리지널\s*소스|original\s*source|originalsource/u.test([
    truth.product.advertiserName,
    truth.product.brandName,
    truth.product.productName,
    truth.product.landingUrl,
  ].filter(Boolean).join(" ").toLowerCase());
}

function assignmentCompatibility(mechanism: string, dimension: ReferenceCopyEvidenceDimension) {
  if (/숫자 놀람|근거 → 반응|질문 → 대답/u.test(mechanism) && dimension === "numeric-proof") return 70;
  if (/권위·증거/u.test(mechanism) && ["certification", "ingredient-provenance", "process", "numeric-proof"].includes(dimension)) return 60;
  if (/관계 문제|문제 → 해결/u.test(mechanism) && ["usage-problem", "texture", "product-usp"].includes(dimension)) return 55;
  if (/비교 → 결론|예상 → 반전/u.test(mechanism) && ["process", "texture", "ingredient-provenance", "product-usp"].includes(dimension)) return 45;
  if (/감탄 → 구매 이유/u.test(mechanism) && ["numeric-proof", "ingredient-provenance", "texture", "process"].includes(dimension)) return 35;
  return 0;
}

const NON_SENSORY_DIMENSION_PRIORITY: ReferenceCopyEvidenceDimension[] = [
  "numeric-proof",
  "ingredient-provenance",
  "process",
  "texture",
  "usage-problem",
  "certification",
  "product-usp",
  "offer",
];

/**
 * 레퍼런스 여섯 장을 고른 뒤 각 광고가 사용할 중심 상품 근거를 먼저 고정한다.
 * 특히 오리지널소스는 조사자료의 수치·원료·공정·제형·사용 상황을 향보다
 * 우선하며, 같은 상품 fact를 여섯 장에 반복 배정하지 않는다.
 */
export function buildReferenceCopyEvidenceAssignments(truth: ProductTruth, references: NativeAdReference[]): ReferenceCopyEvidenceAssignment[] {
  const merchantNames = [truth.product.advertiserName, truth.product.brandName, truth.normalized.brandName]
    .map((value) => String(value || "").replace(/\s+/g, "").toLowerCase())
    .filter((value) => value.length >= 2);
  const facts = usableFacts(truth).filter((fact) =>
    !["identity", "shipping", "merchant-proof"].includes(fact.evidenceType || "") &&
    fact.copyEligibility !== "identityOnly" &&
    fact.key !== "base-product-name" &&
    fact.value.trim() &&
    !/^(?:향|사용감|제품|상품|구성|원료)$/u.test(fact.value.trim()) &&
    !/(?:리뷰|후기)\s*$/u.test(fact.value.trim()) &&
    !merchantNames.some((name) => fact.value.replace(/\s+/g, "").toLowerCase().includes(name))
  );
  const originalSource = isOriginalSourceProduct(truth);
  const sensoryCap = originalSource ? 1 : 2;
  const availableNonSensoryDimensions = new Set(facts.map(referenceCopyEvidenceDimensionForFact).filter((dimension) => dimension !== "sensory"));
  const requiredNonSensoryCoverage = Math.min(4, availableNonSensoryDimensions.size);
  const usedFactIds = new Set<string>();
  const dimensionCounts = new Map<ReferenceCopyEvidenceDimension, number>();
  let sensoryCount = 0;

  return references.map((reference, index) => {
    const referenceMechanism = referenceRhetoricalMechanism(reference);
    const unusedFacts = facts.filter((fact) => !usedFactIds.has(fact.id));
    const nonSensoryUnused = unusedFacts.filter((fact) => referenceCopyEvidenceDimensionForFact(fact) !== "sensory");
    const uncoveredNonSensory = nonSensoryUnused.filter((fact) => !dimensionCounts.has(referenceCopyEvidenceDimensionForFact(fact)));
    const mustCoverAnotherDimension = originalSource && [...dimensionCounts.keys()].filter((dimension) => dimension !== "sensory").length < requiredNonSensoryCoverage;
    const preferredNonSensory = mustCoverAnotherDimension && uncoveredNonSensory.length ? uncoveredNonSensory : nonSensoryUnused;
    const eligibleFacts = preferredNonSensory.length
      ? preferredNonSensory
      : unusedFacts.filter((fact) => sensoryCount < sensoryCap || referenceCopyEvidenceDimensionForFact(fact) !== "sensory");
    const pool = eligibleFacts.length ? eligibleFacts : facts.filter((fact) => sensoryCount < sensoryCap || referenceCopyEvidenceDimensionForFact(fact) !== "sensory");
    const ranked = [...pool].sort((left, right) => {
      const score = (fact: ProductFact) => {
        const dimension = referenceCopyEvidenceDimensionForFact(fact);
        const dimensionPriority = NON_SENSORY_DIMENSION_PRIORITY.indexOf(dimension);
        return assignmentCompatibility(referenceMechanism, dimension) +
          (fact.source === "vendor-research" ? 35 : 0) +
          (fact.copyEligibility === "headlineEligible" ? 8 : 0) +
          (dimension === "sensory" ? (originalSource ? -180 : -25) : 30) -
          (dimensionCounts.get(dimension) || 0) * 28 -
          (dimensionPriority >= 0 ? dimensionPriority : NON_SENSORY_DIMENSION_PRIORITY.length) * 2;
      };
      return score(right) - score(left) || (right.specificity || 0) - (left.specificity || 0) || left.id.localeCompare(right.id);
    });
    const primary = ranked[0] || facts[index % Math.max(1, facts.length)];
    const evidenceDimension = primary ? referenceCopyEvidenceDimensionForFact(primary) : "product-usp";
    if (primary) usedFactIds.add(primary.id);
    dimensionCounts.set(evidenceDimension, (dimensionCounts.get(evidenceDimension) || 0) + 1);
    if (evidenceDimension === "sensory") sensoryCount += 1;
    const supportingFactIds = facts
      .filter((fact) => fact.id !== primary?.id && !usedFactIds.has(fact.id))
      .filter((fact) => {
        const dimension = referenceCopyEvidenceDimensionForFact(fact);
        if (originalSource && evidenceDimension !== "sensory" && dimension === "sensory") return false;
        if (evidenceDimension === "numeric-proof") return ["ingredient-provenance", "process", "product-usp"].includes(dimension);
        if (evidenceDimension === "usage-problem") return ["texture", "numeric-proof", "product-usp"].includes(dimension);
        if (evidenceDimension === "ingredient-provenance") return ["process", "numeric-proof", "product-usp"].includes(dimension);
        return dimension !== "sensory" || sensoryCount < sensoryCap;
      })
      .slice(0, 2)
      .map((fact) => fact.id);
    return {
      referenceId: reference.id,
      referenceMechanism,
      primaryFactId: primary?.id || "",
      supportingFactIds,
      evidenceDimension,
      sensoryLed: evidenceDimension === "sensory",
      assignmentReason: `${referenceMechanism} 수사에 ${evidenceDimension} 상품 근거를 배정했습니다.`,
    };
  });
}

export function alignPremiseSeedsToEvidenceAssignments(truth: ProductTruth, premiseSeeds: ImageCreativePremise[], assignments: ReferenceCopyEvidenceAssignment[]) {
  const facts = new Map(truth.facts.map((fact) => [fact.id, fact]));
  return premiseSeeds.map((premise, index) => {
    const assignment = assignments[index];
    const primary = assignment ? facts.get(assignment.primaryFactId) : undefined;
    if (!assignment || !primary) return premise;
    const supportingFactIds = [assignment.primaryFactId, ...assignment.supportingFactIds].filter((id, factIndex, ids) => facts.has(id) && ids.indexOf(id) === factIndex).slice(0, 3);
    return {
      ...premise,
      productBridge: primary.value,
      supportingFactIds,
      factBoundary: `${premise.factBoundary} 객관 주장은 ${supportingFactIds.join(", ")}의 검증된 ProductTruth 근거 안에서만 사용하고 ${assignment.evidenceDimension} 중심을 향 중심 문구로 바꾸지 않습니다.`,
    };
  });
}

function angleClaimMode(angle: CreativeAngle): ReferenceCopyClaimMode {
  if (angle === "family-reaction" || angle === "stock-up-scene" || angle === "usage-moment") return "lifestyle-scenario";
  if (angle === "insider-secret") return "dramatized-persona";
  if (["meme-reaction", "sensory-explosion", "purchase-twist", "category-replacement", "social-reaction", "expectation-reversal", "price-shock"].includes(angle)) return "subjective-reaction";
  return "obvious-puffery";
}

function factPriority(fact: ProductFact) {
  if (["usp", "ingredient", "composition", "usage"].includes(fact.evidenceType || "")) return 5;
  if (["quantity", "numeric"].includes(fact.evidenceType || "")) return 4;
  if (["price", "offer"].includes(fact.evidenceType || "")) return 3;
  if (fact.evidenceType === "identity") return 1;
  return 2;
}

function factBridge(fact: ProductFact | undefined, truth: ProductTruth) {
  return fact?.value || truth.normalized.verifiedDescriptor || truth.normalized.baseProductName || truth.product.productName;
}

const ANGLE_IDEA_PARTS: Record<CreativeAngle, { situations: string[]; tensions: string[]; reactions: string[] }> = {
  "price-shock": { situations: ["가격표를 처음 본 순간", "장바구니에 담기 전 가격을 다시 보는 순간"], tensions: ["예상한 가격과 실제 판매가의 간극", "구성과 가격을 함께 따져보는 망설임"], reactions: ["숫자를 다시 확인하는 놀람", "구매 이유가 선명해지는 반응"] },
  "family-reaction": { situations: ["가족이 함께 먹거나 쓰는 저녁", "주말에 같이 모이는 순간"], tensions: ["누구나 만족할 선택을 고르는 고민", "한 번 꺼냈다가 금방 비는 상황"], reactions: ["먼저 손이 가는 생활 반응", "다음 몫을 챙기고 싶어지는 반응"] },
  "alternative-rebuttal": { situations: ["늘 하던 구매 방식을 반복하려는 순간", "비슷한 상품 사이에서 비교하는 순간"], tensions: ["번거로운 선택을 계속해야 하는가", "겉보기만 비슷한 대안의 아쉬움"], reactions: ["기존 선택을 다시 묻는 한마디", "구체 차이를 보고 결론 내리는 반응"] },
  "meme-reaction": { situations: ["첫인상을 짧게 공유하는 순간", "친구에게 바로 보내고 싶은 순간"], tensions: ["설명보다 즉각적인 반응이 필요한 피드", "평범해 보였던 첫인상"], reactions: ["짧고 과감한 감탄", "댓글처럼 바로 이해되는 반응"] },
  "sensory-explosion": { situations: ["상품을 실제로 먹거나 쓰기 시작한 순간", "감각 차이가 가장 또렷한 순간"], tensions: ["익숙한 상품일 거라는 예상", "향·식감·질감이 약할 거라는 의심"], reactions: ["감각이 먼저 튀어나오는 감탄", "한 번에 차이를 알아채는 반응"] },
  "purchase-twist": { situations: ["한 가지 이유로 골랐다가 다른 장점을 발견한 순간", "가볍게 시도한 뒤 인상이 바뀐 순간"], tensions: ["구매 전 기대와 사용 후 만족의 차이", "처음 고른 이유만으로는 설명되지 않는 만족"], reactions: ["진짜 구매 이유를 뒤늦게 깨닫는 반전", "다음 사용 장면을 떠올리는 반응"] },
  "insider-secret": { situations: ["쉽게 지나치기 아까운 조건을 발견한 순간", "표시된 사실을 조용히 알려주는 장면"], tensions: ["아는 사람만 먼저 볼 것 같은 정보", "그냥 넘기기 아까운 구매 조건"], reactions: ["발견한 사람처럼 귀띔하는 반응", "공개된 사실을 비밀처럼 강조하는 반응"] },
  "stock-up-scene": { situations: ["보관 공간을 미리 비워두는 순간", "자주 쓰거나 먹을 몫을 챙기는 순간"], tensions: ["한 번 쓰고 끝내기 아쉬운 구성", "필요할 때 없으면 아쉬운 생활 장면"], reactions: ["다음 사용까지 준비하고 싶은 반응", "여유 있게 챙겨두는 만족"] },
  "category-replacement": { situations: ["늘 사던 같은 카테고리 상품을 고르는 순간", "다음 구매 후보를 떠올리는 순간"], tensions: ["기존 선택으로 돌아갈 이유가 있는가", "비슷한 대안이 다시 생각날까"], reactions: ["주관적으로 선택이 끝났다는 반응", "다른 대안이 잠시 잊히는 만족"] },
  "concrete-usp-discovery": { situations: ["구체 원료·방식·구성을 처음 확인한 순간", "숫자나 제조 정보를 자세히 보는 순간"], tensions: ["겉보기만으로 알 수 없던 차이", "구매 이유를 설명할 한 가지 근거"], reactions: ["구체 사실에서 오는 놀람", "차이를 발견한 납득"] },
  "problem-callout": { situations: ["반복되는 불편을 다시 마주한 순간", "구매 전에 가장 먼저 망설이는 순간"], tensions: ["익숙하지만 해결되지 않은 불편", "이 카테고리에서 자주 생기는 선택 고민"], reactions: ["내 얘기처럼 멈추는 질문", "상품 사실로 답을 찾는 반응"] },
  "usage-moment": { situations: ["하루 중 상품이 가장 필요한 순간", "실제로 꺼내 먹거나 사용하는 순간"], tensions: ["지금 무엇을 고를지 망설이는 상황", "사용 직전 기대와 실제 감각의 간극"], reactions: ["바로 써보고 싶어지는 반응", "생활 장면이 선명해지는 반응"] },
  "social-reaction": { situations: ["함께 있는 사람이 상품을 발견한 순간", "옆 사람이 자연스럽게 관심을 보이는 순간"], tensions: ["혼자만 알기 아까운 선택", "설명하지 않아도 시선이 모이는 장면"], reactions: ["주변의 관심을 생활 대화로 표현", "다 같이 손이 가는 반응"] },
  "expectation-reversal": { situations: ["평범할 거라 생각하고 시작한 순간", "익숙한 카테고리라는 선입견을 가진 순간"], tensions: ["예상했던 특징과 실제 차이", "첫인상만으로 지나칠 뻔한 장점"], reactions: ["예상을 뒤집는 한마디", "구체 차이를 뒤늦게 알아채는 반응"] },
};

/** LLM이 실패해도 상품마다 최소 20개의 서로 다른 내부 발상 재료를 제공합니다. */
export function generateReferenceCopyHookIdeas(truth: ProductTruth, references: NativeAdReference[] = [], minimum = 20): ReferenceCopyHookIdea[] {
  const facts = usableFacts(truth).sort((left, right) => factPriority(right) - factPriority(left));
  const available = availableCreativeAngles(truth);
  const ideas: ReferenceCopyHookIdea[] = [];
  let cursor = 0;
  while (ideas.length < Math.max(20, minimum)) {
    const angle = available[cursor % available.length];
    if (PRICE_ANGLES.has(angle) && !hasVerifiedPriceFact(truth)) {
      cursor += 1;
      continue;
    }
    const parts = ANGLE_IDEA_PARTS[angle];
    const fact = facts[cursor % Math.max(1, facts.length)];
    const reference = references[cursor % Math.max(1, references.length)];
    ideas.push({
      id: `hook-idea-${String(ideas.length + 1).padStart(2, "0")}`,
      creativeAngle: angle,
      consumerSituation: parts.situations[Math.floor(cursor / available.length) % parts.situations.length],
      tension: parts.tensions[(cursor + ideas.length) % parts.tensions.length],
      reaction: parts.reactions[(cursor + Math.floor(ideas.length / 2)) % parts.reactions.length],
      productBridge: factBridge(fact, truth),
      supportingFactIds: fact ? [fact.id] : [],
      referenceMechanism: referenceRhetoricalMechanism(reference),
      claimMode: angleClaimMode(angle),
    });
    cursor += 1;
  }
  return ideas;
}

export function assignCreativeAngles(truth: ProductTruth, references: NativeAdReference[], ideas = generateReferenceCopyHookIdeas(truth, references)) {
  const available = availableCreativeAngles(truth);
  const used = new Map<CreativeAngle, number>();
  return references.map((reference, index) => {
    const mechanism = referenceRhetoricalMechanism(reference);
    const ranked = ideas
      .filter((idea) => available.includes(idea.creativeAngle))
      .filter((idea) => idea.creativeAngle !== "price-shock" || (used.get("price-shock") || 0) < 2)
      .sort((left, right) => {
        const leftScore = (left.referenceMechanism === mechanism ? 20 : 0) - (used.get(left.creativeAngle) || 0) * 30;
        const rightScore = (right.referenceMechanism === mechanism ? 20 : 0) - (used.get(right.creativeAngle) || 0) * 30;
        return rightScore - leftScore;
      });
    const selected = ranked[0] || ideas[index % ideas.length];
    used.set(selected.creativeAngle, (used.get(selected.creativeAngle) || 0) + 1);
    return selected;
  });
}
