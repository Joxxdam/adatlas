import type { ExtractedPalette } from "./types";

export type DesignCategory = "food" | "meat" | "beauty" | "body-care" | "household" | "health" | "fashion" | "general";

export const categoryFallbackPalettes: Record<DesignCategory, ExtractedPalette> = {
  meat: {
    primaryColor: "#7f1018",
    secondaryColor: "#24090b",
    accentColor: "#ff2a2a",
    backgroundColor: "#fff8ee",
    surfaceColor: "#ffffff",
    textDarkColor: "#14110f",
    textLightColor: "#ffffff",
    mutedColor: "#8b8177",
    highlightColor: "#fff238",
    dangerColor: "#e60012",
    confidence: 0.55,
  },
  food: {
    primaryColor: "#d14a25",
    secondaryColor: "#5e2418",
    accentColor: "#ef5a24",
    backgroundColor: "#fff9ef",
    surfaceColor: "#ffffff",
    textDarkColor: "#211914",
    textLightColor: "#ffffff",
    mutedColor: "#8b7d70",
    highlightColor: "#ffe84d",
    dangerColor: "#e73526",
    confidence: 0.55,
  },
  beauty: {
    primaryColor: "#e8799a",
    secondaryColor: "#552c4d",
    accentColor: "#f04d87",
    backgroundColor: "#fff8fb",
    surfaceColor: "#ffffff",
    textDarkColor: "#261b23",
    textLightColor: "#ffffff",
    mutedColor: "#9f8696",
    highlightColor: "#ffd6e6",
    dangerColor: "#dc315f",
    confidence: 0.55,
  },
  "body-care": {
    primaryColor: "#0aa792",
    secondaryColor: "#073b39",
    accentColor: "#16dbc2",
    backgroundColor: "#eefcf9",
    surfaceColor: "#ffffff",
    textDarkColor: "#071f1d",
    textLightColor: "#ffffff",
    mutedColor: "#6b8f89",
    highlightColor: "#81f4e4",
    dangerColor: "#ff4d5c",
    confidence: 0.55,
  },
  household: {
    primaryColor: "#146c94",
    secondaryColor: "#102f42",
    accentColor: "#19b8b2",
    backgroundColor: "#f2f8fb",
    surfaceColor: "#ffffff",
    textDarkColor: "#10242f",
    textLightColor: "#ffffff",
    mutedColor: "#748793",
    highlightColor: "#6ce5d9",
    dangerColor: "#ff4d47",
    confidence: 0.55,
  },
  health: {
    primaryColor: "#687348",
    secondaryColor: "#46382a",
    accentColor: "#a47c36",
    backgroundColor: "#fbf7ef",
    surfaceColor: "#ffffff",
    textDarkColor: "#2b251f",
    textLightColor: "#ffffff",
    mutedColor: "#8a8175",
    highlightColor: "#e1c677",
    dangerColor: "#b84534",
    confidence: 0.55,
  },
  fashion: {
    primaryColor: "#202020",
    secondaryColor: "#6d6d6d",
    accentColor: "#d93258",
    backgroundColor: "#f6f5f3",
    surfaceColor: "#ffffff",
    textDarkColor: "#111111",
    textLightColor: "#ffffff",
    mutedColor: "#858585",
    highlightColor: "#f3cf54",
    dangerColor: "#d7193f",
    confidence: 0.55,
  },
  general: {
    primaryColor: "#1769aa",
    secondaryColor: "#243447",
    accentColor: "#00a9a5",
    backgroundColor: "#f5f7fa",
    surfaceColor: "#ffffff",
    textDarkColor: "#14202b",
    textLightColor: "#ffffff",
    mutedColor: "#788694",
    highlightColor: "#ffe46b",
    dangerColor: "#e43d46",
    confidence: 0.5,
  },
};

export function inferDesignCategory(value?: string): DesignCategory {
  const text = String(value || "").toLowerCase();
  if (/(한우|고기|육류|등심|갈비|스테이크|meat|beef|pork)/i.test(text)) return "meat";
  if (/(뷰티|화장품|스킨|쿠션|앰플|크림|세럼|메이크업|beauty|cosmetic)/i.test(text)) return "beauty";
  if (/(바디|샤워|젤|샴푸|워시|향수|데오|body|shower|wash)/i.test(text)) return "body-care";
  if (/(리빙|생활|세제|청소|주방|house|living)/i.test(text)) return "household";
  if (/(건강|영양|홍삼|비타민|health|supplement)/i.test(text)) return "health";
  if (/(패션|의류|신발|가방|fashion|apparel)/i.test(text)) return "fashion";
  if (/(식품|과일|채소|농산|복숭아|사과|food|fruit|farm)/i.test(text)) return "food";
  return "general";
}

export function getCategoryFallbackPalette(category?: string): ExtractedPalette {
  return { ...categoryFallbackPalettes[inferDesignCategory(category)] };
}
