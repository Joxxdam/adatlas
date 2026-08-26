export type VendorResearchCopyEligibility = "headlineEligible" | "proofOnly" | "blocked";

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
};

