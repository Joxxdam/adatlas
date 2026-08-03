import { cleanGeneratedText, trimCopyToLimit, visibleCopyLength } from "./copyQuality";
import type {
  AdBrief,
  CopyQualityDimension,
  CopyQualityFinding,
  CopyQualityReport,
  CopySlotKey,
  GeneratedAdCopy,
  TemplateCopyLimits,
} from "./types";

const vagueTerms = ["특별한", "새로운", "최고의", "완벽한", "놀라운", "프리미엄한"];
const overclaimTerms = ["무조건", "100% 효과", "완치", "절대", "유일", "최저가 보장"];
const genericCtas = ["확인하기", "자세히 보기", "클릭하기", "알아보기"];

function addFinding(findings: CopyQualityFinding[], finding: Omit<CopyQualityFinding, "id">) {
  findings.push({ ...finding, id: `copy-${findings.length + 1}` });
}

function repeatedMeaning(copy: GeneratedAdCopy) {
  const slots = [copy.headline, copy.bodyCopy, copy.highlightCopy, copy.bottomBarCopy]
    .map((text) => cleanGeneratedText(text).replace(/\s+/g, ""))
    .filter((text) => text.length >= 5);
  return slots.some((text, index) =>
    slots.slice(index + 1).some((other) => text.includes(other) || other.includes(text))
  );
}

function numberMentions(copy: GeneratedAdCopy) {
  return [copy.headline, copy.bodyCopy, copy.highlightCopy, copy.bottomBarCopy].filter((text) =>
    /\d[\d,]*(?:원|%|만원)/.test(text || "")
  ).length;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function evaluateCopyQuality(params: {
  copy: GeneratedAdCopy;
  brief: AdBrief;
  copyLimits?: TemplateCopyLimits;
}): CopyQualityReport {
  const { copy, brief, copyLimits = {} } = params;
  const findings: CopyQualityFinding[] = [];
  const slotEntries = Object.entries(copyLimits) as Array<
    [CopySlotKey, TemplateCopyLimits[CopySlotKey]]
  >;

  for (const [slot, limit] of slotEntries) {
    if (!limit) continue;
    const text = String(copy[slot] || "");
    if (visibleCopyLength(text) > limit.maxChars) {
      addFinding(findings, {
        severity: "warning",
        slot,
        message: `${slot}이 ${visibleCopyLength(text)}자로 권장 최대 ${limit.maxChars}자를 넘습니다.`,
        suggestion: "글자 크기 축소보다 문구 자체를 먼저 줄이세요.",
      });
    }
    if ((text.match(/\n/g)?.length || 0) + 1 > limit.maxLines) {
      addFinding(findings, {
        severity: "warning",
        slot,
        message: `${slot}의 줄 수가 템플릿 허용 범위를 넘습니다.`,
        suggestion: `${limit.maxLines}줄 안에서 핵심 메시지만 남기세요.`,
      });
    }
  }

  const allText = [copy.headline, copy.bodyCopy, copy.highlightCopy, copy.bottomBarCopy, copy.cta]
    .filter(Boolean)
    .join(" ");
  const vagueCount = vagueTerms.filter((term) => allText.includes(term)).length;
  const overclaimCount = overclaimTerms.filter((term) => allText.includes(term)).length;

  if (repeatedMeaning(copy)) {
    addFinding(findings, {
      severity: "warning",
      message: "서로 다른 문구 영역에서 같은 의미가 반복됩니다.",
      suggestion: "헤드라인은 후킹, 본문은 근거, 강조문은 혜택으로 역할을 나누세요.",
    });
  }
  if (numberMentions(copy) >= 3) {
    addFinding(findings, {
      severity: "info",
      message: "가격 또는 할인 숫자가 여러 영역에서 반복됩니다.",
      suggestion: "판매가는 가격 슬롯에 남기고 카피 영역은 구매 명분에 사용하세요.",
    });
  }
  if (genericCtas.some((term) => cleanGeneratedText(copy.cta).includes(term))) {
    addFinding(findings, {
      severity: "warning",
      slot: "cta",
      message: "CTA가 행동 대상을 구체적으로 알려 주지 않습니다.",
      suggestion: "구성 보기, 특가 담기처럼 다음 행동을 명확히 적으세요.",
    });
  }
  if (vagueCount) {
    addFinding(findings, {
      severity: "warning",
      message: "구체적 근거 없이 넓게 해석되는 표현이 포함되어 있습니다.",
      suggestion: "상품명, 구성, 사용 상황, 검증된 혜택으로 바꾸세요.",
    });
  }
  if (overclaimCount) {
    addFinding(findings, {
      severity: "error",
      message: "과장 또는 입증이 필요한 단정 표현을 확인해야 합니다.",
      suggestion: "상품 상세페이지에서 확인된 사실 범위로 낮추세요.",
    });
  }
  for (const required of brief.mandatoryInfo) {
    if (required && !allText.includes(required) && !String(copy.price).includes(required)) {
      addFinding(findings, {
        severity: "warning",
        message: `필수 정보 '${required}'가 카피에 보이지 않습니다.`,
        suggestion: "본문 또는 하단 정보 바에 반영하세요.",
      });
    }
  }
  for (const prohibited of brief.prohibitedClaims) {
    if (prohibited && allText.includes(prohibited)) {
      addFinding(findings, {
        severity: "error",
        message: `금지 표현 '${prohibited}'가 포함되어 있습니다.`,
        suggestion: "해당 표현을 삭제하거나 검증 가능한 사실로 바꾸세요.",
      });
    }
  }

  const hasSpecificFact = Boolean(
    [brief.productName, brief.price, brief.discountInfo, brief.mainBenefit]
      .filter(Boolean)
      .some(
        (fact) => allText.includes(fact) || (fact.length > 6 && allText.includes(fact.slice(0, 6)))
      )
  );
  const hasBenefit = Boolean(copy.bodyCopy || copy.highlightCopy) && Boolean(brief.mainBenefit);
  const hasPrice = Boolean(copy.price || /\d[\d,]*(?:원|만원)/.test(allText));
  const targetSignal = brief.targetCustomer
    ? allText.includes(brief.targetCustomer) || Boolean(brief.customerProblem)
    : true;
  const basePenalty = findings.filter((finding) => finding.severity === "warning").length * 6;
  const errorPenalty = findings.filter((finding) => finding.severity === "error").length * 14;

  const scores: Record<CopyQualityDimension, number> = {
    specificity: clamp((hasSpecificFact ? 88 : 62) - vagueCount * 12),
    benefitClarity: clamp(hasBenefit ? 86 : copy.bodyCopy ? 68 : 45),
    differentiation: clamp(82 - vagueCount * 10 - (repeatedMeaning(copy) ? 8 : 0)),
    priceClarity: clamp(hasPrice ? 90 - Math.max(0, numberMentions(copy) - 2) * 7 : 58),
    targetFit: clamp(targetSignal ? 84 : 62),
    naturalKoreanTone: clamp(90 - basePenalty),
    overclaimSafety: clamp(100 - overclaimCount * 28),
    repetitionSafety: clamp(repeatedMeaning(copy) ? 62 : 92),
  };
  const totalScore = clamp(
    Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.values(scores).length -
      errorPenalty * 0.2
  );

  return { totalScore, scores, findings, checkedAt: new Date().toISOString() };
}

export function tightenCopyToTemplate(
  copy: GeneratedAdCopy,
  copyLimits?: TemplateCopyLimits
): GeneratedAdCopy {
  if (!copyLimits) return copy;
  const next = { ...copy };
  for (const key of ["headline", "bodyCopy", "highlightCopy", "bottomBarCopy", "cta"] as const) {
    const limit = copyLimits[key];
    if (limit) next[key] = trimCopyToLimit(next[key], limit.maxChars);
  }
  return next;
}
