import "server-only";
import { randomInt } from "node:crypto";
import path from "node:path";
import type { GenerationJob, GenerationResult } from "./types";
import { resolveCategoryCreativeProfile } from "./categoryCreativeRouter";
import {
  defaultCompositionTypes,
  pickCompatibleRandomItems,
  scoreReferenceCompatibility,
  type ProductReferenceCompatibilityProfile,
} from "./referenceSelection";
import { readNativeReferenceManifestSync } from "./nativeReferenceLibraryRepository.server";
import {
  normalizeNativeReferenceCompatibility,
  type ManagedNativeReferenceItem,
  type NativeReferenceProductForm,
} from "./referenceLibraryManagement";

export type NativeReferenceCategoryGroup =
  | "fashion"
  | "food"
  | "beauty";

export type NativeAdReference = {
  id: string;
  path: string;
  publicPath: string;
  sourceFile: string;
  layoutFamily: string;
  categoryGroup: NativeReferenceCategoryGroup;
  categoryLabel: string;
  selectionReason: string;
  productForm?: ManagedNativeReferenceItem["productForm"];
  compositionType?: ManagedNativeReferenceItem["compositionType"];
  productSlotCount?: number;
  productSlotShape?: ManagedNativeReferenceItem["productSlotShape"];
  photographyType?: ManagedNativeReferenceItem["photographyType"];
  textDensity?: ManagedNativeReferenceItem["textDensity"];
  compatibilityConfidence?: ManagedNativeReferenceItem["compatibilityConfidence"];
};

const publicRoot = path.resolve(/* turbopackIgnore: true */ process.cwd(), "public");

function categoryGroupFromOrdinal(ordinal: number): NativeReferenceCategoryGroup {
  if (
    [2, 4, 7, 9, 44].includes(ordinal) ||
    (ordinal >= 11 && ordinal <= 36) ||
    (ordinal >= 50 && ordinal <= 66)
  ) return "food";
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
  return readNativeReferenceManifestSync().items.map((item) => normalizeNativeReferenceCompatibility({
      ...item,
      categoryGroup: normalizeCategoryGroup(item.categoryGroup, item.ordinal),
    }));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function toNativeAdReference(
  selected: ManagedNativeReferenceItem,
  selectionReason: string
): NativeAdReference {
  const publicPath = selected.publicPath;
  return {
    id: selected.id,
    path: path.join(publicRoot, publicPath.replace(/^\/+/, "")),
    publicPath,
    sourceFile: selected.sourceFile,
    layoutFamily: selected.layoutFamily,
    categoryGroup: selected.categoryGroup as NativeReferenceCategoryGroup,
    categoryLabel: categoryLabel(selected.categoryGroup as NativeReferenceCategoryGroup),
    selectionReason,
    productForm: selected.productForm,
    compositionType: selected.compositionType,
    productSlotCount: selected.productSlotCount,
    productSlotShape: selected.productSlotShape,
    photographyType: selected.photographyType,
    textDensity: selected.textDensity,
    compatibilityConfidence: selected.compatibilityConfidence,
  };
}

function categoryLabel(categoryGroup: NativeReferenceCategoryGroup) {
  if (categoryGroup === "fashion") return "패션";
  if (categoryGroup === "food") return "식품";
  return "화장품";
}

export function resolveNativeReferenceCategoryGroup(
  job: Pick<GenerationJob, "productTruth">
): NativeReferenceCategoryGroup {
  const category = resolveCategoryCreativeProfile(job.productTruth).category;
  if (category.startsWith("food_")) return "food";
  if (category === "fashion") return "fashion";
  return "beauty";
}

const packagedForms = new Set<NativeReferenceProductForm>([
  "bottle", "tube", "pouch", "box", "tray", "jar", "can", "bundle", "universal-packshot",
]);

function resolveProductForm(job: Pick<GenerationJob, "productTruth">): NativeReferenceProductForm {
  const truth = job.productTruth;
  const categoryGroup = resolveNativeReferenceCategoryGroup(job);
  const text = [
    truth.normalized.cleanProductName,
    truth.normalized.rawProductTitle,
    truth.normalized.category,
    truth.normalized.quantity,
    truth.normalized.composition,
    truth.normalized.packageOrOption,
    truth.product.productName,
  ].filter(Boolean).join(" ").toLowerCase();
  if (categoryGroup === "fashion") return "fashion-item";
  if (/스테이크|등심|안심|갈비|삼겹|목살|한우|소고기|돼지고기|육류|meat|beef|pork/.test(text)) return "meat-cut";
  if (/과일|채소|농산|수산|생물|원물|produce|fruit|vegetable/.test(text)) return "produce";
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

function resolveProductCount(job: Pick<GenerationJob, "productTruth">) {
  const text = [
    job.productTruth.normalized.quantity,
    job.productTruth.normalized.composition,
    job.productTruth.normalized.packageOrOption,
  ].filter(Boolean).join(" ");
  const match = text.match(/(?:^|\s)([2-6])\s*(?:개|병|캔|팩|박스|세트|입)(?:\s|$)/);
  return match ? Number(match[1]) : 1;
}

export function buildProductReferenceCompatibilityProfile(
  job: Pick<GenerationJob, "productTruth">
): ProductReferenceCompatibilityProfile {
  const categoryGroup = resolveNativeReferenceCategoryGroup(job);
  const productForm = resolveProductForm(job);
  const packagedProduct = packagedForms.has(productForm);
  const naturalFood = categoryGroup === "food" && ["meat-cut", "natural-food", "produce"].includes(productForm);
  const profile: ProductReferenceCompatibilityProfile = {
    categoryGroup,
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
export function selectCategoryNativeAdReferences(
  job: Pick<GenerationJob, "productTruth">,
  count = 6,
  nextIndex: (maxExclusive: number) => number = randomInt
): NativeAdReference[] {
  const profile = buildProductReferenceCompatibilityProfile(job);
  const categoryGroup = profile.categoryGroup;
  const categoryName = categoryLabel(categoryGroup);
  const referenceItems = readReferenceItems();
  return pickCompatibleRandomItems(referenceItems, count, profile, nextIndex).map((candidate, index) =>
    toNativeAdReference(
      candidate.item,
      `${categoryName} · ${profile.productForm} 호환 후보에서 ${index + 1}번째 레퍼런스로 무작위 선택했습니다(호환 점수 ${candidate.score}: ${candidate.reasons.join(", ")}). 선택 결과는 작업에 고정되며 최종 결과는 원본 구성을 보존하고 실제 URL 상품과 ProductTruth 문구를 교체합니다.`
    )
  );
}

/** 과거 작업처럼 레퍼런스가 저장되지 않은 경우에만 사용하는 결정적 fallback. */
export function selectNativeAdReference(job: GenerationJob, result: GenerationResult): NativeAdReference {
  const referenceItems = readReferenceItems();
  if (!referenceItems.length) throw new Error("등록된 고품질 광고 레퍼런스가 없습니다.");
  const profile = buildProductReferenceCompatibilityProfile(job);
  const compatible = referenceItems
    .map((item) => scoreReferenceCompatibility(profile, item))
    .filter((candidate) => candidate.score >= 60)
    .sort((left, right) => right.score - left.score);
  if (!compatible.length) {
    throw new Error(`${categoryLabel(profile.categoryGroup)} · ${profile.productForm} 상품과 호환되는 복구용 레퍼런스가 없습니다.`);
  }
  const selected = compatible[stableHash(`${job.id}:${job.productTruth.productId}:${result.id}`) % compatible.length];
  return toNativeAdReference(
    selected.item,
    `과거 작업 복구를 위해 ${categoryLabel(profile.categoryGroup)} · ${profile.productForm} 호환 풀에서 결정적으로 선택했습니다(호환 점수 ${selected.score}).`
  );
}
