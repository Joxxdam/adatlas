import type { HookPlan, ProductTruth } from "./types";

export const performanceTemplateIds = ["T01_PRICE_SHOCK", "T02_URGENT_OFFER", "T03_QUALITY_PROOF", "T04_SENSORY_EXPERIENCE", "T05_BELIEF_REVERSAL", "T06_USE_CASE", "T07_SOCIAL_PROOF", "T08_UGC_PROBLEM_SOLUTION", "T09_PRODUCT_HERO", "T10_LINEUP_BENEFIT"] as const;

export type PerformanceTemplateId = (typeof performanceTemplateIds)[number];
export type LayoutZone = "TOP_HEADLINE" | "TOP_BANNER" | "LEFT_COPY" | "RIGHT_COPY" | "CENTER_HERO" | "BOTTOM_PRICE_BAR" | "BOTTOM_INFORMATION" | "FLOATING_BADGE" | "HANDWRITTEN_NOTE" | "PRODUCT_CUTOUT" | "FULL_BLEED_VISUAL";
export type PaletteId = "FOOD_SALE" | "FOOD_EDITORIAL" | "BODY_COOLING" | "UGC_NATURAL" | "PREMIUM_DARK";
export type FontRole = "HEAVY_GOTHIC" | "DISPLAY_BLACK" | "ROUNDED_BOLD" | "HANDWRITTEN_MARKER" | "HANDWRITTEN_BRUSH" | "CLEAN_EDITORIAL";

export type PerformanceTemplate = {
  id: PerformanceTemplateId;
  label: string;
  zones: LayoutZone[];
  palettes: PaletteId[];
  fontRoles: FontRole[];
  requires: Array<"price" | "offer" | "quality" | "sensory" | "use-case" | "social" | "problem" | "lineup" | "product">;
  cta: "optional" | "recommended" | "hidden";
};

export const PERFORMANCE_TEMPLATE_REGISTRY_VERSION = "performance-templates-v1";

export const performanceTemplateRegistry: readonly PerformanceTemplate[] = [
  { id: "T01_PRICE_SHOCK", label: "가격 충격", zones: ["TOP_HEADLINE", "CENTER_HERO", "PRODUCT_CUTOUT", "BOTTOM_PRICE_BAR", "FLOATING_BADGE"], palettes: ["FOOD_SALE", "PREMIUM_DARK"], fontRoles: ["DISPLAY_BLACK", "HEAVY_GOTHIC"], requires: ["price"], cta: "optional" },
  { id: "T02_URGENT_OFFER", label: "긴급 혜택", zones: ["TOP_BANNER", "TOP_HEADLINE", "CENTER_HERO", "PRODUCT_CUTOUT", "BOTTOM_INFORMATION"], palettes: ["FOOD_SALE", "UGC_NATURAL"], fontRoles: ["DISPLAY_BLACK", "HANDWRITTEN_MARKER"], requires: ["offer"], cta: "recommended" },
  { id: "T03_QUALITY_PROOF", label: "품질 근거", zones: ["TOP_HEADLINE", "LEFT_COPY", "RIGHT_COPY", "PRODUCT_CUTOUT", "BOTTOM_INFORMATION"], palettes: ["FOOD_EDITORIAL", "PREMIUM_DARK"], fontRoles: ["CLEAN_EDITORIAL", "HEAVY_GOTHIC"], requires: ["product"], cta: "optional" },
  { id: "T04_SENSORY_EXPERIENCE", label: "감각 경험", zones: ["FULL_BLEED_VISUAL", "TOP_HEADLINE", "PRODUCT_CUTOUT", "HANDWRITTEN_NOTE"], palettes: ["BODY_COOLING", "FOOD_EDITORIAL"], fontRoles: ["ROUNDED_BOLD", "HANDWRITTEN_BRUSH"], requires: ["product"], cta: "hidden" },
  { id: "T05_BELIEF_REVERSAL", label: "믿음 반전", zones: ["TOP_HEADLINE", "LEFT_COPY", "CENTER_HERO", "PRODUCT_CUTOUT", "HANDWRITTEN_NOTE"], palettes: ["PREMIUM_DARK", "UGC_NATURAL"], fontRoles: ["DISPLAY_BLACK", "HANDWRITTEN_MARKER"], requires: ["product"], cta: "optional" },
  { id: "T06_USE_CASE", label: "사용 상황", zones: ["FULL_BLEED_VISUAL", "TOP_HEADLINE", "RIGHT_COPY", "PRODUCT_CUTOUT", "BOTTOM_INFORMATION"], palettes: ["UGC_NATURAL", "BODY_COOLING"], fontRoles: ["HEAVY_GOTHIC", "CLEAN_EDITORIAL"], requires: ["product"], cta: "recommended" },
  { id: "T07_SOCIAL_PROOF", label: "후기 신뢰", zones: ["TOP_HEADLINE", "LEFT_COPY", "CENTER_HERO", "PRODUCT_CUTOUT", "FLOATING_BADGE"], palettes: ["UGC_NATURAL", "PREMIUM_DARK"], fontRoles: ["ROUNDED_BOLD", "HANDWRITTEN_MARKER"], requires: ["social"], cta: "optional" },
  { id: "T08_UGC_PROBLEM_SOLUTION", label: "문제 해결 UGC", zones: ["FULL_BLEED_VISUAL", "TOP_HEADLINE", "RIGHT_COPY", "PRODUCT_CUTOUT", "HANDWRITTEN_NOTE"], palettes: ["UGC_NATURAL", "BODY_COOLING"], fontRoles: ["HEAVY_GOTHIC", "HANDWRITTEN_MARKER"], requires: ["product"], cta: "recommended" },
  { id: "T09_PRODUCT_HERO", label: "제품 히어로", zones: ["TOP_HEADLINE", "CENTER_HERO", "PRODUCT_CUTOUT", "BOTTOM_INFORMATION"], palettes: ["PREMIUM_DARK", "FOOD_EDITORIAL"], fontRoles: ["DISPLAY_BLACK", "CLEAN_EDITORIAL"], requires: ["product"], cta: "optional" },
  { id: "T10_LINEUP_BENEFIT", label: "라인업·구성", zones: ["TOP_HEADLINE", "CENTER_HERO", "PRODUCT_CUTOUT", "BOTTOM_PRICE_BAR", "BOTTOM_INFORMATION", "FLOATING_BADGE"], palettes: ["FOOD_SALE", "UGC_NATURAL"], fontRoles: ["DISPLAY_BLACK", "ROUNDED_BOLD"], requires: ["lineup"], cta: "recommended" },
] as const;

function availableSignals(truth: ProductTruth) {
  const facts = truth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified");
  const all = facts.map((fact) => `${fact.key} ${fact.label} ${fact.value} ${fact.evidenceType || ""}`).join(" ");
  const has = (pattern: RegExp) => pattern.test(all);
  return new Set([truth.product.price || has(/\bprice\b|가격|원/u) ? "price" : "", truth.product.discountInfo || has(/할인|쿠폰|무료배송|증정|한정|특가|1\+1|2\+1/u) ? "offer" : "", has(/성분|원산지|인증|함량|등급|ingredient|origin|certification|numeric/u) ? "quality" : "", truth.product.mainBenefit || has(/향|식감|촉감|쿨링|보습|풍미|산뜻|부드러/u) ? "sensory" : "", truth.product.targetCustomer || has(/사용|운동|샤워|식사|출근|선물|상황|usage|target/u) ? "use-case" : "", has(/리뷰|후기|평점|review/u) ? "social" : "", truth.product.mainBenefit || truth.product.targetCustomer ? "problem" : "", has(/세트|구성|옵션|향\s*\d|맛\s*\d|\d\s*종|입고|1\+1|2\+1/u) ? "lineup" : "", truth.confirmedProductImage || truth.imageAssets.length ? "product" : ""].filter(Boolean));
}

export function isPerformanceTemplateEligible(template: PerformanceTemplate, truth: ProductTruth) {
  const signals = availableSignals(truth);
  return template.requires.every((required) => signals.has(required));
}

const hookPreferences: Record<string, PerformanceTemplateId[]> = {
  "price-value": ["T01_PRICE_SHOCK", "T02_URGENT_OFFER", "T10_LINEUP_BENEFIT"],
  "scarcity-urgency": ["T02_URGENT_OFFER", "T01_PRICE_SHOCK"],
  "review-trust": ["T07_SOCIAL_PROOF", "T03_QUALITY_PROOF"],
  "feature-usp": ["T03_QUALITY_PROOF", "T09_PRODUCT_HERO"],
  "sensory-experience": ["T04_SENSORY_EXPERIENCE", "T09_PRODUCT_HERO"],
  "usage-occasion": ["T06_USE_CASE", "T08_UGC_PROBLEM_SOLUTION"],
  "problem-solution": ["T08_UGC_PROBLEM_SOLUTION", "T05_BELIEF_REVERSAL"],
  "bundle-choice": ["T10_LINEUP_BENEFIT", "T01_PRICE_SHOCK"],
  "comparison-alternative": ["T05_BELIEF_REVERSAL", "T03_QUALITY_PROOF"],
};

export function selectPerformanceTemplates(truth: ProductTruth, hooks: HookPlan[], count = 6) {
  const eligible = performanceTemplateRegistry.filter((template) => isPerformanceTemplateEligible(template, truth));
  const pool = eligible;
  const used = new Set<PerformanceTemplateId>();
  return hooks.slice(0, count).map((hook, index) => {
    const preferences = hookPreferences[hook.primaryTag || ""] || [];
    const preferred = preferences.map((id) => pool.find((template) => template.id === id)).find((template) => template && !used.has(template.id) && isPerformanceTemplateEligible(template, truth));
    const selected = preferred || pool.find((template) => !used.has(template.id)) || pool[index % pool.length];
    used.add(selected.id);
    return selected;
  });
}

export function unusedPerformanceTemplates(selected: PerformanceTemplateId[], truth: ProductTruth) {
  return performanceTemplateRegistry.filter((template) => !selected.includes(template.id) && isPerformanceTemplateEligible(template, truth));
}
