import type { AdImageLabel, ReferenceUsageAspect, ReferenceUsageSelection } from "./types";

export const referenceUsageAspectOptions: Array<{
  value: ReferenceUsageAspect;
  label: string;
}> = [
  { value: "headline-structure", label: "헤드라인 구조" },
  { value: "hook-style", label: "후킹 방식" },
  { value: "appeal-point", label: "핵심 소구점" },
  { value: "tone", label: "말투와 뉘앙스" },
  { value: "information-hierarchy", label: "정보 우선순위" },
  { value: "price-emphasis", label: "가격 강조" },
  { value: "product-layout", label: "상품 배치" },
  { value: "color-mood", label: "색감" },
  { value: "background-mood", label: "배경 분위기" },
  { value: "cta-style", label: "CTA 방식" },
];

const defaultAspects: ReferenceUsageAspect[] = ["headline-structure", "hook-style", "appeal-point", "tone", "information-hierarchy"];

export function defaultReferenceUsage(label: AdImageLabel): ReferenceUsageSelection {
  return {
    imageId: label.imageId,
    aspects: defaultAspects,
    weight: 1,
  };
}

export function normalizeReferenceUsages(labels: AdImageLabel[], usages: ReferenceUsageSelection[]): ReferenceUsageSelection[] {
  const byId = new Map(usages.map((usage) => [usage.imageId, usage]));
  return labels.map((label) => byId.get(label.imageId) || defaultReferenceUsage(label));
}

export function referenceUsageSummary(usages: ReferenceUsageSelection[]): string {
  return usages
    .map((usage) => {
      const labels = usage.aspects.map((aspect) => referenceUsageAspectOptions.find((option) => option.value === aspect)?.label).filter(Boolean);
      return `${usage.imageId}: ${labels.join(", ") || "선택 없음"}`;
    })
    .join("\n");
}
