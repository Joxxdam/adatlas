import "server-only";

import type { ProductAnalysisSnapshot } from "./types.ts";
import { runVideoPlanningAi } from "./videoPlanningAi.server.ts";

function clean(value: unknown, max = 220) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function compact(value: unknown, limit = 6) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => clean(item)).filter(Boolean))].slice(0, limit);
}

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["targetCustomers", "customerProblems", "useSituations", "purchaseHesitations", "purchaseReasons", "differentiators", "visualizableElements", "unsupportedClaims"],
  properties: {
    targetCustomers: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", maxLength: 120 } },
    customerProblems: { type: "array", minItems: 2, maxItems: 4, items: { type: "string", maxLength: 140 } },
    useSituations: { type: "array", minItems: 2, maxItems: 5, items: { type: "string", maxLength: 140 } },
    purchaseHesitations: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", maxLength: 140 } },
    purchaseReasons: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", maxLength: 140 } },
    differentiators: { type: "array", maxItems: 5, items: { type: "string", maxLength: 140 } },
    visualizableElements: { type: "array", minItems: 2, maxItems: 6, items: { type: "string", maxLength: 160 } },
    unsupportedClaims: { type: "array", maxItems: 6, items: { type: "string", maxLength: 180 } },
  },
} as const;

function normalizedNumbers(value: string) {
  return (value.match(/\d[\d,.]*/g) || []).map((item) => item.replace(/[,.]/g, ""));
}

export async function enrichVideoProductAnalysis(snapshot: ProductAnalysisSnapshot): Promise<ProductAnalysisSnapshot> {
  const facts = {
    productName: snapshot.productName,
    brandName: snapshot.brandName,
    category: snapshot.category,
    price: snapshot.price,
    promotion: snapshot.promotion || snapshot.discountInfo,
    volumeOrOption: snapshot.volumeOrOption,
    origin: snapshot.countryOfOrigin,
    ingredients: snapshot.ingredients,
    coreUsps: snapshot.coreUsps,
    keyFeatures: snapshot.keyFeatures,
    trustSignals: snapshot.trustSignals,
    verifiedNumbers: snapshot.verifiedNumbers,
    description: clean(snapshot.rawDescription, 2400),
  };
  const parsed = await runVideoPlanningAi<{
    targetCustomers: string[];
    customerProblems: string[];
    useSituations: string[];
    purchaseHesitations: string[];
    purchaseReasons: string[];
    differentiators: string[];
    visualizableElements: string[];
    unsupportedClaims: string[];
  }>({
    stage: "product-analysis",
    outputSchema: analysisSchema as unknown as Record<string, unknown>,
    prompt: `아래 상품 상세페이지 공개정보를 숏폼 광고 영상 기획용으로 분석한다. 입력에 없는 가격·수치·원료·원산지·인증·후기·효능·판매성과는 만들지 않는다. targetCustomers, customerProblems, useSituations, purchaseHesitations, purchaseReasons는 확인된 사실에 근거한 광고 해석이다. differentiators는 입력에서 직접 확인되는 차이만 쓴다. visualizableElements는 촬영 가능한 장소·행동·질감·반응을 구체적으로 쓴다. unsupportedClaims에는 근거가 없어 확정 문구로 쓰면 안 되는 후보만 넣는다. JSON만 반환한다.\n${JSON.stringify(facts)}`,
  });
  const generated = Object.values(parsed).flat().join(" ");
  const sourceNumbers = new Set(normalizedNumbers(JSON.stringify(facts)));
  const unsupportedNumber = normalizedNumbers(generated).find((number) => !sourceNumbers.has(number));
  if (unsupportedNumber) throw new Error("상품 분석 해석에 확인되지 않은 수치가 포함되었습니다.");
  const targetCustomers = compact(parsed.targetCustomers, 4);
  const customerProblems = compact(parsed.customerProblems, 4);
  const useSituations = compact(parsed.useSituations, 5);
  const purchaseHesitations = compact(parsed.purchaseHesitations, 4);
  const purchaseReasons = compact(parsed.purchaseReasons, 4);
  const differentiators = compact(parsed.differentiators, 5);
  const visualizableElements = compact(parsed.visualizableElements, 6);
  const unsupportedClaims = compact(parsed.unsupportedClaims, 6);
  return {
    ...snapshot,
    targetCustomers,
    customerProblems,
    useSituations,
    differentiators,
    visualizableElements,
    inferredFields: ["targetCustomers", "customerProblems"],
    inferredAngles: [
      ...targetCustomers.map((value, index) => ({
        id: `inferred-target-${index + 1}`,
        label: "추천 타깃",
        value,
        source: "공개 상품정보 기반 AI 해석",
        bucket: "inferred" as const,
      })),
      ...customerProblems.map((value, index) => ({
        id: `inferred-problem-${index + 1}`,
        label: "추천 고객 문제",
        value,
        source: "공개 상품정보 기반 AI 해석",
        bucket: "inferred" as const,
      })),
      ...purchaseHesitations.map((value, index) => ({
        id: `inferred-hesitation-${index + 1}`,
        label: "구매 망설임",
        value,
        source: "공개 상품정보 기반 AI 해석",
        bucket: "inferred" as const,
      })),
      ...purchaseReasons.map((value, index) => ({
        id: `inferred-reason-${index + 1}`,
        label: "구매 이유",
        value,
        source: "공개 상품정보 기반 AI 해석",
        bucket: "inferred" as const,
      })),
    ],
    unsupportedClaims: unsupportedClaims.map((value, index) => ({
      id: `unsupported-${index + 1}`,
      label: "확인 필요",
      value,
      source: "AI 근거 검수",
      bucket: "unsupported" as const,
    })),
    analysisNotes: ["상품명·가격·구성·USP·후기 근거는 공개정보이며, 타깃·고객 문제·상황·구매 이유는 그 사실을 바탕으로 한 AI 기획 해석입니다."],
  };
}
