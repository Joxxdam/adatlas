import { getCategoryFallbackPalette, inferDesignCategory } from "./defaultPalettes";
import type { PalettePolicy, TemplateVariantPreference } from "./types";

export type CategoryDesignDefault = {
  visualTone: string;
  textStylePresetKey: string;
  palettePolicy: PalettePolicy;
  variantPreference: TemplateVariantPreference;
  imageFittingPolicy: "cover" | "contain" | "smart-cover";
  ctaStyle: "bar" | "button" | "compact";
  priceEmphasisLevel: "high" | "medium" | "low";
};

const defaults: Record<string, CategoryDesignDefault> = {
  meat: {
    visualTone: "bold-performance",
    textStylePresetKey: "foodImpact",
    palettePolicy: "protected-palette",
    variantPreference: { preferred: "medium", fallbackOrder: ["short", "long"] },
    imageFittingPolicy: "smart-cover",
    ctaStyle: "bar",
    priceEmphasisLevel: "high",
  },
  food: {
    visualTone: "fresh-commerce",
    textStylePresetKey: "foodProduceEditorial",
    palettePolicy: "accent-only",
    variantPreference: { preferred: "medium", fallbackOrder: ["short", "long"] },
    imageFittingPolicy: "smart-cover",
    ctaStyle: "bar",
    priceEmphasisLevel: "high",
  },
  beauty: {
    visualTone: "beauty-editorial",
    textStylePresetKey: "beautyEditorial",
    palettePolicy: "full-auto",
    variantPreference: { preferred: "medium", fallbackOrder: ["long", "short"] },
    imageFittingPolicy: "contain",
    ctaStyle: "button",
    priceEmphasisLevel: "medium",
  },
  "body-care": {
    visualTone: "clinical-proof",
    textStylePresetKey: "bodyProof",
    palettePolicy: "full-auto",
    variantPreference: { preferred: "medium", fallbackOrder: ["short", "long"] },
    imageFittingPolicy: "contain",
    ctaStyle: "compact",
    priceEmphasisLevel: "medium",
  },
  household: {
    visualTone: "problem-solution",
    textStylePresetKey: "bodyProof",
    palettePolicy: "full-auto",
    variantPreference: { preferred: "short", fallbackOrder: ["medium", "long"] },
    imageFittingPolicy: "contain",
    ctaStyle: "bar",
    priceEmphasisLevel: "medium",
  },
  health: {
    visualTone: "premium-trust",
    textStylePresetKey: "beautyEditorial",
    palettePolicy: "accent-only",
    variantPreference: { preferred: "medium", fallbackOrder: ["short", "long"] },
    imageFittingPolicy: "contain",
    ctaStyle: "button",
    priceEmphasisLevel: "medium",
  },
  fashion: {
    visualTone: "editorial",
    textStylePresetKey: "beautyEditorial",
    palettePolicy: "accent-only",
    variantPreference: { preferred: "long", fallbackOrder: ["medium", "short"] },
    imageFittingPolicy: "smart-cover",
    ctaStyle: "compact",
    priceEmphasisLevel: "low",
  },
  general: {
    visualTone: "commerce-clean",
    textStylePresetKey: "testimonialClean",
    palettePolicy: "accent-only",
    variantPreference: { preferred: "medium", fallbackOrder: ["short", "long"] },
    imageFittingPolicy: "smart-cover",
    ctaStyle: "bar",
    priceEmphasisLevel: "medium",
  },
};

export function getCategoryDesignDefault(category?: string) {
  const key = inferDesignCategory(category);
  return {
    ...defaults[key],
    palette: getCategoryFallbackPalette(category),
  };
}
