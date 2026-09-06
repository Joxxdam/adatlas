import type { ProductTruth, ReferenceAdaptedCopyPlan } from "./types.ts";
import { availableCreativeAngles, referenceCopyEvidenceDimensionForFact } from "./referenceCopyAngles.ts";

function planText(plan: ReferenceAdaptedCopyPlan) {
  return [plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].filter(Boolean).join(" ");
}

function comparableText(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, "")
    .trim();
}

function normalizedWords(value: string) {
  return new Set(
    String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^0-9a-z가-힣]+/g, " ")
      .split(/\s+/)
      .map((word) => {
        if (!/^[가-힣]+$/u.test(word)) return word;
        const stem = word.replace(/(?:으로|에서|에게|한테|처럼|보다|까지|부터|은|는|이|가|을|를|만|도|의|에|로)$/u, "");
        return stem.length >= 2 ? stem : word;
      })
      .filter((word) => word.length >= 2)
  );
}

function similarity(left: string, right: string) {
  const a = normalizedWords(left);
  const b = normalizedWords(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((word) => b.has(word)).length;
  return intersection / Math.max(1, new Set([...a, ...b]).size);
}

function characterBigramSimilarity(left: string, right: string) {
  const a = comparableText(left);
  const b = comparableText(right);
  if (a.length < 4 || b.length < 4) return a === b && a.length > 0 ? 1 : 0;
  const grams = (value: string) => {
    const result = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2);
      result.set(gram, (result.get(gram) || 0) + 1);
    }
    return result;
  };
  const leftGrams = grams(a);
  const rightGrams = grams(b);
  let intersection = 0;
  leftGrams.forEach((count, gram) => {
    intersection += Math.min(count, rightGrams.get(gram) || 0);
  });
  const leftCount = [...leftGrams.values()].reduce((sum, count) => sum + count, 0);
  const rightCount = [...rightGrams.values()].reduce((sum, count) => sum + count, 0);
  return (2 * intersection) / Math.max(1, leftCount + rightCount);
}

function withoutSharedProductIdentity(value: string, truth: ProductTruth) {
  let normalized = String(value || "").normalize("NFKC").toLowerCase();
  const identities = [truth.normalized.baseProductName, truth.normalized.cleanProductName, truth.product.productName]
    .map((identity) => String(identity || "").normalize("NFKC").toLowerCase().trim())
    .filter((identity) => identity.length >= 3)
    .sort((left, right) => right.length - left.length);
  identities.forEach((identity) => {
    normalized = normalized.split(identity).join(" ");
  });
  return normalized.replace(/상품\s*자세히\s*보기|구성\s*확인(?:하기)?|지금\s*확인(?:하기)?/gu, " ").replace(/\s+/g, " ").trim();
}

function includesAny(text: string, values: Array<string | undefined>) {
  return values.some((value) => value && text.includes(value));
}

function isOriginalSourceTruth(truth: ProductTruth) {
  return /오리지널\s*소스|original\s*source|originalsource/u.test([
    truth.product.advertiserName,
    truth.product.brandName,
    truth.product.productName,
    truth.product.landingUrl,
  ].filter(Boolean).join(" ").toLowerCase());
}

function reflectsAssignedFact(plan: ReferenceAdaptedCopyPlan, truth: ProductTruth) {
  const factId = plan.evidenceAssignment?.primaryFactId;
  if (!factId) return true;
  const fact = truth.facts.find((candidate) => candidate.id === factId);
  if (!fact) return false;
  const text = planText(plan).normalize("NFKC").toLowerCase();
  const dimension = referenceCopyEvidenceDimensionForFact(fact);
  if (dimension === "numeric-proof" && fact.numericTokens.length) return fact.numericTokens.some((token) => text.includes(token.toLowerCase()));
  const dimensionSignals: Partial<Record<typeof dimension, RegExp>> = {
    "ingredient-provenance": /시칠리아|민트\s*벨트|히말라야|멕시코|페루|아프리카|수확|원료/u,
    process: /냉압착|증류|추출|공정|눌러/u,
    texture: /거품|제형|젤|쿠션|보습막|마무리/u,
    "usage-problem": /운동|퇴근|무더|아침|샤워|사용|필요한\s*순간/u,
    certification: /비건|peta|인증|크루얼티|천연\s*향료/u,
  };
  if (dimensionSignals[dimension]?.test(text)) return true;
  const stopWords = new Set(["제품", "상품", "소개됨", "강조한", "사용감", "구성", "원료", "함유"]);
  const tokens = `${fact.label} ${fact.value}`.split(/[^0-9a-z가-힣]+/iu).filter((token) => token.length >= 3 && !stopWords.has(token));
  return tokens.some((token) => text.includes(token.toLowerCase()));
}

/**
 * 6장 묶음에서 같은 판매 사실만 반복되는 것을 결정적으로 제한한다.
 * 결과를 폐기하지는 않고 재작성 대상만 표시하므로 이미지 생성은 계속된다.
 */
export function applyReferenceCopyGroupRules(plans: ReferenceAdaptedCopyPlan[], truth: ProductTruth) {
  const errors = new Map(plans.map((plan) => [plan.referenceId, [...plan.validationErrors]]));
  const texts = plans.map(planText);
  const primaryOwners = new Map<string, number[]>();
  plans.forEach((plan, index) => {
    const assignment = plan.evidenceAssignment;
    if (!assignment?.primaryFactId) return;
    primaryOwners.set(assignment.primaryFactId, [...(primaryOwners.get(assignment.primaryFactId) || []), index]);
    if (!plan.factIds.includes(assignment.primaryFactId)) errors.get(plan.referenceId)?.push(`배정된 중심 상품 근거(${assignment.primaryFactId})가 최종 문구 계획에 없습니다.`);
    if (!reflectsAssignedFact(plan, truth)) errors.get(plan.referenceId)?.push(`배정된 중심 상품 근거(${assignment.primaryFactId})가 실제 문구에 드러나지 않습니다.`);
  });
  const availablePrimaryFactCount = truth.facts.filter((fact) =>
    fact.usableInCopy && fact.copyEligibility !== "blocked" && fact.copyEligibility !== "identityOnly" && !["identity", "shipping", "merchant-proof"].includes(fact.evidenceType || "")
  ).length;
  if (availablePrimaryFactCount >= plans.length) {
    primaryOwners.forEach((indexes) => {
      indexes.slice(1).forEach((index) => errors.get(plans[index].referenceId)?.push("같은 중심 상품 근거가 다른 소재와 반복 배정됐습니다."));
    });
  }
  const assignedPlanCount = plans.filter((plan) => plan.evidenceAssignment?.primaryFactId).length;
  if (isOriginalSourceTruth(truth) && assignedPlanCount === plans.length) {
    const sensoryIndexes = plans.map((plan, index) => ({ plan, index })).filter(({ plan }) => plan.evidenceAssignment?.sensoryLed);
    sensoryIndexes.slice(1).forEach(({ plan }) => errors.get(plan.referenceId)?.push("오리지널소스 향 중심 소재는 6장 중 최대 1장입니다."));
    if (plans.length >= 6) {
      const availableNonSensoryDimensions = new Set(truth.facts
        .filter((fact) => fact.usableInCopy && fact.copyEligibility !== "blocked" && fact.copyEligibility !== "identityOnly")
        .map(referenceCopyEvidenceDimensionForFact)
        .filter((dimension) => dimension !== "sensory"));
      const usedNonSensoryDimensions = new Set(plans.map((plan) => plan.evidenceAssignment?.evidenceDimension).filter((dimension) => dimension && dimension !== "sensory"));
      const required = Math.min(4, availableNonSensoryDimensions.size);
      if (usedNonSensoryDimensions.size < required) {
        const target = sensoryIndexes.at(-1)?.plan || plans.at(-1);
        if (target) errors.get(target.referenceId)?.push(`오리지널소스 6장은 향 외 상품 근거 차원을 최소 ${required}개 사용해야 합니다.`);
      }
    }
  }
  const rules: Array<{ label: string; cap: number; matches: (text: string) => boolean }> = [
    {
      label: "가격",
      cap: 2,
      matches: (text) => includesAny(text, [truth.normalized.price, truth.normalized.originalPrice]) || /\d[\d,.]*\s*원/u.test(text),
    },
    {
      label: "할인율",
      cap: 2,
      matches: (text) => includesAny(text, [truth.normalized.discount, truth.normalized.discountInfo]) || /\d{1,3}\s*%/u.test(text),
    },
    {
      label: "2+1·증정 구성",
      cap: 3,
      matches: (text) => /(?:\d+\s*\+\s*\d+|증정)/u.test(text),
    },
    {
      label: "수량·중량",
      cap: 2,
      matches: (text) => includesAny(text, [truth.normalized.quantity, truth.normalized.salesUnit, truth.normalized.composition]),
    },
    {
      label: "'차이·달라요' 계열 범용 후킹",
      cap: 2,
      matches: (text) => /차이(?:부터|가|는)?|달라요|다릅니다/u.test(text),
    },
    {
      label: "'한입부터' 계열 범용 후킹",
      cap: 1,
      matches: (text) => /한입부터/u.test(text),
    },
    {
      label: "'오늘 식탁' 계열 범용 상황",
      cap: 2,
      matches: (text) => /오늘[^.!?\n]{0,12}식탁|식탁[^.!?\n]{0,12}(?:담기|바빠|주인공)/u.test(text),
    },
    // 48시간 숙성·육즙처럼 설득력이 큰 동일 USP는 서로 다른 레퍼런스에서
    // 반복해도 된다. 가격·할인·판매 수량과 문장 자체의 중복만 별도로 제한한다.
  ];
  rules.forEach((rule) => {
    const matched = plans.map((plan, index) => ({ plan, index })).filter(({ plan, index }) => plan.generationSource !== "safe-minimal" && rule.matches(texts[index]));
    matched.slice(rule.cap).forEach(({ plan }) => errors.get(plan.referenceId)?.push(`6장 묶음에서 ${rule.label} 메인 강조는 최대 ${rule.cap}장입니다.`));
  });
  const ctaOwners = new Map<string, number[]>();
  plans.forEach((plan, index) => {
    const signature = comparableText(plan.cta);
    if (signature.length < 4) return;
    ctaOwners.set(signature, [...(ctaOwners.get(signature) || []), index]);
  });
  ctaOwners.forEach((indexes) => {
    indexes.slice(2).forEach((index) => errors.get(plans[index].referenceId)?.push("같은 CTA 문구는 6장 묶음에서 최대 2장만 사용할 수 있습니다."));
  });
  const availableAngleCount = availableCreativeAngles(truth).length;
  if (availableAngleCount >= Math.min(6, plans.length)) {
    const firstByAngle = new Map<string, number>();
    plans.forEach((plan, index) => {
      if (plan.generationSource === "safe-minimal") return;
      if (!plan.creativeAngle) return;
      const first = firstByAngle.get(plan.creativeAngle);
      if (first === undefined) firstByAngle.set(plan.creativeAngle, index);
      else errors.get(plan.referenceId)?.push(`소재 ${String(first + 1).padStart(2, "0")}와 CreativeAngle(${plan.creativeAngle})이 반복됩니다.`);
    });
  }
  for (let left = 0; left < plans.length; left += 1) {
    for (let right = left + 1; right < plans.length; right += 1) {
      // 안전 최소 문구는 AI·1회 보정 실패 시 사실 안전성을 우선하는 최종
      // 비상 경로다. 서로 다른 중심 근거 배정은 위에서 강제하되, 보조 슬롯의
      // 동일 사실 반복 때문에 나머지 이미지 제작까지 막지는 않는다.
      if (plans[left].generationSource === "safe-minimal" || plans[right].generationSource === "safe-minimal") continue;
      const leftBody = withoutSharedProductIdentity(texts[left], truth);
      const rightBody = withoutSharedProductIdentity(texts[right], truth);
      const wholeCopyRepeated = similarity(leftBody, rightBody) >= 0.76 || characterBigramSimilarity(leftBody, rightBody) >= 0.84;
      const leftHeadline = withoutSharedProductIdentity(plans[left].headline, truth);
      const rightHeadline = withoutSharedProductIdentity(plans[right].headline, truth);
      const headlineRepeated = Boolean(leftHeadline && rightHeadline) && (similarity(leftHeadline, rightHeadline) >= 0.72 || characterBigramSimilarity(leftHeadline, rightHeadline) >= 0.8);
      if (wholeCopyRepeated || headlineRepeated) {
        errors.get(plans[right].referenceId)?.push(`소재 ${String(left + 1).padStart(2, "0")}와 문구 의미가 지나치게 유사합니다.`);
      }
      const leftLines = new Set((plans[left].copySlots || [])
        .filter((slot) => slot.role !== "cta" && slot.sourceType !== "source-brand" && slot.replacePolicy !== "remove")
        .map((slot) => comparableText(withoutSharedProductIdentity(slot.targetText, truth)))
        .filter((line) => line.length >= 5));
      const repeatedLine = (plans[right].copySlots || [])
        .filter((slot) => slot.role !== "cta" && slot.sourceType !== "source-brand" && slot.replacePolicy !== "remove")
        .map((slot) => comparableText(withoutSharedProductIdentity(slot.targetText, truth)))
        .find((line) => line.length >= 5 && leftLines.has(line));
      if (repeatedLine) errors.get(plans[right].referenceId)?.push(`소재 ${String(left + 1).padStart(2, "0")}와 핵심 문구 블록이 반복됩니다.`);
    }
  }
  return plans.map((plan) => {
    const validationErrors = [...new Set(errors.get(plan.referenceId) || [])];
    return {
      ...plan,
      validationStatus: validationErrors.length ? ("invalid" as const) : plan.validationStatus,
      validationErrors,
    };
  });
}
