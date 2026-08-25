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

function hasUnsupportedNumber(value: string, sourceNumbers: Set<string>) {
  return normalizedNumbers(value).some((number) => !sourceNumbers.has(number));
}

function groundedItems(value: unknown, limit: number, sourceNumbers: Set<string>, rejected: string[]) {
  return compact(value, limit).filter((item) => {
    if (!hasUnsupportedNumber(item, sourceNumbers)) return true;
    rejected.push(item);
    return false;
  });
}

function fillGrounded(values: string[], fallbacks: unknown[], limit: number, sourceNumbers: Set<string>, rejected: string[]) {
  return groundedItems([...values, ...fallbacks], limit, sourceNumbers, rejected);
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
  const sourceNumbers = new Set(normalizedNumbers(JSON.stringify(facts)));
  const rejectedNumericInterpretations: string[] = [];
  const targetCustomers = fillGrounded(
    groundedItems(parsed.targetCustomers, 4, sourceNumbers, rejectedNumericInterpretations),
    [...snapshot.targetCustomers, `${snapshot.category || "해당"} 상품의 실제 구성과 구매 조건을 비교하는 고객`],
    4,
    sourceNumbers,
    rejectedNumericInterpretations
  );
  const customerProblems = fillGrounded(
    groundedItems(parsed.customerProblems, 4, sourceNumbers, rejectedNumericInterpretations),
    [...snapshot.customerProblems, "상품 사진과 설명만으로 실제 구성과 차이를 빠르게 판단하기 어려움"],
    4,
    sourceNumbers,
    rejectedNumericInterpretations
  );
  const useSituations = fillGrounded(
    groundedItems(parsed.useSituations, 5, sourceNumbers, rejectedNumericInterpretations),
    [...(snapshot.useSituations || []), "구매 전에 상세 구성과 활용 장면을 비교하는 순간", "상품을 실제로 사용하는 과정을 보여주는 장면"],
    5,
    sourceNumbers,
    rejectedNumericInterpretations
  );
  const purchaseHesitations = fillGrounded(
    groundedItems(parsed.purchaseHesitations, 4, sourceNumbers, rejectedNumericInterpretations),
    ["상품 사진만으로 실제 구성과 사용 장면을 판단하기 어려움"],
    4,
    sourceNumbers,
    rejectedNumericInterpretations
  );
  const purchaseReasons = fillGrounded(
    groundedItems(parsed.purchaseReasons, 4, sourceNumbers, rejectedNumericInterpretations),
    [...snapshot.coreUsps, ...snapshot.keyFeatures],
    4,
    sourceNumbers,
    rejectedNumericInterpretations
  );
  const differentiators = fillGrounded(
    groundedItems(parsed.differentiators, 5, sourceNumbers, rejectedNumericInterpretations),
    [...(snapshot.differentiators || []), ...snapshot.coreUsps],
    5,
    sourceNumbers,
    rejectedNumericInterpretations
  );
  const visualizableElements = fillGrounded(
    groundedItems(parsed.visualizableElements, 6, sourceNumbers, rejectedNumericInterpretations),
    [...(snapshot.visualizableElements || []), ...(snapshot.ingredients || []), ...snapshot.coreUsps, "상품의 실제 형태와 질감을 가까이 보여주는 장면", "상품을 사용하는 손동작과 반응을 보여주는 장면"],
    6,
    sourceNumbers,
    rejectedNumericInterpretations
  );
  // unsupportedClaims는 광고에 바로 쓰는 확정 사실이 아니라 UI에서
  // '확인 필요'로 표시되는 격리 영역이다. AI가 만든 미확인 수치 문장도
  // 분석 전체를 실패시키지 않고 이곳으로 이동한다.
  const unsupportedClaims = compact([...parsed.unsupportedClaims, ...rejectedNumericInterpretations], 6);
  if (rejectedNumericInterpretations.length) {
    console.warn(`[video-planning] product-analysis filtered ${new Set(rejectedNumericInterpretations).size} interpretation(s) containing unsupported numbers`);
  }
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
    analysisNotes: [
      "상품명·가격·구성·USP·후기 근거는 공개정보이며, 타깃·고객 문제·상황·구매 이유는 그 사실을 바탕으로 한 AI 기획 해석입니다.",
      ...(rejectedNumericInterpretations.length ? ["공개 상품정보에서 확인되지 않은 수치가 포함된 AI 해석은 확정 사실에서 제외하고 확인 필요 항목으로 분리했습니다."] : []),
    ],
  };
}
