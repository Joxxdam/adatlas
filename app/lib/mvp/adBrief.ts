import type { AdBrief, ProductInfoForPrompt } from "./types";

export const defaultAdBrief: AdBrief = {
  productName: "",
  category: "기타",
  price: "",
  originalPrice: "",
  discountInfo: "",
  mainBenefit: "",
  targetCustomer: "",
  landingUrl: "",
  adObjective: "purchase",
  additionalEmphasis: "",
  mandatoryInfo: [],
  prohibitedClaims: [],
  creativeIntensity: "balanced",
};

export function productInfoToAdBrief(
  product: ProductInfoForPrompt,
  current: AdBrief = defaultAdBrief
): AdBrief {
  const notes = product.creativeContext?.appliedContentNotes || [];
  const requiredNotes = notes
    .filter((note) => note.required || note.type === "MUST_INCLUDE")
    .map((note) => note.content);
  const prohibitedNotes = notes
    .filter((note) => note.prohibited || note.type === "PROHIBITED_EXPRESSION")
    .map((note) => note.content);
  const toneNote = notes.find((note) => ["TONE_OF_VOICE", "TONE_AND_MANNER"].includes(note.type) && !note.prohibited)?.content;
  const hookNote = notes.find((note) => note.type === "PREFERRED_HOOK" && !note.prohibited)?.content;
  return {
    ...current,
    productName: product.productName || "",
    category: product.category || "기타",
    price: product.price || "",
    originalPrice: product.originalPrice || product.oldPrice || "",
    discountInfo: product.discountInfo || "",
    mainBenefit: product.mainBenefit || "",
    targetCustomer: product.targetCustomer || "",
    landingUrl: product.landingUrl || "",
    adObjective: product.creativeContext?.recommendedObjective ? "purchase" : current.adObjective,
    mandatoryInfo: Array.from(new Set([...(current.mandatoryInfo || []), ...requiredNotes])),
    prohibitedClaims: Array.from(new Set([...(current.prohibitedClaims || []), ...prohibitedNotes])),
    desiredHookType: hookNote || product.creativeContext?.recommendedHookTypes?.[0] || current.desiredHookType,
    tonePreference: toneNote || current.tonePreference,
    additionalEmphasis: [current.additionalEmphasis, ...(product.creativeContext?.recommendedMessageAngles || [])]
      .filter(Boolean)
      .join(" · "),
  };
}

export function applyAdBriefToProductInfo(
  brief: AdBrief,
  product: ProductInfoForPrompt
): ProductInfoForPrompt {
  return {
    ...product,
    productName: brief.productName,
    category: brief.category,
    price: brief.price,
    originalPrice: brief.originalPrice || product.originalPrice,
    oldPrice: brief.originalPrice || product.oldPrice,
    discountInfo: brief.discountInfo,
    mainBenefit: brief.mainBenefit,
    targetCustomer: brief.targetCustomer,
    landingUrl: brief.landingUrl,
  };
}

export function parseBriefList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatBriefList(value: string[] = []): string {
  return value.join(", ");
}
