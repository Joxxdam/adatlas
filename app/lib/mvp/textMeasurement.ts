import { estimateTextWidth, fitTextToBox } from "./textFit";
import type { BannerFitResult, CopyVariantKey, TemplateSlot } from "./types";
import type { TextStylePreset } from "./templateTextStyles";

export function measureTextBlock(
  lines: string[],
  fontSize: number,
  lineHeight: number,
  letterSpacing = 0
) {
  return {
    width: Math.max(0, ...lines.map((line) => estimateTextWidth(line, fontSize, letterSpacing))),
    height: Math.max(1, lines.length) * fontSize * lineHeight,
  };
}

export function fitTextToSlot(params: {
  slot: TemplateSlot;
  text: string;
  style: TextStylePreset;
  usedVariant?: CopyVariantKey;
}): BannerFitResult {
  const padding = params.slot.safePadding ?? 0;
  const boxWidth = Math.max(12, params.slot.width - padding * 2);
  const boxHeight = Math.max(12, params.slot.height - padding * 2);
  const lineHeight = params.style.lineHeight ?? 1.1;
  const result = fitTextToBox({
    text: params.text,
    boxWidth,
    boxHeight,
    maxLines: params.slot.maxLines || params.style.maxLines || 1,
    minFontSize: params.style.minFontSize || Math.max(12, params.style.fontSize * 0.55),
    maxFontSize: params.style.maxFontSize || params.style.fontSize,
    fontFamily: params.style.fontFamily,
    fontWeight: params.style.fontWeight,
    letterSpacing: params.style.letterSpacing,
    lineHeight,
  });
  const measured = measureTextBlock(
    result.lines,
    result.fontSize,
    lineHeight,
    params.style.letterSpacing
  );
  const overflowX = measured.width > boxWidth + 0.5;
  const overflowY = measured.height > boxHeight + 0.5;
  const status = result.didTruncate
    ? "ellipsis"
    : overflowX || overflowY
      ? "failed"
      : result.didShrink
        ? "shrunk"
        : result.lines.length > 1
          ? "wrapped"
          : "exact";
  const warnings: string[] = [];
  if (overflowX) warnings.push("horizontal overflow");
  if (overflowY) warnings.push("vertical overflow");
  if (result.didTruncate) warnings.push("text ellipsis applied");

  return {
    slotId: params.slot.id,
    status,
    originalText: params.text,
    finalText: result.lines.join("\n"),
    fontSize: result.fontSize,
    lineHeight,
    lines: result.lines,
    usedVariant: params.usedVariant,
    boundingBox: {
      x: params.slot.x + padding,
      y: params.slot.y + padding,
      width: Math.min(boxWidth, measured.width),
      height: Math.min(boxHeight, measured.height),
    },
    overflowX,
    overflowY,
    warnings,
  };
}
