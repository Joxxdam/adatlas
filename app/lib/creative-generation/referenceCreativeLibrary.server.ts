import "server-only";
import { randomInt } from "node:crypto";
import path from "node:path";
import type { GenerationJob, GenerationResult } from "./types";
import { resolveCategoryCreativeProfile } from "./categoryCreativeRouter";
import { defaultCompositionTypes, pickCompatibleRandomItems, scoreReferenceCompatibility, type ProductReferenceCompatibilityProfile } from "./referenceSelection";
import { readNativeReferenceManifestSync } from "./nativeReferenceLibraryRepository.server";
import { isApprovedReferenceNativeCopy, normalizeNativeReferenceCompatibility, type ManagedNativeReferenceItem, type NativeReferenceFoodSubcategory, type NativeReferenceProductForm } from "./referenceLibraryManagement";

export type NativeReferenceCategoryGroup = "fashion" | "food" | "beauty";

export type NativeAdReference = {
  id: string;
  path: string;
  publicPath: string;
  sourceFile: string;
  layoutFamily: string;
  categoryGroup: NativeReferenceCategoryGroup;
  foodSubcategory?: NativeReferenceFoodSubcategory;
  categoryLabel: string;
  selectionReason: string;
  productForm?: ManagedNativeReferenceItem["productForm"];
  compositionType?: ManagedNativeReferenceItem["compositionType"];
  productSlotCount?: number;
  productSlotShape?: ManagedNativeReferenceItem["productSlotShape"];
  photographyType?: ManagedNativeReferenceItem["photographyType"];
  textDensity?: ManagedNativeReferenceItem["textDensity"];
  compatibilityConfidence?: ManagedNativeReferenceItem["compatibilityConfidence"];
  nativeCopy?: ManagedNativeReferenceItem["nativeCopy"];
};

type ReferenceSelectionJob = Pick<GenerationJob, "productTruth" | "referenceCategoryOverride">;

const publicRoot = path.resolve(/* turbopackIgnore: true */ process.cwd(), "public");

function categoryGroupFromOrdinal(ordinal: number): NativeReferenceCategoryGroup {
  if ([2, 4, 7, 9, 44].includes(ordinal) || (ordinal >= 11 && ordinal <= 36) || (ordinal >= 50 && ordinal <= 66)) return "food";
  return "beauty";
}

function normalizeCategoryGroup(value: string | undefined, ordinal: number): NativeReferenceCategoryGroup {
  if (value === "food" || value === "fashion" || value === "beauty") return value;
  if (value === "beauty-personal-care" || value === "health-wellness" || value === "general") return "beauty";
  return categoryGroupFromOrdinal(ordinal);
}

// Next 개발 서버가 JSON import를 캐시한 상태에서도 새 카테고리 정책이 즉시
// 적용되도록 검수된 순번 분류를 fallback으로 사용한다.
function readReferenceItems() {
  return readNativeReferenceManifestSync().items.map((item) =>
    normalizeNativeReferenceCompatibility({
      ...item,
      categoryGroup: normalizeCategoryGroup(item.categoryGroup, item.ordinal),
    })
  );
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toNativeAdReference(selected: ManagedNativeReferenceItem, selectionReason: string): NativeAdReference {
  const publicPath = selected.publicPath;
  return {
    id: selected.id,
    path: path.join(publicRoot, publicPath.replace(/^\/+/, "")),
    publicPath,
    sourceFile: selected.sourceFile,
    layoutFamily: selected.layoutFamily,
    categoryGroup: selected.categoryGroup as NativeReferenceCategoryGroup,
    foodSubcategory: selected.foodSubcategory,
    categoryLabel: categoryLabel(selected.categoryGroup as NativeReferenceCategoryGroup),
    selectionReason,
    productForm: selected.productForm,
    compositionType: selected.compositionType,
    productSlotCount: selected.productSlotCount,
    productSlotShape: selected.productSlotShape,
    photographyType: selected.photographyType,
    textDensity: selected.textDensity,
    compatibilityConfidence: selected.compatibilityConfidence,
    nativeCopy: selected.nativeCopy,
  };
}

/** 관리 화면에서 막 등록된 레퍼런스를 문구 구조 캐시에 전달할 때 사용합니다. */
export function nativeAdReferenceFromManagedItem(item: ManagedNativeReferenceItem): NativeAdReference {
  return toNativeAdReference(normalizeNativeReferenceCompatibility(item), "레퍼런스 관리 화면에서 등록되어 문구 구조를 사전 분석합니다.");
}

/**
 * 생성 작업에서는 OCR을 실행하지 않습니다. 업로드·운영자 재분석에서 저장된
 * 분석만 전달하고, 미분석 항목은 계획 단계의 원본 이미지 직접 판독 fallback을
 * 사용합니다. 이 함수는 과거 호출부 호환을 위해 유지합니다.
 */
export async function ensureNativeReferenceCopies(references: NativeAdReference[]) {
  return references;
}

function categoryLabel(categoryGroup: NativeReferenceCategoryGroup) {
  if (categoryGroup === "fashion") return "패션";
  if (categoryGroup === "food") return "식품";
  return "화장품";
}

export function resolveNativeReferenceCategoryGroup(job: ReferenceSelectionJob): NativeReferenceCategoryGroup {
  if (job.referenceCategoryOverride === "fashion") return "fashion";
  if (job.referenceCategoryOverride === "food" || job.referenceCategoryOverride === "food-produce") return "food";
  if (job.referenceCategoryOverride === "beauty") return "beauty";
  const category = resolveCategoryCreativeProfile(job.productTruth).category;
  if (category.startsWith("food_")) return "food";
  if (category === "fashion") return "fashion";
  return "beauty";
}

const packagedForms = new Set<NativeReferenceProductForm>(["bottle", "tube", "pouch", "box", "tray", "jar", "can", "bundle", "universal-packshot"]);

function resolveProductForm(job: ReferenceSelectionJob, categoryGroup: NativeReferenceCategoryGroup, foodSubcategory?: NativeReferenceFoodSubcategory): NativeReferenceProductForm {
  const truth = job.productTruth;
  const text = [truth.normalized.cleanProductName, truth.normalized.rawProductTitle, truth.normalized.category, truth.normalized.quantity, truth.normalized.composition, truth.normalized.packageOrOption, truth.product.productName].filter(Boolean).join(" ").toLowerCase();
  if (categoryGroup === "fashion") return "fashion-item";
  if (categoryGroup === "food" && /스테이크|등심|안심|갈비|삼겹|목살|한우|소고기|돼지고기|육류|meat|beef|pork/.test(text)) return "meat-cut";
  if (foodSubcategory) return "produce";
  if (/캔|can\b/.test(text)) return "can";
  if (/튜브|tube/.test(text)) return "tube";
  if (/파우치|봉지|팩(?:\s|$|\d)|분말|즙|pouch|sachet/.test(text)) return "pouch";
  if (/단지|병조림|jar/.test(text)) return "jar";
  if (/병|보틀|우유|음료|주스|워터|샤워젤|샴푸|로션|세럼|앰플|bottle|milk|drink|juice/.test(text)) return "bottle";
  if (/박스|상자|box/.test(text)) return "box";
  if (/트레이|쟁반|tray/.test(text)) return "tray";
  if (/세트|묶음|번들|bundle/.test(text)) return "bundle";
  if (categoryGroup === "food" && !/(건강|영양제|비타민|유산균|홍삼)/.test(text)) return "natural-food";
  return "universal-packshot";
}

export function resolveNativeReferenceFoodSubcategory(job: ReferenceSelectionJob): NativeReferenceFoodSubcategory | undefined {
  if (job.referenceCategoryOverride === "food-produce") return "produce-agriculture";
  // 사용자가 일반 식품이나 다른 대분류를 직접 골랐다면 자동 과일 판정을 덮어씁니다.
  if (job.referenceCategoryOverride) return undefined;
  const truth = job.productTruth;
  const identityText = [truth.product.category, truth.product.productSubCategory, truth.product.detectedProductType, truth.product.productName, truth.normalized.category, truth.normalized.cleanProductName, truth.normalized.rawProductTitle].filter(Boolean).join(" ").toLowerCase();
  const isProcessedFood = /주스|과즙|즙(?:\s|$|팩)|잼|청(?:\s|$)|말랭이|건조|분말|스낵|과자|음료|우유|요거트|소스|냉동|통조림|가공|젤리|juice|jam|snack|drink|milk|powder/.test(identityText);
  const hasProduceIdentity = /농산|청과|과채|과일|채소|사과|복숭아|자두|포도|수박|배(?:\s|$)|감귤|귤(?:\s|$)|오렌지|레몬|라임|딸기|멜론|참외|토마토|고구마|감자|양파|마늘|버섯|옥수수|산지직송|제철|생과|produce|fruit|vegetable/.test(identityText);
  const isFreshProfile = resolveCategoryCreativeProfile(truth).category === "food_fresh";
  return !isProcessedFood && (hasProduceIdentity || isFreshProfile) ? "produce-agriculture" : undefined;
}

function resolveProductCount(job: ReferenceSelectionJob) {
  const text = [job.productTruth.normalized.quantity, job.productTruth.normalized.composition, job.productTruth.normalized.packageOrOption].filter(Boolean).join(" ");
  const match = text.match(/(?:^|\s)([2-6])\s*(?:개|병|캔|팩|박스|세트|입)(?:\s|$)/);
  return match ? Number(match[1]) : 1;
}

export function buildProductReferenceCompatibilityProfile(job: ReferenceSelectionJob): ProductReferenceCompatibilityProfile {
  const categoryGroup = resolveNativeReferenceCategoryGroup(job);
  const foodSubcategory = resolveNativeReferenceFoodSubcategory(job);
  const productForm = resolveProductForm(job, categoryGroup, foodSubcategory);
  const packagedProduct = packagedForms.has(productForm);
  const naturalFood = categoryGroup === "food" && ["meat-cut", "natural-food", "produce"].includes(productForm);
  const profile: ProductReferenceCompatibilityProfile = {
    categoryGroup,
    foodSubcategory,
    productForm,
    productCount: resolveProductCount(job),
    packagedProduct,
    naturalFood,
    allowsHumanModel: categoryGroup === "fashion",
    compatibleCompositionTypes: [],
  };
  profile.compatibleCompositionTypes = defaultCompositionTypes(profile);
  return profile;
}

/**
 * 새 작업을 만들 때 상품군·형태·구도·슬롯이 호환되는 ZIP 후보에서
 * 중복 없이 무작위 레퍼런스를 뽑는다.
 * 선택 결과는 GenerationJob에 저장되므로 새로고침·재시도·서버 복구 시에는
 * 다시 추첨하지 않고 같은 디자인을 이어서 편집한다.
 */
export function selectCategoryNativeAdReferences(job: ReferenceSelectionJob, count = 6, nextIndex: (maxExclusive: number) => number = randomInt, recentReferenceIds: ReadonlySet<string> = new Set()): NativeAdReference[] {
  const profile = buildProductReferenceCompatibilityProfile(job);
  const categoryGroup = profile.categoryGroup;
  const categoryName = profile.foodSubcategory ? `${categoryLabel(categoryGroup)} > 과일/농산물` : categoryLabel(categoryGroup);
  // OCR 승인 여부는 제작 허가가 아닙니다. 호환되는 레퍼런스는 모두 시각
  // 원본으로 사용할 수 있고, 저장 문구가 없거나 불확실하면 자동 fallback이
  // ProductTruth 문구 계약을 만들어 사용자 승인 없이 제작을 계속합니다.
  const referenceItems = readReferenceItems();
  const copyReadyItems = referenceItems.filter((item) => isApprovedReferenceNativeCopy(item.nativeCopy));
  const freshItems = referenceItems.filter((item) => !recentReferenceIds.has(item.id));
  const freshCopyReadyItems = copyReadyItems.filter((item) => !recentReferenceIds.has(item.id));
  const selectionMode = job.referenceCategoryOverride ? "사용자 수동 지정" : "상품 분석 자동 분류";
  let selected;
  let lastError: unknown;
  // 원문 OCR이 준비된 레퍼런스를 항상 우선한다. 기존 라이브러리 마이그레이션
  // 중에는 제작을 막지 않기 위해 원문 미분석 항목까지 단계적으로 넓힌다.
  for (const pool of [freshCopyReadyItems, copyReadyItems, freshItems, referenceItems]) {
    try {
      selected = pickCompatibleRandomItems(pool, count, profile, nextIndex);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!selected) throw lastError instanceof Error ? lastError : new Error("호환되는 광고 레퍼런스가 부족합니다.");
  return selected.map((candidate, index) => toNativeAdReference(candidate.item, `${selectionMode} · ${categoryName} · ${profile.productForm} 호환 후보에서 ${index + 1}번째 레퍼런스로 무작위 선택했습니다(호환 점수 ${candidate.score}: ${candidate.reasons.join(", ")}). 선택 결과는 작업에 고정되며 최종 결과는 원본 구성을 보존하고 실제 URL 상품과 ProductTruth 문구를 교체합니다.`));
}

/** 과거 작업처럼 레퍼런스가 저장되지 않은 경우에만 사용하는 결정적 fallback. */
export function selectNativeAdReference(job: GenerationJob, result: GenerationResult): NativeAdReference {
  const allReferenceItems = readReferenceItems();
  const copyReadyItems = allReferenceItems.filter((item) => isApprovedReferenceNativeCopy(item.nativeCopy));
  const profile = buildProductReferenceCompatibilityProfile(job);
  if (!allReferenceItems.length) throw new Error("등록된 고품질 광고 레퍼런스가 없습니다.");
  const compatibleIn = (items: typeof allReferenceItems) => items
      .map((item) => scoreReferenceCompatibility(profile, item))
      .filter((candidate) => candidate.score >= 60)
      .sort((left, right) => right.score - left.score);
  const copyReadyCompatible = compatibleIn(copyReadyItems);
  const compatible = copyReadyCompatible.length ? copyReadyCompatible : compatibleIn(allReferenceItems);
  if (!compatible.length) {
    const categoryName = profile.foodSubcategory ? `${categoryLabel(profile.categoryGroup)} > 과일/농산물` : categoryLabel(profile.categoryGroup);
    throw new Error(`${categoryName} · ${profile.productForm} 상품과 호환되는 복구용 레퍼런스가 없습니다.`);
  }
  const selected = compatible[stableHash(`${job.id}:${job.productTruth.productId}:${result.id}`) % compatible.length];
  return toNativeAdReference(selected.item, `과거 작업 복구를 위해 ${profile.foodSubcategory ? `${categoryLabel(profile.categoryGroup)} > 과일/농산물` : categoryLabel(profile.categoryGroup)} · ${profile.productForm} 호환 풀에서 결정적으로 선택했습니다(호환 점수 ${selected.score}).`);
}
