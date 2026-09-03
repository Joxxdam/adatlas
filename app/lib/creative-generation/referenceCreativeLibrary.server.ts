import "server-only";
import { randomInt } from "node:crypto";
import path from "node:path";
import type { GenerationJob, GenerationResult } from "./types";
import { resolveCategoryCreativeProfile } from "./categoryCreativeRouter";
import { defaultCompositionTypes, pickCompatibleRandomItems, scoreReferenceCompatibility, type ProductReferenceCompatibilityProfile } from "./referenceSelection";
import { readNativeReferenceManifestSync } from "./nativeReferenceLibraryRepository.server";
import { inferNativeReferenceFoodSubcategoryFromText, normalizeNativeReferenceCompatibility, referenceBelongsToSelectionPool, type ManagedNativeReferenceItem, type NativeReferenceFoodSubcategory, type NativeReferenceProductForm } from "./referenceLibraryManagement";

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
  if (categoryGroup === "food") return "음식";
  return "화장품";
}

export function resolveNativeReferenceCategoryGroup(job: ReferenceSelectionJob): NativeReferenceCategoryGroup {
  if (job.referenceCategoryOverride === "fashion") return "fashion";
  if (["food", "food-snack", "food-produce"].includes(job.referenceCategoryOverride || "")) return "food";
  if (job.referenceCategoryOverride === "beauty") return "beauty";
  const category = resolveCategoryCreativeProfile(job.productTruth).category;
  if (category.startsWith("food_")) return "food";
  if (category === "fashion") return "fashion";
  if (["beauty_cosmetics", "personal_care", "health"].includes(category)) return "beauty";
  // A weak upstream category such as "기타" must not silently become beauty
  // when the product identity itself clearly says food or fashion.
  const identityText = [
    job.productTruth.product.category,
    job.productTruth.product.productSubCategory,
    job.productTruth.product.detectedProductType,
    job.productTruth.product.productName,
    job.productTruth.normalized.category,
    job.productTruth.normalized.cleanProductName,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/food|snack|dessert|meat|fruit|produce|식품|음식|간식|스낵|과자|디저트|육류|과일|채소|농산|무화과|곶감|건조|말랭이|김치|반찬|음료|주스/.test(identityText)) return "food";
  if (/fashion|apparel|clothing|패션|의류|원피스|셔츠|바지|신발|가방/.test(identityText)) return "fashion";
  return "beauty";
}

const packagedForms = new Set<NativeReferenceProductForm>(["bottle", "tube", "pouch", "box", "tray", "jar", "can", "bundle", "universal-packshot"]);

function resolveProductForm(job: ReferenceSelectionJob, categoryGroup: NativeReferenceCategoryGroup, foodSubcategory?: NativeReferenceFoodSubcategory): NativeReferenceProductForm {
  const truth = job.productTruth;
  const text = [truth.normalized.cleanProductName, truth.normalized.rawProductTitle, truth.normalized.category, truth.normalized.quantity, truth.normalized.composition, truth.normalized.packageOrOption, truth.product.productName].filter(Boolean).join(" ").toLowerCase();
  if (categoryGroup === "fashion") return "fashion-item";
  if (categoryGroup === "food" && /스테이크|등심|안심|갈비|삼겹|목살|한우|소고기|돼지고기|육류|meat|beef|pork/.test(text)) return "meat-cut";
  if (foodSubcategory === "snack") return "natural-food";
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
  if (job.referenceCategoryOverride === "food-snack" || job.referenceCategoryOverride === "food-produce") return "snack";
  // 사용자가 일반 음식이나 다른 대분류를 직접 골랐다면 자동 간식 판정을 덮어씁니다.
  if (job.referenceCategoryOverride) return undefined;
  const truth = job.productTruth;
  const identityText = [truth.product.category, truth.product.productSubCategory, truth.product.detectedProductType, truth.product.productName, truth.normalized.category, truth.normalized.cleanProductName, truth.normalized.rawProductTitle].filter(Boolean).join(" ").toLowerCase();
  return inferNativeReferenceFoodSubcategoryFromText(identityText);
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
    // 화장품 레퍼런스의 인물은 동일 인물을 복사하지 않고, 같은 역할·구도에
    // 맞는 전혀 다른 가상 성인으로 다시 생성한다.
    allowsHumanModel: categoryGroup !== "food",
    compatibleCompositionTypes: [],
  };
  profile.compatibleCompositionTypes = defaultCompositionTypes(profile);
  return profile;
}

/**
 * 새 작업을 만들 때 일반 음식은 음식 전체 풀에서, 간식은 운영자가 지정한
 * 간식 하위 풀에서 중복 없이 무작위 레퍼런스를 뽑는다.
 * 선택 결과는 GenerationJob에 저장되므로 새로고침·재시도·서버 복구 시에는
 * 다시 추첨하지 않고 같은 디자인을 이어서 편집한다.
 */
export function selectCategoryNativeAdReferences(job: ReferenceSelectionJob, count = 6, nextIndex: (maxExclusive: number) => number = randomInt, recentReferenceIds: ReadonlySet<string> = new Set()): NativeAdReference[] {
  const profile = buildProductReferenceCompatibilityProfile(job);
  const categoryGroup = profile.categoryGroup;
  const categoryName = categoryLabel(categoryGroup);
  const referenceItems = readReferenceItems();
  const eligibleItems = referenceItems.filter((item) => referenceBelongsToSelectionPool(item, categoryGroup, profile.foodSubcategory));
  const selectionMode = job.referenceCategoryOverride ? "사용자 수동 지정" : "상품 분석 자동 분류";
  const poolName = profile.foodSubcategory === "snack" ? "음식 > 간식 전용 풀" : `${categoryName} 호환 풀`;
  const unusedItems = eligibleItems.filter((item) => !recentReferenceIds.has(item.id));
  const usableItems = unusedItems.filter((item) => scoreReferenceCompatibility(profile, item).score >= 60).length >= count
    ? unusedItems
    : eligibleItems;
  const selected = pickCompatibleRandomItems(usableItems, count, profile, nextIndex);
  return selected.map((candidate, index) => toNativeAdReference(candidate.item, `${selectionMode} · ${poolName}에서 상품 형태·구도·슬롯 호환 점수 ${candidate.score}점으로 통과한 후보 중 ${index + 1}번째로 무작위 선택했습니다. ${candidate.reasons.join(" · ")}. 선택 결과는 작업에 고정됩니다.`));
}

/** 과거 작업처럼 레퍼런스가 저장되지 않은 경우에만 사용하는 결정적 fallback. */
export function selectNativeAdReference(job: GenerationJob, result: GenerationResult): NativeAdReference {
  const allReferenceItems = readReferenceItems();
  const profile = buildProductReferenceCompatibilityProfile(job);
  if (!allReferenceItems.length) throw new Error("등록된 고품질 광고 레퍼런스가 없습니다.");
  const categoryItems = allReferenceItems
    .map((item) => scoreReferenceCompatibility(profile, item))
    .filter((candidate) => candidate.score >= 60);
  if (!categoryItems.length) {
    throw new Error(`${categoryLabel(profile.categoryGroup)}에 등록된 복구용 레퍼런스가 없습니다.`);
  }
  const selected = categoryItems[stableHash(`${job.id}:${job.productTruth.productId}:${result.id}`) % categoryItems.length];
  return toNativeAdReference(selected.item, `과거 작업 복구를 위해 ${categoryLabel(profile.categoryGroup)} 호환 풀에서 ${selected.score}점으로 통과한 레퍼런스를 결정적으로 선택했습니다.`);
}
