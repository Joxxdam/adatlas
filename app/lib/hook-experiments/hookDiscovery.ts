import type { ProductTruth } from "../creative-generation/types.ts";
import type { ExperimentHookCode, HookRecommendation } from "./types.ts";

type HookDefinition = {
  code: ExperimentHookCode;
  type: string;
  label: string;
  applicability: (truth: ProductTruth) => { eligible: boolean; warnings?: string[] };
  message: (truth: ProductTruth) => string;
  hypothesis: string;
  reason: string;
};

function productName(truth: ProductTruth) {
  return truth.product.productName || "이 상품";
}

function benefit(truth: ProductTruth) {
  return (
    truth.product.mainBenefit ||
    truth.product.verifiedBenefits?.[0] ||
    truth.product.extractedDescription ||
    "상품의 핵심 정보"
  );
}

function hasReviews(truth: ProductTruth) {
  return Boolean(
    truth.product.reviewSources?.length ||
    truth.product.creativeContext?.reviewInsightIds?.length ||
    truth.product.creativeContext?.reviewInsightSummaries?.length
  );
}

function factIds(truth: ProductTruth, keys: string[]) {
  return truth.facts
    .filter((fact) => keys.some((key) => fact.key.startsWith(key)))
    .map((fact) => fact.id);
}

const always = () => ({ eligible: true });

const definitions: HookDefinition[] = [
  {
    code: "SEN",
    type: "sensory",
    label: "강한 감각·장면형",
    applicability: (truth) => ({
      eligible: Boolean(benefit(truth)),
      warnings: benefit(truth) ? [] : ["감각 근거가 부족합니다."],
    }),
    message: (truth) => `상쾌함이 필요한 순간,\n${benefit(truth)}`,
    hypothesis: "상품에서 확인된 감각과 사용 장면을 강하게 표현하면 첫 주목도가 높아집니다.",
    reason: "상품의 사용감과 장면을 문구형·비주얼형으로 넓게 탐색합니다.",
  },
  {
    code: "CUR",
    type: "curiosity",
    label: "궁금증형",
    applicability: always,
    message: (truth) => `${productName(truth)},\n왜 다르게 느껴질까요?`,
    hypothesis:
      "확인 가능한 상품 차이를 질문으로 예고하면 상세 정보를 확인하려는 반응이 늘어납니다.",
    reason: "근거 없는 숫자 없이 상품 차이에 대한 궁금증을 만듭니다.",
  },
  {
    code: "PRB",
    type: "problem-solution",
    label: "문제 해결형",
    applicability: always,
    message: (truth) =>
      `${truth.product.category || "상품"} 고민,\n${productName(truth)}로 바꿔보세요`,
    hypothesis: "익숙한 고객 문제와 확인된 상품 효용을 연결하면 선택 이유가 선명해집니다.",
    reason: "고객 문제와 상품의 실제 핵심 혜택을 직접 연결합니다.",
  },
  {
    code: "BRD",
    type: "brand-story",
    label: "브랜드 메시지형",
    applicability: (truth) => ({
      eligible: Boolean(truth.product.brandName || truth.product.advertiserName),
      warnings:
        truth.product.brandName || truth.product.advertiserName
          ? []
          : ["브랜드 정보가 부족해 신뢰도 확인이 필요합니다."],
    }),
    message: (truth) =>
      `${truth.product.brandName || truth.product.advertiserName || productName(truth)},\n${benefit(truth)}`,
    hypothesis: "브랜드명과 대표 상품 메시지를 함께 제시하면 기억점이 선명해집니다.",
    reason: "브랜드와 대표 USP를 하나의 기억점으로 결합합니다.",
  },
  {
    code: "PRC",
    type: "price-benefit",
    label: "가격·혜택형",
    applicability: (truth) => ({
      eligible: Boolean(truth.product.price || truth.product.discountInfo),
      warnings:
        truth.product.price || truth.product.discountInfo
          ? []
          : ["확인된 가격·혜택이 없어 제외됩니다."],
    }),
    message: (truth) =>
      [productName(truth), truth.product.discountInfo, truth.product.price]
        .filter(Boolean)
        .join("\n"),
    hypothesis: "확인된 가격·구성을 명확히 보여주면 상품 비교가 쉬워집니다.",
    reason: "상세페이지에서 확인된 가격과 혜택만 사용합니다.",
  },
  {
    code: "REV",
    type: "review-ugc",
    label: "후기·신뢰형",
    applicability: (truth) => ({
      eligible: hasReviews(truth),
      warnings: hasReviews(truth) ? [] : ["실제 리뷰 인사이트가 없어 다른 근거형으로 대체됩니다."],
    }),
    message: (truth) => `${productName(truth)}\n실사용 정보에서 확인한 선택 이유`,
    hypothesis: "실제 리뷰와 신뢰 근거를 제시하면 상품에 대한 불확실성이 줄어듭니다.",
    reason: "저장된 리뷰 인사이트가 있는 경우에만 후기 메시지를 사용합니다.",
  },
  {
    code: "USP",
    type: "feature-usp",
    label: "핵심 USP형",
    applicability: always,
    message: (truth) => `${productName(truth)}의 핵심,\n${benefit(truth)}`,
    hypothesis: "상품의 확인된 핵심 차이를 한 가지로 압축하면 선택 기준이 명확해집니다.",
    reason: "상품 상세페이지에서 확인된 USP를 가장 크게 표현합니다.",
  },
  {
    code: "EMP",
    type: "empathy-situation",
    label: "상황 공감형",
    applicability: always,
    message: (truth) =>
      `${truth.product.targetCustomer || "이 상품이 필요한 순간"},\n${benefit(truth)}`,
    hypothesis: "고객이 겪는 일상 상황에서 시작하면 상품 필요성을 빠르게 이해합니다.",
    reason: "타깃의 일상 상황과 실제 상품 효용을 연결합니다.",
  },
  {
    code: "VAL",
    type: "value",
    label: "가성비형",
    applicability: (truth) => ({
      eligible: Boolean(truth.product.price),
      warnings: truth.product.price ? [] : ["확인된 가격이 없어 제외됩니다."],
    }),
    message: (truth) => `${productName(truth)}\n${truth.product.price || "구성 정보 확인"}`,
    hypothesis: "확인된 가격과 상품 구성을 함께 보여주면 가치 판단이 쉬워집니다.",
    reason: "후기 근거가 없을 때 사용할 수 있는 사실 기반 대체 가설입니다.",
  },
  {
    code: "NEW",
    type: "new-product",
    label: "신상품 탐색형",
    applicability: always,
    message: (truth) => `새롭게 확인할 선택지,\n${productName(truth)}`,
    hypothesis: "상품을 새로운 선택지로 단순하게 제시하면 초기 반응을 확인할 수 있습니다.",
    reason: "근거가 부족한 후킹을 대체하는 보수적인 탐색 가설입니다.",
  },
  {
    code: "CTL",
    type: "control",
    label: "기존 소재 대조군",
    applicability: always,
    message: (truth) => `${productName(truth)}\n${benefit(truth)}`,
    hypothesis: "현재 대표 상품 메시지를 유지해 신규 후킹과 비교할 기준을 만듭니다.",
    reason: "사용자가 대조군 사용을 선택한 경우에만 포함합니다.",
  },
];

export const defaultDiscoveryHookCodes: ExperimentHookCode[] = [
  "SEN",
  "CUR",
  "PRB",
  "BRD",
  "PRC",
  "REV",
  "USP",
  "EMP",
];

export const HookDiscoveryService = {
  recommend(
    truth: ProductTruth,
    options: { selectedHookCodes?: ExperimentHookCode[]; useControl?: boolean; limit?: number } = {}
  ) {
    const requested = options.selectedHookCodes?.length
      ? options.selectedHookCodes
      : defaultDiscoveryHookCodes;
    const mapped = requested
      .map((code) => definitions.find((item) => item.code === code))
      .filter((item): item is HookDefinition => Boolean(item))
      .map((definition): HookRecommendation => {
        const applicability = definition.applicability(truth);
        return {
          hookType: definition.type,
          hookCode: definition.code,
          label: definition.label,
          mainMessage: definition.message(truth),
          hypothesis: definition.hypothesis,
          recommendationReason: definition.reason,
          eligible: applicability.eligible,
          warnings: applicability.warnings || [],
          factIds: factIds(truth, [
            "product-name",
            "main-benefit",
            "verified-benefit",
            "price",
            "discount",
            "category",
          ]),
        };
      });
    const eligible = mapped.filter((item) => item.eligible);
    const fallbackCodes: ExperimentHookCode[] = ["VAL", "NEW"];
    for (const code of fallbackCodes) {
      if (eligible.length >= requested.length) break;
      if (eligible.some((item) => item.hookCode === code)) continue;
      const definition = definitions.find((item) => item.code === code)!;
      const applicability = definition.applicability(truth);
      if (!applicability.eligible) continue;
      eligible.push({
        hookType: definition.type,
        hookCode: definition.code,
        label: definition.label,
        mainMessage: definition.message(truth),
        hypothesis: definition.hypothesis,
        recommendationReason: definition.reason,
        eligible: true,
        warnings: [],
        factIds: factIds(truth, [
          "product-name",
          "main-benefit",
          "verified-benefit",
          "price",
          "discount",
          "category",
        ]),
      });
    }
    if (options.useControl && !eligible.some((item) => item.hookCode === "CTL")) {
      const control = definitions.find((item) => item.code === "CTL")!;
      eligible.push({
        hookType: control.type,
        hookCode: control.code,
        label: control.label,
        mainMessage: control.message(truth),
        hypothesis: control.hypothesis,
        recommendationReason: control.reason,
        eligible: true,
        warnings: [],
        factIds: factIds(truth, ["product-name", "main-benefit"]),
      });
    }
    const limit = Math.max(4, Math.min(10, options.limit || requested.length));
    return {
      recommendations: eligible.slice(0, limit),
      excluded: mapped.filter((item) => !item.eligible),
    };
  },
};
