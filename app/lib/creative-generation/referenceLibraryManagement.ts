import { referenceRequiresComparisonSemantics } from "./referenceSemanticRoles.ts";

export const nativeReferenceCategoryGroups = ["fashion", "food", "beauty"] as const;

export type NativeReferenceCategoryGroup = (typeof nativeReferenceCategoryGroups)[number];

export const nativeReferenceFoodSubcategories = ["snack"] as const;
export type NativeReferenceFoodSubcategory = (typeof nativeReferenceFoodSubcategories)[number];

/**
 * 기본 분류를 바꾸지 않고 같은 레퍼런스를 다른 제작 후보군에서도 함께
 * 활용하기 위한 추가 풀입니다. food-snack은 음식 전체 풀에도 포함됩니다.
 */
export const nativeReferenceSelectionPools = ["fashion", "food", "food-snack", "beauty"] as const;
export type NativeReferenceSelectionPool = (typeof nativeReferenceSelectionPools)[number];

export const nativeReferenceProductForms = ["bottle", "tube", "pouch", "box", "tray", "jar", "can", "fashion-item", "natural-food", "meat-cut", "produce", "bundle", "universal-packshot"] as const;
export type NativeReferenceProductForm = (typeof nativeReferenceProductForms)[number];

export const nativeReferenceCompositionTypes = ["product-packshot", "price-card", "product-lineup", "lifestyle-scene", "before-after", "comparison", "review-card", "sensory-closeup", "human-use", "natural-food-scene"] as const;
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

export type ReferenceTextRegion = {
  id: string;
  role: "headline" | "support" | "proof" | "offer" | "cta" | "badge" | "other";
  /** 다단·분산 배치에서도 재현 가능한 실제 시각 읽기 순서입니다. */
  readingOrder?: number;
  /** 광고 문구와 상품 라벨·브랜드·장식을 분리해 잘못 적응하지 않게 합니다. */
  sourceType?: "ad-copy" | "source-brand" | "source-product-label" | "decorative" | "uncertain";
  replacePolicy?: "adapt" | "remove" | "product-replacement" | "preserve" | "review";
  text: string;
  lines: string[];
  /** 0~1 비율 좌표입니다. OCR이 좌표를 확신하지 못하면 생략합니다. */
  box?: { x: number; y: number; width: number; height: number };
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  align?: "left" | "center" | "right" | "unknown";
  emphasis?: "none" | "light" | "strong";
  colorHint?: string;
  backgroundHint?: string;
  outlineHint?: string;
  sizeClass?: "small" | "medium" | "large" | "hero";
  characterBudget?: number;
  reviewRequired?: boolean;
  confidence?: number;
};

const standaloneBrandVisualHintPattern = /(?:logo|wordmark|brand\s*mark|emblem|crest|seal|monogram|로고|워드마크|브랜드\s*마크|상호|엠블럼|문장|인장)/i;
const splitCircleBadgePattern = /(?:상단|위쪽).*(?:하단|아래쪽).*원형\s*배지|(?:two[ -]?tone|split).*(?:circle|round).*(?:badge|mark)/i;
const ordinaryBadgeCopyPattern = /(?:\d|%|원|특가|할인|무료|배송|증정|구매|세트|팩|개|kg|g|ml|기간|오늘|마감|국내산|원산지|인증|등급|무항생제|유기농|비건|천연|보장|추천)/i;

/**
 * OCR이 독립 브랜드 마크를 일반 배지 문구로 잘못 분류해도 상품명으로
 * 재창작하지 않도록 하는 보수적인 후처리입니다. 가격·혜택·CTA·인증처럼
 * 광고 의미가 분명한 배지는 그대로 adapt하며, 명시적인 로고 시각 힌트나
 * 짧은 2단 분할 원형 마크만 source-brand/remove로 승격합니다.
 */
export function normalizeReferenceTextRegionBrandPolicy(region: ReferenceTextRegion): ReferenceTextRegion {
  if (region.sourceType === "source-product-label") return { ...region, replacePolicy: "product-replacement" };
  if (region.sourceType === "source-brand" || region.replacePolicy === "remove") {
    return { ...region, sourceType: "source-brand", replacePolicy: "remove" };
  }
  if (region.sourceType === "decorative") return region;

  const lines = normalizeReferenceRawLines(region.lines?.length ? region.lines : String(region.text || "").split("\n")).filter((line) => line.trim());
  const text = lines.join(" ");
  const visualHints = [region.backgroundHint, region.outlineHint, region.id].filter(Boolean).join(" ");
  const compactStackedMark = region.role === "badge"
    && lines.length >= 2
    && lines.length <= 3
    && lines.every((line) => Array.from(line.replace(/\s/g, "")).length <= 5)
    && splitCircleBadgePattern.test(visualHints);
  const explicitBrandMark = ["badge", "other"].includes(region.role) && standaloneBrandVisualHintPattern.test(visualHints);
  if ((compactStackedMark || explicitBrandMark) && !ordinaryBadgeCopyPattern.test(text)) {
    return { ...region, sourceType: "source-brand", replacePolicy: "remove" };
  }
  return region;
}

export type ReferenceNativeCopyValidation = {
  textCoverage: number;
  regionCoverage: number;
  passAgreement: number;
  numericAgreement: number;
  issues: string[];
};

/**
 * 레퍼런스에 실제로 적힌 문구의 원본 기록입니다. 문구 청사진이나 요약본이
 * 아니며 줄바꿈·기호·구어체를 그대로 보존합니다.
 */
export type ReferenceNativeCopy = {
  /** 레퍼런스 관리 manifest의 영구 ID입니다. */
  referenceId: string;
  rawText: string;
  rawLines: string[];
  textRegions: ReferenceTextRegion[];
  confidence?: number;
  ocrConfidence?: number;
  analysisVersion?: string;
  promptVersion?: string;
  model?: string;
  imageHash?: string;
  imageWidth?: number;
  imageHeight?: number;
  analysisStatus?: "ready" | "needs-review" | "unavailable";
  approvalStatus?: "auto-approved" | "manually-approved" | "needs-review" | "rejected";
  approvedAt?: string;
  validation?: ReferenceNativeCopyValidation;
  analysisError?: string;
  attemptCount?: number;
  manuallyCorrected: boolean;
  useForCopyAdaptation: boolean;
  extractionSource: "codex-local" | "manual" | "unavailable";
  extractedAt?: string;
  updatedAt: string;
};

export function isApprovedReferenceNativeCopy(copy: ReferenceNativeCopy | undefined) {
  if (!copy?.rawLines?.some((line) => line.trim()) || copy.useForCopyAdaptation === false) return false;
  if (copy.manuallyCorrected) return copy.approvalStatus === "manually-approved";
  return copy.analysisStatus === "ready" && ["auto-approved", "manually-approved"].includes(copy.approvalStatus || "");
}

/**
 * OCR·수동 입력의 실제 행 순서와 중간 빈 줄을 보존합니다. 운영상 의미가 없는
 * 맨 앞·뒤의 완전한 빈 줄과 Windows CR만 제거하며 문장 내부 띄어쓰기와
 * 인터넷 표현은 교정하지 않습니다.
 */
export function normalizeReferenceRawLines(value: unknown): string[] {
  const lines = (Array.isArray(value) ? value : String(value ?? "").split("\n")).map((line) => String(line).replace(/\r/g, ""));
  while (lines[0] === "") lines.shift();
  while (lines.at(-1) === "") lines.pop();
  return lines;
}

export type ManagedNativeReferenceItem = {
  id: string;
  publicPath: string;
  sourceFile: string;
  layoutFamily: string;
  categoryGroup: NativeReferenceCategoryGroup;
  /** 식품 대카테고리 안에서 운영자가 직접 지정하는 선택 풀입니다. */
  foodSubcategory?: NativeReferenceFoodSubcategory;
  /** 기본 categoryGroup을 유지한 채 함께 사용할 수동 추가 제작 풀입니다. */
  additionalSelectionPools?: NativeReferenceSelectionPool[];
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
  /** 이미지에 실제로 적힌 문구. 레퍼런스 등록 시 1회 추출하고 이후 수동 수정합니다. */
  nativeCopy?: ReferenceNativeCopy;
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
export function normalizeNativeReferenceCompatibility(item: ManagedNativeReferenceItem): ManagedNativeReferenceItem & NativeReferenceCompatibility {
  const packagedFoodProfile = item.categoryGroup === "food" ? verifiedPackagedFoodProfiles.get(item.ordinal) : undefined;
  const isPackagedFood = Boolean(packagedFoodProfile);
  const isNaturalFood = item.categoryGroup === "food" && !isPackagedFood;
  const inferredForm: NativeReferenceProductForm = item.categoryGroup === "fashion" ? "fashion-item" : isNaturalFood ? "meat-cut" : isPackagedFood ? packagedFoodProfile!.productForm : "universal-packshot";
  const semanticComparison = referenceRequiresComparisonSemantics(item);
  const inferredComposition = semanticComparison ? ("comparison" as const) : packagedFoodProfile?.compositionType || (isNaturalFood ? (item.layoutFamily === "sensory-editorial" || item.layoutFamily === "situation-story" ? ("natural-food-scene" as const) : compositionFromLayout(item.layoutFamily)) : compositionFromLayout(item.layoutFamily));
  const inferredCount = packagedFoodProfile?.productSlotCount || (/(?:2\s*\+\s*1|세트|묶음|라인업)/i.test(item.sourceFile) ? 2 : 1);
  const inferredFoodSubcategory = item.categoryGroup === "food"
    ? normalizeNativeReferenceFoodSubcategory(item.foodSubcategory) || inferNativeReferenceFoodSubcategoryFromText([
        item.sourceFile,
        item.nativeCopy?.rawText,
        ...(item.nativeCopy?.rawLines || []),
      ].filter(Boolean).join(" "))
    : undefined;
  const redundantPools = new Set<NativeReferenceSelectionPool>([
    item.categoryGroup,
    ...(item.categoryGroup === "food" && inferredFoodSubcategory === "snack" ? (["food-snack"] as const) : []),
  ]);
  const additionalSelectionPools = normalizeNativeReferenceSelectionPools(item.additionalSelectionPools).filter((pool) => !redundantPools.has(pool));
  return {
    ...item,
    // 과거 등록분에 하위 태그가 비어 있어도 저장 OCR과 파일명에 명백한
    // 간식 신호가 있으면 읽는 시점에 간식 풀로 복구한다. 수동 태그는 우선한다.
    foodSubcategory: inferredFoodSubcategory,
    additionalSelectionPools: additionalSelectionPools.length ? additionalSelectionPools : undefined,
    productForm: nativeReferenceProductForms.includes(item.productForm as NativeReferenceProductForm) ? (item.productForm as NativeReferenceProductForm) : inferredForm,
    compositionType: semanticComparison ? "comparison" : nativeReferenceCompositionTypes.includes(item.compositionType as NativeReferenceCompositionType) ? (item.compositionType as NativeReferenceCompositionType) : inferredComposition,
    // VS 구도는 판매 상품이 하나여도 불리한 대안과 현재 상품이라는 서로 다른
    // 시각 역할 두 개를 가진다. 복수 구성 상품으로 해석하지는 않는다.
    productSlotCount: semanticComparison ? Math.max(2, Math.min(6, Math.round(Number(item.productSlotCount) || 2))) : Math.max(1, Math.min(6, Math.round(Number(item.productSlotCount) || inferredCount))),
    productSlotShape: nativeReferenceSlotShapes.includes(item.productSlotShape as NativeReferenceSlotShape) ? (item.productSlotShape as NativeReferenceSlotShape) : isNaturalFood ? "wide" : item.categoryGroup === "fashion" ? "tall" : "flexible",
    photographyType: nativeReferencePhotographyTypes.includes(item.photographyType as NativeReferencePhotographyType) ? (item.photographyType as NativeReferencePhotographyType) : isNaturalFood ? "natural-food" : inferredComposition === "lifestyle-scene" ? "lifestyle" : "packshot",
    textDensity: nativeReferenceTextDensities.includes(item.textDensity as NativeReferenceTextDensity) ? (item.textDensity as NativeReferenceTextDensity) : ["price-offer", "usp-evidence", "social-proof"].includes(item.layoutFamily) ? "dense" : "medium",
    supportsPackagedProduct: item.supportsPackagedProduct ?? !isNaturalFood,
    supportsNaturalFood: item.supportsNaturalFood ?? isNaturalFood,
    supportsHumanModel: item.supportsHumanModel ?? item.categoryGroup === "fashion",
    supportsMultipleProducts: item.supportsMultipleProducts ?? packagedFoodProfile?.supportsMultipleProducts ?? inferredCount > 1,
    compatibilityConfidence: item.compatibilityConfidence || (item.categoryGroup === "food" ? "high" : "medium"),
  };
}

export function normalizeNativeReferenceCategory(value: unknown): NativeReferenceCategoryGroup {
  return nativeReferenceCategoryGroups.includes(value as NativeReferenceCategoryGroup) ? (value as NativeReferenceCategoryGroup) : "beauty";
}

export function nativeReferenceCategoryLabel(value: NativeReferenceCategoryGroup) {
  if (value === "fashion") return "패션";
  if (value === "food") return "음식";
  return "화장품";
}

export function normalizeNativeReferenceFoodSubcategory(value: unknown): NativeReferenceFoodSubcategory | undefined {
  // 기존 과일/농산물 전용 풀은 간식 전용 풀로 이관한다. 저장된 과거 manifest를
  // 읽거나 진행 중인 개발 서버가 이전 값을 보내도 같은 간식 풀로 복구한다.
  if (value === "produce-agriculture") return "snack";
  return nativeReferenceFoodSubcategories.includes(value as NativeReferenceFoodSubcategory) ? (value as NativeReferenceFoodSubcategory) : undefined;
}

export function nativeReferenceFoodSubcategoryLabel(value: NativeReferenceFoodSubcategory) {
  if (value === "snack") return "간식";
  return value;
}

export function normalizeNativeReferenceSelectionPools(value: unknown): NativeReferenceSelectionPool[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((pool): pool is NativeReferenceSelectionPool => nativeReferenceSelectionPools.includes(pool as NativeReferenceSelectionPool)))];
}

export function nativeReferenceSelectionPoolLabel(value: NativeReferenceSelectionPool) {
  if (value === "fashion") return "패션";
  if (value === "food") return "음식";
  if (value === "food-snack") return "간식";
  return "화장품";
}

/** 기본 분류와 운영자가 체크한 추가 풀을 하나의 선택 멤버십으로 해석합니다. */
export function referenceBelongsToSelectionPool(
  item: Pick<ManagedNativeReferenceItem, "categoryGroup" | "foodSubcategory" | "additionalSelectionPools">,
  categoryGroup: NativeReferenceCategoryGroup,
  foodSubcategory?: NativeReferenceFoodSubcategory
) {
  const additional = new Set(normalizeNativeReferenceSelectionPools(item.additionalSelectionPools));
  if (categoryGroup === "food" && foodSubcategory === "snack") {
    return (item.categoryGroup === "food" && item.foodSubcategory === "snack") || additional.has("food-snack");
  }
  if (categoryGroup === "food") {
    return item.categoryGroup === "food" || additional.has("food") || additional.has("food-snack");
  }
  return item.categoryGroup === categoryGroup || additional.has(categoryGroup);
}

export function inferNativeReferenceFoodSubcategoryFromText(value: string): NativeReferenceFoodSubcategory | undefined {
  const normalized = String(value || "").normalize("NFC").toLowerCase();
  if (/떡갈비|갈비|육류|고기|한우|소고기|돼지고기|닭고기|김치|반찬|찌개|국(?:\s|[._-]|$)|탕(?:\s|[._-]|$)|전골|밀키트|간편식|즉석식|식사|meal|meat|beef|pork|chicken|kimchi|soup/u.test(normalized)) return undefined;
  return /간식|스낵|과자|전병|쿠키|비스킷|초콜릿|캔디|사탕|젤리|견과|건과|말랭이|건조|반건조|곶감|무화과|약과|한과|떡(?!갈비)|빵|베이커리|도넛|디저트|아이스크림|과일|사과|복숭아|자두|포도|수박|감귤|오렌지|딸기|멜론|참외|snack|dessert|fruit/u.test(normalized) ? "snack" : undefined;
}

export function inferNativeReferenceCategoryFromText(value: string): NativeReferenceCategoryGroup {
  if (fashionPattern.test(value)) return "fashion";
  if (beautyPattern.test(value)) return "beauty";
  if (foodPattern.test(value)) return "food";
  return "beauty";
}

export function removeManagedNativeReference(items: readonly ManagedNativeReferenceItem[], id: string) {
  return items.filter((item) => item.id !== id);
}
