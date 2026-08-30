type SemanticTextRegion = {
  id?: string;
  text?: string;
  lines?: string[];
  sourceType?: string;
  replacePolicy?: string;
  box?: { x: number; y: number; width: number; height: number };
};

export type ReferenceSemanticSource = {
  compositionType?: string;
  nativeCopy?: {
    rawText?: string;
    rawLines?: string[];
    textRegions?: SemanticTextRegion[];
  };
};

/**
 * 레퍼런스 분류 태그가 오래되었더라도 저장된 OCR이 명확한 VS 좌우 구도를
 * 보여주면 비교 소재로 복구한다. 단순히 본문에 "비교"가 등장하는 경우는
 * 오탐 가능성이 있어, compositionType 또는 시각 영역 신호만 사용한다.
 */
export function referenceRequiresComparisonSemantics(reference: ReferenceSemanticSource | null | undefined) {
  if (!reference) return false;
  if (reference.compositionType === "comparison") return true;
  const regions = reference.nativeCopy?.textRegions || [];
  const hasVersusMarker = regions.some((region) => {
    const identity = `${region.id || ""} ${region.text || ""} ${(region.lines || []).join(" ")}`;
    return /(?:^|[-_\s])versus(?:[-_\s]|$)|(?:^|\s)vs(?:\.?|\s|$)/iu.test(identity);
  });
  const hasProblemSide = regions.some((region) => /(?:problem|objection|negative|불만|문제).*(?:left|좌)|(?:left|좌).*(?:problem|objection|negative|불만|문제)/iu.test(region.id || ""));
  const hasBenefitSide = regions.some((region) => /(?:benefit|solution|positive|장점|해결).*(?:right|우)|(?:right|우).*(?:benefit|solution|positive|장점|해결)/iu.test(region.id || ""));
  return hasVersusMarker || (hasProblemSide && hasBenefitSide);
}

