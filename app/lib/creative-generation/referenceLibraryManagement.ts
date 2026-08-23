export const nativeReferenceCategoryGroups = ["fashion", "food", "beauty"] as const;

export type NativeReferenceCategoryGroup = (typeof nativeReferenceCategoryGroups)[number];

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
