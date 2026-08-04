import type { BannerTemplateDefinition } from "../../../lib/bannerTemplates";
import { extractPaletteFromImage } from "./colorPaletteExtractor";
import { ensureContrast, normalizeHex } from "./colorUtils";
import { resolveCollisions } from "./collisionResolver";
import { getCategoryFallbackPalette } from "./defaultPalettes";
import { resolveImageLayout, type ImageFrame } from "./imageLayout";
import {
  resolveTemplateTextStyles,
  type TemplateTextStyleSet,
  type TextStylePreset,
} from "./templateTextStyles";
import { fitTextToSlot } from "./textMeasurement";
import type {
  BannerFitResult,
  CollisionItem,
  CopyVariantKey,
  ExtractedPalette,
  GeneratedAdCopyVariant,
  PalettePolicy,
  ProductInfoForPrompt,
  RenderDiagnostics,
  TemplateSlot,
} from "./types";

export type PreparedBannerRender = {
  copy: GeneratedAdCopyVariant;
  selectedVariant: CopyVariantKey;
  palette: ExtractedPalette;
  textStyles: TemplateTextStyleSet;
  fitResults: BannerFitResult[];
  imageFrames: ImageFrame[];
  diagnostics: RenderDiagnostics;
};

type CopyCandidate = {
  key: CopyVariantKey;
  copy: GeneratedAdCopyVariant;
};

function stringStyle(template: BannerTemplateDefinition, key: string, fallback: string) {
  const value = template.style[key];
  return typeof value === "string" && value.trim() ? value : fallback;
}

function applyPalettePolicy(
  extracted: ExtractedPalette,
  template: BannerTemplateDefinition,
  policy: PalettePolicy,
  category?: string
): ExtractedPalette {
  const fallback = getCategoryFallbackPalette(category);
  const background = normalizeHex(
    stringStyle(template, "backgroundColor", fallback.backgroundColor)
  );
  const accent = normalizeHex(stringStyle(template, "accentColor", fallback.accentColor));
  const danger = normalizeHex(stringStyle(template, "priceColor", fallback.dangerColor));

  if (policy === "full-auto") return extracted;
  if (policy === "fixed") {
    return {
      ...fallback,
      primaryColor: background,
      accentColor: accent,
      dangerColor: danger,
      backgroundColor: background,
      surfaceColor: stringStyle(template, "surfaceColor", fallback.surfaceColor),
      textDarkColor: ensureContrast("#151515", background, 4.5),
      sourceImagePath: extracted.sourceImagePath,
      confidence: extracted.confidence,
    };
  }
  if (policy === "protected-palette") {
    return {
      ...extracted,
      primaryColor: accent,
      accentColor: accent,
      dangerColor: danger,
      backgroundColor: background,
      surfaceColor: stringStyle(template, "surfaceColor", extracted.surfaceColor),
      highlightColor: stringStyle(template, "highlightBackground", fallback.highlightColor),
      textDarkColor: ensureContrast("#151515", background, 4.5),
    };
  }
  return {
    ...extracted,
    backgroundColor: background,
    surfaceColor: stringStyle(template, "surfaceColor", extracted.surfaceColor),
    textDarkColor: ensureContrast("#151515", background, 4.5),
  };
}

function asVariant(
  value: Partial<GeneratedAdCopyVariant> | undefined,
  fallback: GeneratedAdCopyVariant
): GeneratedAdCopyVariant {
  return {
    headline: String(value?.headline || fallback.headline || ""),
    bodyCopy: String(value?.bodyCopy || fallback.bodyCopy || ""),
    highlightCopy: String(value?.highlightCopy || fallback.highlightCopy || ""),
    bottomBarCopy: String(value?.bottomBarCopy || fallback.bottomBarCopy || ""),
    cta: String(value?.cta || fallback.cta || ""),
    price: String(value?.price || fallback.price || ""),
  };
}

function copyTextForSlot(
  slot: TemplateSlot,
  copy: GeneratedAdCopyVariant,
  productInfo?: ProductInfoForPrompt,
  originalPrice?: string
) {
  const role = slot.role || slot.id;
  if (role === "headline") return copy.headline;
  if (role === "bodyCopy" || role === "subheadline" || role === "reviewQuote") {
    return copy.bodyCopy;
  }
  if (
    role === "highlight" ||
    role === "highlightCopy" ||
    role === "benefitChip" ||
    role === "socialProof" ||
    role === "urgency"
  ) {
    return copy.highlightCopy;
  }
  if (role === "bottomBar" || role === "bottomBarCopy") return copy.bottomBarCopy;
  if (role === "cta") return copy.cta;
  if (role === "price") return copy.price || productInfo?.price || "";
  if (role === "originalPrice") {
    return originalPrice || productInfo?.originalPrice || productInfo?.oldPrice || "";
  }
  if (role === "productName") return productInfo?.productName || copy.bodyCopy;
  if (role === "productBadge") return "특가";
  return "";
}

function textStyleForSlot(
  styles: TemplateTextStyleSet,
  slot: TemplateSlot
): TextStylePreset | undefined {
  const role = slot.role || slot.id;
  if (role === "headline") return styles.headline;
  if (role === "price") return styles.price;
  if (role === "originalPrice") return styles.originalPrice;
  if (role === "productName") return styles.productName || styles.bodyCopy;
  if (role === "productBadge") return styles.productBadge || styles.benefitChip;
  if (role === "highlight" || role === "highlightCopy") return styles.highlight;
  if (role === "benefitChip" || role === "socialProof" || role === "urgency") {
    return styles.benefitChip || styles.highlight;
  }
  if (role === "reviewQuote") return styles.reviewQuote || styles.bodyCopy;
  if (role === "bottomBar" || role === "bottomBarCopy") return styles.bottomBar;
  if (role === "cta") return styles.cta;
  if (role === "subheadline") return styles.subheadline || styles.bodyCopy;
  return styles.bodyCopy;
}

function fitCandidate(params: {
  template: BannerTemplateDefinition;
  candidate: CopyCandidate;
  styles: TemplateTextStyleSet;
  productInfo?: ProductInfoForPrompt;
  originalPrice?: string;
}) {
  const results = (params.template.slots || [])
    .filter((slot) => ["text", "price", "cta", "badge", "chip"].includes(slot.type))
    .map((slot) => {
      const style = textStyleForSlot(params.styles, slot);
      if (!style) return null;
      const text = copyTextForSlot(
        slot,
        params.candidate.copy,
        params.productInfo,
        params.originalPrice
      );
      if (!text) return null;
      return fitTextToSlot({
        slot,
        text,
        style,
        usedVariant: params.candidate.key,
      });
    })
    .filter((result): result is BannerFitResult => Boolean(result));
  const score = results.reduce((sum, result) => {
    if (result.status === "failed") return sum + 100;
    if (result.status === "ellipsis") return sum + 28;
    if (result.status === "shrunk") return sum + 7;
    if (result.status === "wrapped") return sum + 2;
    return sum;
  }, 0);
  return { results, score };
}

function candidatesFor(params: {
  activeCopy: GeneratedAdCopyVariant;
  selectedVariant?: CopyVariantKey;
  variants?: Partial<Record<"short" | "medium" | "long", GeneratedAdCopyVariant>>;
  template: BannerTemplateDefinition;
}) {
  const activeKey = params.selectedVariant || "base";
  const result: CopyCandidate[] = [{ key: activeKey, copy: params.activeCopy }];
  const preference = params.template.variantPreference;
  const order: Array<"short" | "medium" | "long"> = preference
    ? [preference.preferred, ...preference.fallbackOrder]
    : ["medium", "short", "long"];
  for (const key of order) {
    const value = params.variants?.[key];
    if (!value || result.some((candidate) => candidate.key === key)) continue;
    result.push({ key, copy: asVariant(value, params.activeCopy) });
  }
  return result;
}

export async function prepareBannerRender(params: {
  template: BannerTemplateDefinition;
  activeCopy: GeneratedAdCopyVariant;
  selectedVariant?: CopyVariantKey;
  copyVariants?: Partial<Record<"short" | "medium" | "long", GeneratedAdCopyVariant>>;
  productInfo?: ProductInfoForPrompt;
  imagePaths: string[];
  backgroundImagePath?: string;
  originalPrice?: string;
}): Promise<PreparedBannerRender> {
  const firstImage = params.imagePaths.find(Boolean) || "";
  const extracted = await extractPaletteFromImage(
    firstImage,
    params.productInfo?.category || params.template.category
  );
  const palettePolicy = params.template.palettePolicy || "fixed";
  const palette = applyPalettePolicy(
    extracted,
    params.template,
    palettePolicy,
    params.productInfo?.category
  );
  const textStyles = resolveTemplateTextStyles(params.template.textStylePresetKey, palette);
  const candidates = candidatesFor({
    activeCopy: params.activeCopy,
    selectedVariant: params.selectedVariant,
    variants: params.copyVariants,
    template: params.template,
  });
  const evaluated = candidates.map((candidate) => ({
    candidate,
    ...fitCandidate({
      template: params.template,
      candidate,
      styles: textStyles,
      productInfo: params.productInfo,
      originalPrice: params.originalPrice,
    }),
  }));
  const best = [...evaluated].sort((a, b) => a.score - b.score)[0] || evaluated[0];
  const imageFrames = resolveImageLayout({
    slots: params.template.slots || [],
    imagePaths: params.imagePaths,
    backgroundImagePath: params.backgroundImagePath,
  });
  const collisionItems: CollisionItem[] = [
    ...best.results.map((result) => {
      const slot = params.template.slots?.find((item) => item.id === result.slotId);
      return {
        id: result.slotId,
        type: slot?.type || "text",
        boundingBox: result.boundingBox,
        priority: slot?.priority ?? 60,
        allowMove: slot?.allowMove,
        allowShrink: slot?.allowShrink,
        allowHide: slot?.allowHide,
        intentionalOverlapWith: slot?.intentionalOverlapWith,
      };
    }),
    ...imageFrames
      .filter((frame) => {
        if (frame.slotId === "__generatedSceneBackground") return false;
        const slot = params.template.slots?.find((item) => item.id === frame.slotId);
        return slot?.imageFit !== "background-image";
      })
      .map((frame) => {
        const slot = params.template.slots?.find((item) => item.id === frame.slotId);
        return {
          id: frame.slotId,
          type: "image" as const,
          boundingBox: frame,
          priority: slot?.priority ?? 90,
          allowMove: slot?.allowMove,
          allowShrink: false,
          allowHide: false,
          intentionalOverlapWith: slot?.intentionalOverlapWith,
        };
      }),
  ];
  const collisionResult = resolveCollisions({
    items: collisionItems,
    width: 1200,
    height: 1200,
    safePadding: 16,
  });
  const fitWarnings = best.results.flatMap((result) => result.warnings);
  const unresolvedCollisions = collisionResult.actions.filter(
    (action) => action.action === "failed"
  ).length;
  const failedFits = best.results.filter((result) => result.status === "failed").length;
  const ellipsisFits = best.results.filter((result) => result.status === "ellipsis").length;
  const qualityScore = Math.max(
    0,
    Math.round(
      100 - failedFits * 24 - ellipsisFits * 9 - unresolvedCollisions * 18 - fitWarnings.length * 2
    )
  );
  const warnings = [...fitWarnings, ...collisionResult.warnings];
  if (!params.imagePaths.length) warnings.push("No product image was supplied to the renderer.");
  if (params.backgroundImagePath && !imageFrames.some((frame) => frame.imagePath === params.backgroundImagePath)) {
    warnings.push("The selected scene could not be mapped to a background or scene slot in this template.");
  }
  if (best.candidate.key !== candidates[0]?.key) {
    warnings.push(
      `Copy variant changed from ${candidates[0]?.key || "base"} to ${best.candidate.key}.`
    );
  }

  const diagnostics: RenderDiagnostics = {
    templateId: params.template.id,
    paletteApplied: palettePolicy !== "fixed",
    palettePolicy,
    palette,
    preferredVariant: params.template.variantPreference?.preferred,
    selectedVariant: best.candidate.key,
    variantReason:
      best.candidate.key === candidates[0]?.key
        ? "The active render copy fit the declared slots."
        : "A pre-generated copy variant produced a safer slot fit.",
    fitResults: best.results,
    collisionResult,
    imagePathsUsed: imageFrames.map((frame) => frame.imagePath),
    hiddenElements: collisionResult.actions
      .filter((action) => action.action === "hide-low-priority")
      .map((action) => action.targetId),
    optimizationFlags: {
      autoPaletteApplied: palettePolicy !== "fixed",
      textFittingApplied: best.results.some((result) => result.status !== "exact"),
      collisionResolved: collisionResult.actions.some((action) => action.action !== "failed"),
      lowPriorityElementsHidden: collisionResult.actions.some(
        (action) => action.action === "hide-low-priority"
      ),
    },
    warnings,
    qualityScore,
    qualityStatus: qualityScore >= 88 ? "stable" : qualityScore >= 68 ? "review" : "risk",
  };

  return {
    copy: best.candidate.copy,
    selectedVariant: best.candidate.key,
    palette,
    textStyles,
    fitResults: best.results,
    imageFrames,
    diagnostics,
  };
}
