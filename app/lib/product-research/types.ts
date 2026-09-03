export type VendorResearchCopyEligibility = "headlineEligible" | "proofOnly" | "researchOnly" | "blocked";

export type VendorResearchFactKind =
  | "sensory"
  | "texture"
  | "usage"
  | "target"
  | "origin"
  | "ingredient-provenance"
  | "process"
  | "certification"
  | "ingredient-proof"
  | "numeric-proof"
  | "vendor-narrative"
  | "disclosure-limit";

export type VendorResearchFact = {
  id: string;
  label: string;
  value: string;
  kind: VendorResearchFactKind;
  copyEligibility: VendorResearchCopyEligibility;
  sourceSheet: string;
  sourceCells: string[];
};

export type VendorResearchCopyExample = {
  angle: string;
  headline: string;
  support: string;
  /** `facts`의 원본 id입니다. ProductTruth에서는 `vendor-` 접두사로 연결합니다. */
  factIds: string[];
};

export type VendorProductResearchContext = {
  sourceType: "vendor-provided-research";
  sourceLabel: string;
  researchProductId: string;
  sourceDocument: string;
  extractedAt: string;
  researchVersion?: number;
  /** 작업 생성 시 사용한 조사 파일 내용의 SHA-256입니다. */
  researchHash?: string;
  matchReason: string;
  facts: VendorResearchFact[];
  /** 조사 시트에서 미리 정리한 광고용 표현. 레퍼런스 구조에 맞춰 변환하며 사실의 대체 근거로 쓰지 않습니다. */
  adCopyExamples?: VendorResearchCopyExample[];
  /** 골라담기처럼 여러 조사 상품을 포함하는 상품일 때의 구성원입니다. */
  memberResearchProductIds?: string[];
  blockedClaims: string[];
  /** 사용자가 제공한 원본 시트의 표현을 해당 업체에 한해 광고 근거로 허용합니다. */
  allowSheetClaimsInCopy?: boolean;
  /** 원본 조사에서 검토 대상으로 표시했던 항목. 런타임 차단에는 사용하지 않습니다. */
  researchCautions?: string[];
};
