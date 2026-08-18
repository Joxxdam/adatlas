import { matchCategoryProfile } from "./profiles.ts";
import type {
  CreativeBlueprintId,
  HookCreativeBrief,
  HookHypothesisCandidate,
  HookHypothesisScore,
  HookTaxonomyTag,
  ProductFact,
  ProductInsightProfile,
  ProductTruth,
} from "./types.ts";

export type CategoryHookPrior = Partial<Record<HookTaxonomyTag, number>>;

const tagLabels: Record<HookTaxonomyTag, string> = {
  "problem-solution": "문제 해결",
  "sensory-experience": "감각 경험",
  "price-value": "가격·가치",
  "feature-usp": "기능·USP",
  "review-trust": "후기·신뢰",
  "usage-occasion": "사용 상황",
  "target-identity": "타깃 정체성",
  convenience: "편의",
  "bundle-choice": "세트·선택",
  "season-newness": "시즌·신상품",
  "brand-origin": "브랜드·원산지",
  "comparison-alternative": "비교·대안",
  "scarcity-urgency": "한정·긴급",
  "gift-purpose": "선물 목적",
  other: "기타",
};

const blueprintByTag: Record<HookTaxonomyTag, CreativeBlueprintId> = {
  "problem-solution": "problem-solution-split",
  "sensory-experience": "product-hero-lifestyle",
  "price-value": "proof-data",
  "feature-usp": "proof-data",
  "review-trust": "chat-ugc",
  "usage-occasion": "editorial-story",
  "target-identity": "editorial-story",
  convenience: "problem-solution-split",
  "bundle-choice": "comparison-versus",
  "season-newness": "editorial-story",
  "brand-origin": "product-hero-lifestyle",
  "comparison-alternative": "comparison-versus",
  "scarcity-urgency": "proof-data",
  "gift-purpose": "editorial-story",
  other: "product-hero-lifestyle",
};

function clean(value: unknown) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function words(value: string, maxVisible: number) {
  const normalized = clean(value).replace(/[.!]+$/u, "");
  if (Array.from(normalized.replace(/\s/g, "")).length <= maxVisible) return normalized;
  const parts = normalized.split(/\s+/);
  const kept: string[] = [];
  for (const part of parts) {
    const next = [...kept, part].join(" ");
    if (Array.from(next.replace(/\s/g, "")).length > maxVisible) break;
    kept.push(part);
  }
  return kept.join(" ") || parts[0] || normalized;
}

function koreanObject(value: string) {
  const normalized = clean(value);
  const last = normalized.at(-1) || "";
  const code = last.charCodeAt(0);
  const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return `${normalized}${hasBatchim ? "을" : "를"}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function compactProductName(truth: ProductTruth) {
  const brandTerms = unique([
    clean(truth.product.brandName),
    clean(truth.product.advertiserName),
  ]).filter(Boolean);
  let value = clean(truth.product.productName).replace(
    /\b\d+(?:\.\d+)?\s*(?:ml|mL|l|L|g|kg)\b/gi,
    " "
  );
  value = value
    .replace(/[★☆◆◇♥♡●■▶▷✔✓🍏🍎🔥]/gu, " ")
    .replace(/\b\d[\d,.]*\s*(?:원|%|개|팩|병|박스)\b/gi, " ")
    .replace(/(?:^|\s)(?:1등|특가|한정특가|초특가|무료배송|이벤트)(?:\s|$)/gi, " ")
    .replace(/(?:아삭달콤|여름한정|지금만|놓치지\s*마세요)/gi, " ");
  for (const brand of brandTerms) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    value = value.replace(new RegExp(escaped, "ig"), " ");
  }
  value = clean(value);
  const produceName = value.match(/(?:[가-힣]{2,8}\s*)?(?:청사과|아오리|여름사과|사과|복숭아|자두|포도|수박|참외|배)(?:\s+[가-힣]{2,8})?/u)?.[0];
  if (produceName) return words(produceName, 12);
  const throughSet = value.match(/^(.{2,30}?(?:\d+\s*종\s*세트|\d+\s*개\s*세트|세트))/u)?.[1];
  return words(throughSet || value, 20);
}

function matchingFacts(truth: ProductTruth, predicate: (fact: ProductFact) => boolean) {
  return truth.facts.filter((fact) => fact.usableInCopy && predicate(fact));
}

function signal(facts: ProductFact[]) {
  return facts.map((fact) => ({ value: fact.value, factIds: [fact.id] }));
}

function factStrength(truth: ProductTruth, factIds: string[]) {
  const facts = factIds
    .map((factId) => truth.facts.find((fact) => fact.id === factId))
    .filter((fact): fact is ProductFact => Boolean(fact));
  if (!facts.length) return 30;
  return Math.round(
    facts.reduce(
      (sum, fact) => sum + (fact.strength ?? 50) * 0.55 + (fact.specificity ?? 50) * 0.45,
      0
    ) / facts.length
  );
}

function derivedProblem(target: string, benefit: string) {
  const targetText = clean(target)
    .replace(/(?:을|를)?\s*(?:원하는|찾는|준비하는|챙기려는)\s*(?:사람|고객)?$/u, "")
    .replace(/고객$/u, "")
    .trim();
  if (/외출|여행|휴대|헬스장|캠핑|챙/.test(`${targetText} ${benefit}`))
    return "외출할 때 필요한 용품 챙기기";
  if (/운동/.test(targetText)) return "운동 뒤 남는 불편";
  if (/출근|주말/.test(targetText)) return "상황마다 다른 선택의 번거로움";
  if (/좁은|정리|수납/.test(targetText)) return "공간 정리의 번거로움";
  if (/아침|식사/.test(targetText)) return "매일 준비하는 식사의 번거로움";
  return targetText || words(benefit, 16);
}

function usageMoment(target: string, category: string) {
  const source = `${target} ${category}`;
  if (/외출|여행|휴대|헬스장|캠핑|여행용/.test(source))
    return "여행·헬스장·캠핑에서 씻을 때";
  if (/운동/.test(source)) return "운동을 마친 뒤";
  if (/출근/.test(source)) return "출근을 준비하는 아침";
  if (/주말|선물/.test(source)) return "주말 식사나 선물을 고를 때";
  if (/아침|시리얼|그래놀라/.test(source)) return "바쁜 아침을 준비할 때";
  if (/수납|정리|생활/.test(source)) return "집 안을 정리하는 날";
  if (/농산|과일|사과/.test(source)) return "제철 과일을 고를 때";
  return "매일 사용하는 순간";
}

export function buildProductInsightProfile(truth: ProductTruth): ProductInsightProfile {
  const reviewFacts = matchingFacts(truth, (fact) => fact.evidenceType === "review" || /^review/.test(fact.key));
  const priceFacts = matchingFacts(
    truth,
    (fact) => ["price", "offer", "shipping"].includes(fact.evidenceType || "") || /^(price|original-price|discount)/.test(fact.key)
  );
  const optionFacts = matchingFacts(
    truth,
    (fact) =>
      fact.evidenceType !== "identity" &&
      (
      fact.evidenceType === "quantity" ||
      /(?:option|quantity)/i.test(fact.key) ||
      /(?:\d+\s*(?:개|팩|병|세트|종)|세트\s*구성|묶음|택\s*\d+|옵션|파우치\s*포함)/i.test(fact.value)
      )
  );
  const originFacts = matchingFacts(
    truth,
    (fact) =>
      ["origin", "certification"].includes(fact.evidenceType || "") ||
      (!/^original-price$/i.test(fact.key) &&
        /(?:^|[-_\s])origin(?:$|[-_\s])|원산지|산지|인증/i.test(`${fact.key} ${fact.label}`))
  );
  const benefitFacts = matchingFacts(
    truth,
    (fact) => ["usp", "ingredient", "usage", "target", "numeric"].includes(fact.evidenceType || "") || /(?:benefit|ingredient|target|usp)/i.test(fact.key)
  );
  const targetFacts = matchingFacts(truth, (fact) => fact.evidenceType === "target" || /^target/.test(fact.key));
  const usageFacts = matchingFacts(truth, (fact) => fact.evidenceType === "usage" || /usage|상황/.test(fact.key));
  const ingredientFacts = matchingFacts(truth, (fact) => fact.evidenceType === "ingredient" || /^ingredient/.test(fact.key));
  const seasonFacts = matchingFacts(
    truth,
    (fact) => /(?:season|new|limited|시즌|신상품|한정)/i.test(`${fact.key} ${fact.label} ${fact.value}`)
  );
  const benefit = clean(truth.product.mainBenefit || benefitFacts[0]?.value || truth.product.productName);
  const target = clean(truth.product.targetCustomer || targetFacts[0]?.value);
  const use = usageMoment(target, `${truth.product.category} ${truth.product.productName}`);
  const reasons = benefitFacts.length
    ? benefitFacts.slice(0, 6).map((fact) => ({
        id: `reason-${fact.id}`,
        reason: fact.value,
        factIds: [fact.id],
        strength: factStrength(truth, [fact.id]),
      }))
    : [{
        id: "reason-product-identity",
        reason: benefit,
        factIds: truth.facts.filter((fact) => fact.key === "product-name").map((fact) => fact.id),
        strength: 40,
      }];
  const visibleSignals = reasons.length + reviewFacts.length + priceFacts.length + optionFacts.length + originFacts.length + truth.imageAssets.length;
  return {
    productId: truth.productId,
    productName: truth.product.productName,
    category: matchCategoryProfile(truth.product).id,
    brandName: clean(truth.product.brandName || truth.product.advertiserName),
    primaryBenefit: benefit,
    customerReasons: reasons,
    problems: [{ value: derivedProblem(target, benefit), factIds: reasons[0]?.factIds || [] }],
    outcomes: [{ value: benefit, factIds: reasons[0]?.factIds || [] }],
    useOccasions: unique([use, ...usageFacts.map((fact) => fact.value)]).map((value) => ({
      value,
      factIds: usageFacts.filter((fact) => fact.value === value).map((fact) => fact.id).concat(reasons[0]?.factIds || []),
    })),
    targets: target
      ? [{ value: target, factIds: targetFacts.map((fact) => fact.id).concat(reasons[0]?.factIds || []) }]
      : [],
    ingredients: signal(ingredientFacts),
    priceSignals: signal(priceFacts),
    reviewSignals: signal(reviewFacts),
    optionSignals: signal(optionFacts),
    originSignals: signal(originFacts),
    seasonSignals: signal(seasonFacts),
    visualAssets: truth.imageAssets
      .filter((asset) => asset.verified)
      .map((asset) => ({ id: asset.id, role: asset.role, path: asset.path })),
    dataSufficiency: Math.min(100, Math.round(25 + visibleSignals * 7.5)),
  };
}

function rawScores(input: {
  truth: ProductTruth;
  factIds: string[];
  primaryTag: HookTaxonomyTag;
  sceneKey: string;
  prior?: CategoryHookPrior;
  variant: number;
}): HookHypothesisScore {
  const evidenceStrength = Math.min(100, Math.max(20, factStrength(input.truth, input.factIds)));
  const purchaseReasonStrength = ["problem-solution", "price-value", "feature-usp", "convenience", "bundle-choice"].includes(input.primaryTag)
    ? 82
    : 68;
  const distinctiveness = Math.min(94, 58 + input.factIds.length * 9 + input.variant * 3);
  const visualizability = ["sensory-experience", "usage-occasion", "problem-solution", "bundle-choice"].includes(input.primaryTag) ? 90 : 76;
  const claimSafety = input.factIds.length ? 96 : 72;
  const categoryPrior = Math.max(0, Math.min(100, input.prior?.[input.primaryTag] ?? 50));
  const novelty = Math.min(92, 64 + input.variant * 6 + (input.sceneKey.includes("detail") ? 8 : 0));
  const total = Math.round(
    evidenceStrength * 0.25 +
      purchaseReasonStrength * 0.2 +
      distinctiveness * 0.15 +
      visualizability * 0.15 +
      claimSafety * 0.1 +
      categoryPrior * 0.1 +
      novelty * 0.05
  );
  return { evidenceStrength, purchaseReasonStrength, distinctiveness, visualizability, claimSafety, categoryPrior, novelty, total };
}

function makeBrief(input: {
  id: string;
  tag: HookTaxonomyTag;
  mainHook: string;
  subCopy: string;
  customerReason: string;
  verifiedFacts: string[];
  visualStory: string;
  scene: string;
}): HookCreativeBrief {
  return {
    creativeId: `creative-${input.id}`,
    hookCode: "candidate",
    hypothesisId: input.id,
    mainHook: input.mainHook,
    subCopy: input.subCopy,
    customerInsight: input.customerReason,
    messageHypothesis: `${tagLabels[input.tag]} 가설: ${input.customerReason}`,
    verifiedFacts: input.verifiedFacts,
    objective: `${tagLabels[input.tag]} 가설이 실제 고객의 반응을 만드는지 탐색`,
    visualStory: input.visualStory,
    sceneDescription: input.scene,
    productRole: "실제 판매 상품을 장면의 핵심 피사체로 사용",
    composition: "가설에 맞는 장면과 실제 상품이 한눈에 연결되는 1:1 광고 구도",
    cameraDirection: "상품 비율과 라벨 정면을 왜곡하지 않는 상업 사진 구도",
    lightingDirection: "실제 상품의 색과 재질을 유지하고 접촉 그림자가 자연스러운 조명",
    colorDirection: "상품 대표 색상과 카테고리 맥락을 기준으로 한 고대비 팔레트",
    graphicDirection: "장면·상품·한국어 타이포그래피·그래픽을 한 번의 AI 이미지 생성에서 완성",
    copySafeZone: "한국어 후킹이 모바일에서도 즉시 읽히는 명확한 시각 위계",
    referenceImageIds: [],
    forbiddenElements: [
      "기존 광고 배너의 문구·가격·할인·배지·CTA 복제",
      "확인되지 않은 효능·성분·원산지·인증·후기·가격·구성",
      "실제 상품과 다른 패키지·수량·옵션",
      "지정하지 않은 임의의 한글·숫자·가격·로고",
    ],
    productDirection: "실제 상품 레퍼런스의 형태·라벨·색상을 유지하고 주 피사체로 크게 배치",
    backgroundDirection: "후킹과 직접 연결되는 완성 광고 장면을 생성하고 기존 배경 라이브러리를 사용하지 않음",
    copySafeDirection: "메인·서브·CTA를 AI 생성 단계에서 자연스럽게 조판",
    mustUseReferenceImages: true,
    forbidPromotionalBannerCutouts: true,
    textRendering: "ai-native-final",
    requiredKoreanText: [input.mainHook, input.subCopy],
    negativePrompt: ["배경만 생성", "빈 텍스트 박스", "상품 사후 합성", "템플릿 반복"],
  };
}

type Draft = {
  tag: HookTaxonomyTag;
  secondary?: HookTaxonomyTag[];
  main: string;
  sub: string;
  reason: string;
  factIds: string[];
  sceneKey: string;
  visualStory: string;
  scene: string;
};

export function generateHookHypothesisCandidates(
  truth: ProductTruth,
  profile = buildProductInsightProfile(truth),
  prior: CategoryHookPrior = {}
): HookHypothesisCandidate[] {
  const benefit = words(profile.primaryBenefit, 30);
  const product = compactProductName(truth);
  const reason = profile.customerReasons[0];
  const factIds = reason?.factIds || [];
  const problem = words(profile.problems[0]?.value || benefit, 17);
  const occasion = words(profile.useOccasions[0]?.value || "매일 사용하는 순간", 18);
  const target = words(profile.targets[0]?.value || "", 22);
  const targetHook = words(
    target
      .replace(/려는\s*고객$/u, "고 싶다면")
      .replace(/원하는\s*고객$/u, "원한다면")
      .replace(/찾는\s*고객$/u, "찾는다면")
      .replace(/고객$/u, "이라면"),
    24
  );
  const ingredient = words(profile.ingredients[0]?.value || "", 16);
  const isAgriculture = profile.category === "agriculture";
  const sensoryBenefit = isAgriculture
    ? benefit
        .replace(/\s*\/\s*/g, "·")
        .replace(/\s*3박자(?:\s*한번에)?\s*$/u, "")
    : benefit;
  const priceFactIds = unique(profile.priceSignals.flatMap((item) => item.factIds));
  const seasonFactIds = unique(profile.seasonSignals.flatMap((item) => item.factIds));
  const reviewFactIds = unique(profile.reviewSignals.flatMap((item) => item.factIds));
  const priceValues = profile.priceSignals.map((item) => item.value);
  const salePrice = priceValues.find((value) => /원/.test(value) && value === truth.product.price) || truth.product.price;
  const originalPrice = truth.product.originalPrice || truth.product.oldPrice || "";
  const discount = truth.product.discountInfo || "";
  const quantity = clean(
    truth.product.productName.match(/\d[\d,.]*\s*(?:kg|g|개|팩|박스)/i)?.[0] || ""
  );
  const valueHook = [quantity && `${quantity} 한 상자`, salePrice]
    .filter(Boolean)
    .join(" · ");
  const reviewText = profile.reviewSignals.map((item) => item.value).join(" ");
  const reviewKeyword = reviewText.match(/새콤달콤|아삭(?:한|함)?|싱싱(?:한|함)?/u)?.[0] || "실제 구매 후기";
  const agricultureDrafts: Draft[] = [
    {
      tag: "sensory-experience", main: "아삭·새콤달콤, 청량까지", sub: `한입에 만나는 ${product}`,
      reason: benefit, factIds, sceneKey: "fresh-bite", visualStory: "물방울 맺힌 청사과와 한입 베어 문 단면을 크게 보여준다", scene: "실제 청사과 표면과 과육 단면이 선명한 자연광 푸드 광고 사진",
    },
    ...(salePrice
      ? [{
          tag: "price-value" as const, main: valueHook || `${salePrice} 여름 과일`, sub: originalPrice ? `${originalPrice} → ${salePrice}` : discount || benefit,
          reason: [salePrice, originalPrice, discount].filter(Boolean).join(" · "), factIds: priceFactIds, sceneKey: "produce-price-impact", visualStory: "실제 판매 구성의 사과를 풍성하게 채우고 가격 근거를 크게 보여준다", scene: "청사과 한 상자의 풍성한 실물 사진과 가격 문구용 안전 여백",
        }]
      : []),
    {
      tag: "season-newness", main: "이번 여름 지나면 또 1년", sub: `여름에만 만나는 ${product}`,
      reason: "여름 한정", factIds: unique([...factIds, ...seasonFactIds]), sceneKey: "summer-limited-harvest", visualStory: "여름 햇빛 아래 수확 직후 청사과를 보여준다", scene: "여름 과수원의 빛과 실제 청사과를 연결한 산지 에디토리얼 사진",
    },
    {
      tag: "problem-solution", main: salePrice ? `여름사과 ${quantity || "한 상자"}, 만원도 안 한다면?` : "여름 과일, 가격이 망설여진다면", sub: salePrice ? `${salePrice} 여름 한정가` : benefit,
      reason: salePrice || benefit, factIds: unique([...factIds, ...priceFactIds]), sceneKey: "produce-value-solution", visualStory: "한 상자의 양과 구매 가격을 한눈에 비교하게 한다", scene: "실제 청사과 상자와 낱개를 함께 보여주는 정돈된 커머스 사진",
    },
    {
      tag: "usage-occasion", main: "차갑게 꺼내, 한입 아삭", sub: sensoryBenefit,
      reason: occasion, factIds, sceneKey: "summer-snack-moment", visualStory: "무더운 날 시원하게 꺼내 먹는 청사과의 순간을 보여준다", scene: "차가운 물방울과 청사과 한입의 청량함이 느껴지는 실사 푸드 사진",
    },
    ...(!originalPrice
      ? [{
          tag: "comparison-alternative" as const, main: "여름 과일, 무게·가격부터 비교", sub: [quantity, salePrice].filter(Boolean).join(" · ") || benefit,
          reason: [quantity, salePrice].filter(Boolean).join(" · ") || benefit, factIds: unique([...factIds, ...priceFactIds]), sceneKey: "produce-weight-value", visualStory: "실제 판매 중량과 가격을 다른 추정 없이 한눈에 비교하게 한다", scene: "실제 사과 상자와 낱개를 정돈하고 중량·가격 문구용 여백을 둔 커머스 사진",
        }]
      : []),
    ...(reviewFactIds.length
      ? [{
          tag: "review-trust" as const, main: `후기에서 먼저 나온 말, ${reviewKeyword}`, sub: `${product} 실제 구매 후기에서 확인`,
          reason: reviewKeyword, factIds: reviewFactIds, sceneKey: "produce-review-proof", visualStory: "후기에서 언급된 식감이 보이는 과육 단면을 보여준다", scene: "실제 후기의 감각 표현과 연결되는 청사과 단면 근접 사진",
        }]
      : []),
    ...(originalPrice && salePrice
      ? [{
          tag: "comparison-alternative" as const, main: `${originalPrice} → ${salePrice}`, sub: `${discount || "할인"} · 여름 한정 ${product}`,
          reason: `${originalPrice} 대비 ${salePrice}`, factIds: priceFactIds, sceneKey: "produce-price-contrast", visualStory: "기존가와 현재가의 차이를 단순하고 강하게 보여준다", scene: "실제 청사과를 배경으로 가격 전환이 또렷한 퍼포먼스 광고 사진",
        }]
      : []),
    {
      tag: "sensory-experience", main: `${sensoryBenefit}, 3박자`, sub: `${product}, 맛을 고르는 기준`,
      reason: benefit, factIds, sceneKey: "produce-benefit-detail", visualStory: "확인된 식감이나 구성 근거를 사과 표면과 단면으로 보여준다", scene: "실제 판매 사과의 표면과 단면 디테일이 함께 보이는 자연광 푸드 사진",
    },
  ];
  const genericDrafts: Draft[] = [
    {
      tag: "feature-usp", main: benefit, sub: `${product}에서 확인한 핵심 선택 이유`,
      reason: benefit, factIds, sceneKey: "usp-detail", visualStory: "상품의 핵심 특징을 가까운 디테일로 보여준다", scene: "제품 정면과 핵심 성분·구조 디테일이 함께 읽히는 상업 제품 사진",
    },
    {
      tag: "problem-solution", main: `${problem}, 아직도 번거롭게?`, sub: benefit,
      reason: problem, factIds: unique([...factIds, ...(profile.problems[0]?.factIds || [])]), sceneKey: "problem-before-after", visualStory: "고객의 불편과 해결 뒤의 장면을 한 화면 안에서 대비한다", scene: "불편한 사용 전 상황과 상품을 사용한 뒤의 정돈된 상황을 자연스럽게 대비",
    },
    {
      tag: "usage-occasion", main: `${occasion}, 이 선택`, sub: benefit,
      reason: occasion, factIds: unique([...factIds, ...(profile.useOccasions[0]?.factIds || [])]), sceneKey: "usage-moment", visualStory: "상품이 필요한 구체적인 순간을 실제 생활 장면으로 보여준다", scene: `${occasion}의 실제 생활 맥락, 상품은 손이 닿는 위치에 자연스럽게 배치`,
    },
    {
      tag: "comparison-alternative", main: `${product}, 무엇부터 볼까?`, sub: `${benefit}부터 비교해보세요`,
      reason: benefit, factIds, sceneKey: "comparison-criteria", visualStory: "구매 전에 비교할 한 가지 기준을 상품 디테일로 설명한다", scene: "상품 전체와 비교 기준이 되는 디테일을 좌우로 나눠 보여주는 사진형 장면",
    },
    {
      tag: "convenience", main: `${occasion}, 챙길 것은 간단하게`, sub: benefit,
      reason: `${occasion} 준비 편의`, factIds: unique([...factIds, ...(profile.useOccasions[0]?.factIds || [])]), sceneKey: "convenience-routine", visualStory: "상품이 일상의 준비 과정을 단순하게 만드는 순간을 보여준다", scene: "사용 직전과 직후의 동선이 이해되는 정돈된 생활 사진",
    },
    {
      tag: "feature-usp", main: `${koreanObject(product)} 고를 이유`, sub: benefit,
      reason: benefit, factIds, sceneKey: "feature-hero", visualStory: "상품의 형태와 확인된 특징을 히어로 컷으로 집중시킨다", scene: "상품 라벨이 정면으로 보이는 대형 히어로 제품 사진과 절제된 관련 소품",
    },
    {
      tag: "problem-solution", main: `${problem}, 바꿀 방법은?`, sub: benefit,
      reason: problem, factIds: unique([...factIds, ...(profile.problems[0]?.factIds || [])]), sceneKey: "solution-action", visualStory: "고객이 상품을 사용해 불편을 해결하는 행동을 보여준다", scene: "문제 상황 속 손의 행동과 상품 사용이 동시에 이해되는 사진형 장면",
    },
    {
      tag: "usage-occasion", main: `${occasion} 떠오르는 상품`, sub: benefit,
      reason: occasion, factIds: unique([...factIds, ...(profile.useOccasions[0]?.factIds || [])]), sceneKey: "occasion-editorial", visualStory: "특정 사용 순간의 분위기와 상품을 에디토리얼로 연결한다", scene: `${occasion}를 연상시키는 자연광 에디토리얼 장면과 선명한 실제 상품`,
    },
  ];
  const drafts: Draft[] = isAgriculture ? agricultureDrafts : genericDrafts;
  if (target) drafts.push({
    tag: "target-identity", main: targetHook, sub: `핵심 기준은 ${benefit}`,
    reason: target, factIds: unique([...factIds, ...(profile.targets[0]?.factIds || [])]), sceneKey: "target-lifestyle", visualStory: "명확한 타깃의 하루 속에 상품을 배치한다", scene: `${target}의 행동과 공간을 과장 없이 보여주는 라이프스타일 사진`,
  });
  if (ingredient) drafts.push(
    { tag: "sensory-experience", main: `${ingredient}, 사용하는 순간`, sub: benefit, reason: ingredient, factIds: unique(profile.ingredients.flatMap((item) => item.factIds)), sceneKey: "sensory-splash", visualStory: "성분이 연상시키는 감각을 질감과 움직임으로 전달한다", scene: `${ingredient}의 색·질감과 제품, 정확한 한국어 카피를 연결한 물성 중심의 완성 광고` },
    { tag: "sensory-experience", main: `${ingredient}가 만든 사용감`, sub: benefit, reason: ingredient, factIds: unique(profile.ingredients.flatMap((item) => item.factIds)), sceneKey: "ingredient-macro", visualStory: "성분의 매크로 질감과 패키지를 하나의 장면으로 구성한다", scene: `${ingredient}의 실제 재료 디테일과 상품 정면이 함께 보이는 근접 사진` },
  );
  if (profile.priceSignals.length) {
    const evidence = words(profile.priceSignals.map((item) => item.value).join(" · "), 24);
    const main = isAgriculture && salePrice
      ? [quantity && `${quantity} 한 상자`, salePrice].filter(Boolean).join(" · ")
      : evidence;
    const sub = isAgriculture
      ? [originalPrice && `${originalPrice}에서`, discount].filter(Boolean).join(" ") || benefit
      : `${product} 구매 조건을 한눈에`;
    drafts.push({ tag: "price-value", main, sub, reason: evidence, factIds: unique(profile.priceSignals.flatMap((item) => item.factIds)), sceneKey: "price-value", visualStory: "확인된 구매 혜택과 상품 구성을 선명하게 보여준다", scene: "실제 상품과 구성, 확인된 가격 문구를 한 화면에 조판한 완성형 커머스 광고" });
  }
  if (profile.reviewSignals.length) {
    const evidence = words(profile.reviewSignals.map((item) => item.value).join(" · "), 26);
    drafts.push({ tag: "review-trust", main: `후기에서 확인한 ${product}`, sub: evidence, reason: evidence, factIds: unique(profile.reviewSignals.flatMap((item) => item.factIds)), sceneKey: "review-usage", visualStory: "실제 후기 근거와 사용 장면을 연결한다", scene: "실제 사용 맥락의 UGC풍 장면과 확인된 후기 근거 문구를 함께 조판한 완성 광고" });
  }
  if (profile.optionSignals.length) {
    const evidence = words(profile.optionSignals.map((item) => item.value).join(" · "), 24);
    const bundleHook = /여행|휴대|파우치/.test(`${evidence} ${benefit}`)
      ? `${product}, 이제 따로 담지 마세요`
      : /택\s*\d+|옵션|선택/.test(evidence)
        ? `${evidence}, 내게 맞게 선택`
        : `${evidence}, 구성부터 확인`;
    drafts.push({ tag: "bundle-choice", secondary: ["price-value"], main: bundleHook, sub: benefit, reason: evidence, factIds: unique(profile.optionSignals.flatMap((item) => item.factIds)), sceneKey: "bundle-lineup", visualStory: "실제 옵션과 구성품의 차이를 한 장에서 이해시킨다", scene: "확인된 동일 상품 또는 옵션만 크기 차이와 겹침을 활용해 구성한 제품 라인업 사진" });
  }
  if (profile.originSignals.length) {
    const evidence = words(profile.originSignals.map((item) => item.value).join(" · "), 22);
    drafts.push({ tag: "brand-origin", main: `${evidence}에서 시작된 차이`, sub: benefit, reason: evidence, factIds: unique(profile.originSignals.flatMap((item) => item.factIds)), sceneKey: "origin-story", visualStory: "확인된 산지·원산지·브랜드 배경을 상품과 연결한다", scene: "확인된 원산지 또는 브랜드 맥락과 실제 상품을 연결한 다큐멘터리형 사진" });
  } else if (profile.brandName) {
    drafts.push({ tag: "brand-origin", main: `${words(profile.brandName, 18)}에서 시작된 ${product}`, sub: benefit, reason: profile.brandName, factIds, sceneKey: "brand-editorial", visualStory: "브랜드의 색과 상품 실루엣을 절제된 에디토리얼로 보여준다", scene: "브랜드 컬러와 실제 상품 형태를 중심으로 한 프리미엄 스튜디오 사진" });
  }
  if (profile.seasonSignals.length) {
    const evidence = words(profile.seasonSignals.map((item) => item.value).join(" · "), 22);
    drafts.push({ tag: "season-newness", main: isAgriculture ? `여름에만 만나는 ${product}` : evidence, sub: isAgriculture ? "이번 기간이 지나면 다음 여름까지" : `${occasion} 먼저 만나는 ${product}`, reason: evidence, factIds: unique(profile.seasonSignals.flatMap((item) => item.factIds)), sceneKey: "season-arrival", visualStory: "확인된 시즌·신상품 신호를 사용 순간과 연결한다", scene: "해당 시즌의 실제 빛과 소품, 상품과 정확한 카피가 결합된 완성 광고" });
  }
  // Signal-specific candidates must not disappear merely because generic
  // hypotheses happened to be appended first. Keep at most 15 after all
  // product-backed candidates have been assembled.
  const capped = drafts.slice(0, 15);
  return capped.map((draft, index) => {
    const id = `hypothesis-${String(index + 1).padStart(2, "0")}-${draft.tag}`;
    const score = rawScores({ truth, factIds: draft.factIds, primaryTag: draft.tag, sceneKey: draft.sceneKey, prior, variant: index % 3 });
    const evidenceSummary = unique(draft.factIds)
      .map((factId) => truth.facts.find((fact) => fact.id === factId))
      .filter((fact): fact is ProductFact => Boolean(fact))
      .map((fact) => `${fact.label}: ${fact.value}`)
      .join(" · ");
    const evidence = unique(draft.factIds)
      .map((factId) => truth.facts.find((fact) => fact.id === factId))
      .filter((fact): fact is ProductFact => Boolean(fact))
      .map((fact) => ({
        fact: `${fact.label}: ${fact.value}`,
        sourceReference: fact.sourceUrl || fact.source,
      }));
    return {
      id,
      primaryTag: draft.tag,
      secondaryTags: draft.secondary || [],
      hypothesis: `${tagLabels[draft.tag]} 가설: ${draft.reason}`,
      mainHook: words(draft.main, 28),
      subCopy: words(draft.sub, 42),
      customerReason: draft.reason,
      selectionReason: `${draft.reason} 근거가 확인되고 '${draft.visualStory}' 표현이 가능해 ${score.total}점으로 선정`,
      evidenceSummary,
      evidence,
      factIds: unique(draft.factIds),
      sceneKey: draft.sceneKey,
      visualStory: draft.visualStory,
      score,
      status: "candidate" as const,
      creativeBrief: makeBrief({
        id,
        tag: draft.tag,
        mainHook: words(draft.main, 28),
        subCopy: words(draft.sub, 42),
        customerReason: draft.reason,
        verifiedFacts: evidence.map((item) => item.fact),
        visualStory: draft.visualStory,
        scene: draft.scene,
      }),
    };
  });
}

export function selectDiverseHookHypotheses(candidates: HookHypothesisCandidate[], count = 6) {
  const sorted = [...candidates].sort((left, right) => right.score.total - left.score.total || left.id.localeCompare(right.id));
  const selected: HookHypothesisCandidate[] = [];
  const tagCounts = new Map<HookTaxonomyTag, number>();
  const reasons = new Set<string>();
  const scenes = new Set<string>();
  const trySelect = (candidate: HookHypothesisCandidate, strict: boolean) => {
    if ((tagCounts.get(candidate.primaryTag) || 0) >= 2) return false;
    if (strict && (reasons.has(candidate.customerReason) || scenes.has(candidate.sceneKey))) return false;
    if (selected.some((item) => item.mainHook === candidate.mainHook)) return false;
    selected.push({ ...candidate, status: "selected" });
    tagCounts.set(candidate.primaryTag, (tagCounts.get(candidate.primaryTag) || 0) + 1);
    reasons.add(candidate.customerReason);
    scenes.add(candidate.sceneKey);
    return true;
  };
  for (const candidate of sorted) {
    if (selected.length >= count) break;
    trySelect(candidate, true);
  }
  for (const candidate of sorted) {
    if (selected.length >= count) break;
    if (!selected.some((item) => item.id === candidate.id)) trySelect(candidate, false);
  }
  return selected.slice(0, count);
}

export function buildProductHookExploration(truth: ProductTruth, prior: CategoryHookPrior = {}) {
  const profile = buildProductInsightProfile(truth);
  const candidates = generateHookHypothesisCandidates(truth, profile, prior);
  const selected = selectDiverseHookHypotheses(candidates, 6);
  return { profile, candidates, selected };
}

export function blueprintForHookTag(tag: HookTaxonomyTag) {
  return blueprintByTag[tag];
}
