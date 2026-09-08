import { referenceRequiresComparisonSemantics } from "./referenceSemanticRoles.ts";

export const nativeReferenceCategoryGroups = ["fashion", "food", "beauty"] as const;

export type NativeReferenceCategoryGroup = (typeof nativeReferenceCategoryGroups)[number];

export const nativeReferenceFoodSubcategories = ["meat", "snack"] as const;
export type NativeReferenceFoodSubcategory = (typeof nativeReferenceFoodSubcategories)[number];

export const nativeReferenceBeautySubcategories = ["design", "hook"] as const;
export type NativeReferenceBeautySubcategory = (typeof nativeReferenceBeautySubcategories)[number];

/**
 * 기본 분류를 바꾸지 않고 같은 레퍼런스를 다른 제작 후보군에서도 함께
 * 활용하기 위한 추가 풀입니다. food는 육류·간식을 포함한 식품 전체 풀이고,
 * food-meat/food-snack은 사용자가 하위 풀을 직접 고를 때 사용합니다.
 */
export const nativeReferenceSelectionPools = ["fashion", "food", "food-meat", "food-snack", "beauty"] as const;
export type NativeReferenceSelectionPool = (typeof nativeReferenceSelectionPools)[number];

export const nativeReferenceProductForms = ["bottle", "tube", "pouch", "box", "tray", "jar", "can", "fashion-item", "natural-food", "meat-cut", "produce", "bundle", "universal-packshot"] as const;
export type NativeReferenceProductForm = (typeof nativeReferenceProductForms)[number];

/** 레퍼런스 안에 실제로 보이는 상품 표현입니다. 지원 가능성이 아니라 화면 관찰값입니다. */
export const nativeReferenceProductPresentations = ["packaged", "unpackaged", "mixed"] as const;
export type NativeReferenceProductPresentation = (typeof nativeReferenceProductPresentations)[number];

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
  beautySubcategory?: NativeReferenceBeautySubcategory;
  productForm: NativeReferenceProductForm;
  productPresentation: NativeReferenceProductPresentation;
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
  /** 화장품 대카테고리 안의 디자인 중심·후킹 중심 선택 풀입니다. */
  beautySubcategory?: NativeReferenceBeautySubcategory;
  /** 기본 categoryGroup을 유지한 채 함께 사용할 수동 추가 제작 풀입니다. */
  additionalSelectionPools?: NativeReferenceSelectionPool[];
  ordinal: number;
  contentHash?: string;
  uploadedAt?: string;
  classificationMethod?: "codex-local" | "filename-rule" | "imported" | "manual";
  productForm?: NativeReferenceProductForm;
  productPresentation?: NativeReferenceProductPresentation;
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

const beautyHookLayouts = new Set(["price-offer", "problem-objection", "social-proof", "usp-evidence"]);
const beautyHookCompositions = new Set<NativeReferenceCompositionType>(["price-card", "before-after", "comparison", "review-card", "human-use"]);
const beautyDesignCompositions = new Set<NativeReferenceCompositionType>(["product-packshot", "product-lineup", "sensory-closeup"]);
const beautyDesignPhotography = new Set<NativeReferencePhotographyType>(["packshot", "editorial"]);
const beautyHookCopyPattern = /(?:\d[\d,.]*\s*(?:원|%|개|명|일|시간)|\d\s*[+x×]\s*\d|off|sale|할인|특가|쿠폰|증정|무료\s*배송|배송비|오늘|마감|놓치|단독|한정|재구매|후기|추천|비교|전후|before|after|고민|해결|효과|비법|비밀|왜|어떻게|지금\s*사|구매|보러\s*가|클릭|링크|\?|!)/iu;

/** 저장된 시각·OCR 신호로 기존 화장품 레퍼런스도 즉시 두 풀로 나눕니다. */
export function inferNativeReferenceBeautySubcategory(input: {
  sourceFile?: string;
  layoutFamily?: string;
  compositionType?: NativeReferenceCompositionType;
  photographyType?: NativeReferencePhotographyType;
  textDensity?: NativeReferenceTextDensity;
  supportsHumanModel?: boolean;
  nativeCopy?: ReferenceNativeCopy;
}): NativeReferenceBeautySubcategory {
  if (beautyHookCompositions.has(input.compositionType as NativeReferenceCompositionType)) return "hook";
  if (beautyHookLayouts.has(String(input.layoutFamily || ""))) return "hook";
  if (input.photographyType === "human-model" || input.supportsHumanModel) return "hook";
  const copyText = [input.sourceFile, input.nativeCopy?.rawText, ...(input.nativeCopy?.rawLines || [])].filter(Boolean).join(" ");
  if (beautyHookCopyPattern.test(copyText)) return "hook";

  // 디자인 풀은 027.webp 같은 제품 중심 브랜드 키비주얼만 허용한다.
  // 문구가 중간 이상이거나 판정 근거가 부족한 소재는 성과형 후킹 풀로 둔다.
  const productLedComposition = beautyDesignCompositions.has(input.compositionType as NativeReferenceCompositionType);
  const productLedPhotography = beautyDesignPhotography.has(input.photographyType as NativeReferencePhotographyType);
  if (input.textDensity === "light" && productLedComposition && productLedPhotography) return "design";
  return "hook";
}

/**
 * 과거 manifest의 카테고리 값은 유지하면서 신규 호환 태그를 보완한다.
 * 육류와 실제 확인한 포장 식품 레퍼런스를 분리해 병음료가 육류 장면을
 * 범용 fallback으로 사용하는 일을 막는다. 수동 태그가 있으면 항상 우선한다.
 */
export function normalizeNativeReferenceCompatibility(item: ManagedNativeReferenceItem): ManagedNativeReferenceItem & NativeReferenceCompatibility {
  const referenceIdentityText = [
    item.sourceFile,
    item.nativeCopy?.rawText,
    ...(item.nativeCopy?.rawLines || []),
  ].filter(Boolean).join(" ");
  const inferredFoodSubcategory = item.categoryGroup === "food"
    ? normalizeNativeReferenceFoodSubcategory(item.foodSubcategory) || inferNativeReferenceFoodSubcategoryFromText(referenceIdentityText)
    : undefined;
  const inferredBeautySubcategory = item.categoryGroup === "beauty"
    ? normalizeNativeReferenceBeautySubcategory(item.beautySubcategory) || inferNativeReferenceBeautySubcategory(item)
    : undefined;
  const packagedFoodProfile = item.categoryGroup === "food" ? verifiedPackagedFoodProfiles.get(item.ordinal) : undefined;
  const isPackagedFood = Boolean(packagedFoodProfile);
  const isNaturalFood = item.categoryGroup === "food" && !isPackagedFood;
  const inferredForm: NativeReferenceProductForm = item.categoryGroup === "fashion"
    ? "fashion-item"
    : inferredFoodSubcategory === "meat"
      ? "meat-cut"
      : isNaturalFood
        ? "natural-food"
        : isPackagedFood
          ? packagedFoodProfile!.productForm
          : "universal-packshot";
  const semanticComparison = referenceRequiresComparisonSemantics(item);
  const inferredComposition = semanticComparison ? ("comparison" as const) : packagedFoodProfile?.compositionType || (isNaturalFood ? (item.layoutFamily === "sensory-editorial" || item.layoutFamily === "situation-story" ? ("natural-food-scene" as const) : compositionFromLayout(item.layoutFamily)) : compositionFromLayout(item.layoutFamily));
  const inferredCount = packagedFoodProfile?.productSlotCount || (/(?:2\s*\+\s*1|세트|묶음|라인업)/i.test(item.sourceFile) ? 2 : 1);
  const supportsPackagedProduct = item.supportsPackagedProduct ?? !isNaturalFood;
  const supportsNaturalFood = item.supportsNaturalFood ?? isNaturalFood;
  const inferredPresentation: NativeReferenceProductPresentation = supportsPackagedProduct && supportsNaturalFood
    ? "mixed"
    : supportsPackagedProduct
      ? "packaged"
      : "unpackaged";
  const redundantPools = new Set<NativeReferenceSelectionPool>([
    item.categoryGroup,
    ...(item.categoryGroup === "food" && inferredFoodSubcategory ? ([`food-${inferredFoodSubcategory}`] as NativeReferenceSelectionPool[]) : []),
  ]);
  const additionalSelectionPools = normalizeNativeReferenceSelectionPools(item.additionalSelectionPools).filter((pool) => !redundantPools.has(pool));
  return {
    ...item,
    // 과거 등록분에 하위 태그가 비어 있어도 저장 OCR과 파일명으로 육류·간식을
    // 복구한다. 둘 다 아니면 별도 '기타' 풀을 만들지 않고 식품에만 둔다.
    foodSubcategory: inferredFoodSubcategory,
    beautySubcategory: inferredBeautySubcategory,
    additionalSelectionPools: additionalSelectionPools.length ? additionalSelectionPools : undefined,
    productForm: nativeReferenceProductForms.includes(item.productForm as NativeReferenceProductForm)
      && !(item.productForm === "meat-cut" && inferredFoodSubcategory !== "meat")
      ? (item.productForm as NativeReferenceProductForm)
      : inferredForm,
    productPresentation: nativeReferenceProductPresentations.includes(item.productPresentation as NativeReferenceProductPresentation)
      ? (item.productPresentation as NativeReferenceProductPresentation)
      : inferredPresentation,
    compositionType: semanticComparison ? "comparison" : nativeReferenceCompositionTypes.includes(item.compositionType as NativeReferenceCompositionType) ? (item.compositionType as NativeReferenceCompositionType) : inferredComposition,
    // VS 구도는 판매 상품이 하나여도 불리한 대안과 현재 상품이라는 서로 다른
    // 시각 역할 두 개를 가진다. 복수 구성 상품으로 해석하지는 않는다.
    productSlotCount: semanticComparison ? Math.max(2, Math.min(6, Math.round(Number(item.productSlotCount) || 2))) : Math.max(1, Math.min(6, Math.round(Number(item.productSlotCount) || inferredCount))),
    productSlotShape: nativeReferenceSlotShapes.includes(item.productSlotShape as NativeReferenceSlotShape) ? (item.productSlotShape as NativeReferenceSlotShape) : isNaturalFood ? "wide" : item.categoryGroup === "fashion" ? "tall" : "flexible",
    photographyType: nativeReferencePhotographyTypes.includes(item.photographyType as NativeReferencePhotographyType) ? (item.photographyType as NativeReferencePhotographyType) : isNaturalFood ? "natural-food" : inferredComposition === "lifestyle-scene" ? "lifestyle" : "packshot",
    textDensity: nativeReferenceTextDensities.includes(item.textDensity as NativeReferenceTextDensity) ? (item.textDensity as NativeReferenceTextDensity) : ["price-offer", "usp-evidence", "social-proof"].includes(item.layoutFamily) ? "dense" : "medium",
    supportsPackagedProduct,
    supportsNaturalFood,
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
  if (value === "food") return "식품";
  return "화장품";
}

export function normalizeNativeReferenceFoodSubcategory(value: unknown): NativeReferenceFoodSubcategory | undefined {
  // 기존 과일/농산물 전용 풀은 간식 전용 풀로 이관한다. 저장된 과거 manifest를
  // 읽거나 진행 중인 개발 서버가 이전 값을 보내도 같은 간식 풀로 복구한다.
  // 과거 other/none은 별도 풀로 유지하지 않고 식품 대분류만 남긴다.
  if (value === "produce-agriculture") return "snack";
  if (value === "other" || value === "none") return undefined;
  return nativeReferenceFoodSubcategories.includes(value as NativeReferenceFoodSubcategory) ? (value as NativeReferenceFoodSubcategory) : undefined;
}

export function nativeReferenceFoodSubcategoryLabel(value: NativeReferenceFoodSubcategory) {
  if (value === "meat") return "육류";
  return "간식";
}

export function normalizeNativeReferenceBeautySubcategory(value: unknown): NativeReferenceBeautySubcategory | undefined {
  return nativeReferenceBeautySubcategories.includes(value as NativeReferenceBeautySubcategory) ? (value as NativeReferenceBeautySubcategory) : undefined;
}

export function nativeReferenceBeautySubcategoryLabel(value: NativeReferenceBeautySubcategory) {
  if (value === "design") return "디자인";
  return "후킹";
}

export function normalizeNativeReferenceSelectionPools(value: unknown): NativeReferenceSelectionPool[] {
  if (!Array.isArray(value)) return [];
  const migrated = value.map((pool) => pool === "food-other" ? "food" : pool === "food-produce" ? "food-snack" : pool);
  return [...new Set(migrated.filter((pool): pool is NativeReferenceSelectionPool => nativeReferenceSelectionPools.includes(pool as NativeReferenceSelectionPool)))];
}

export function nativeReferenceSelectionPoolLabel(value: NativeReferenceSelectionPool) {
  if (value === "fashion") return "패션";
  if (value === "food") return "식품";
  if (value === "food-meat") return "식품 · 육류";
  if (value === "food-snack") return "식품 · 간식";
  return "화장품";
}

/** 기본 분류와 운영자가 체크한 추가 풀을 하나의 선택 멤버십으로 해석합니다. */
export function referenceBelongsToSelectionPool(
  item: Pick<ManagedNativeReferenceItem, "categoryGroup" | "foodSubcategory" | "additionalSelectionPools">,
  categoryGroup: NativeReferenceCategoryGroup,
  foodSubcategory?: NativeReferenceFoodSubcategory
) {
  const additional = new Set(normalizeNativeReferenceSelectionPools(item.additionalSelectionPools));
  if (categoryGroup === "food" && foodSubcategory) {
    return (item.categoryGroup === "food" && item.foodSubcategory === foodSubcategory)
      || additional.has(`food-${foodSubcategory}` as NativeReferenceSelectionPool);
  }
  if (categoryGroup === "food") {
    return item.categoryGroup === "food" || additional.has("food");
  }
  return item.categoryGroup === categoryGroup || additional.has(categoryGroup);
}

export function referenceBelongsToBeautySelectionPool(
  item: Pick<ManagedNativeReferenceItem, "categoryGroup" | "beautySubcategory">,
  beautySubcategory: NativeReferenceBeautySubcategory
) {
  return item.categoryGroup === "beauty" && normalizeNativeReferenceBeautySubcategory(item.beautySubcategory) === beautySubcategory;
}

export function inferNativeReferenceFoodSubcategoryFromText(value: string): NativeReferenceFoodSubcategory | undefined {
  const normalized = String(value || "").normalize("NFC").toLowerCase();
  // 육포·고기맛 과자처럼 육류 단어를 포함한 간식도 실제 판매 형태를 우선한다.
  if (/간식|스낵|과자|칩(?:\s|[._-]|$)|전병|쿠키|비스킷|초콜릿|캔디|사탕|젤리|육포|견과|건과|말랭이|건조|반건조|곶감|무화과|약과|한과|떡(?!갈비)|빵|베이커리|도넛|디저트|아이스크림|과일|사과|복숭아|자두|포도|수박|감귤|오렌지|딸기|멜론|참외|레몬|라임|깔라만시|자몽|바나나|망고|키위|체리|블루베리|snack|dessert|fruit/u.test(normalized)) return "snack";
  // 고기가 재료로 들어가더라도 볶음밥·김치·반찬·소스가 판매 상품이면
  // 육류 레퍼런스가 아니라 하위 태그 없는 일반 식품으로 둔다.
  if (/볶음밥|주먹밥|김치(?:찜)?|겉절이|고춧가루|반찬|샐러드|카레|파스타\s*소스|음료|스파클링/u.test(normalized)
    && !/닭강정|제육|불고기|바베큐|바비큐/u.test(normalized)) return undefined;
  if (/떡갈비|갈비|갈비살|가짜갈비|육류|고기|한우|한돈|설록우|암소|소고기|쇠고기|돼지고기|닭고기|닭가슴살|닭강정|오리고기|양고기|등뼈|안창살|안창|도가니|등심|안심|채끝|살치살|차돌|토시살|부채살|치마살|업진살|양지|사태|우둔|삼겹|목살|정육|축산|스테이크|불고기|제육|바베큐|바비큐|직화육|육즙|meat|beef|pork|chicken|steak|barbecue|bbq/u.test(normalized)) return "meat";
  return undefined;
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
