export type VendorResearchCopyEligibility = "headlineEligible" | "proofOnly" | "researchOnly" | "blocked";

export type VendorResearchFactKind =
  | "sensory"
  | "texture"
  | "usage"
  | "target"
  | "origin"
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

export type VendorProductResearchContext = {
  sourceType: "vendor-provided-research";
  sourceLabel: string;
  researchProductId: string;
  sourceDocument: string;
  extractedAt: string;
  matchReason: string;
  facts: VendorResearchFact[];
  blockedClaims: string[];
  /** 사용자가 제공한 원본 시트의 표현을 해당 업체에 한해 광고 근거로 허용합니다. */
  allowSheetClaimsInCopy?: boolean;
  /** 원본 조사에서 검토 대상으로 표시했던 항목. 런타임 차단에는 사용하지 않습니다. */
  researchCautions?: string[];
};
