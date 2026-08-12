import type { ProductInfoForPrompt } from "../mvp/types";
import { selectAutomaticLayout } from "./automaticLayout.ts";
import {
  legacyHookToBackgroundHook,
  type AudienceAgeGroup,
  type AudienceProfile,
  type BackgroundAssetType,
  type BackgroundCategory,
  type BackgroundHookType,
  type BackgroundLibraryItem,
  type BackgroundRecommendation,
  type BackgroundRecommendationInput,
} from "./types.ts";

const audienceAgeLabels: Record<AudienceAgeGroup, string> = {
  teens: "10대",
  twenties: "20대",
  thirties: "30대",
  forties: "40대",
  fifties: "50대",
  senior: "시니어",
  kids: "아이",
  family: "가족",
  couple: "커플",
  friends: "친구",
  no_people: "인물 없음",
};

const explicitAgeMatchers: Array<[AudienceAgeGroup, RegExp]> = [
  ["teens", /10대|십대|청소년|중학생|고등학생|수험생|teen/i],
  ["twenties", /20대|이십대|20\s*[-~]\s*29|2030|대학생|사회초년생|취준/i],
  ["thirties", /30대|삼십대|30\s*[-~]\s*39|2030|3040|신혼|육아맘|워킹맘/i],
  ["forties", /40대|사십대|40\s*[-~]\s*49|3040|4050/i],
  ["fifties", /50대|오십대|50\s*[-~]\s*59|4050|5060|중장년|부모님/i],
  ["senior", /60대|70대|80대|육십대|칠십대|5060|시니어|어르신|노년/i],
  ["kids", /아이|아기|유아|어린이|키즈|육아|자녀/i],
  ["family", /가족|온\s*가족|부모|자녀|가정/i],
  ["couple", /부부|커플|연인|신혼/i],
  ["friends", /친구|동료|모임|회식/i],
];

const inferredAudienceMatchers: Array<[AudienceAgeGroup[], RegExp]> = [
  [["twenties", "thirties", "forties"], /직장인|회사원|출퇴근|오피스|커리어/i],
  [["teens", "twenties"], /학생|캠퍼스|트렌디|스트리트|입학|새학기/i],
  [["thirties", "forties", "family"], /신혼|육아|가정|집들이|명절|선물세트/i],
  [["forties", "fifties"], /중년/i],
  [["forties", "fifties", "senior"], /관절|혈행|부모님|활력|갱년기|시니어/i],
];

const categoryMatchers: Array<[BackgroundCategory, RegExp]> = [
  ["beauty", /뷰티|화장품|스킨|로션|크림|세럼|클렌징|메이크업|향수|샴푸|트리트먼트|샤워\s*젤|샤워젤|바디\s*워시|바디워시|핸드케어|beauty|cosmetic|skin|shower|body\s*wash/i],
  ["health", /건강기능|건기식|영양제|유산균|다이어트|이너뷰티|단백질|관절|혈행|오메가|비타민|health|supplement|protein|vitamin|probiotic/i],
  ["meat", /육류|축산|한우|정육|소고기|돼지고기|닭고기|갈비|등심|안심|삼겹|meat|beef|pork|chicken/i],
  ["seafood", /수산|생선|회\b|해산물|건어물|굴비|전복|새우|오징어|문어|seafood|fish|shrimp/i],
  ["agriculture", /농산|과일|채소|쌀|곡물|농장|산지|과수원|수확|farm|fruit|vegetable|grain/i],
  ["food-mall", /종합\s*식품|식품몰|쇼핑몰|공동구매|공구|특산물|선물세트|장보기|산지직송|food\s*mall|grocery/i],
  ["processed-food", /식품|음식|간식|커피|차|음료|디저트|소스|냉동|밀키트|HMR|베이커리|food|beverage|coffee|tea|snack|dessert|sauce/i],
  ["fashion", /패션|의류|옷|신발|가방|주얼리|액세서리|코디|데일리룩|fashion|apparel|clothes|shoe|bag/i],
  ["kids", /유아용품|이유식|완구|아동복|육아용품|키즈|어린이|baby|kids|toy/i],
  ["pet", /반려|강아지|고양이|사료|펫|애견|pet|dog|cat/i],
  ["living", /생활|가구|인테리어|주방용품|욕실용품|침구|청소|세제|홈데코|가전|home|living|interior|kitchen|laundry/i],
  ["promotion", /할인|특가|무료배송|신상품|한정|시즌|행사|프로모션|promotion|sale|event/i],
];

const hookAssetPriority: Record<BackgroundHookType, BackgroundAssetType[]> = {
  problem_solution: ["people_photo", "lifestyle_photo", "ai_generated"],
  price_offer: ["designed_asset", "product_set", "pattern_texture"],
  usp_proof: ["product_set", "ingredient_scene", "lifestyle_photo"],
  sensory: ["ingredient_scene", "pattern_texture", "product_set", "ai_generated"],
  situation: ["lifestyle_photo", "people_photo", "ai_generated"],
  review_ugc: ["people_photo", "lifestyle_photo"],
  urgency: ["designed_asset", "product_set", "pattern_texture"],
  premium: ["product_set", "lifestyle_photo", "ai_generated"],
  styling: ["lifestyle_photo", "people_photo", "pattern_texture"],
  freshness: ["ingredient_scene", "lifestyle_photo", "product_set"],
  origin_story: ["lifestyle_photo", "people_photo", "ingredient_scene"],
  family: ["people_photo", "lifestyle_photo"],
  convenience: ["lifestyle_photo", "people_photo", "product_set"],
  gifting: ["product_set", "lifestyle_photo", "designed_asset"],
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function compactTokens(values: unknown[]) {
  return new Set(
    values
      .flatMap((value) => clean(value).split(/[\s,·/()\[\]_-]+/))
      .filter((value) => value.length > 1)
  );
}

function overlapScore(left: Set<string>, right: string[], points: number, limit = 3) {
  const matches = Array.from(new Set(right.map(clean))).filter((value) =>
    Array.from(left).some((token) => value.includes(token) || token.includes(value))
  );
  return { score: Math.min(limit, matches.length) * points, matches: matches.slice(0, limit) };
}

function normalizeBrandToken(value: unknown) {
  return clean(value).replace(/[^a-z0-9가-힣]/g, "");
}

function advertiserMatch(item: BackgroundLibraryItem, input: BackgroundRecommendationInput) {
  const productValues = [
    input.product.brandName,
    input.product.advertiserName,
    input.product.productName,
    input.product.landingUrl,
  ]
    .map(normalizeBrandToken)
    .filter(Boolean);
  return (item.advertiserAliases || []).some((alias) => {
    const normalizedAlias = normalizeBrandToken(alias);
    return normalizedAlias && productValues.some((value) => value.includes(normalizedAlias));
  });
}

function productKeywordMatch(
  item: BackgroundLibraryItem,
  input: BackgroundRecommendationInput
) {
  const haystack = normalizeBrandToken(
    [
      input.product.productName,
      input.product.mainBenefit,
      input.product.extractedDescription,
      input.product.landingUrl,
      ...(input.product.ingredients || []),
    ].join(" ")
  );
  if (!haystack) return [];
  return (item.productKeywords || []).filter((keyword) => {
    const normalizedKeyword = normalizeBrandToken(keyword);
    return normalizedKeyword && haystack.includes(normalizedKeyword);
  });
}

export function toBackgroundHookType(hookType: BackgroundRecommendationInput["hook"]["hookType"]) {
  return legacyHookToBackgroundHook[hookType];
}

function resolveBackgroundHook(input: BackgroundRecommendationInput): BackgroundHookType {
  return input.hook.backgroundHookType || toBackgroundHookType(input.hook.hookType);
}

export function inferBackgroundCategory(product: Partial<ProductInfoForPrompt>): BackgroundCategory {
  const pool = [
    product.category,
    product.productName,
    product.mainBenefit,
    product.extractedDescription,
  ].join(" ");
  return categoryMatchers.find(([, pattern]) => pattern.test(pool))?.[0] || "promotion";
}

export function inferAudienceProfile(
  product: BackgroundRecommendationInput["product"]
): AudienceProfile {
  const category = inferBackgroundCategory(product);
  const sources = [
    ["추천 대상", product.targetCustomer],
    ["상품명", product.productName],
    ["핵심 혜택", product.mainBenefit],
    ["상세 설명", product.extractedDescription],
    ["카테고리", product.category],
  ] as const;
  const pool = sources.map(([, value]) => String(value || "")).join(" ");
  const supplied = (product.targetAgeGroups || []).filter((value) => value !== "no_people");
  const explicitMatches = explicitAgeMatchers
    .filter(([, pattern]) => pattern.test(pool))
    .map(([ageGroup]) => ageGroup);
  const inferredMatches = inferredAudienceMatchers
    .filter(([, pattern]) => pattern.test(pool))
    .flatMap(([ageGroups]) => ageGroups);
  const ageGroups = Array.from(
    new Set<AudienceAgeGroup>(supplied.length ? supplied : explicitMatches.length ? explicitMatches : inferredMatches)
  );
  if (!ageGroups.length) ageGroups.push("no_people");
  const evidence = sources
    .filter(([, value]) => [...explicitAgeMatchers, ...inferredAudienceMatchers].some(([, pattern]) => pattern.test(String(value || ""))))
    .map(([label, value]) => `${label}: ${String(value).replace(/\s+/g, " ").trim().slice(0, 46)}`)
    .slice(0, 2);
  return {
    category,
    ageGroups,
    labels: ageGroups.map((ageGroup) => audienceAgeLabels[ageGroup]),
    evidence,
    confidence: supplied.length || explicitMatches.length ? "explicit" : inferredMatches.length ? "inferred" : "broad",
  };
}

function scoreBackground(
  item: BackgroundLibraryItem,
  input: BackgroundRecommendationInput,
  category: BackgroundCategory,
  audienceProfile: AudienceProfile
): BackgroundRecommendation {
  let score = 0;
  const reasons: string[] = [];
  const hookType = resolveBackgroundHook(input);
  const productTokens = compactTokens([
    input.product.category,
    input.product.productSubCategory,
    input.product.detectedProductType,
    input.product.productName,
    input.product.mainBenefit,
    input.product.targetCustomer,
    input.product.extractedDescription,
    ...(input.product.ingredients || []),
  ]);
  const hookTokens = compactTokens([
    input.hook.sceneDescription,
    ...input.hook.mood,
    ...input.hook.backgroundTags,
  ]);

  if (advertiserMatch(item, input)) {
    score += 30;
    reasons.push("브랜드 장면 일치");
  }
  const matchedProductKeywords = productKeywordMatch(item, input);
  if (matchedProductKeywords.length) {
    score += 110 + Math.min(32, (matchedProductKeywords.length - 1) * 8);
    reasons.push("상품 전용 장면 일치");
  } else if (
    (item.advertiserAliases || []).length &&
    (item.productKeywords || []).length &&
    advertiserMatch(item, input)
  ) {
    score -= 60;
  }
  if (item.category === category) {
    score += 60;
    reasons.push("카테고리 일치");
  } else if (item.category === "promotion") {
    score += 8;
    reasons.push("프로모션 대체 배경");
  }
  const subcategory = overlapScore(productTokens, item.subcategories, 12, 2);
  score += subcategory.score;
  if (subcategory.matches.length) reasons.push("세부 상품 일치");
  const industry = overlapScore(productTokens, item.industries, 7, 3);
  score += industry.score;
  if (industry.matches.length) reasons.push("업종 키워드 일치");
  if (item.hookTypes.includes(hookType)) {
    score += 34;
    reasons.push("후킹 방향 일치");
  }
  const preferredTypes = input.hook.preferredAssetTypes?.length
    ? input.hook.preferredAssetTypes
    : hookAssetPriority[hookType];
  const assetRank = preferredTypes.indexOf(item.assetType);
  if (assetRank >= 0) {
    score += Math.max(8, 28 - assetRank * 7);
    reasons.push(assetRank === 0 ? "추천 장면 유형 일치" : "장면 유형 적합");
  }
  const ages = input.hook.targetAgeGroups?.length
    ? input.hook.targetAgeGroups
    : audienceProfile.ageGroups;
  const matchedAges = item.ageGroups.filter(
    (age) => age !== "no_people" && ages.includes(age)
  );
  if (matchedAges.length) {
    score += 26 + Math.min(8, (matchedAges.length - 1) * 4);
    reasons.push(`타깃 ${matchedAges.map((age) => audienceAgeLabels[age]).join("·")} 일치`);
  } else if (!item.includesPerson && ages.includes("no_people")) {
    score += 12;
  }
  if (input.product.modelIncluded && item.includesPerson) score -= 35;
  if (!input.product.modelIncluded && ["problem_solution", "review_ugc", "family"].includes(hookType) && item.includesPerson) score += 16;
  const scene = overlapScore(hookTokens, [...item.mood, ...item.elements, item.scene], 5, 5);
  score += scene.score;
  if (scene.matches.length) reasons.push("장면·분위기 일치");
  const preferredColors = [
    ...(input.hook.preferredColors || []),
    ...(input.product.brandColors || []),
    ...(input.product.productColors || []),
  ];
  const colorHarmony = overlapScore(compactTokens(preferredColors), item.colors, 9, 3);
  score += colorHarmony.score;
  if (colorHarmony.matches.length) reasons.push("브랜드 색상 조화");
  const productColors = compactTokens(input.product.productColors || []);
  const sameColor = overlapScore(productColors, item.colors, 8, 2);
  score += sameColor.score;
  if (
    productColors.size &&
    sameColor.matches.length === 0 &&
    ["ingredient_scene", "pattern_texture", "product_set", "ai_generated"].includes(item.assetType)
  ) score -= 7;
  const ingredientMatch = overlapScore(
    compactTokens(input.product.ingredients || []),
    [...item.elements, item.scene],
    10,
    3
  );
  score += ingredientMatch.score;
  if (ingredientMatch.matches.length) reasons.push("성분·원료 장면 일치");
  if (item.textSafeArea === input.hook.textSafeArea) score += 12;
  if (item.productPosition === input.hook.productPosition) score += 12;
  if ((input.selectedIds || []).includes(item.id)) {
    score -= 28;
    reasons.push("이번 세션 선택 이력 감점");
  }

  return {
    background: item,
    score,
    matchScore: score,
    diversityScore: 0,
    reasons: Array.from(new Set(reasons)).slice(0, 3),
    connectionLabel: ["lifestyle_photo", "people_photo"].includes(item.assetType)
      ? "실사형"
      : "콘텐츠형",
    audienceMatchLabels: matchedAges.map((age) => audienceAgeLabels[age]),
    automaticLayout: selectAutomaticLayout({
      background: item,
      hookType,
      hasPrice: Boolean(input.product.price || input.product.discountInfo),
    }),
  };
}

function stringOverlap(left: string[], right: string[]) {
  const a = compactTokens(left);
  const b = compactTokens(right);
  if (!a.size || !b.size) return 0;
  const matches = [...a].filter((value) =>
    [...b].some((other) => value.includes(other) || other.includes(value))
  ).length;
  return matches / Math.max(1, Math.min(a.size, b.size));
}

function perceptualHashDistance(left?: string, right?: string) {
  if (!left || !right || !/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) {
    return Number.POSITIVE_INFINITY;
  }
  try {
    let xor = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
    let distance = 0;
    while (xor > BigInt(0)) {
      distance += Number(xor & BigInt(1));
      xor >>= BigInt(1);
    }
    return distance;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function diversityPenalty(
  candidate: BackgroundRecommendation,
  selected: BackgroundRecommendation[]
) {
  let penalty = 0;
  for (const previous of selected) {
    const item = candidate.background;
    const other = previous.background;
    const sameProductCollection =
      item.advertiserAliases?.includes("originalsource.co.kr") &&
      other.advertiserAliases?.includes("originalsource.co.kr") &&
      Boolean(
        (item.productKeywords || []).some((keyword) =>
          (other.productKeywords || []).includes(keyword)
        )
      );
    if (item.assetType === other.assetType) penalty += sameProductCollection ? 7 : 18;
    if (item.includesPerson === other.includesPerson) penalty += 5;
    if (
      item.includesPerson &&
      other.includesPerson &&
      stringOverlap(item.peopleType, other.peopleType) > 0.45
    ) penalty += 12;
    if (item.includesPerson && other.includesPerson && stringOverlap(item.ageGroups, other.ageGroups) > 0.5) {
      penalty += 8;
    }
    if (stringOverlap([item.scene, ...item.elements], [other.scene, ...other.elements]) > 0.45) {
      penalty += 16;
    }
    if (stringOverlap(item.colors, other.colors) > 0.55) penalty += sameProductCollection ? 3 : 9;
    if (item.textSafeArea === other.textSafeArea) penalty += sameProductCollection ? 3 : 7;
    if (item.productPosition === other.productPosition) penalty += sameProductCollection ? 3 : 7;
    if (item.brightness === other.brightness) penalty += 3;
    if (perceptualHashDistance(item.perceptualHash, other.perceptualHash) <= 8) penalty += 80;
  }
  return penalty;
}

function chooseDiverse(
  candidates: BackgroundRecommendation[],
  limit: number
): BackgroundRecommendation[] {
  const selected: BackgroundRecommendation[] = [];
  const remaining = [...candidates];
  while (selected.length < limit && remaining.length) {
    remaining.sort((left, right) => {
      const leftPenalty = diversityPenalty(left, selected);
      const rightPenalty = diversityPenalty(right, selected);
      return (
        right.matchScore - rightPenalty - (left.matchScore - leftPenalty) ||
        left.background.id.localeCompare(right.background.id)
      );
    });
    const next = remaining.shift()!;
    const penalty = diversityPenalty(next, selected);
    selected.push({
      ...next,
      diversityScore: -penalty,
      score: next.matchScore - penalty,
    });
  }
  return selected;
}

export function recommendBackgrounds(
  items: BackgroundLibraryItem[],
  input: BackgroundRecommendationInput
) {
  const category = inferBackgroundCategory(input.product);
  const audienceProfile = inferAudienceProfile(input.product);
  const limit = Math.max(1, Math.min(12, input.limit || 6));
  const excluded = new Set(input.excludeIds || []);
  const scored = items
    .filter((item) => item.enabled !== false && !excluded.has(item.id))
    .map((item) => scoreBackground(item, input, category, audienceProfile))
    .sort((a, b) => b.score - a.score || a.background.id.localeCompare(b.background.id));
  const sameCategory = scored.filter((item) => item.background.category === category);
  const compatibleIndustry = scored.filter(
    (item) => item.background.category !== category && item.background.category !== "promotion"
  );
  const promotion = scored.filter((item) => item.background.category === "promotion");
  const categoryAndIndustry =
    sameCategory.length >= limit ? sameCategory : [...sameCategory, ...compatibleIndustry];
  const expandedPool =
    categoryAndIndustry.length >= limit ? categoryAndIndustry : [...categoryAndIndustry, ...promotion];
  const pool = expandedPool.filter(
    (item, index, values) => values.findIndex((candidate) => candidate.background.file === item.background.file) === index
  );
  const recommendations = chooseDiverse(pool, limit);
  return {
    category,
    audienceProfile,
    automaticRecommendation: recommendations[0],
    recommendations,
  };
}

export function recommendPersonBackgrounds(
  items: BackgroundLibraryItem[],
  input: BackgroundRecommendationInput
) {
  const category = inferBackgroundCategory(input.product);
  const audienceProfile = inferAudienceProfile(input.product);
  const limit = Math.max(1, Math.min(12, input.limit || 6));
  return items
    .filter((item) => item.enabled !== false && item.includesPerson)
    .map((item) => scoreBackground(item, input, category, audienceProfile))
    .sort((a, b) => b.score - a.score || a.background.id.localeCompare(b.background.id))
    .slice(0, limit);
}
