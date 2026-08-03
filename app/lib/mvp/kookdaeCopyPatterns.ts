import type { AdImageLabel, GeneratedAdCopyVariant, ProductInfoForPrompt } from "./types";

export const kookdaeHeadlinePatterns = {
  priceShock: [
    "와 진심 미쳤다",
    "이거 실화냐 가격 실화냐",
    "{가격대}로 이 퀄리티가 가능하다고?",
    "가격 보고 두 번 확인했습니다, 오타 아닙니다",
  ],
  insiderConfession: [
    "아버지가 정육점을 해도 이 가격엔 절대 못 사옵니다",
    "우리 사장님, 결심하셨습니다",
    "사장님이 미쳤어요.. 이 가격 진짜 손해 보고 파는 겁니다",
    "담당자 컨펌 없이 그냥 올렸습니다",
    "직원인 저도 이해 안 되는 가격입니다",
  ],
  reversal: [
    "이 가격 보고 저도 두 번 놀랐습니다",
    "장바구니에 넣고 결제할 때까지 의심했습니다",
    "반신반의로 시켰다가 바로 재주문했습니다",
    "속는 셈 치고 시켰는데 인생 고기 만났습니다",
  ],
  giftFamily: [
    "{가격대}로 생색 제대로 내는 {상품명} 찾았습니다",
    "선물하면 반응 폭발하는 {상품명}",
    "온가족이서 배터지게 먹었네요",
    "부모님 선물, 이 가격이면 부담 없어요",
  ],
  expertAuthority: [
    "20년차 정육 명장이 직접 고른 등급",
    "정육점 사장님들이 이 글 보면 화낼 가격",
    "전국 정육점 사장님들이 몰래 사가는 그 부위",
  ],
} as const;

export type KookdaePatternName = keyof typeof kookdaeHeadlinePatterns;

export type KookdaeVariantKey = "short" | "medium" | "long";

type KookdaeVariantPatternSet = {
  headline: string[];
  bodyCopy: string[];
  highlightCopy: string[];
  bottomBarCopy: string[];
  cta: string[];
};

export const kookdaeVariantPatterns: Record<KookdaeVariantKey, KookdaeVariantPatternSet> = {
  short: {
    headline: [
      "와 진심 미쳤다",
      "이 가격 실화냐",
      "사장님 결심가,,",
      "가격보고 두번 봄;;",
      "이건 손해가..",
      "이 가격 맞아?",
      "진짜 이 가격임;;",
      "도매가 미쳤다..",
      "고기값 실화냐",
      "이거 오타 아님?",
    ],
    bodyCopy: [
      "가족식사로 든든해요",
      "잡내 없이 부드러워요",
      "양도 맛도 미쳤어요",
      "캠핑용으로 딱이에요",
      "입에서 살살 녹음..",
      "가격이 말이 안 됨;;",
      "온가족 배터짐,,",
    ],
    highlightCopy: [
      "{가격대} 특가",
      "도매가 특가",
      "오늘만 특가",
      "품절임박",
      "{부위명} 특가",
      "이 가격 실화",
      "마진포기급",
    ],
    bottomBarCopy: [
      "품절 전 담기",
      "지금 담아야 손해 안 봅니다",
      "오늘만 도매가 판매",
      "이 가격 다시 없음",
      "마진도 안 남는 특가",
    ],
    cta: ["구매하기", "특가 확인", "지금 담기", "바로 보기", "품절 전 담기"],
  },
  medium: {
    headline: [
      "이 가격 보고 두 번 놀랐습니다",
      "사장님이 결심한 가격입니다",
      "정육점 사장님도 놀랄 가격",
      "이 가격 진짜 맞습니다;;",
      "가격 보고 다시 확인했습니다..",
      "이 가격이면 일단 담아야죠,,",
      "{부위명}이 이 가격이라고요?",
      "고기값 보고 저도 멈칫했습니다;;",
      "온가족 먹을 고기값이 이 정도라니..",
    ],
    bodyCopy: [
      "잡내 없이 부드러운 찰진 {부위명}이에요",
      "가족끼리 배터지게 먹기 좋은 구성입니다",
      "캠핑용으로 구워도 양도 맛도 든든해요",
      "입에서 살살 녹고 가격은 진짜 말도 안 됩니다",
      "고소하고 부드러운데 가격까지 착해요..",
      "양도 넉넉해서 가족식사로 딱이에요;;",
      "이 정도 구성에 이 가격이면 진짜 괜찮습니다",
    ],
    highlightCopy: [
      "{가격대} {부위명} 특가",
      "{부위명} 도매가",
      "오늘만 한정 도매가",
      "가족식사용 든든한 구성",
      "잡내 없이 부드러운 특가",
      "온가족 든든한 고기 구성",
    ],
    bottomBarCopy: [
      "잡내 없이 부드러운 찰진 {부위명} 도매가 판매",
      "캠핑/가족식사용으로 든든한 구성",
      "마진도 안 남는 역대급 특가로 모십니다",
      "온가족이서 배터지게 먹기 좋은 구성입니다",
      "이 가격이면 오늘 담아야 손해 안 봅니다",
    ],
    cta: ["특가 확인하기", "지금 구매하기", "품절 전 담기", "오늘 특가 보기", "지금 담아두기"],
  },
  long: {
    headline: [
      "사장님이 미쳤어요.. 이 가격 진짜 손해 보고 파는 겁니다",
      "아버지가 정육점을 해도 이 가격엔 절대 못 사옵니다",
      "가격 보고 두 번 확인했습니다, 오타 아닙니다",
      "계산기 두드리다가 손해인 거 알면서도 올립니다",
      "이 가격 보고 저도 두 번 놀랐습니다",
      "경리팀이 계산 잘못한 줄 알았습니다, 진짜 맞는 가격입니다",
      "정육점 사장님들이 이 글 보면 화낼 가격입니다",
      "마진 없다고 본사에서 뒤집어졌습니다",
    ],
    bodyCopy: [
      "캠핑용 고기로 샀어요..입에서 살살 녹고 양도 많은데 가격이 진짜 말도 안 됩니다",
      "입에서 살살 녹고 양도 든든한 {부위명} 구성이에요",
      "잡내 없이 부드럽고 가족끼리 배터지게 먹기 좋은 구성이에요",
      "명절/생일/집들이 선물로 눈치 안 보이는 비주얼, 근데 가격은 반값입니다",
      "고소하고 부드러운 고기를 이 가격에 담을 수 있다는 게 진짜 말이 안 됩니다",
      "캠핑 가서 구워 먹기에도 좋고, 가족식사로 올려도 생색 제대로 납니다",
    ],
    highlightCopy: [
      "{부위명} {가격대}로 온가족이서 배터지게 먹었네요",
      "찰진 {부위명} {가격대} 도매가 특가",
      "오늘만 한정 도매가로 풀었습니다",
      "이 가격이면 가족식사도 선물도 부담 없습니다",
    ],
    bottomBarCopy: [
      "잡내 없이 부드러운 {부위명} 도매가 판매",
      "마진도 안 남는 역대급 폭락가로 모십니다",
      "캠핑/가족식사용으로 배터지게 먹기 좋은 구성입니다",
      "오늘만 이 가격, 품절되면 다시 보기 어렵습니다",
    ],
    cta: ["품절 전에 서두르세요", "지금 구매하기", "품절 전 담기", "오늘 특가 확인하기"],
  },
};

export type KookdaeSelectedPattern = {
  variant: KookdaeVariantKey;
  patternGroup: KookdaePatternName;
  sourcePattern: string;
  tone: string;
};

export const kookdaeGenericForbiddenPhrases = [
  "만나보세요",
  "특별한 기회",
  "특별한 가격으로 만나는 기회",
  "합리적인 가격",
  "프리미엄 품질",
  "고품질 상품",
  "놓치지 마세요",
  "지금 확인하세요",
  "만족스러운 선택",
  "특별한 선택",
  "좋은 기회",
  "뛰어난 품질",
  "신선한 경험",
  "여러분을 기다립니다",
  "자세히 알아보기",
];

export const kookdaeGenericReplacements: Array<[RegExp, string]> = [
  [/특별한 기회/g, "가격 보고 다시 확인했습니다"],
  [/특별한 가격으로 만나는 기회/g, "가격 보고 두 번 확인했습니다"],
  [/합리적인 가격/g, "사장님이 결심한 가격"],
  [/프리미엄 품질/g, "잡내 없이 부드러운 고기"],
  [/고품질 상품/g, "부드럽고 든든한 구성"],
  [/놓치지 마세요/g, "품절 전에 담아두세요"],
  [/지금 확인하세요/g, "특가 확인하기"],
  [/만족스러운 선택/g, "가족식사로 든든한 구성"],
  [/특별한 선택/g, "선물하기 부담 없는 구성"],
  [/좋은 기회/g, "이 가격 다시 없을 구성"],
  [/뛰어난 품질/g, "잡내 없이 부드러운 품질"],
  [/신선한 경험/g, "입에서 살살 녹는 구성"],
  [/여러분을 기다립니다/g, "품절 전 담아두세요"],
  [/자세히 알아보기/g, "구성 보러가기"],
  [/만나보세요/g, "특가 확인하기"],
];

function clean(value?: string) {
  return String(value || "")
    .replace(/[\u{1f000}-\u{1ffff}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeKookdaePunctuation(value: string, options?: { cta?: boolean }) {
  let text = clean(value)
    .replace(/;{3,}/g, ";;")
    .replace(/\.{3,}/g, "..")
    .replace(/,{3,}/g, ",,")
    .replace(/\?{2,}/g, "?")
    .replace(/!{2,}/g, "!")
    .replace(/\?!{2,}/g, "?!");

  if (options?.cta) {
    text = text.replace(/[;,]+$/g, "").replace(/\.{2,}$/g, "");
  }

  return text.trim();
}

export function kookdaePriceBand(product: ProductInfoForPrompt) {
  const source = clean(product.price || product.discountInfo || product.mainBenefit);
  const match = source.match(/[\d,]+/);
  if (!match) return "";
  const value = Number(match[0].replace(/,/g, ""));
  if (!value || Number.isNaN(value)) return "";
  if (value >= 10000) return `${Math.floor(value / 10000)}만원대`;
  return `${value.toLocaleString("ko-KR")}원`;
}

export function kookdaeProductFacts(product: ProductInfoForPrompt, reference?: AdImageLabel) {
  const source = [
    product.productName,
    product.category,
    product.mainBenefit,
    product.extractedDescription,
    reference?.finalLabel?.ocrText,
    reference?.finalLabel?.appealPoint,
  ].join(" ");
  const cut =
    source.match(/(등심|갈비|한우|설록우|스테이크|채끝|안심|차돌|불고기|국거리)/)?.[1] ||
    "";

  return {
    productName: clean(product.productName || cut || "고기"),
    cut,
    price: clean(product.price),
    originalPrice: clean(product.originalPrice || product.oldPrice),
    discountInfo: clean(product.discountInfo),
    priceBand: kookdaePriceBand(product),
    benefit: clean(product.mainBenefit),
    useCase:
      source.match(/(캠핑|가족식사|선물|명절|홈파티|부모님|집들이)/)?.[1] || "가족식사",
  };
}

export function chooseKookdaePatternNames(
  product: ProductInfoForPrompt,
  reference?: AdImageLabel
): KookdaePatternName[] {
  const facts = kookdaeProductFacts(product, reference);
  const source = [
    product.productName,
    product.discountInfo,
    product.mainBenefit,
    reference?.finalLabel?.hookType,
    reference?.finalLabel?.appealPoint,
    reference?.finalLabel?.copyNuance,
    reference?.finalLabel?.whyItWorks,
  ].join(" ");
  const names: KookdaePatternName[] = [];

  if (facts.price || facts.discountInfo || /가격|할인|특가|도매|폭락/.test(source)) {
    names.push("priceShock");
  }
  if (/사장|담당자|내부|정육|원가|손해/.test(source)) {
    names.push("insiderConfession");
  }
  if (/선물|가족|부모님|명절|모임|캠핑/.test(source)) {
    names.push("giftFamily");
  }
  if (/후기|리뷰|반신반의|의심|놀랐/.test(source)) {
    names.push("reversal");
  }
  if (/명장|전문가|정육점|등급|품질/.test(source)) {
    names.push("expertAuthority");
  }

  const fallbackNames: KookdaePatternName[] = ["priceShock", "giftFamily"];
  return Array.from(new Set(names.length ? names : fallbackNames)).slice(0, 2);
}

export function fillKookdaePattern(pattern: string, product: ProductInfoForPrompt, reference?: AdImageLabel) {
  const facts = kookdaeProductFacts(product, reference);
  return pattern
    .replace(/\{가격대\}/g, facts.priceBand || facts.price || "이 가격")
    .replace(/\{상품명\}/g, facts.cut || facts.productName || "고기")
    .replace(/\{부위명\}/g, facts.cut || facts.productName || "고기")
    .replace(/\{상황\}/g, facts.useCase)
    .replace(/\{품질특징\}/g, facts.benefit || "잡내 없이 부드러운");
}

function selectVariantPattern(
  variant: KookdaeVariantKey,
  slot: keyof KookdaeVariantPatternSet,
  product: ProductInfoForPrompt,
  reference?: AdImageLabel
) {
  const patternNames = chooseKookdaePatternNames(product, reference);
  const facts = kookdaeProductFacts(product, reference);
  const source = [
    product.productName,
    product.discountInfo,
    product.mainBenefit,
    reference?.finalLabel?.hookType,
    reference?.finalLabel?.appealPoint,
    reference?.finalLabel?.copyNuance,
    reference?.finalLabel?.whyItWorks,
  ].join(" ");
  const pool = kookdaeVariantPatterns[variant][slot];

  let index = 0;
  if (slot === "headline") {
    if (patternNames.includes("insiderConfession")) index = variant === "long" ? 0 : 1;
    else if (patternNames.includes("giftFamily")) index = variant === "short" ? 1 : 5;
    else if (patternNames.includes("reversal")) index = variant === "long" ? 4 : 4;
    else if (/도매|폭락|특가|할인|가격/.test(source) || facts.price || facts.priceBand) {
      index = variant === "short" ? 2 : variant === "medium" ? 3 : 0;
    }
  } else if (slot === "bodyCopy") {
    index = facts.useCase === "캠핑" ? 2 : patternNames.includes("giftFamily") ? 1 : 0;
  } else if (slot === "highlightCopy") {
    index = facts.priceBand ? 0 : facts.discountInfo ? 2 : 1;
  } else if (slot === "bottomBarCopy") {
    index = patternNames.includes("insiderConfession") ? 2 : patternNames.includes("giftFamily") ? 3 : 0;
  } else if (slot === "cta") {
    index = variant === "short" ? 1 : variant === "medium" ? 0 : 2;
  }

  const sourcePattern = pool[index % pool.length];
  return {
    text: normalizeKookdaePunctuation(fillKookdaePattern(sourcePattern, product, reference), {
      cta: slot === "cta",
    }),
    sourcePattern,
    patternGroup: patternNames[0] || "priceShock",
  };
}

export function buildKookdaeCopyVariantsFromPatterns(
  product: ProductInfoForPrompt,
  reference?: AdImageLabel
): {
  variants: {
    short: GeneratedAdCopyVariant;
    medium: GeneratedAdCopyVariant;
    long: GeneratedAdCopyVariant;
  };
  selectedPatterns: KookdaeSelectedPattern[];
} {
  const facts = kookdaeProductFacts(product, reference);
  const selectedPatterns: KookdaeSelectedPattern[] = [];
  const buildVariant = (variant: KookdaeVariantKey): GeneratedAdCopyVariant => {
    const headline = selectVariantPattern(variant, "headline", product, reference);
    selectedPatterns.push({
      variant,
      patternGroup: headline.patternGroup,
      sourcePattern: headline.sourcePattern,
      tone:
        variant === "short"
          ? "punctuationTone"
          : variant === "medium"
            ? "colloquialTone"
            : "insiderConfession",
    });

    return {
      headline: headline.text,
      bodyCopy: selectVariantPattern(variant, "bodyCopy", product, reference).text,
      highlightCopy: selectVariantPattern(variant, "highlightCopy", product, reference).text,
      bottomBarCopy: selectVariantPattern(variant, "bottomBarCopy", product, reference).text,
      cta: selectVariantPattern(variant, "cta", product, reference).text,
      price: facts.price,
    };
  };

  return {
    variants: {
      short: buildVariant("short"),
      medium: buildVariant("medium"),
      long: buildVariant("long"),
    },
    selectedPatterns,
  };
}

export function kookdaeFallbackCopy(
  product: ProductInfoForPrompt,
  reference?: AdImageLabel
): GeneratedAdCopyVariant {
  const facts = kookdaeProductFacts(product, reference);
  const patternNames = chooseKookdaePatternNames(product, reference);
  const firstPattern = kookdaeHeadlinePatterns[patternNames[0]][0];
  const headline = fillKookdaePattern(firstPattern, product, reference);
  const priceLabel = facts.priceBand ? `${facts.priceBand} 특가` : "도매가 특가";

  return {
    headline,
    bodyCopy:
      facts.benefit ||
      (facts.useCase === "캠핑"
        ? "캠핑용으로 구워도 부드럽고 양도 든든해요"
        : "가족끼리 배터지게 먹기 좋은 구성입니다"),
    highlightCopy: facts.discountInfo || priceLabel,
    bottomBarCopy:
      facts.cut || facts.productName
        ? `잡내 없이 부드러운 ${facts.cut || facts.productName} 도매가 판매`
        : "마진도 안 남는 역대급 폭락가로 모십니다",
    cta: "특가 확인하기",
    price: facts.price,
  };
}

export function kookdaePatternPromptBlock() {
  return `
[국대한우 카피 패턴 라이브러리]
국대한우 가이드는 단순 참고자료가 아니라 문구 생성의 1차 스타일 기준이다.
상품 정보의 가격/수량/등급/리뷰 사실은 반드시 지키되, 말투와 문장 구조는 아래 패턴을 강하게 따른다.

패턴 그룹:
${JSON.stringify(kookdaeHeadlinePatterns, null, 2)}

길이별 독립 copyVariants 패턴:
${JSON.stringify(kookdaeVariantPatterns, null, 2)}

생성 절차:
1. productInfo에서 상품명, 부위명, 가격, 기존가, 할인율, 용도, 품질 특징, 구성, 타겟 상황을 추출한다.
2. priceShock, insiderConfession, reversal, giftFamily, expertAuthority 중 1~2개를 선택한다.
3. 선택한 패턴으로 headline 후보 8개를 만든다.
4. 상품 정보와 맞지 않거나, 없는 가격/리뷰/수량을 만든 후보, generic 후보를 제거한다.
5. 최종 headline 1개를 고른다.
6. bodyCopy는 headline을 반복하지 않고 맛/구성/상황을 존댓말 1문장으로 보강한다.
7. highlightCopy는 "도매가 판매", "4만원대 특가", "오늘만 특가", "잡내 없이 부드러운", "가족식사용 구성"처럼 짧은 라벨로 쓴다.
8. bottomBarCopy는 빨간 바/하단 바에 들어갈 짧은 구매 명분으로 쓴다.
9. cta는 "지금 구매하기", "특가 확인하기", "품절 전 담기"처럼 짧게 쓴다.
10. copyVariants.short/medium/long은 절대 긴 문장을 자른 결과가 아니다.
11. short는 short 전용 패턴에서, medium은 medium 전용 패턴에서, long은 long 전용 패턴에서 각각 독립적으로 고른다.
12. short/medium에는 "사장님 결심가,,", "가격보고 두번 봄;;", "가격 보고 다시 확인했습니다.."처럼 자연스러운 말끝 기호를 허용한다.
13. CTA에는 과한 말끝 기호를 붙이지 않는다.

예문 복붙 금지의 의미:
- 상품 정보와 맞지 않는 문장을 맹목적으로 복사하지 말라는 뜻이다.
- 단, 국대한우는 가이드 예문과 문장 결이 가까워야 한다.
- 어투, 속도감, 감탄 구조, 가격 충격 문법, 내부자 고백형 구조는 적극적으로 사용한다.
- 상품 정보가 맞으면 가이드 예문을 가깝게 패러프레이즈해도 된다.

국대한우 금지 generic 표현:
${kookdaeGenericForbiddenPhrases.map((phrase) => `- ${phrase}`).join("\n")}
`;
}
