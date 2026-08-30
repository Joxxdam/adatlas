import type { ProductTruth, ReferenceAdaptedCopyPlan } from "./types.ts";

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

/**
 * 6장 묶음에서 같은 판매 사실만 반복되는 것을 결정적으로 제한한다.
 * 결과를 폐기하지는 않고 재작성 대상만 표시하므로 이미지 생성은 계속된다.
 */
export function applyReferenceCopyGroupRules(plans: ReferenceAdaptedCopyPlan[], truth: ProductTruth) {
  const errors = new Map(plans.map((plan) => [plan.referenceId, [...plan.validationErrors]]));
  const texts = plans.map(planText);
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
    // 서로 다른 USP까지 합쳐 전체 두 장으로 제한하면 정상적인 6장 문구가
    // 무조건 탈락한다. 같은 사실 하나가 반복되는 경우만 개별 제한한다.
    ...truth.facts
      .filter((fact) => fact.evidenceType === "usp" && fact.usableInCopy !== false && fact.value.trim())
      .map((fact) => ({
        label: `상품 근거(${fact.label})`,
        cap: 2,
        matches: (text: string) => text.includes(fact.value),
      })),
  ];
  rules.forEach((rule) => {
    const matched = plans.map((plan, index) => ({ plan, index })).filter(({ index }) => rule.matches(texts[index]));
    matched.slice(rule.cap).forEach(({ plan }) => errors.get(plan.referenceId)?.push(`6장 묶음에서 ${rule.label} 메인 강조는 최대 ${rule.cap}장입니다.`));
  });
  for (let left = 0; left < plans.length; left += 1) {
    for (let right = left + 1; right < plans.length; right += 1) {
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
