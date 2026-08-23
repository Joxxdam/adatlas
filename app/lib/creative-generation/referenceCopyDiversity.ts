import type { ProductTruth, ReferenceAdaptedCopyPlan } from "./types.ts";

function planText(plan: ReferenceAdaptedCopyPlan) {
  return [plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].filter(Boolean).join(" ");
}

function normalizedWords(value: string) {
  return new Set(
    String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^0-9a-z가-힣]+/g, " ")
      .split(/\s+/)
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
    {
      label: "상품 근거",
      cap: 2,
      matches: (text) => truth.facts.some((fact) => fact.evidenceType === "usp" && fact.usableInCopy !== false && text.includes(fact.value)),
    },
  ];
  rules.forEach((rule) => {
    const matched = plans.map((plan, index) => ({ plan, index })).filter(({ index }) => rule.matches(texts[index]));
    matched.slice(rule.cap).forEach(({ plan }) => errors.get(plan.referenceId)?.push(`6장 묶음에서 ${rule.label} 메인 강조는 최대 ${rule.cap}장입니다.`));
  });
  for (let left = 0; left < plans.length; left += 1) {
    for (let right = left + 1; right < plans.length; right += 1) {
      if (similarity(texts[left], texts[right]) >= 0.82) {
        errors.get(plans[right].referenceId)?.push(`소재 ${String(left + 1).padStart(2, "0")}와 문구 의미가 지나치게 유사합니다.`);
      }
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
