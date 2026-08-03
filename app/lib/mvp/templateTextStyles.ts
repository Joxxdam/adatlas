import { ensureContrast } from "./colorUtils";
import { fontFamilyForRegistryId } from "./fontRegistry";
import type { ExtractedPalette } from "./types";

export type TextStyleRole =
  | "headline"
  | "subheadline"
  | "bodyCopy"
  | "highlight"
  | "price"
  | "originalPrice"
  | "productName"
  | "productBadge"
  | "urgency"
  | "reviewQuote"
  | "socialProof"
  | "benefitChip"
  | "bottomBar"
  | "cta"
  | "footer"
  | "disclaimer";

export type TextStylePreset = {
  fontFamily: string;
  fontWeight: number | string;
  fontSize: number;
  minFontSize?: number;
  maxFontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  backgroundFill?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  paddingX?: number;
  paddingY?: number;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  maxLines?: number;
};

export type TemplateTextStyleSet = Partial<Record<TextStyleRole, TextStylePreset>>;

const sans = fontFamilyForRegistryId("korean-sans");
const impact = fontFamilyForRegistryId("korean-impact");
const serif = fontFamilyForRegistryId("korean-serif");

const common: TemplateTextStyleSet = {
  headline: {
    fontFamily: impact,
    fontWeight: 900,
    fontSize: 88,
    minFontSize: 44,
    lineHeight: 0.98,
    letterSpacing: -3,
    fill: "#111111",
    maxLines: 2,
  },
  bodyCopy: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 34,
    minFontSize: 22,
    lineHeight: 1.16,
    fill: "#222222",
    maxLines: 3,
  },
  highlight: {
    fontFamily: sans,
    fontWeight: 900,
    fontSize: 32,
    minFontSize: 22,
    lineHeight: 1.05,
    fill: "#111111",
    maxLines: 1,
  },
  price: {
    fontFamily: impact,
    fontWeight: 900,
    fontSize: 78,
    minFontSize: 42,
    lineHeight: 1,
    letterSpacing: -2,
    fill: "#e60012",
    maxLines: 1,
  },
  originalPrice: {
    fontFamily: sans,
    fontWeight: 700,
    fontSize: 30,
    minFontSize: 22,
    lineHeight: 1,
    fill: "#777777",
    maxLines: 1,
  },
  benefitChip: {
    fontFamily: sans,
    fontWeight: 800,
    fontSize: 27,
    minFontSize: 20,
    lineHeight: 1,
    fill: "#111111",
    maxLines: 1,
  },
  bottomBar: {
    fontFamily: sans,
    fontWeight: 800,
    fontSize: 32,
    minFontSize: 22,
    lineHeight: 1,
    fill: "#ffffff",
    maxLines: 1,
  },
  cta: {
    fontFamily: sans,
    fontWeight: 800,
    fontSize: 31,
    minFontSize: 22,
    lineHeight: 1,
    fill: "#ffffff",
    maxLines: 1,
  },
};

function mergeSet(overrides: TemplateTextStyleSet): TemplateTextStyleSet {
  return Object.fromEntries(
    Object.entries({ ...common, ...overrides }).map(([role, style]) => [
      role,
      { ...(common[role as TextStyleRole] || {}), ...(style || {}) },
    ])
  ) as TemplateTextStyleSet;
}

export const templateTextStylePresets: Record<string, TemplateTextStyleSet> = {
  foodImpact: mergeSet({
    headline: { ...common.headline!, fill: "#ffffff", stroke: "#15100d", strokeWidth: 8 },
    price: { ...common.price!, fill: "#fff238", stroke: "#111111", strokeWidth: 7 },
    bodyCopy: { ...common.bodyCopy!, fill: "#ffffff", fontSize: 31, maxLines: 2 },
  }),
  foodProduceEditorial: mergeSet({
    headline: {
      ...common.headline!,
      fill: "#b92f35",
      fontSize: 82,
      minFontSize: 42,
      lineHeight: 1,
      textAlign: "left",
    },
    bodyCopy: { ...common.bodyCopy!, fontSize: 30, maxLines: 3 },
    price: { ...common.price!, fill: "#d83232", fontSize: 76 },
  }),
  beautyEditorial: mergeSet({
    headline: {
      ...common.headline!,
      fontFamily: serif,
      fontWeight: 800,
      fontSize: 72,
      minFontSize: 38,
      lineHeight: 1.08,
      letterSpacing: -1,
      maxLines: 3,
    },
    bodyCopy: {
      ...common.bodyCopy!,
      fontWeight: 600,
      fontSize: 29,
      lineHeight: 1.25,
      maxLines: 3,
    },
    highlight: { ...common.highlight!, fontSize: 27, fontWeight: 800 },
    price: { ...common.price!, fontFamily: sans, fontSize: 58, letterSpacing: 0 },
  }),
  beautyClinical: mergeSet({
    headline: {
      ...common.headline!,
      fontFamily: sans,
      fontSize: 76,
      minFontSize: 40,
      lineHeight: 1.02,
      letterSpacing: -2,
      maxLines: 3,
    },
    bodyCopy: { ...common.bodyCopy!, fontSize: 28, maxLines: 3 },
    benefitChip: { ...common.benefitChip!, fontSize: 25 },
  }),
  bodyProof: mergeSet({
    headline: {
      ...common.headline!,
      fill: "#ffffff",
      fontSize: 78,
      minFontSize: 38,
      lineHeight: 1.16,
      stroke: "#101817",
      strokeWidth: 3,
      maxLines: 3,
    },
    bodyCopy: {
      ...common.bodyCopy!,
      fill: "#ffffff",
      fontSize: 29,
      lineHeight: 1.22,
      maxLines: 3,
    },
    benefitChip: { ...common.benefitChip!, fontSize: 26, fontWeight: 900 },
    price: { ...common.price!, fill: "#20e8ca" },
  }),
  testimonialClean: mergeSet({
    headline: {
      ...common.headline!,
      fontFamily: sans,
      fontSize: 68,
      minFontSize: 36,
      lineHeight: 1.08,
      maxLines: 3,
    },
    reviewQuote: {
      fontFamily: sans,
      fontWeight: 700,
      fontSize: 36,
      minFontSize: 24,
      lineHeight: 1.2,
      fill: "#111111",
      maxLines: 3,
    },
  }),
};

export function resolveTemplateTextStyles(
  presetKey: string | undefined,
  palette: ExtractedPalette
) {
  const preset =
    templateTextStylePresets[presetKey || "foodImpact"] || templateTextStylePresets.foodImpact;
  const resolved = {} as TemplateTextStyleSet;
  for (const [role, style] of Object.entries(preset)) {
    if (!style) continue;
    const preserveDarkOverlayText =
      presetKey === "bodyProof" &&
      ["headline", "bodyCopy", "subheadline", "reviewQuote"].includes(role);
    const surface =
      role === "headline" && presetKey === "bodyProof"
        ? palette.secondaryColor
        : palette.backgroundColor;
    resolved[role as TextStyleRole] = {
      ...style,
      fill: preserveDarkOverlayText
        ? style.fill
        : role === "price"
          ? palette.dangerColor
          : role === "highlight" || role === "benefitChip"
            ? ensureContrast(style.fill, palette.highlightColor, 4.5)
            : ensureContrast(style.fill, surface, 4.5),
    };
  }
  return resolved;
}
