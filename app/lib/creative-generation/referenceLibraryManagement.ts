export const nativeReferenceCategoryGroups = ["fashion", "food", "beauty"] as const;

export type NativeReferenceCategoryGroup = (typeof nativeReferenceCategoryGroups)[number];

export const nativeReferenceProductForms = [
  "bottle", "tube", "pouch", "box", "tray", "jar", "can", "fashion-item",
  "natural-food", "meat-cut", "produce", "bundle", "universal-packshot",
] as const;
export type NativeReferenceProductForm = (typeof nativeReferenceProductForms)[number];

export const nativeReferenceCompositionTypes = [
  "product-packshot", "price-card", "product-lineup", "lifestyle-scene",
  "before-after", "comparison", "review-card", "sensory-closeup", "human-use",
  "natural-food-scene",
] as const;
export type NativeReferenceCompositionType = (typeof nativeReferenceCompositionTypes)[number];
export const nativeReferenceSlotShapes = ["tall", "wide", "square", "flexible"] as const;
export type NativeReferenceSlotShape = (typeof nativeReferenceSlotShapes)[number];
export const nativeReferencePhotographyTypes = ["packshot", "editorial", "lifestyle", "human-model", "natural-food"] as const;
export type NativeReferencePhotographyType = (typeof nativeReferencePhotographyTypes)[number];
export const nativeReferenceTextDensities = ["light", "medium", "dense"] as const;
export type NativeReferenceTextDensity = (typeof nativeReferenceTextDensities)[number];
export const nativeReferenceCompatibilityConfidences = ["low", "medium", "high"] as const;
export type NativeReferenceCompatibilityConfidence = (typeof nativeReferenceCompatibilityConfidences)[number];

export type NativeReferenceCompatibility = {
  productForm: NativeReferenceProductForm;
  compositionType: NativeReferenceCompositionType;
  productSlotCount: number;
  productSlotShape: NativeReferenceSlotShape;
  photographyType: NativeReferencePhotographyType;
  textDensity: NativeReferenceTextDensity;
  supportsPackagedProduct: boolean;
  supportsNaturalFood: boolean;
  supportsHumanModel: boolean;
  supportsMultipleProducts: boolean;
  compatibilityConfidence: NativeReferenceCompatibilityConfidence;
};

export type ManagedNativeReferenceItem = {
  id: string;
  publicPath: string;
  sourceFile: string;
  layoutFamily: string;
  categoryGroup: NativeReferenceCategoryGroup;
  ordinal: number;
  contentHash?: string;
  uploadedAt?: string;
  classificationMethod?: "codex-local" | "filename-rule" | "imported" | "manual";
  productForm?: NativeReferenceProductForm;
  compositionType?: NativeReferenceCompositionType;
  productSlotCount?: number;
  productSlotShape?: NativeReferenceSlotShape;
  photographyType?: NativeReferencePhotographyType;
  textDensity?: NativeReferenceTextDensity;
  supportsPackagedProduct?: boolean;
  supportsNaturalFood?: boolean;
  supportsHumanModel?: boolean;
  supportsMultipleProducts?: boolean;
  compatibilityConfidence?: NativeReferenceCompatibilityConfidence;
};

export type ManagedNativeReferenceManifest = {
  version: string;
  importedAt: string;
  updatedAt?: string;
  sourceLabel: string;
  selectionPolicy: string;
  usagePolicy: string;
  items: ManagedNativeReferenceItem[];
};

const fashionPattern = /패션|의류|옷|원피스|티셔츠|셔츠|바지|팬츠|스커트|신발|구두|운동화|가방|모자|양말|fashion|apparel|dress|shirt|pants|skirt|shoes|sneaker|bag/i;
const foodPattern = /식품|음식|먹거리|한우|고기|육류|과일|채소|농산|수산|간식|과자|음료|커피|차|우유|요거트|소스|반찬|food|beef|meat|fruit|snack|drink|coffee|milk/i;
const beautyPattern = /화장품|뷰티|스킨|로션|크림|세럼|앰플|샴푸|린스|트리트먼트|바디|샤워|클렌징|향수|메이크업|립|마스크팩|웰니스|건강|건기식|건강기능|영양제|비타민|유산균|홍삼|퍼스널케어|beauty|cosmetic|skin|cream|serum|shampoo|body|shower|wellness|vitamin/i;
const verifiedPackagedFoodProfiles = new Map<number, Pick<NativeReferenceCompatibility, "productForm" | "compositionType" | "productSlotCount" | "supportsMultipleProducts">>([
  [2, { productForm: "bundle", compositionType: "product-lineup", productSlotCount: 3, supportsMultipleProducts: true }],
  [9, { productForm: "pouch", compositionType: "product-lineup", productSlotCount: 3, supportsMultipleProducts: true }],
  [15, { productForm: "pouch", compositionType: "product-lineup", productSlotCount: 2, supportsMultipleProducts: true }],
  [20, { productForm: "pouch", compositionType: "product-lineup", productSlotCount: 3, supportsMultipleProducts: true }],
  [24, { productForm: "bottle", compositionType: "price-card", productSlotCount: 1, supportsMultipleProducts: false }],
  [25, { productForm: "pouch", compositionType: "product-lineup", productSlotCount: 3, supportsMultipleProducts: true }],
]);

function compositionFromLayout(layoutFamily: string): NativeReferenceCompositionType {
  if (layoutFamily === "price-offer") return "price-card";
  if (layoutFamily === "social-proof") return "review-card";
  if (layoutFamily === "situation-story") return "lifestyle-scene";
  if (layoutFamily === "sensory-editorial") return "sensory-closeup";
  return "product-packshot";
}

/**
 * 과거 manifest의 카테고리 값은 유지하면서 신규 호환 태그를 보완한다.
 * 육류와 실제 확인한 포장 식품 레퍼런스를 분리해 병음료가 육류 장면을
 * 범용 fallback으로 사용하는 일을 막는다. 수동 태그가 있으면 항상 우선한다.
 */
export function normalizeNativeReferenceCompatibility(
  item: ManagedNativeReferenceItem
): ManagedNativeReferenceItem & NativeReferenceCompatibility {
  const packagedFoodProfile = item.categoryGroup === "food" ? verifiedPackagedFoodProfiles.get(item.ordinal) : undefined;
  const isPackagedFood = Boolean(packagedFoodProfile);
  const isNaturalFood = item.categoryGroup === "food" && !isPackagedFood;
  const inferredForm: NativeReferenceProductForm = item.categoryGroup === "fashion"
    ? "fashion-item"
    : isNaturalFood
      ? "meat-cut"
      : isPackagedFood
        ? packagedFoodProfile!.productForm
        : "universal-packshot";
  const inferredComposition = packagedFoodProfile?.compositionType || (isNaturalFood
    ? (item.layoutFamily === "sensory-editorial" || item.layoutFamily === "situation-story"
      ? "natural-food-scene" as const
      : compositionFromLayout(item.layoutFamily))
    : compositionFromLayout(item.layoutFamily));
  const inferredCount = packagedFoodProfile?.productSlotCount || (/(?:2\s*\+\s*1|세트|묶음|라인업)/i.test(item.sourceFile) ? 2 : 1);
  return {
    ...item,
    productForm: nativeReferenceProductForms.includes(item.productForm as NativeReferenceProductForm)
      ? item.productForm as NativeReferenceProductForm
      : inferredForm,
    compositionType: nativeReferenceCompositionTypes.includes(item.compositionType as NativeReferenceCompositionType)
      ? item.compositionType as NativeReferenceCompositionType
      : inferredComposition,
    productSlotCount: Math.max(1, Math.min(6, Math.round(Number(item.productSlotCount) || inferredCount))),
    productSlotShape: nativeReferenceSlotShapes.includes(item.productSlotShape as NativeReferenceSlotShape)
      ? item.productSlotShape as NativeReferenceSlotShape
      : isNaturalFood ? "wide" : item.categoryGroup === "fashion" ? "tall" : "flexible",
    photographyType: nativeReferencePhotographyTypes.includes(item.photographyType as NativeReferencePhotographyType)
      ? item.photographyType as NativeReferencePhotographyType
      : isNaturalFood ? "natural-food" : inferredComposition === "lifestyle-scene" ? "lifestyle" : "packshot",
    textDensity: nativeReferenceTextDensities.includes(item.textDensity as NativeReferenceTextDensity)
      ? item.textDensity as NativeReferenceTextDensity
      : ["price-offer", "usp-evidence", "social-proof"].includes(item.layoutFamily) ? "dense" : "medium",
    supportsPackagedProduct: item.supportsPackagedProduct ?? !isNaturalFood,
    supportsNaturalFood: item.supportsNaturalFood ?? isNaturalFood,
    supportsHumanModel: item.supportsHumanModel ?? item.categoryGroup === "fashion",
    supportsMultipleProducts: item.supportsMultipleProducts ?? packagedFoodProfile?.supportsMultipleProducts ?? inferredCount > 1,
    compatibilityConfidence: item.compatibilityConfidence || (item.categoryGroup === "food" ? "high" : "medium"),
  };
}

export function normalizeNativeReferenceCategory(value: unknown): NativeReferenceCategoryGroup {
  return nativeReferenceCategoryGroups.includes(value as NativeReferenceCategoryGroup)
    ? value as NativeReferenceCategoryGroup
    : "beauty";
}

export function nativeReferenceCategoryLabel(value: NativeReferenceCategoryGroup) {
  if (value === "fashion") return "패션";
  if (value === "food") return "식품";
  return "화장품";
}

export function inferNativeReferenceCategoryFromText(value: string): NativeReferenceCategoryGroup {
  if (fashionPattern.test(value)) return "fashion";
  if (beautyPattern.test(value)) return "beauty";
  if (foodPattern.test(value)) return "food";
  return "beauty";
}

export function removeManagedNativeReference(
  items: readonly ManagedNativeReferenceItem[],
  id: string
) {
  return items.filter((item) => item.id !== id);
}
