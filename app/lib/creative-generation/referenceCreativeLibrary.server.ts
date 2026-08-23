import "server-only";
import { randomInt } from "node:crypto";
import path from "node:path";
import type { GenerationJob, GenerationResult } from "./types";
import { resolveCategoryCreativeProfile } from "./categoryCreativeRouter";
import { pickCategoryPreferredItems } from "./referenceSelection";
import { readNativeReferenceManifestSync } from "./nativeReferenceLibraryRepository.server";
import type { ManagedNativeReferenceItem } from "./referenceLibraryManagement";

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
  return readNativeReferenceManifestSync().items.map((item) => ({
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

/**
 * 새 작업을 만들 때 같은 상품군 ZIP 풀에서 중복 없이 무작위 레퍼런스를 뽑는다.
 * 선택 결과는 GenerationJob에 저장되므로 새로고침·재시도·서버 복구 시에는
 * 다시 추첨하지 않고 같은 디자인을 이어서 편집한다.
 */
export function selectCategoryNativeAdReferences(
  job: Pick<GenerationJob, "productTruth">,
  count = 6,
  nextIndex: (maxExclusive: number) => number = randomInt
): NativeAdReference[] {
  const categoryGroup = resolveNativeReferenceCategoryGroup(job);
  const categoryName = categoryLabel(categoryGroup);
  const referenceItems = readReferenceItems();
  const categorySafeItems = categoryGroup === "fashion"
    ? referenceItems.filter((item) => item.categoryGroup === "fashion" || item.categoryGroup === "beauty")
    : referenceItems;
  return pickCategoryPreferredItems(categorySafeItems, count, categoryGroup, nextIndex).map((selected, index) =>
    toNativeAdReference(
      selected,
      `${categoryName} 상품군 ZIP 풀에서 ${index + 1}번째 디자인 레퍼런스로 무작위 선택했습니다. 최종 결과는 이 구성에 실제 URL 상품과 ProductTruth 문구를 교체합니다.`
    )
  );
}

/** 과거 작업처럼 레퍼런스가 저장되지 않은 경우에만 사용하는 결정적 fallback. */
export function selectNativeAdReference(job: GenerationJob, result: GenerationResult): NativeAdReference {
  const referenceItems = readReferenceItems();
  if (!referenceItems.length) throw new Error("등록된 고품질 광고 레퍼런스가 없습니다.");
  const categoryGroup = resolveNativeReferenceCategoryGroup(job);
  const categoryItems = referenceItems.filter((item) => item.categoryGroup === categoryGroup);
  const pool = categoryItems.length
    ? categoryItems
    : categoryGroup === "fashion"
      ? referenceItems.filter((item) => item.categoryGroup === "beauty")
      : referenceItems;
  const selected = pool[stableHash(`${job.id}:${job.productTruth.productId}:${result.id}`) % pool.length];
  return toNativeAdReference(
    selected,
    `과거 작업 복구를 위해 ${categoryLabel(categoryGroup)} 상품군 ZIP 풀에서 호환 레퍼런스를 선택했습니다.`
  );
}
