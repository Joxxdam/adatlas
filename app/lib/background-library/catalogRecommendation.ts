import { selectAutomaticLayout } from "./automaticLayout.ts";
import {
  catalogItemToLegacy,
  productionReady,
  readBackgroundCollectionConfigs,
} from "./catalogStore.server.ts";
import type {
  BackgroundCatalogItem,
  CatalogRecommendationInput,
} from "./catalogTypes.ts";
import type { BackgroundRecommendation } from "./types.ts";

function normalize(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function containsAny(pool: string, values: string[]) {
  return values.filter((value) => pool.includes(normalize(value)));
}

function positionReason(item: BackgroundCatalogItem) {
  if (item.recommendedProductPosition.includes("right")) return "상품을 오른쪽에 배치할 여백이 넓어요.";
  if (item.recommendedProductPosition.includes("left")) return "상품을 왼쪽에 배치할 여백이 넓어요.";
  if (item.collectionIds.includes("womens-fashion-scenes")) return "전신 의류 누끼를 배치할 세로 공간이 충분해요.";
  return "상품과 문구를 분리할 합성 여백이 있어요.";
}

export async function recommendCatalogBackgrounds(
  items: BackgroundCatalogItem[],
  input: CatalogRecommendationInput
): Promise<BackgroundRecommendation[]> {
  const configs = await readBackgroundCollectionConfigs();
  const productPool = normalize([
    input.product.productName, input.product.category, input.product.mainBenefit,
    input.product.extractedDescription, input.product.targetCustomer,
    ...(input.product.productColors || []), ...(input.product.brandColors || []),
    input.hook?.sceneDescription, ...(input.hook?.mood || []), ...(input.hook?.backgroundTags || []),
  ].join(" "));
  const scored = items.filter(productionReady).map((item) => {
    let score = item.adCompositionScore * 42 + item.backgroundSuitabilityScore * 28;
    const reasons: string[] = [positionReason(item)];
    const collectionConfigs = configs.filter((config) => item.collectionIds.includes(config.id));
    for (const config of collectionConfigs) {
      const matchingRules = config.recommendationRules.filter((rule) => containsAny(productPool, rule.keywords).length);
      for (const rule of matchingRules) {
        if (rule.categories.includes(item.primaryCategory)) {
          score += 48;
          reasons.unshift(`${rule.keywords.find((keyword) => productPool.includes(normalize(keyword)))} 소구와 ${item.primaryCategory} 장면이 잘 맞아요.`);
        }
      }
      const moodMatches = containsAny(productPool, [...item.moodTags, ...config.preferredMoods]);
      if (moodMatches.length) { score += Math.min(18, moodMatches.length * 6); reasons.push("상품 분위기와 배경 톤이 잘 어울려요."); }
      const colorMatches = containsAny(productPool, [item.dominantColor, ...item.secondaryColors, ...config.preferredColors]);
      if (colorMatches.length) { score += 12; reasons.push("상품 대표색과 조화로운 배경이에요."); }
    }
    if (input.hook?.productPosition === item.recommendedProductPosition) score += 14;
    if (input.hook?.textSafeArea === item.recommendedCopyPosition) { score += 14; reasons.push("선택한 문구 위치의 가독성이 좋아요."); }
    if (item.peoplePresence === "prominent") score -= 20;
    if (item.clutterLevel > 0.68) score -= 12;
    return { item, score, reasons: Array.from(new Set(reasons)).slice(0, 3) };
  }).sort((a, b) => b.score - a.score);
  const selected: typeof scored = [];
  for (const candidate of scored) {
    const repeatedCategory = selected.filter((item) => item.item.primaryCategory === candidate.item.primaryCategory).length;
    const repeatedColor = selected.filter((item) => item.item.dominantColor === candidate.item.dominantColor).length;
    candidate.score -= repeatedCategory * 7 + repeatedColor * 4;
    selected.push(candidate);
    selected.sort((a, b) => b.score - a.score);
    if (selected.length >= Math.max(1, Math.min(12, input.limit || 12))) break;
  }
  return selected.map(({ item, score, reasons }) => {
    const background = catalogItemToLegacy(item);
    return {
      background,
      score,
      matchScore: score,
      diversityScore: 0,
      reasons,
      connectionLabel: item.sourceType === "local-generation" ? "로컬 생성" : item.sourceType === "pexels" ? "Pexels" : "보유 배경",
      automaticLayout: selectAutomaticLayout({
        background,
        hookType: input.hook?.backgroundHookType || "situation",
        hasPrice: Boolean(input.product.price || input.product.discountInfo),
      }),
    } satisfies BackgroundRecommendation;
  });
}
