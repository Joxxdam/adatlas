import type { BannerTemplateDefinition } from "../../../lib/bannerTemplates";
import type { TextStylePreset as CreativeTextStylePreset } from "../creative/types";
import type { PreparedBannerRender } from "./bannerRenderPipeline";
import type { ProductImageRenderEffect, ProductInfoForPrompt, TemplateSlot } from "./types";

export type OptimizedTemplateSvgInput = {
  template: BannerTemplateDefinition;
  plan: PreparedBannerRender;
  productInfo?: ProductInfoForPrompt;
  productOriginalPrice?: string;
  productOldPrice?: string;
  frameData: Array<{ dataUrl: string }>;
  logoDataUrl?: string;
  aiDisclosureText?: string;
  fontFaceCss: string;
  productEffect?: Partial<ProductImageRenderEffect>;
  textOverrides?: {
    creativePreset?: CreativeTextStylePreset;
    fontFamily?: string;
    headlineFontFamily?: string;
    headlineFontSize?: number;
    headlineColor?: string;
    headlineFontWeight?: number;
    headlineLetterSpacing?: number;
    headlineLineHeight?: number;
    headlineTextStroke?: boolean;
    headlineTextStrokeColor?: string;
    headlineTextStrokeWidth?: number;
    headlineShadow?: boolean;
    bodyColor?: string;
    bodyFontSize?: number;
    bodyFontWeight?: number;
  };
  backgroundTreatment?: {
    blur?: number;
    brightness?: number;
    overlayColor?: string;
    overlayOpacity?: number;
  };
};

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function estimateWidth(text: string, fontSize: number) {
  return [...text].reduce(
    (width, char) => width + fontSize * (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(char) ? 0.96 : 0.62),
    0
  );
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function safeRenderedFontSize(
  slot: TemplateSlot,
  lines: string[],
  requestedSize: number,
  lineHeightRatio: number,
  strokeWidth = 0
) {
  const horizontalPadding = Math.max(0, Number(slot.safePadding || 0)) * 2 + strokeWidth * 2;
  const availableWidth = Math.max(1, slot.width - horizontalPadding);
  const widestAtRequestedSize = Math.max(
    1,
    ...lines.map((line) => estimateWidth(line, requestedSize))
  );
  const widthScale = Math.min(1, availableWidth / widestAtRequestedSize);
  const availableHeight = Math.max(1, slot.height - strokeWidth * 2);
  const requestedBlockHeight = Math.max(
    1,
    lines.length * requestedSize * lineHeightRatio
  );
  const heightScale = Math.min(1, availableHeight / requestedBlockHeight);
  return Math.max(8, Math.floor(requestedSize * Math.min(widthScale, heightScale)));
}

function slotText(slot: TemplateSlot, input: OptimizedTemplateSvgInput) {
  const { plan, productInfo } = input;
  const role = slot.role || slot.id;
  if (role === "headline") return plan.copy.headline;
  if (role === "bodyCopy" || role === "subheadline" || role === "reviewQuote") {
    return plan.copy.bodyCopy;
  }
  if (
    role === "highlight" ||
    role === "highlightCopy" ||
    role === "benefitChip" ||
    role === "socialProof" ||
    role === "urgency"
  ) {
    return plan.copy.highlightCopy;
  }
  if (role === "bottomBar" || role === "bottomBarCopy") return plan.copy.bottomBarCopy;
  if (role === "cta") return plan.copy.cta;
  if (role === "price") return plan.copy.price || productInfo?.price || "";
  if (role === "originalPrice") {
    return (
      input.productOriginalPrice ||
      input.productOldPrice ||
      productInfo?.originalPrice ||
      productInfo?.oldPrice ||
      ""
    );
  }
  if (role === "productName") return productInfo?.productName || plan.copy.bodyCopy;
  if (role === "productBadge") return "특가";
  return "";
}

function slotStyle(slot: TemplateSlot, plan: PreparedBannerRender) {
  const role = slot.role || slot.id;
  if (role === "headline") return plan.textStyles.headline;
  if (role === "price") return plan.textStyles.price;
  if (role === "originalPrice") return plan.textStyles.originalPrice;
  if (role === "productName") return plan.textStyles.productName || plan.textStyles.bodyCopy;
  if (role === "productBadge") return plan.textStyles.productBadge || plan.textStyles.benefitChip;
  if (role === "highlight" || role === "highlightCopy") return plan.textStyles.highlight;
  if (role === "benefitChip" || role === "socialProof" || role === "urgency") {
    return plan.textStyles.benefitChip || plan.textStyles.highlight;
  }
  if (role === "reviewQuote") return plan.textStyles.reviewQuote || plan.textStyles.bodyCopy;
  if (role === "bottomBar" || role === "bottomBarCopy") return plan.textStyles.bottomBar;
  if (role === "cta") return plan.textStyles.cta;
  if (role === "subheadline") return plan.textStyles.subheadline || plan.textStyles.bodyCopy;
  return plan.textStyles.bodyCopy;
}

function surface(input: OptimizedTemplateSvgInput) {
  const { template, plan } = input;
  const palette = plan.palette;
  if (template.visualTone === "produce-editorial") {
    return `<rect width="1200" height="1200" fill="${xml(palette.backgroundColor)}"/>
      <rect x="548" y="32" width="624" height="924" rx="8" fill="${xml(palette.surfaceColor)}"/>
      <path d="M64 54 H430" stroke="${xml(palette.accentColor)}" stroke-width="8"/>`;
  }
  if (template.visualTone === "beauty-editorial") {
    return `<rect width="1200" height="1200" fill="${xml(palette.backgroundColor)}"/>
      <rect x="556" y="46" width="604" height="850" rx="8" fill="${xml(palette.surfaceColor)}"/>
      <path d="M70 62 H268" stroke="${xml(palette.accentColor)}" stroke-width="5"/>
      <path d="M70 884 H1130" stroke="${xml(palette.mutedColor)}" stroke-width="2"/>`;
  }
  if (template.visualTone === "beauty-clinical") {
    return `<rect width="1200" height="1200" fill="${xml(palette.backgroundColor)}"/>
      <rect x="585" y="0" width="615" height="1200" fill="${xml(palette.surfaceColor)}"/>
      <path d="M585 0 V1200" stroke="${xml(palette.mutedColor)}" stroke-width="2"/>`;
  }
  return `<rect width="1200" height="1200" fill="${xml(palette.backgroundColor)}"/>`;
}

function toneOverlay(template: BannerTemplateDefinition) {
  if (template.visualTone === "meat-impact") {
    return '<rect width="1200" height="1200" fill="url(#optimizedMeatShade)"/>';
  }
  if (template.visualTone === "body-proof") {
    return '<rect width="1200" height="1200" fill="url(#optimizedBodyShade)"/>';
  }
  return "";
}

function imageElements(input: OptimizedTemplateSvgInput, layer: "background" | "product") {
  const slots = input.template.slots || [];
  return input.plan.imageFrames
    .map((frame, index) => {
      const dataUrl = input.frameData[index]?.dataUrl;
      if (!dataUrl) return "";
      const slot = slots.find((item) => item.id === frame.slotId);
      const background =
        slot?.imageFit === "background-image" ||
        slot?.role === "background" ||
        slot?.role === "scene" ||
        slot?.id === "background" ||
        slot?.id === "scene" ||
        frame.slotId === "__generatedSceneBackground";
      if ((layer === "background") !== background) return "";
      const preserve = frame.fit === "cover" || background ? "slice" : "meet";
      const backdrop =
        !background &&
        ["beauty-editorial", "beauty-clinical", "produce-editorial"].includes(
          input.template.visualTone || ""
        )
          ? `<rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${
              frame.height
            }" rx="8" fill="${xml(input.plan.palette.surfaceColor)}"/>`
          : "";
      if (background) {
        return `<image href="${dataUrl}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="xMidYMid ${preserve}" clip-path="url(#optimizedClip${index})" filter="url(#optimizedSceneFilter)"/>`;
      }
      const effect = input.productEffect || {};
      const scale = Math.max(0.65, Math.min(1.45, Number(effect.productScale ?? 1)));
      const offsetX = Math.max(-240, Math.min(240, Number(effect.productOffsetX ?? 0)));
      const offsetY = Math.max(-240, Math.min(240, Number(effect.productOffsetY ?? 0)));
      const rotation = Math.max(-24, Math.min(24, Number(effect.productRotation ?? 0)));
      const centerX = frame.x + frame.width / 2;
      const centerY = frame.y + frame.height / 2;
      const transform = `translate(${offsetX} ${offsetY}) translate(${centerX} ${centerY}) rotate(${rotation}) scale(${scale}) translate(${-centerX} ${-centerY})`;
      return `${backdrop}<g transform="${transform}"><image href="${dataUrl}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="xMidYMid ${preserve}" clip-path="url(#optimizedClip${index})" filter="url(#optimizedProductEffect)"/></g>`;
    })
    .join("");
}

function sceneOverlay(input: OptimizedTemplateSvgInput) {
  const opacity = Math.max(0, Math.min(0.72, Number(input.backgroundTreatment?.overlayOpacity || 0)));
  if (!opacity) return "";
  return `<rect width="1200" height="1200" fill="${xml(
    input.backgroundTreatment?.overlayColor || "#000000"
  )}" opacity="${opacity}"/>`;
}

function foregroundScenePanels(input: OptimizedTemplateSvgInput) {
  const hasGeneratedFullBleedScene = input.plan.imageFrames.some(
    (frame) => frame.slotId === "__generatedSceneBackground"
  );
  if (!hasGeneratedFullBleedScene) return "";
  const palette = input.plan.palette;
  if (input.template.visualTone === "produce-editorial") {
    return `<rect x="30" y="30" width="510" height="912" rx="8" fill="${xml(
      palette.backgroundColor
    )}" opacity="0.94"/>`;
  }
  if (input.template.visualTone === "beauty-editorial") {
    return `<rect x="30" y="30" width="510" height="872" rx="8" fill="${xml(
      palette.backgroundColor
    )}" opacity="0.94"/>`;
  }
  if (input.template.visualTone === "beauty-clinical") {
    return `<rect x="585" y="0" width="615" height="1200" fill="${xml(
      palette.surfaceColor
    )}" opacity="0.96"/>`;
  }
  return "";
}

function productEffectFilter(input: OptimizedTemplateSvgInput) {
  const effect = input.productEffect;
  if (!effect) {
    return '<filter id="optimizedProductEffect" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#000000" flood-opacity="0.22"/></filter>';
  }
  const nodes: string[] = [];
  const merge: string[] = [];
  if (effect.shadow !== false) {
    const shadowOpacity = Math.max(0, Math.min(1, Number(effect.shadowOpacity ?? 0.34)));
    nodes.push(`<feDropShadow in="SourceAlpha" dx="${Number(effect.shadowOffsetX ?? 0)}" dy="${Number(effect.shadowOffsetY ?? 16)}" stdDeviation="${Math.max(1, Number(effect.shadowBlur ?? 22) / 3)}" flood-color="${xml(effect.shadowBaseColor || effect.shadowColor || "#000000")}" flood-opacity="${shadowOpacity}" result="productShadow"/>`);
    merge.push('<feMergeNode in="productShadow"/>');
  }
  if (effect.glow) {
    nodes.push(`<feGaussianBlur in="SourceAlpha" stdDeviation="${Math.max(1, Number(effect.glowBlur ?? 20) / 3)}" result="glowAlpha"/><feFlood flood-color="${xml(effect.glowBaseColor || effect.glowColor || "#ffffff")}" flood-opacity="${Math.max(0, Math.min(1, Number(effect.glowOpacity ?? 0.22)))}" result="glowColor"/><feComposite in="glowColor" in2="glowAlpha" operator="in" result="productGlow"/>`);
    merge.push('<feMergeNode in="productGlow"/>');
  }
  if (effect.outline) {
    nodes.push(`<feMorphology in="SourceAlpha" operator="dilate" radius="${Math.max(1, Number(effect.outlineWidth ?? 8) / 3)}" result="outlineAlpha"/><feFlood flood-color="${xml(effect.outlineColor || "#ffffff")}" result="outlineColor"/><feComposite in="outlineColor" in2="outlineAlpha" operator="in" result="productOutline"/>`);
    merge.push('<feMergeNode in="productOutline"/>');
  }
  merge.push('<feMergeNode in="SourceGraphic"/>');
  return `<filter id="optimizedProductEffect" x="-40%" y="-40%" width="180%" height="200%">${nodes.join("")}<feMerge>${merge.join("")}</feMerge></filter>`;
}

function headlineShadowFilter(input: OptimizedTemplateSvgInput) {
  const presetShadow = input.textOverrides?.creativePreset?.shadow;
  const templateStyle = input.plan.textStyles.headline;
  const color = presetShadow?.color || templateStyle?.shadowColor || "rgba(0,0,0,0.42)";
  const blur = Math.max(0, Number(presetShadow?.blur ?? templateStyle?.shadowBlur ?? 10));
  const offsetX = Number(presetShadow?.offsetX ?? templateStyle?.shadowOffsetX ?? 0);
  const offsetY = Number(presetShadow?.offsetY ?? templateStyle?.shadowOffsetY ?? 5);
  return `<filter id="optimizedHeadlineShadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="${offsetX}" dy="${offsetY}" stdDeviation="${Math.max(
    0.1,
    blur / 3
  )}" flood-color="${xml(color)}"/></filter>`;
}

function textBox(slot: TemplateSlot, role: string, input: OptimizedTemplateSvgInput) {
  const { plan, template } = input;
  if (slot.type === "cta") {
    const fill =
      template.visualTone === "meat-impact" ? plan.palette.dangerColor : plan.palette.accentColor;
    return `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" rx="${
      ["beauty-editorial", "beauty-clinical"].includes(template.visualTone || "") ? 8 : 0
    }" fill="${xml(fill)}"/>`;
  }
  if (role === "bottomBar" || role === "bottomBarCopy") {
    const fill =
      template.visualTone === "meat-impact"
        ? plan.palette.secondaryColor
        : plan.palette.primaryColor;
    return `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${
      slot.height
    }" rx="${slot.x > 0 ? 8 : 0}" fill="${xml(fill)}"/>`;
  }
  if (slot.type === "chip") {
    return `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${
      slot.height
    }" rx="8" fill="${xml(plan.palette.highlightColor)}"/>`;
  }
  if (slot.type === "badge") {
    return `<rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${
      slot.height
    }" rx="6" fill="${xml(plan.palette.dangerColor)}"/>`;
  }
  return "";
}

function textElements(input: OptimizedTemplateSvgInput) {
  const slots = input.template.slots || [];
  return slots
    .filter((slot) => ["text", "price", "cta", "badge", "chip"].includes(slot.type))
    .map((slot) => {
      const text = slotText(slot, input).trim();
      const fit = input.plan.fitResults.find((result) => result.slotId === slot.id);
      const style = slotStyle(slot, input.plan);
      if (!text || !fit || !style) return "";
      const role = slot.role || slot.id;
      const textOverrides = input.textOverrides;
      const creativePreset = textOverrides?.creativePreset;
      const isHeadline = role === "headline";
      const isBodyCopy = ["bodyCopy", "subheadline", "reviewQuote"].includes(role);
      const centered =
        role === "cta" ||
        role === "bottomBar" ||
        role === "bottomBarCopy" ||
        role === "productBadge" ||
        (role === "headline" && input.template.visualTone === "meat-impact");
      const x = centered ? slot.x + slot.width / 2 : slot.x + (slot.safePadding || 0);
      const manualStroke =
        isHeadline && typeof textOverrides?.headlineTextStroke === "boolean"
          ? textOverrides.headlineTextStroke
          : undefined;
      const strokeEnabled = isHeadline
        ? manualStroke ?? (creativePreset ? Boolean(creativePreset.outline) : Boolean(style.stroke))
        : Boolean(style.stroke);
      const strokeWidth = strokeEnabled
        ? clampNumber(
            Number(
              textOverrides?.headlineTextStrokeWidth ??
                creativePreset?.outline?.width ??
                style.strokeWidth ??
                0
            ),
            0,
            20
          )
        : 0;
      const lineHeightRatio = clampNumber(
        Number(
          isHeadline
            ? textOverrides?.headlineLineHeight ?? creativePreset?.lineHeight ?? fit.lineHeight
            : fit.lineHeight
        ),
        0.82,
        1.5
      );
      const requestedFontSize = Math.max(
        8,
        Number(
          isHeadline
            ? textOverrides?.headlineFontSize ??
                fit.fontSize * (creativePreset?.headlineScale ?? 1)
            : isBodyCopy
              ? textOverrides?.bodyFontSize ??
                fit.fontSize * (creativePreset?.secondaryScale ?? 1)
              : fit.fontSize
        )
      );
      const fontSize = safeRenderedFontSize(
        slot,
        fit.lines,
        requestedFontSize,
        lineHeightRatio,
        strokeWidth
      );
      const lineHeight = fontSize * lineHeightRatio;
      const blockHeight = fit.lines.length * lineHeight;
      const startY =
        slot.y + Math.max(lineHeight, (slot.height - blockHeight) / 2 + lineHeight * 0.78);
      const fill = ["cta", "bottomBar", "bottomBarCopy", "productBadge"].includes(role)
        ? "#ffffff"
        : isHeadline
          ? textOverrides?.headlineColor || creativePreset?.foregroundColor || style.fill
          : isBodyCopy
            ? textOverrides?.bodyColor || style.fill
            : style.fill;
      const strokeColor =
        textOverrides?.headlineTextStrokeColor || creativePreset?.outline?.color || style.stroke;
      const stroke = strokeEnabled && strokeColor
        ? ` stroke="${xml(strokeColor)}" stroke-width="${strokeWidth}" paint-order="stroke fill" stroke-linejoin="round"`
        : "";
      const resolvedFontFamily = isHeadline
        ? textOverrides?.headlineFontFamily || creativePreset?.fontFamily || style.fontFamily
        : isBodyCopy
          ? textOverrides?.fontFamily || style.fontFamily
          : style.fontFamily;
      const fontFamily = isHeadline
        ? `AdAtlasHeadlineFont, ${resolvedFontFamily}`
        : `AdAtlasSelectedFont, ${resolvedFontFamily}`;
      const fontWeight = isHeadline
        ? textOverrides?.headlineFontWeight || creativePreset?.fontWeight || style.fontWeight
        : isBodyCopy
          ? textOverrides?.bodyFontWeight || style.fontWeight
          : style.fontWeight;
      const letterSpacing = isHeadline
        ? textOverrides?.headlineLetterSpacing ?? creativePreset?.letterSpacing ?? style.letterSpacing
        : style.letterSpacing;
      const headlineShadowEnabled = isHeadline
        ? typeof textOverrides?.headlineShadow === "boolean"
          ? textOverrides.headlineShadow
          : creativePreset
            ? Boolean(creativePreset.shadow)
            : Boolean(style.shadowColor)
        : false;
      const shadow = headlineShadowEnabled ? ' filter="url(#optimizedHeadlineShadow)"' : "";
      const backgroundBox =
        isHeadline && creativePreset?.backgroundBox
          ? (() => {
              const paddingX = Math.max(
                12,
                slot.width * creativePreset.backgroundBox!.paddingRatio
              );
              const paddingY = Math.max(10, fontSize * 0.18);
              const textWidth = Math.max(
                1,
                ...fit.lines.map((line) => estimateWidth(line, fontSize))
              );
              const boxWidth = Math.min(slot.width, textWidth + paddingX * 2);
              const boxHeight = Math.min(slot.height, blockHeight + paddingY * 2);
              const boxX = centered ? x - boxWidth / 2 : slot.x;
              const boxY = Math.max(slot.y, startY - fontSize * 0.82 - paddingY);
              return `<rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="8" fill="${xml(
                creativePreset.backgroundBox!.color
              )}" opacity="${clampNumber(
                creativePreset.backgroundBox!.opacity,
                0,
                1
              )}"/>`;
            })()
          : "";
      const lines = fit.lines
        .map(
          (line, index) =>
            `<text x="${x}" y="${startY + index * lineHeight}" text-anchor="${
              centered ? "middle" : "start"
            }" font-family="${xml(fontFamily)}" font-size="${fontSize}" font-weight="${
              fontWeight
            }" letter-spacing="${letterSpacing || 0}" fill="${xml(fill)}"${stroke}${shadow}>${xml(
              line
            )}</text>`
        )
        .join("");
      const strike =
        role === "originalPrice"
          ? `<line x1="${slot.x}" y1="${slot.y + slot.height / 2}" x2="${Math.min(
              slot.x + slot.width,
              slot.x + estimateWidth(fit.finalText, fontSize) + 18
            )}" y2="${slot.y + slot.height / 2}" stroke="${xml(fill)}" stroke-width="4"/>`
          : "";
      const arrow =
        role === "cta"
          ? `<text x="${slot.x + slot.width - 38}" y="${
              slot.y + slot.height / 2 + 10
            }" text-anchor="middle" font-family="AdAtlasSelectedFont" font-size="38" font-weight="700" fill="#ffffff">›</text>`
          : "";
      return `${textBox(slot, role, input)}${backgroundBox}${lines}${strike}${arrow}`;
    })
    .join("");
}

export function buildOptimizedTemplateSvg(input: OptimizedTemplateSvgInput) {
  const clips = input.plan.imageFrames
    .map((frame, index) => {
      const inset = frame.fit === "contain" ? 8 : 0;
      return `<clipPath id="optimizedClip${index}"><rect x="${
        frame.x + inset
      }" y="${frame.y + inset}" width="${Math.max(
        1,
        frame.width - inset * 2
      )}" height="${Math.max(1, frame.height - inset * 2)}" rx="${
        frame.fit === "contain" ? 6 : 0
      }"/></clipPath>`;
    })
    .join("");
  const logo = input.logoDataUrl
    ? `<image href="${input.logoDataUrl}" x="1028" y="40" width="126" height="126" preserveAspectRatio="xMidYMid meet"/>`
    : "";
  const disclosure = input.aiDisclosureText
    ? `<text x="600" y="1174" text-anchor="middle" font-family="AdAtlasSelectedFont" font-size="18" font-weight="500" fill="#ffffff" stroke="#111111" stroke-width="2" paint-order="stroke fill">${xml(
        input.aiDisclosureText
      )}</text>`
    : "";
  const sceneBlur = Math.max(0, Math.min(18, Number(input.backgroundTreatment?.blur || 0)));
  const sceneBrightness = Math.max(
    0.55,
    Math.min(1.35, Number(input.backgroundTreatment?.brightness || 1))
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
    <defs>
      <style>${input.fontFaceCss}</style>
      ${clips}
      <filter id="optimizedSceneFilter" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${sceneBlur}" edgeMode="duplicate"/><feComponentTransfer><feFuncR type="linear" slope="${sceneBrightness}"/><feFuncG type="linear" slope="${sceneBrightness}"/><feFuncB type="linear" slope="${sceneBrightness}"/></feComponentTransfer></filter>
      ${productEffectFilter(input)}
      ${headlineShadowFilter(input)}
      <linearGradient id="optimizedMeatShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#000" stop-opacity="0.56"/><stop offset="45%" stop-color="#000" stop-opacity="0.1"/><stop offset="100%" stop-color="#000" stop-opacity="0.78"/></linearGradient>
      <linearGradient id="optimizedBodyShade" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#07100f" stop-opacity="0.88"/><stop offset="62%" stop-color="#07100f" stop-opacity="0.46"/><stop offset="100%" stop-color="#07100f" stop-opacity="0.72"/></linearGradient>
    </defs>
    ${surface(input)}
    ${imageElements(input, "background")}
    ${sceneOverlay(input)}
    ${toneOverlay(input.template)}
    ${foregroundScenePanels(input)}
    ${imageElements(input, "product")}
    ${textElements(input)}
    ${logo}
    ${disclosure}
  </svg>`;
}
