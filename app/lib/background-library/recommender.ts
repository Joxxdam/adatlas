import type { ProductInfoForPrompt } from "../mvp/types";
import type {
  BackgroundCategory,
  BackgroundLibraryItem,
  BackgroundRecommendation,
  BackgroundRecommendationInput,
} from "./types";

const categoryMatchers: Array<[BackgroundCategory, RegExp]> = [
  ["beauty", /뷰티|화장품|스킨|로션|크림|세럼|클렌징|메이크업|향수|beauty|cosmetic|skin/i],
  ["fashion", /패션|의류|옷|신발|가방|주얼리|액세서리|fashion|apparel|clothes|shoe|bag/i],
  [
    "food",
    /식품|음식|간식|커피|차|음료|디저트|건강식|육류|축산|한우|정육|소고기|돼지고기|갈비|등심|food|meat|beef|pork|beverage|coffee|tea|snack/i,
  ],
  ["agriculture", /농산|수산|과일|채소|쌀|곡물|농장|산지|farm|fruit|vegetable|grain/i],
  ["lifestyle", /생활|가구|인테리어|주방|욕실|침구|청소|반려|육아|home|living|interior|kitchen/i],
  ["commerce", /전자|디지털|가전|기기|문구|용품|commerce|electronic|device|gadget/i],
];

const hookOffsets: Record<BackgroundRecommendationInput["hook"]["hookType"], number> = {
  "price-benefit": 0,
  "feature-usp": 1,
  lifestyle: 3,
  "season-event": 4,
  "problem-solution": 2,
  "social-proof": 1,
  curiosity: 4,
  sensory: 2,
  gift: 3,
  "brand-story": 5,
};

const categorySceneTokens: Record<BackgroundCategory, string[]> = {
  beauty: ["욕실", "세면대", "물", "자연광", "대리석", "선반", "클린", "스튜디오"],
  fashion: ["스튜디오", "행거", "부티크", "패브릭", "워드로브", "도시", "자연광"],
  food: ["식탁", "테이블", "조리대", "주방", "다이닝", "불판", "숯불", "캠핑", "푸드"],
  agriculture: ["농장", "밭", "과수원", "산지", "원목", "마켓", "주방", "자연광"],
  lifestyle: ["거실", "침실", "주방", "욕실", "선반", "야외", "운동", "자연광"],
  commerce: ["스튜디오", "단상", "미니멀", "화이트", "블랙", "컬러", "제품촬영"],
};

function compactTokens(values: unknown[]) {
  return new Set(
    values
      .flatMap((value) =>
        String(value || "")
          .toLowerCase()
          .split(/[\s,·/()\[\]_-]+/)
      )
      .map((value) => value.trim())
      .filter((value) => value.length > 1)
  );
}

function overlapScore(left: Set<string>, right: string[], points: number, limit = 3) {
  const matches = Array.from(new Set(right.map((value) => value.toLowerCase()))).filter((value) =>
    Array.from(left).some((token) => value.includes(token) || token.includes(value))
  );
  return { score: Math.min(limit, matches.length) * points, matches: matches.slice(0, limit) };
}

function compactUniquePaths(values: unknown[]) {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      if (!/^(?:https?:\/\/|\/)[^\s]+$/i.test(value)) return false;
      if (/\.(?:svg|gif)(?:$|[?#])/i.test(value)) return false;
      seen.add(value);
      return true;
    });
}

function stableToken(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function displaySiteName(product: Partial<ProductInfoForPrompt>) {
  const named = String(product.brandName || product.advertiserName || "").trim();
  if (named) return named.slice(0, 24);
  try {
    return new URL(String(product.landingUrl || "")).hostname.replace(/^www\./, "").slice(0, 24);
  } catch {
    return "입력한 사이트";
  }
}

function siteImagePaths(product: Partial<ProductInfoForPrompt>) {
  const primary = String(product.productImagePath || product.extractedMainImage || "").trim();
  const details = compactUniquePaths([
    ...(product.sourceImageCandidates || [])
      .filter((candidate) => candidate.type === "detail")
      .map((candidate) => candidate.imagePath),
    ...(product.extractedGalleryImages || []),
    ...(product.productImagePaths || []),
  ]).filter((path) => path !== primary);
  return compactUniquePaths([...details, primary]);
}

function buildSiteDerivedRecommendations(
  input: BackgroundRecommendationInput,
  category: BackgroundCategory,
  limit: number
): BackgroundRecommendation[] {
  const paths = siteImagePaths(input.product);
  if (!paths.length) return [];

  const siteName = displaySiteName(input.product);
  const productName = String(input.product.productName || input.product.category || "상품")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  const offset = hookOffsets[input.hook.hookType] % paths.length;
  const ordered = [...paths.slice(offset), ...paths.slice(0, offset)];
  const labels = ["대표 비주얼 톤", "상품 디테일 톤", "보조 이미지 톤"];
  const now = new Date().toISOString();

  return ordered.slice(0, limit).map((file, index) => ({
    background: {
      id: `site-${stableToken(`${input.product.landingUrl || siteName}:${file}`)}`,
      file,
      category,
      industries: [
        String(input.product.category || category),
        String(input.product.brandName || input.product.advertiserName || siteName),
      ].filter(Boolean),
      hookTypes: [input.hook.hookType],
      scene: `${siteName} ${labels[index] || "상세페이지 톤"}`,
      mood: Array.from(new Set([...(input.hook.mood || []), "상품 연계"])).slice(0, 4),
      elements: Array.from(
        new Set([...(input.hook.backgroundTags || []), "상세페이지 색감", "상품 질감"])
      ).slice(0, 6),
      colors: [],
      productPosition: input.hook.productPosition,
      textSafeArea: input.hook.textSafeArea,
      orientation: "square",
      width: 0,
      height: 0,
      sourceType: "site_derived",
      sourceName: `${siteName} 상세페이지`,
      sourceUrl: String(input.product.landingUrl || file),
      licenseUrl: String(input.product.landingUrl || ""),
      downloadedAt: now,
      enabled: true,
    },
    score: 180 - index,
    reasons: [
      `${siteName} 상세페이지 이미지`,
      `${productName} 색감·질감 연결`,
      "합성 시 흐림·톤 보정",
    ],
    connectionLabel: "사이트 연계",
    intendedTreatment: "blurred-site-image",
  }));
}

export function inferBackgroundCategory(
  product: Partial<ProductInfoForPrompt>
): BackgroundCategory {
  const pool = [
    product.category,
    product.productName,
    product.mainBenefit,
    product.extractedDescription,
  ].join(" ");
  return categoryMatchers.find(([, pattern]) => pattern.test(pool))?.[0] || "commerce";
}

function scoreBackground(
  item: BackgroundLibraryItem,
  input: BackgroundRecommendationInput,
  category: BackgroundCategory
): BackgroundRecommendation {
  let score = 0;
  const reasons: string[] = [];
  const isHookBase = item.sourceName === "AdAtlas Hook Base";
  const productTokens = compactTokens([
    input.product.category,
    input.product.productName,
    input.product.mainBenefit,
    input.product.extractedDescription,
    input.product.brandName,
    input.product.advertiserName,
  ]);
  const hookTokens = compactTokens([
    input.hook.sceneDescription,
    ...input.hook.mood,
    ...input.hook.backgroundTags,
  ]);

  if (item.category === category) {
    score += 42;
    reasons.push("상품 카테고리 일치");
  } else if (item.category === "commerce") {
    score += 10;
    reasons.push("범용 커머스 배경");
  }
  const industry = overlapScore(productTokens, item.industries, 5, 3);
  score += industry.score;
  if (industry.matches.length)
    reasons.push(`업종 키워드 ${industry.matches.slice(0, 2).join("·")}`);
  if (item.hookTypes.includes(input.hook.hookType)) {
    score += isHookBase ? 42 : 24;
    reasons.push(isHookBase ? "예시 품질 기반 후킹 배경" : "후킹 방향 일치");
  }
  const mood = overlapScore(hookTokens, [...item.mood, ...item.elements, item.scene], 4, 4);
  score += mood.score;
  if (mood.matches.length) reasons.push("장면·무드 일치");
  if (item.textSafeArea === input.hook.textSafeArea) {
    score += 10;
    reasons.push("문구 여백 일치");
  }
  if (item.productPosition === input.hook.productPosition) {
    score += 10;
    reasons.push("상품 배치 일치");
  }
  const productScene = overlapScore(
    compactTokens([...productTokens, ...categorySceneTokens[category]]),
    [...item.industries, ...item.elements, item.scene],
    6,
    3
  );
  score += productScene.score;
  if (productScene.matches.length) reasons.push("상품 사용 장면 연결");
  score += Math.min(3, item.colors.length);
  return {
    background: item,
    score,
    reasons: reasons.slice(0, 3),
    connectionLabel: isHookBase
      ? "후킹 기본 배경"
      : item.category === category
        ? "업종 장면"
        : "범용 배경",
    intendedTreatment: "original",
  };
}

export function recommendBackgrounds(
  items: BackgroundLibraryItem[],
  input: BackgroundRecommendationInput
) {
  const category = inferBackgroundCategory(input.product);
  const limit = Math.max(1, Math.min(6, input.limit || 3));
  const scored = items
    .map((item) => scoreBackground(item, input, category))
    .sort((a, b) => b.score - a.score || a.background.id.localeCompare(b.background.id));
  const selected: BackgroundRecommendation[] = [];
  const addUnique = (candidate: BackgroundRecommendation) => {
    if (!selected.some((item) => item.background.id === candidate.background.id)) {
      selected.push(candidate);
    }
  };
  scored
    .filter(
      (item) =>
        item.background.sourceName === "AdAtlas Hook Base" &&
        item.background.category === category &&
        item.background.hookTypes.includes(input.hook.hookType)
    )
    .forEach(addUnique);
  scored
    .filter(
      (item) =>
        item.background.sourceName === "AdAtlas Hook Base" &&
        item.background.category === "commerce" &&
        item.background.hookTypes.includes(input.hook.hookType)
    )
    .forEach(addUnique);
  buildSiteDerivedRecommendations(input, category, 1).forEach(addUnique);
  scored
    .filter(
      (item) =>
        item.background.category === category && item.background.sourceName !== "AdAtlas Hook Base"
    )
    .forEach(addUnique);
  if (selected.length < limit)
    scored.filter((item) => item.background.category === "commerce").forEach(addUnique);
  if (selected.length < limit) scored.forEach(addUnique);
  return { category, recommendations: selected.slice(0, limit) };
}
