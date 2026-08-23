import type { AdBrief, AdImageLabel, ProductInfoForPrompt } from "./types";

export type InferredAdBriefContext = {
  awarenessStage: NonNullable<AdBrief["awarenessStage"]>;
  customerProblem: string;
  purchaseBarrier: string;
  hookType: string;
  offerType: string;
  tone: string;
  proofElements: string[];
  visualEmphasis: string;
};

function compact(value: string | undefined, max = 54) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function referenceText(references: AdImageLabel[]) {
  return references
    .flatMap((label) => {
      const final = label.finalLabel;
      return [...(label.structuredLabels?.hookTypes || []), ...(label.structuredLabels?.appealPoints || []), final?.hookType, final?.appealPoint, final?.copyNuance, final?.consumerInsight, final?.purchaseTrigger, final?.reusableCopyPattern];
    })
    .filter(Boolean)
    .join(" ");
}

function categoryProblem(category: string) {
  if (/식품|선물|고기|농산/.test(category)) return "품질과 가격을 함께 비교해야 하는 부담";
  if (/뷰티|스킨/.test(category)) return "성분과 사용감을 구매 전에 판단하기 어려움";
  if (/패션|의류/.test(category)) return "착용감과 활용도를 이미지로 판단하기 어려움";
  if (/건강/.test(category)) return "상품 간 차이와 선택 근거를 구분하기 어려움";
  if (/앱|디지털/.test(category)) return "기존 방식보다 나은 이유를 즉시 이해하기 어려움";
  return "상품의 구체적인 구매 이유를 빠르게 판단하기 어려움";
}

export function inferAdBriefContext(params: { product: ProductInfoForPrompt; brief: AdBrief; references?: AdImageLabel[] }): InferredAdBriefContext {
  const { product, brief, references = [] } = params;
  const contentNotes = product.creativeContext?.appliedContentNotes || [];
  const preferredHook = contentNotes.find((note) => note.type === "PREFERRED_HOOK" && !note.prohibited)?.content;
  const toneInstruction = contentNotes.find((note) => ["TONE_OF_VOICE", "TONE_AND_MANNER"].includes(note.type) && !note.prohibited)?.content;
  const text = [product.productName, product.category, product.mainBenefit, product.extractedDescription, product.discountInfo, brief.additionalEmphasis, referenceText(references)].filter(Boolean).join(" ");
  const hasPriceOffer = Boolean(product.price && (product.discountInfo || product.originalPrice));
  const hasProofTone = /후기|리뷰|인증|판매량|평점|국내산|원산지/.test(text);
  const isPerformance = brief.creativeIntensity === "performance";

  const objectiveAwarenessStage = brief.adObjective === "awareness" ? "unaware" : brief.adObjective === "signup" ? "problem-aware" : brief.adObjective === "retargeting" ? "comparing" : undefined;
  const awarenessStage = brief.awarenessStage || objectiveAwarenessStage || (hasPriceOffer ? "comparing" : product.mainBenefit ? "solution-aware" : "problem-aware");
  const customerProblem = brief.customerProblem || categoryProblem(product.category);
  const purchaseBarrier = brief.purchaseBarrier || (product.price ? "표시 가격만 보고 품질과 구성의 가치를 확신하기 어려움" : "상품을 선택할 구체적인 근거가 부족함");
  const hookType = preferredHook || brief.desiredHookType || product.creativeContext?.recommendedHookTypes?.[0] || (brief.adObjective === "awareness" ? "브랜드대표메시지형" : brief.adObjective === "signup" ? "차별점발견형" : brief.adObjective === "retargeting" ? (hasPriceOffer ? "혜택재강조형" : "구매이유환기형") : isPerformance && hasPriceOffer ? "가격정당화형" : hasProofTone ? "후기/신뢰형" : references[0]?.finalLabel?.hookType || "혜택선명형");
  const offerType = brief.offerType || compact(product.discountInfo) || (product.price ? `판매가 ${product.price} 중심` : "확인된 상품 혜택 중심");
  const tone = toneInstruction || brief.tonePreference || (brief.creativeIntensity === "brand" ? "감성적이고 자연스러운 문장으로 판매 압박을 줄인 부드러운 톤" : brief.creativeIntensity === "performance" ? "확인된 가격·할인과 행동 유도를 우선하는 직접적인 전환 톤" : "USP와 확인된 구매 혜택을 균형 있게 전달하는 톤");

  const proofElements = Array.from(new Set([...(brief.proofElements || []), product.price ? `상세페이지 표시 판매가 ${product.price}` : "", product.originalPrice ? `상세페이지 표시 정상가 ${product.originalPrice}` : "", product.discountInfo ? compact(product.discountInfo) : "", product.mainBenefit ? compact(product.mainBenefit) : ""].filter(Boolean))).slice(0, 4);

  const visualEmphasis = brief.creativeIntensity === "brand" ? "상품을 크게 보여 주고 여백과 신뢰감을 우선" : hasPriceOffer ? "상품 비주얼과 확인된 가격·혜택을 한 시선 안에 배치" : "상품 비주얼과 핵심 효용을 가장 먼저 인지하도록 배치";

  return {
    awarenessStage,
    customerProblem,
    purchaseBarrier,
    hookType,
    offerType,
    tone,
    proofElements,
    visualEmphasis,
  };
}
