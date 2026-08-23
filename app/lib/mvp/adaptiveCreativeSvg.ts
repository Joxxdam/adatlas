import type { AdaptiveCreativePlan } from "../background-library/types";
import type { GeneratedAdCopyVariant, ProductImageRenderEffect } from "./types";

export type AdaptiveCreativeSvgInput = {
  plan: AdaptiveCreativePlan;
  copy: GeneratedAdCopyVariant;
  backgroundDataUrl: string;
  productDataUrl: string;
  logoDataUrl?: string;
  aiDisclosureText?: string;
  fontFaceCss?: string;
  fontFamily?: string;
  headlineFontFamily?: string;
  productEffect?: Partial<ProductImageRenderEffect>;
  backgroundFlipHorizontal?: boolean;
};

function xml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function estimate(text: string, fontSize: number) {
  return [...text].reduce((sum, char) => sum + fontSize * (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(char) ? 0.96 : 0.6), 0);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}

function safeBox<T extends { x: number; y: number; width: number; height: number }>(box: T): T {
  const width = clamp(box.width, 40, 1152);
  const height = clamp(box.height, 32, 1152);
  return {
    ...box,
    width,
    height,
    x: clamp(box.x, 24, 1176 - width),
    y: clamp(box.y, 24, 1176 - height),
  };
}

function normalizePlan(plan: AdaptiveCreativePlan): AdaptiveCreativePlan {
  return {
    ...plan,
    productPlacement: {
      ...safeBox(plan.productPlacement),
      scale: clamp(plan.productPlacement.scale, 0.55, 1.55),
      rotation: clamp(plan.productPlacement.rotation, -30, 30),
      groundY: clamp(plan.productPlacement.groundY, 24, 1176),
    },
    productComposition: plan.productComposition || {
      mode: "single",
      count: 1,
      scaleStep: 0,
      overlapRatio: 0,
    },
    textPlacement: {
      ...safeBox(plan.textPlacement),
      fontSize: clamp(plan.textPlacement.fontSize, 24, 112),
      maxLines: clamp(plan.textPlacement.maxLines, 1, 4),
    },
    bodyPlacement: {
      ...safeBox(plan.bodyPlacement),
      fontSize: clamp(plan.bodyPlacement.fontSize, 16, 54),
      maxLines: clamp(plan.bodyPlacement.maxLines, 1, 4),
    },
    pricePlacement: {
      ...safeBox(plan.pricePlacement),
      fontSize: clamp(plan.pricePlacement.fontSize, 20, 88),
      maxLines: clamp(plan.pricePlacement.maxLines, 1, 2),
    },
    ctaPlacement: {
      ...safeBox(plan.ctaPlacement),
      fontSize: clamp(plan.ctaPlacement.fontSize, 16, 46),
      maxLines: 1,
    },
  };
}

function wrapText(text: string, width: number, fontSize: number, maxLines: number) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (!current || estimate(next, fontSize) <= width) {
      current = next;
      continue;
    }
    if (lines.length < maxLines - 1) {
      lines.push(current);
      current = word;
    } else {
      // Keep every word in the final line. fittedText reduces the font until it fits.
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function fittedText(params: { text: string; x: number; y: number; width: number; height: number; fontSize: number; minSize: number; maxLines: number; color: string; align: "left" | "center" | "right"; weight: number; family: string; lineHeight?: number }) {
  const lineHeight = params.lineHeight || 1.12;
  let size = params.fontSize;
  let lines = wrapText(params.text, params.width, size, params.maxLines);
  while (size > params.minSize && (lines.some((line) => estimate(line, size) > params.width) || lines.length * size * lineHeight > params.height)) {
    size -= 2;
    lines = wrapText(params.text, params.width, size, params.maxLines);
  }
  const anchor = params.align === "center" ? "middle" : params.align === "right" ? "end" : "start";
  const x = params.align === "center" ? params.x + params.width / 2 : params.align === "right" ? params.x + params.width : params.x;
  return lines.map((line, index) => `<text x="${x}" y="${params.y + size + index * size * lineHeight}" text-anchor="${anchor}" fill="${xml(params.color)}" font-family="${xml(params.family)}" font-size="${size}" font-weight="${params.weight}" letter-spacing="-1.5">${xml(line)}</text>`).join("");
}

function backgroundPanel(plan: AdaptiveCreativePlan) {
  if (!plan.contrastAdjustments.useTextPanel) return "";
  const opacity = Math.max(0, Math.min(0.82, plan.contrastAdjustments.panelOpacity));
  const color = xml(plan.colorPalette.panel);
  const direction = plan.contrastAdjustments.gradientDirection;
  if (direction === "none") {
    const box = plan.textPlacement;
    return `<rect x="${Math.max(24, box.x - 28)}" y="${Math.max(24, box.y - 24)}" width="${Math.min(1152, box.width + 56)}" height="${Math.min(500, box.height + plan.bodyPlacement.height + 80)}" rx="26" fill="${color}" opacity="${opacity}"/>`;
  }
  const coordinates = {
    left: ["0%", "0%", "100%", "0%"],
    right: ["100%", "0%", "0%", "0%"],
    top: ["0%", "0%", "0%", "100%"],
    bottom: ["0%", "100%", "0%", "0%"],
  }[direction];
  return `<defs><linearGradient id="adaptiveTextShade" x1="${coordinates[0]}" y1="${coordinates[1]}" x2="${coordinates[2]}" y2="${coordinates[3]}"><stop offset="0%" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="72%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><rect width="1200" height="1200" fill="url(#adaptiveTextShade)"/>`;
}

function decoration(plan: AdaptiveCreativePlan) {
  if (plan.decorationStyle === "promotion") {
    return `<path d="M66 42 H1134" stroke="${xml(plan.colorPalette.accent)}" stroke-width="8"/><circle cx="1120" cy="62" r="10" fill="${xml(plan.colorPalette.accent)}"/>`;
  }
  if (plan.decorationStyle === "editorial") {
    return `<path d="M72 58 H250" stroke="${xml(plan.colorPalette.accent)}" stroke-width="4"/><path d="M72 1128 H1128" stroke="${xml(plan.colorPalette.body)}" stroke-width="2" opacity="0.5"/>`;
  }
  if (plan.decorationStyle === "ingredient") {
    return `<circle cx="1080" cy="92" r="38" fill="none" stroke="${xml(plan.colorPalette.accent)}" stroke-width="4"/><path d="M1048 92 H1112" stroke="${xml(plan.colorPalette.accent)}" stroke-width="3"/>`;
  }
  if (plan.decorationStyle === "minimal") {
    return `<path d="M72 1118 H220" stroke="${xml(plan.colorPalette.accent)}" stroke-width="4"/>`;
  }
  return "";
}

function productFilter(plan: AdaptiveCreativePlan, effect?: Partial<ProductImageRenderEffect>) {
  const separation = Math.max(0.1, Math.min(0.7, plan.contrastAdjustments.productSeparation));
  const opacity = Math.max(0, Math.min(0.8, Number(effect?.shadowOpacity ?? separation)));
  const blur = Math.max(4, Number(effect?.shadowBlur ?? 22) / 3);
  const offsetY = Number(effect?.shadowOffsetY ?? 18);
  const outline = effect?.outline ? `<feMorphology in="SourceAlpha" operator="dilate" radius="${Math.max(1, Number(effect.outlineWidth ?? 3) / 3)}" result="outlineAlpha"/><feFlood flood-color="${xml(effect.outlineColor || "#ffffff")}" result="outlineColor"/><feComposite in="outlineColor" in2="outlineAlpha" operator="in" result="outline"/>` : "";
  const outlineNode = effect?.outline ? '<feMergeNode in="outline"/>' : "";
  return `<filter id="adaptiveProduct" x="-45%" y="-45%" width="190%" height="210%">${outline}<feDropShadow dx="${Number(effect?.shadowOffsetX ?? 0)}" dy="${offsetY}" stdDeviation="${blur}" flood-color="${xml(effect?.shadowColor || "#000000")}" flood-opacity="${opacity}" result="shadow"/><feMerge>${outlineNode}<feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

export function buildAdaptiveCreativeSvg(input: AdaptiveCreativeSvgInput) {
  const plan = normalizePlan(input.plan);
  const { copy } = input;
  const bg = plan.backgroundAdjustments;
  const backgroundWidth = 1200 * Math.max(1, Math.min(1.45, bg.scale));
  const backgroundHeight = backgroundWidth;
  const backgroundX = (1200 - backgroundWidth) / 2 + Math.max(-220, Math.min(220, bg.offsetX));
  const backgroundY = (1200 - backgroundHeight) / 2 + Math.max(-220, Math.min(220, bg.offsetY));
  const product = plan.productPlacement;
  const effectScale = Math.max(0.65, Math.min(1.5, Number(input.productEffect?.productScale ?? 1)));
  const scale = Math.max(0.55, Math.min(1.55, product.scale * effectScale));
  const offsetX = Math.max(-260, Math.min(260, Number(input.productEffect?.productOffsetX ?? 0)));
  const offsetY = Math.max(-260, Math.min(260, Number(input.productEffect?.productOffsetY ?? 0)));
  const productImages = (() => {
    if (!input.productDataUrl) return "";
    const image = (x: number, y: number, width: number, height: number, rotation: number) => {
      const cx = x + width / 2;
      const cy = y + height;
      return `<g transform="translate(${offsetX} ${offsetY}) translate(${cx} ${cy}) rotate(${rotation + Number(input.productEffect?.productRotation ?? 0)}) scale(${scale}) translate(${-cx} ${-cy})"><image href="${xml(input.productDataUrl)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" filter="url(#adaptiveProduct)"/></g>`;
    };
    if (plan.productComposition.mode === "single") {
      return image(product.x, product.y, product.width, product.height, product.rotation);
    }
    const instances = plan.productComposition.count;
    const step = clamp(plan.productComposition.scaleStep, 0.08, 0.38);
    const overlap = clamp(plan.productComposition.overlapRatio, 0.12, 0.56);
    const supportScale = 1 - step;
    const supportWidth = product.width * supportScale;
    const supportHeight = product.height * supportScale;
    const horizontalShift = product.width * (1 - overlap);
    const supportY = product.y + product.height - supportHeight;
    if (plan.productComposition.mode === "scale-contrast") {
      const supportX = clamp(product.x - horizontalShift * 0.7, 24, 1176 - supportWidth);
      return [image(supportX, supportY, supportWidth, supportHeight, product.rotation - 7), image(product.x, product.y, product.width, product.height, product.rotation + 2)].join("");
    }
    const leftX = clamp(product.x - horizontalShift, 24, 1176 - supportWidth);
    const rightX = clamp(product.x + product.width - supportWidth + horizontalShift * 0.2, 24, 1176 - supportWidth);
    const repeated = [image(leftX, supportY, supportWidth, supportHeight, product.rotation - 8), instances === 3 ? image(rightX, supportY, supportWidth, supportHeight, product.rotation + 8) : "", image(product.x, product.y, product.width, product.height, product.rotation)];
    return repeated.join("");
  })();
  const fontFamily = input.fontFamily || "AdAtlasBody, sans-serif";
  const headlineFamily = input.headlineFontFamily || "AdAtlasHeadline, sans-serif";
  const headline = fittedText({
    text: copy.headline,
    ...plan.textPlacement,
    minSize: 34,
    weight: 900,
    family: headlineFamily,
    lineHeight: 1.04,
  });
  const body = fittedText({
    text: copy.bodyCopy,
    ...plan.bodyPlacement,
    minSize: 20,
    weight: 700,
    family: fontFamily,
    lineHeight: 1.22,
  });
  const highlight = copy.highlightCopy
    ? fittedText({
        text: copy.highlightCopy,
        x: plan.bodyPlacement.x,
        y: plan.bodyPlacement.y + plan.bodyPlacement.height + 10,
        width: plan.bodyPlacement.width,
        height: 58,
        fontSize: 24,
        minSize: 18,
        maxLines: 1,
        color: plan.colorPalette.accent,
        align: plan.bodyPlacement.align,
        weight: 800,
        family: fontFamily,
      })
    : "";
  const price =
    plan.pricePlacement.visible && copy.price
      ? fittedText({
          text: copy.price,
          ...plan.pricePlacement,
          minSize: 28,
          weight: 900,
          family: headlineFamily,
        })
      : "";
  const cta =
    plan.ctaPlacement.visible && copy.cta
      ? `<rect x="${plan.ctaPlacement.x}" y="${plan.ctaPlacement.y}" width="${plan.ctaPlacement.width}" height="${plan.ctaPlacement.height}" rx="${Math.min(28, plan.ctaPlacement.height / 2)}" fill="${xml(plan.colorPalette.ctaBackground)}"/>${fittedText({
          text: copy.cta,
          ...plan.ctaPlacement,
          y: plan.ctaPlacement.y + Math.max(0, (plan.ctaPlacement.height - plan.ctaPlacement.fontSize * 1.15) / 2),
          minSize: 18,
          weight: 850,
          family: fontFamily,
        })}`
      : "";
  const bottom = copy.bottomBarCopy
    ? fittedText({
        text: copy.bottomBarCopy,
        x: 72,
        y: 1118,
        width: 1056,
        height: 52,
        fontSize: 23,
        minSize: 17,
        maxLines: 1,
        color: plan.colorPalette.body,
        align: "center",
        weight: 700,
        family: fontFamily,
      })
    : "";
  const logoSize = 118;
  const logoX = plan.textPlacement.x < 600 ? 1050 : 32;
  const logo = input.logoDataUrl ? `<image href="${xml(input.logoDataUrl)}" x="${logoX}" y="32" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>` : "";
  const aiDisclosure = input.aiDisclosureText?.trim() ? `<text x="600" y="1180" text-anchor="middle" fill="rgba(255,255,255,0.86)" stroke="rgba(0,0,0,0.42)" stroke-width="2" paint-order="stroke fill" font-family="${xml(fontFamily)}" font-size="17" font-weight="500">${xml(input.aiDisclosureText.trim())}</text>` : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
  <defs>
    <style>${input.fontFaceCss || ""}</style>
    <filter id="adaptiveBackground"><feGaussianBlur stdDeviation="${Math.max(0, Math.min(20, bg.blur))}"/><feComponentTransfer><feFuncR type="linear" slope="${Math.max(0.55, Math.min(1.35, bg.brightness))}"/><feFuncG type="linear" slope="${Math.max(0.55, Math.min(1.35, bg.brightness))}"/><feFuncB type="linear" slope="${Math.max(0.55, Math.min(1.35, bg.brightness))}"/></feComponentTransfer></filter>
    ${productFilter(plan, input.productEffect)}
  </defs>
  <rect width="1200" height="1200" fill="#f4f4f4"/>
  <image href="${xml(input.backgroundDataUrl)}" x="${backgroundX}" y="${backgroundY}" width="${backgroundWidth}" height="${backgroundHeight}" preserveAspectRatio="xMidYMid slice" ${input.backgroundFlipHorizontal ? 'transform="translate(1200 0) scale(-1 1)"' : ""} filter="url(#adaptiveBackground)"/>
  ${backgroundPanel(plan)}
  ${decoration(plan)}
  ${productImages}
  ${headline}
  ${body}
  ${highlight}
  ${price}
  ${cta}
  ${bottom}
  ${logo}
  ${aiDisclosure}
  </svg>`;
}
