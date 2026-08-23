import type {
  ManagedNativeReferenceItem,
  NativeReferenceCategoryGroup,
  NativeReferenceCompositionType,
  NativeReferenceProductForm,
} from "./referenceLibraryManagement.ts";

export function pickUniqueRandomItems<T>(
  items: readonly T[],
  count: number,
  nextIndex: (maxExclusive: number) => number
) {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error("무작위 레퍼런스 선택 수가 올바르지 않습니다.");
  }
  if (items.length < count) {
    throw new Error(`고품질 광고 레퍼런스가 부족합니다. 필요 ${count}장, 등록 ${items.length}장`);
  }
  const pool = [...items];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const picked = Math.max(0, Math.min(index, Math.floor(nextIndex(index + 1))));
    [pool[index], pool[picked]] = [pool[picked], pool[index]];
  }
  return pool.slice(0, count);
}

export type ProductReferenceCompatibilityProfile = {
  categoryGroup: NativeReferenceCategoryGroup;
  productForm: NativeReferenceProductForm;
  productCount: number;
  packagedProduct: boolean;
  naturalFood: boolean;
  allowsHumanModel: boolean;
  compatibleCompositionTypes: NativeReferenceCompositionType[];
};

export type ScoredCompatibleReference<T extends ManagedNativeReferenceItem = ManagedNativeReferenceItem> = {
  item: T;
  score: number;
  reasons: string[];
};

const packagedForms = new Set<NativeReferenceProductForm>(["bottle", "tube", "pouch", "box", "tray", "jar", "can", "bundle", "universal-packshot"]);
const safePackagedCompositions = new Set<NativeReferenceCompositionType>(["product-packshot", "price-card", "product-lineup", "lifestyle-scene", "review-card", "sensory-closeup"]);
const safeNaturalCompositions = new Set<NativeReferenceCompositionType>(["product-packshot", "price-card", "lifestyle-scene", "sensory-closeup", "natural-food-scene"]);

function productFormScore(product: ProductReferenceCompatibilityProfile, item: ManagedNativeReferenceItem) {
  if (item.productForm === product.productForm) return 28;
  if (item.productForm === "universal-packshot") return 20;
  if (product.packagedProduct && item.productForm && packagedForms.has(item.productForm)) return 12;
  if (product.naturalFood && ["natural-food", "meat-cut", "produce"].includes(item.productForm || "")) return 14;
  return -40;
}

export function scoreReferenceCompatibility<T extends ManagedNativeReferenceItem>(
  profile: ProductReferenceCompatibilityProfile,
  item: T
): ScoredCompatibleReference<T> {
  const reasons: string[] = [];
  if (item.categoryGroup !== profile.categoryGroup) return { item, score: -100, reasons: ["상품군 불일치"] };
  if (item.compatibilityConfidence === "low") return { item, score: -100, reasons: ["호환 태그 신뢰도 낮음"] };
  if (profile.packagedProduct && !item.supportsPackagedProduct) return { item, score: -100, reasons: ["패키지 상품 미지원"] };
  if (profile.naturalFood && !item.supportsNaturalFood) return { item, score: -100, reasons: ["자연 식품 장면 미지원"] };
  if (!profile.allowsHumanModel && item.photographyType === "human-model") return { item, score: -100, reasons: ["사람 모델 전용 구성"] };
  if (profile.productCount === 1 && (item.productSlotCount || 1) > 1 && item.supportsMultipleProducts) {
    return { item, score: -100, reasons: ["복수 상품 전용 구성"] };
  }

  let score = 45;
  reasons.push("상품군 일치");
  const formScore = productFormScore(profile, item);
  if (formScore < 0) return { item, score: -100, reasons: [...reasons, "상품 형태 불일치"] };
  score += formScore;
  reasons.push(item.productForm === profile.productForm ? "상품 형태 일치" : "안전한 패키지 형태 호환");
  if (profile.compatibleCompositionTypes.includes(item.compositionType || "product-packshot")) {
    score += 18;
    reasons.push("광고 구성 호환");
  } else {
    score -= 25;
  }
  if ((item.productSlotCount || 1) === profile.productCount) score += 7;
  if (item.compatibilityConfidence === "high") score += 5;
  return { item, score, reasons };
}

/** 점수 기준을 통과한 상위 호환 후보군 안에서만 중복 없이 무작위 선택한다. */
export function pickCompatibleRandomItems<T extends ManagedNativeReferenceItem>(
  items: readonly T[],
  count: number,
  profile: ProductReferenceCompatibilityProfile,
  nextIndex: (maxExclusive: number) => number,
  minimumScore = 60
): ScoredCompatibleReference<T>[] {
  const compatible = items
    .map((item) => scoreReferenceCompatibility(profile, item))
    .filter((candidate) => candidate.score >= minimumScore)
    .sort((left, right) => right.score - left.score);
  if (compatible.length < count) {
    throw new Error(`호환되는 광고 레퍼런스가 부족합니다. ${profile.categoryGroup} · ${profile.productForm} 상품에 필요 ${count}장, 사용 가능 ${compatible.length}장입니다. 레퍼런스 관리의 고급 호환 태그를 보완해 주세요.`);
  }
  const topScore = compatible[0]?.score || minimumScore;
  const topBand = compatible.filter((candidate) => candidate.score >= Math.max(minimumScore, topScore - 12));
  const pool = topBand.length >= count ? topBand : compatible;
  return pickUniqueRandomItems(pool, count, nextIndex);
}

export function defaultCompositionTypes(profile: Pick<ProductReferenceCompatibilityProfile, "packagedProduct" | "naturalFood" | "productCount">): NativeReferenceCompositionType[] {
  const base: NativeReferenceCompositionType[] = profile.naturalFood ? [...safeNaturalCompositions] : profile.packagedProduct ? [...safePackagedCompositions] : ["product-packshot"];
  return profile.productCount > 1 ? [...new Set([...base, "product-lineup" as const])] : base.filter((item) => item !== "product-lineup");
}
