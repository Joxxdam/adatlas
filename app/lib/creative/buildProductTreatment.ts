import type { CreativeIntensity, ProductImageRenderEffect } from "../mvp/types";

export function buildProductTreatment(params: { archetypeId: string; intensity: CreativeIntensity; colorHints?: string[] }): ProductImageRenderEffect {
  const hero = ["product-hero", "giant-hook", "price-event"].includes(params.archetypeId);
  const review = params.archetypeId === "community-review";
  const performance = params.intensity === "performance";
  const accent = params.colorHints?.[0] || "#ffffff";

  return {
    outline: performance || review,
    outlineColor: "#ffffff",
    outlineWidth: performance ? 12 : 8,
    shadow: true,
    shadowBaseColor: "#000000",
    shadowOpacity: hero ? 0.42 : 0.3,
    shadowColor: hero ? "rgba(0,0,0,0.46)" : "rgba(0,0,0,0.32)",
    shadowBlur: hero ? 30 : 22,
    shadowOffsetX: 0,
    shadowOffsetY: hero ? 20 : 14,
    glow: hero,
    glowBaseColor: accent,
    glowOpacity: 0.22,
    glowColor: accent,
    glowBlur: hero ? 28 : 18,
    productScale: hero ? 1.12 : review ? 0.94 : 1,
    productOffsetX: ["problem-solution", "community-review", "lifestyle-context"].includes(params.archetypeId) ? 70 : 0,
    productOffsetY: hero ? 12 : 0,
    productRotation: params.archetypeId === "product-hero" ? -3 : 0,
  };
}
