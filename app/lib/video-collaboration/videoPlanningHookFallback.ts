import crypto from "node:crypto";
import type {
  ProductAnalysisSnapshot,
  VideoHookCandidate,
} from "./types.ts";

function clean(value: unknown, max = 120) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** AI가 필수 자기소개형 후보만 누락했을 때 사용하는 최신 경로의 단일 보완안입니다. */
export function buildCurrentProductSelfIntroductionHook(
  analysis: ProductAnalysisSnapshot
): VideoHookCandidate {
  const rawProduct = clean(analysis.productName) || "이 상품";
  const spokenProduct =
    rawProduct
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|개|봉|팩|세트)\b/gi, "")
      .replace(/(?:특가|할인|추천|대용량|한정|무료배송)/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 24) || "이 상품";
  const fact =
    analysis.verifiedNumbers?.map((item) => clean(item)).find(Boolean) ||
    analysis.coreUsps?.map((item) => clean(item)).find(Boolean) ||
    analysis.keyFeatures?.map((item) => clean(item)).find(Boolean) ||
    rawProduct;
  const evidenceIds = (analysis.verifiedFacts || [])
    .filter((item) => {
      const haystack = `${item.label} ${item.value}`.replace(/\s/g, "");
      const needle = fact.replace(/\s/g, "");
      return needle && (haystack.includes(needle) || needle.includes(item.value.replace(/\s/g, "")));
    })
    .map((item) => item.id)
    .slice(0, 3);

  return {
    id: `hook-${crypto.randomUUID()}`,
    hookType: "product-self-introduction",
    hook: `나 ${spokenProduct}인데! 그냥 흔한 ${spokenProduct} 아니고, ${fact}`,
    customerProblem:
      analysis.customerProblems?.map((item) => clean(item, 160)).find(Boolean) ||
      `${spokenProduct}을 비슷한 상품으로만 보는 오해`,
    evidenceIds,
    visualIdea:
      "상품이 1인칭으로 등장해 흔한 오해를 부정하고, 확인된 원료·구성·숫자 한 가지를 실제 사용 장면으로 공개",
    score: {
      stopPower: 86,
      specificity: /\d/.test(fact) ? 92 : 82,
      productRelevance: 96,
      visualPotential: 88,
      evidenceStrength: evidenceIds.length ? 88 : 64,
      conversionPotential: 82,
      originality: 86,
      policySafety: 100,
      total: evidenceIds.length ? 89 : 84,
    },
    rejectionReasons: [],
  };
}
