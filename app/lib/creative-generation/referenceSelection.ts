import type { ManagedNativeReferenceItem, NativeReferenceCategoryGroup, NativeReferenceCompositionType, NativeReferenceFoodSubcategory, NativeReferenceProductForm } from "./referenceLibraryManagement.ts";

export function pickUniqueRandomItems<T>(items: readonly T[], count: number, nextIndex: (maxExclusive: number) => number) {
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
  foodSubcategory?: NativeReferenceFoodSubcategory;
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

function nativeCopySignature(item: ManagedNativeReferenceItem) {
  return String(item.nativeCopy?.rawText || "")
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 80);
}

function pickDiverseCompatibleReferences<T extends ManagedNativeReferenceItem>(items: readonly ScoredCompatibleReference<T>[], count: number, nextIndex: (maxExclusive: number) => number) {
  const remaining = pickUniqueRandomItems(items, items.length, nextIndex);
  const selected: ScoredCompatibleReference<T>[] = [];
  const compositions = new Set<string>();
  const layouts = new Set<string>();
  const copies = new Set<string>();
  while (selected.length < count && remaining.length) {
    let bestIndex = 0;
    let bestNovelty = -1;
    remaining.forEach((candidate, index) => {
      const copy = nativeCopySignature(candidate.item);
      const novelty =
        (compositions.has(candidate.item.compositionType || "") ? 0 : 4) +
        (layouts.has(candidate.item.layoutFamily || "") ? 0 : 3) +
        (!copy || copies.has(copy) ? 0 : 5) +
        candidate.score / 1000;
      if (novelty > bestNovelty) {
        bestNovelty = novelty;
        bestIndex = index;
      }
    });
    const [picked] = remaining.splice(bestIndex, 1);
    selected.push(picked);
    compositions.add(picked.item.compositionType || "");
    layouts.add(picked.item.layoutFamily || "");
    const copy = nativeCopySignature(picked.item);
    if (copy) copies.add(copy);
  }
  return selected;
}

const packagedForms = new Set<NativeReferenceProductForm>(["bottle", "tube", "pouch", "box", "tray", "jar", "can", "bundle", "universal-packshot"]);
const safePackagedCompositions = new Set<NativeReferenceCompositionType>(["product-packshot", "price-card", "product-lineup", "lifestyle-scene", "review-card", "sensory-closeup"]);
const safeNaturalCompositions = new Set<NativeReferenceCompositionType>(["product-packshot", "price-card", "lifestyle-scene", "sensory-closeup", "natural-food-scene"]);

function productFormScore(product: ProductReferenceCompatibilityProfile, item: ManagedNativeReferenceItem) {
  if (item.productForm === product.productForm) return 28;
  // 과일/농산물은 운영자가 실제 디자인을 보고 직접 지정한 풀을 신뢰한다.
  // 과거 자동 태그가 meat-cut 등으로 남아 있어도 이 체크 하나로 사용할 수 있어야 한다.
  if (product.foodSubcategory && item.foodSubcategory === product.foodSubcategory) return 22;
  if (item.productForm === "universal-packshot") return 20;
  if (product.packagedProduct && item.productForm && packagedForms.has(item.productForm)) return 12;
  if (product.naturalFood && ["natural-food", "meat-cut", "produce"].includes(item.productForm || "")) return 14;
  return -40;
}

export function scoreReferenceCompatibility<T extends ManagedNativeReferenceItem>(profile: ProductReferenceCompatibilityProfile, item: T): ScoredCompatibleReference<T> {
  const reasons: string[] = [];
  if (item.categoryGroup !== profile.categoryGroup) return { item, score: -100, reasons: ["상품군 불일치"] };
  if (profile.foodSubcategory && item.foodSubcategory !== profile.foodSubcategory) {
    return { item, score: -100, reasons: ["식품 하위 선택 풀 불일치"] };
  }
  if (item.compatibilityConfidence === "low") return { item, score: -100, reasons: ["호환 태그 신뢰도 낮음"] };
  // 일반 식품과 육류는 관리자가 식품으로 분류한 광고 디자인 전체를 하나의
  // 선택 풀로 사용한다. 상품 형태 태그는 제작 단계의 교체 가이드로 남기되,
  // 병·파우치·복수 상품 같은 원본 형태 때문에 선택 자체를 막지는 않는다.
  // 과일/농산물은 운영자가 지정한 전용 하위 풀을 계속 엄격하게 유지한다.
  if (profile.categoryGroup === "food" && !profile.foodSubcategory) {
    return {
      item,
      score: 60,
      reasons: ["식품 상품군 일치", "식품 카테고리 전체 무작위 풀"],
    };
  }
  if (profile.packagedProduct && !item.supportsPackagedProduct) return { item, score: -100, reasons: ["패키지 상품 미지원"] };
  if (profile.naturalFood && !item.supportsNaturalFood && !profile.foodSubcategory) {
    return { item, score: -100, reasons: ["자연 식품 장면 미지원"] };
  }
  if (!profile.allowsHumanModel && item.photographyType === "human-model") return { item, score: -100, reasons: ["사람 모델 전용 구성"] };
  // 화장품 패키지는 같은 단품을 여러 각도·크기로 반복하거나 제품과 사용
  // 장면을 함께 배치해도 실제 판매 수량을 바꾸지 않는다. 복수 슬롯이라는
  // 이유만으로 레퍼런스를 버리지 않고 생성 단계에서 동일 상품만 반복한다.
  if (profile.categoryGroup !== "beauty" && profile.productCount === 1 && (item.productSlotCount || 1) > 1 && item.supportsMultipleProducts) {
    return { item, score: -100, reasons: ["복수 상품 전용 구성"] };
  }

  let score = 45;
  reasons.push("상품군 일치");
  if (profile.foodSubcategory) {
    score += 12;
    reasons.push("과일/농산물 수동 태그 일치");
  }
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

/** 카테고리·호환 기준을 통과한 후보군 안에서만 중복 없이 무작위 선택한다. */
export function pickCompatibleRandomItems<T extends ManagedNativeReferenceItem>(items: readonly T[], count: number, profile: ProductReferenceCompatibilityProfile, nextIndex: (maxExclusive: number) => number, minimumScore = 60): ScoredCompatibleReference<T>[] {
  const compatible = items
    .map((item) => scoreReferenceCompatibility(profile, item))
    .filter((candidate) => candidate.score >= minimumScore)
    .sort((left, right) => right.score - left.score);
  if (compatible.length < count) {
    const categoryPath = profile.foodSubcategory ? `${profile.categoryGroup} > 과일/농산물` : profile.categoryGroup;
    throw new Error(`호환되는 광고 레퍼런스가 부족합니다. ${categoryPath} · ${profile.productForm} 상품에 필요 ${count}장, 사용 가능 ${compatible.length}장입니다. 레퍼런스 관리에서 상품군과 호환 태그를 보완해 주세요.`);
  }
  if (profile.categoryGroup === "food" && !profile.foodSubcategory) {
    return pickUniqueRandomItems(compatible, count, nextIndex);
  }
  // 점수는 비호환 항목을 거르는 안전선으로만 쓴다. 통과 후 다시 상위 12점
  // 밴드로 줄이면 bottle 같은 특정 태그만 반복되어, 같은 화장품 레퍼런스가
  // 계속 선택된다. 전체 통과 풀을 섞은 뒤 문구·구도 다양성을 우선한다.
  return pickDiverseCompatibleReferences(compatible, count, nextIndex);
}

export function defaultCompositionTypes(profile: Pick<ProductReferenceCompatibilityProfile, "categoryGroup" | "packagedProduct" | "naturalFood" | "productCount">): NativeReferenceCompositionType[] {
  const base: NativeReferenceCompositionType[] = profile.naturalFood ? [...safeNaturalCompositions] : profile.packagedProduct ? [...safePackagedCompositions] : ["product-packshot"];
  const categoryCompatible = profile.categoryGroup === "beauty" ? [...base, "human-use" as const, "comparison" as const] : base;
  // 화장품 단품도 동일 패키지 반복 배치가 가능하므로 product-lineup을
  // 유지한다. 실제 세트·수량으로 해석하지 않는 것은 생성 프롬프트가 맡는다.
  if (profile.categoryGroup === "beauty") return [...new Set(categoryCompatible)];
  return profile.productCount > 1 ? [...new Set([...categoryCompatible, "product-lineup" as const])] : categoryCompatible.filter((item) => item !== "product-lineup");
}
