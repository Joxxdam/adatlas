import type {
  AdaptiveLayoutPlan,
  CreativeGrammarId,
  GenerationResult,
  HookPlan,
  ProductTruth,
} from "./types.ts";

export const REFERENCE_CREATIVE_GRAMMAR_VERSION = "reference-creative-grammar-v2-37-samples";
export const ADAPTIVE_LAYOUT_VERSION = "adaptive-native-layout-v2";

export type ReferenceCreativeGrammar = {
  id: CreativeGrammarId;
  label: string;
  hookPattern: string;
  scenePattern: string;
  typographyPattern: string;
  graphicMotifs: AdaptiveLayoutPlan["graphicMotif"][];
  preferredPalettes: string[];
};

/**
 * Reusable grammar distilled from the supplied quality references. These are
 * semantic directions, never fixed pixel templates or copied layouts.
 */
export const referenceCreativeGrammars: ReferenceCreativeGrammar[] = [
  { id:"PROVOCATIVE_REVERSAL", label:"선 넘는 반전", hookPattern:"상식이나 망설임을 짧은 질문·부정으로 뒤집는다", scenePattern:"문제의 순간과 상품 해결을 한 프레임에서 강하게 대비", typographyPattern:"두꺼운 고딕, 한 단어 색상 반전", graphicMotifs:["marker","circle","arrow"], preferredPalettes:["signal-red","mono-teal"] },
  { id:"SENSORY_PROOF", label:"감각 증명", hookPattern:"맛·향·온도·질감을 동작과 의성어로 먼저 느끼게 한다", scenePattern:"재료나 사용감의 매크로 움직임과 실제 상품 접촉면", typographyPattern:"압축형 디스플레이와 손글씨 보조", graphicMotifs:["marker","arrow","label"], preferredPalettes:["fresh-citrus","cool-mint","food-heat"] },
  { id:"SITUATION_STORY", label:"상황 한 컷", hookPattern:"고객이 겪는 구체적인 시간·장소·행동을 말한다", scenePattern:"인물의 행동과 상품 사용이 같은 시선 안에서 이해되는 사진", typographyPattern:"상단 상황문 + 하단 해결문", graphicMotifs:["speech","label","none"], preferredPalettes:["lifestyle-dark","natural-paper"] },
  { id:"PRICE_VALUE", label:"가격·가치 충격", hookPattern:"확인된 중량·구성·가격의 의외성을 한 문장으로 만든다", scenePattern:"실제 판매 단위를 풍성하게 보여주되 가격이 상품을 가리지 않음", typographyPattern:"큰 숫자와 짧은 전후 비교", graphicMotifs:["receipt","circle","label"], preferredPalettes:["signal-red","sale-yellow"] },
  { id:"SOCIAL_DIALOGUE", label:"후기·대화", hookPattern:"확인된 후기의 말투나 주변인의 반응으로 시작한다", scenePattern:"UGC 같은 현실 장면 또는 말풍선이 자연스러운 사용 장면", typographyPattern:"대화체와 손글씨, 인용부호", graphicMotifs:["speech","marker","label"], preferredPalettes:["ugc-black","cool-mint"] },
  { id:"FEATURE_EVIDENCE", label:"기능 근거", hookPattern:"성분·구조·원산지 등 확인된 한 가지 차이를 쉽게 번역한다", scenePattern:"상품 히어로와 근거가 되는 재료·디테일을 가까이 연결", typographyPattern:"명료한 고딕과 작은 증거 라벨", graphicMotifs:["label","circle","arrow"], preferredPalettes:["clean-proof","natural-paper"] },
  { id:"BUNDLE_LINEUP", label:"구성 라인업", hookPattern:"세트·선택·반복 사용의 이득을 실제 구성으로 설명한다", scenePattern:"확인된 동일 상품 또는 구성만 크기 차이와 겹침으로 배열", typographyPattern:"반복 리듬과 구성 숫자 강조", graphicMotifs:["label","arrow","receipt"], preferredPalettes:["sale-yellow","clean-proof"] },
  { id:"SEASON_URGENCY", label:"시즌 긴급성", hookPattern:"실제 기간·계절 근거가 있을 때 놓치는 비용을 말한다", scenePattern:"시즌 빛·온도·행동과 상품을 하나의 순간으로 연결", typographyPattern:"속도감 있는 사선·밑줄", graphicMotifs:["marker","arrow","circle"], preferredPalettes:["season-bright","signal-red"] },
  { id:"PREMIUM_EDITORIAL", label:"프리미엄 에디토리얼", hookPattern:"가격보다 선택 기준·원산지·감각을 절제해 말한다", scenePattern:"여백 있는 고급 촬영과 자연스러운 표면·조명", typographyPattern:"에디토리얼 세리프와 작은 캡션", graphicMotifs:["none","label"], preferredPalettes:["premium-ink","natural-paper"] },
  { id:"PROBLEM_RELIEF", label:"문제에서 해방", hookPattern:"고객이 숨기고 싶은 불편을 구체적으로 드러낸 뒤 해결을 제시한다", scenePattern:"문제 표정·행동과 상품 사용 후의 안도감을 대비", typographyPattern:"문제는 거칠게, 해결은 선명하게", graphicMotifs:["marker","speech","arrow"], preferredPalettes:["mono-teal","signal-red"] },
];

const grammarByTag: Record<string, CreativeGrammarId> = {
  "problem-solution":"PROBLEM_RELIEF",
  "sensory-experience":"SENSORY_PROOF",
  "price-value":"PRICE_VALUE",
  "feature-usp":"FEATURE_EVIDENCE",
  "review-trust":"SOCIAL_DIALOGUE",
  "usage-occasion":"SITUATION_STORY",
  "target-identity":"SITUATION_STORY",
  convenience:"PROBLEM_RELIEF",
  "bundle-choice":"BUNDLE_LINEUP",
  "season-newness":"SEASON_URGENCY",
  "brand-origin":"PREMIUM_EDITORIAL",
  "comparison-alternative":"PROVOCATIVE_REVERSAL",
  "scarcity-urgency":"SEASON_URGENCY",
  "gift-purpose":"SITUATION_STORY",
  other:"PREMIUM_EDITORIAL",
};

export function selectCreativeGrammar(hook: HookPlan): CreativeGrammarId {
  if (hook.creativeGrammarId) return hook.creativeGrammarId;
  if (/\?|아직|굳이|왜|말고|안\s/u.test(hook.headline)) return "PROVOCATIVE_REVERSAL";
  return grammarByTag[hook.primaryTag || "other"] || "PREMIUM_EDITORIAL";
}

function stableIndex(value: string, length: number) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return Math.abs(hash) % Math.max(1, length);
}

export function buildAdaptiveLayoutPlan(input: {
  truth: ProductTruth;
  result: GenerationResult;
  groupResults?: GenerationResult[];
}): AdaptiveLayoutPlan {
  const { truth, result } = input;
  const grammarId = selectCreativeGrammar(result.hookPlan);
  const grammar = referenceCreativeGrammars.find((item) => item.id === grammarId)!;
  const order = Math.max(0, result.order - 1);
  const variants = [
    { sceneAnchor:"full-bleed", copyAnchor:"top-left", productAnchor:"right", textAlign:"left" },
    { sceneAnchor:"right-story", copyAnchor:"left-center", productAnchor:"bottom-right", textAlign:"left" },
    { sceneAnchor:"top-story", copyAnchor:"bottom-center", productAnchor:"center", textAlign:"center" },
    { sceneAnchor:"split-story", copyAnchor:"top-center", productAnchor:"bottom-left", textAlign:"center" },
    { sceneAnchor:"left-story", copyAnchor:"bottom-left", productAnchor:"right", textAlign:"left" },
    { sceneAnchor:"full-bleed", copyAnchor:"top-center", productAnchor:"center", textAlign:"center" },
  ] as const;
  // Rotate the complete six-layout set with a product-stable offset. The six
  // cards stay mutually distinct while different products do not inherit the
  // same H01 coordinate arrangement.
  const productOffset = stableIndex(truth.productId, variants.length);
  const variant = variants[(order + productOffset) % variants.length];
  const hasBundle = Boolean(
    truth.normalized.composition ||
    /(?:세트|구성|택\s*\d|\d+\s*(?:개|팩|병|종))/u.test(truth.normalized.packageOrOption || "")
  );
  const productCount: 1|2|3 = grammarId === "BUNDLE_LINEUP" && hasBundle ? 3 : hasBundle && order % 3 === 1 ? 2 : 1;
  const priceEmphasis = grammarId === "PRICE_VALUE" && Boolean(truth.normalized.price);
  const motif = grammar.graphicMotifs[stableIndex(`${truth.productId}:${result.hookPlan.hookCode}`, grammar.graphicMotifs.length)];
  const scaleByGrammar: Record<CreativeGrammarId, number> = {
    PROVOCATIVE_REVERSAL:.42, SENSORY_PROOF:.48, SITUATION_STORY:.38, PRICE_VALUE:.48,
    SOCIAL_DIALOGUE:.36, FEATURE_EVIDENCE:.50, BUNDLE_LINEUP:.34, SEASON_URGENCY:.43,
    PREMIUM_EDITORIAL:.46, PROBLEM_RELIEF:.40,
  };
  return {
    version:ADAPTIVE_LAYOUT_VERSION,
    id:`layout-${result.hookPlan.hookCode}-${grammarId.toLowerCase()}`,
    grammarId,
    ...variant,
    productScale:Math.max(.32, scaleByGrammar[grammarId] - (productCount - 1) * .07 + (stableIndex(`${truth.productId}:${result.hookPlan.hookCode}:scale`,3)-1)*.025),
    productCount,
    productRotation:productCount === 3 ? [-6,0,6] : productCount === 2 ? [-4,4] : [order % 2 ? 3 : -2],
    typographyRole:grammarId === "PREMIUM_EDITORIAL" ? "editorial" : grammarId === "SOCIAL_DIALOGUE" ? "handwritten" : grammarId === "SENSORY_PROOF" ? "display" : "heavy",
    headlineMaxWidth:variant.textAlign === "center" ? 980 : 620,
    headlineMaxLines:2,
    subCopyMaxWidth:variant.textAlign === "center" ? 850 : 560,
    graphicMotif:motif,
    paletteId:grammar.preferredPalettes[stableIndex(result.hookPlan.sceneIntent || result.id, grammar.preferredPalettes.length)],
    contrastSurface:grammarId === "PREMIUM_EDITORIAL" ? "paper" : variant.sceneAnchor === "full-bleed" ? "gradient" : "solid",
    priceEmphasis,
    sceneKey:result.hookPlan.creativeBrief?.sceneType || result.hookPlan.creativeBrief?.heroScene || result.hookPlan.sceneIntent,
    reasons:[grammar.hookPattern, grammar.scenePattern, `${result.hookPlan.hookCode} 전용 ${variant.copyAnchor}/${variant.productAnchor} 구도`],
  };
}
