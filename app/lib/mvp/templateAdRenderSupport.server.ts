import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import sharp from "sharp";
import { foodImpactHeroTemplate, headlineFontPresets, templateHeadlinePresetMap, type BannerTemplateDefinition } from "@/lib/bannerTemplates";
import { prepareLogoDataUrlForSurface } from "./adaptiveLogo.server";
import { getSelectedProductImagePath } from "./imageEffects";
import { buildUspFirstFallbackCopy } from "./productUsp";
import { fitTextToBox } from "./textFit";
import type { AdaptiveCreativePlan, AutomaticLayoutPreset } from "../background-library/types";
import { readCatalogAssetFromUrl } from "../background-library/catalogStore.server";
import type { AdHookType, AdProductPosition, AdTextSafeArea, GeneratedAdCopy, GeneratedAdCopyVariant, CopyVariantKey, ProductInfoForPrompt, ProductImageRenderEffect, ProductImageState } from "./types";

type RenderStyle = Partial<typeof foodImpactHeroTemplate.style> & {
  creativeTextStylePresetId?: string;
  bodyFontSize?: number;
  bodyFontWeight?: number;
  selectedFontWeight?: number;
  headlineFontWeight?: number;
  selectedFontFile?: string;
  headlineFontFile?: string;
  accentPhrase?: string;
  accentColor?: string;
  manualTextColors?: boolean;
};

type RenderBody = {
  templateId?: string;
  canvasSize?: { width?: number; height?: number };
  copy?: Partial<GeneratedAdCopy>;
  productInfo?: ProductInfoForPrompt;
  copyVariants?: Partial<Record<"short" | "medium" | "long", GeneratedAdCopyVariant>>;
  selectedVariant?: CopyVariantKey;
  productImagePath?: string;
  secondaryProductImagePath?: string;
  selectedProductImagePath?: string;
  productImagePaths?: string[];
  imageSource?: string;
  productImageState?: ProductImageState;
  productOriginalPrice?: string;
  productOldPrice?: string;
  backgroundMode?: "none" | "auto-detail-blur-dark" | "selected-detail-blur-dark";
  selectedBackgroundSource?: string;
  backgroundComposition?: {
    sourceId?: string;
    sourceType?: "library" | "site" | "ai" | "manual";
    hookType?: AdHookType;
    productPosition?: AdProductPosition;
    textSafeArea?: AdTextSafeArea;
    layoutPreset?: AutomaticLayoutPreset;
  };
  adaptiveCreativePlan?: AdaptiveCreativePlan;
  logoImagePath?: string;
  aiDisclosure?: {
    enabled?: boolean;
    text?: string;
  };
  backgroundStyle?: {
    blurLevel?: "low" | "medium" | "high";
    dimLevel?: "low" | "medium" | "high";
    overlayColor?: string;
    overlayOpacity?: number;
    brightness?: number;
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    flipHorizontal?: boolean;
  };
  style?: RenderStyle;
  productEffect?: Partial<ProductImageRenderEffect>;
};

function compactRequestedProductImagePaths(body: RenderBody): string[] {
  const selectedProcessedProductPath = body.productImageState?.selectedImageMode === "styled-cutout" ? body.productImageState.styledCutoutImagePath : body.productImageState?.selectedImageMode === "cutout" ? body.productImageState.cutoutImagePath : "";
  const originalProductImagePath = body.productImageState?.originalImagePath?.trim() || "";
  const values = [selectedProcessedProductPath, ...(body.productImagePaths || []), body.productImagePath, body.secondaryProductImagePath, body.selectedProductImagePath, body.productImageState?.originalImagePath];
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const value of values) {
    const imagePath = value?.trim();
    if (!imagePath || seen.has(imagePath)) continue;
    if (selectedProcessedProductPath && originalProductImagePath && imagePath === originalProductImagePath) {
      continue;
    }
    seen.add(imagePath);
    paths.push(imagePath);
  }

  return paths.slice(0, 4);
}

type TextLine = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fill: string;
  weight?: number;
  anchor?: "start" | "middle";
  fontFamily?: string;
  letterSpacing?: number;
  dominantBaseline?: "middle" | "auto";
  stroke?: boolean;
  strokeColor?: string;
  strokeWidth?: number;
  filter?: string;
};

type RenderFittingSlot = {
  didShrink: boolean;
  didTruncate: boolean;
  fontSize: number;
  lines: string[];
};

type RenderFittingState = {
  slots: Partial<Record<keyof GeneratedAdCopyVariant, RenderFittingSlot>>;
};

const renderFittingStack: RenderFittingState[] = [];

function currentRenderFitting() {
  return renderFittingStack[renderFittingStack.length - 1];
}

const outputDir = path.join(process.cwd(), "public", "generated-ads");
const defaultCutoutProductEffect: ProductImageRenderEffect = {
  outline: true,
  outlineColor: "#ffffff",
  outlineWidth: 14,
  shadow: true,
  shadowColor: "rgba(0,0,0,0.45)",
  shadowBlur: 24,
  shadowOffsetX: 0,
  shadowOffsetY: 10,
  glow: true,
  glowColor: "rgba(255,255,255,0.55)",
  glowBlur: 28,
  productScale: 1.08,
  productOffsetX: 0,
  productOffsetY: 0,
  productRotation: 0,
};

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function isProcessedProductPath(value: string) {
  return value.startsWith("/processed-products/");
}

function resolveProductEffect(imagePath: string, requestEffect?: Partial<ProductImageRenderEffect>, templateEffect?: Partial<ProductImageRenderEffect>) {
  const hasRequestEffect = Boolean(requestEffect && Object.keys(requestEffect).length);
  const hasTemplateEffect = Boolean(templateEffect && Object.keys(templateEffect).length);
  if (!hasRequestEffect && !hasTemplateEffect && !isProcessedProductPath(imagePath)) return undefined;

  return {
    ...defaultCutoutProductEffect,
    ...(templateEffect || {}),
    ...(requestEffect || {}),
  } as ProductImageRenderEffect;
}

function svgColorWithOpacity(color: string) {
  const rgba = color.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgba) return { color, opacity: 1 };
  const parts = rgba[1].split(",").map((part) => part.trim());
  if (parts.length < 3) return { color, opacity: 1 };
  return {
    color: `rgb(${parts[0]},${parts[1]},${parts[2]})`,
    opacity: parts[3] !== undefined ? Number(parts[3]) : 1,
  };
}

function productEffectFilterDef(effect?: ProductImageRenderEffect) {
  if (!effect) {
    return `<filter id="productShadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#000000" flood-opacity="0.18"/>
    </filter>`;
  }

  const shadow = svgColorWithOpacity(effect.shadowColor);
  const glow = svgColorWithOpacity(effect.glowColor);
  return `<filter id="productShadow" x="-45%" y="-45%" width="190%" height="210%" color-interpolation-filters="sRGB">
    ${
      effect.outline && effect.outlineWidth > 0
        ? `<feMorphology in="SourceAlpha" operator="dilate" radius="${effect.outlineWidth}" result="outline" />
    <feFlood flood-color="${escapeXml(effect.outlineColor)}" flood-opacity="1" result="outlineColor" />
    <feComposite in="outlineColor" in2="outline" operator="in" result="outlineLayer" />`
        : ""
    }
    ${
      effect.glow && effect.glowBlur > 0
        ? `<feGaussianBlur in="SourceAlpha" stdDeviation="${effect.glowBlur}" result="glow" />
    <feFlood flood-color="${escapeXml(glow.color)}" flood-opacity="${glow.opacity}" result="glowColor" />
    <feComposite in="glowColor" in2="glow" operator="in" result="glowLayer" />`
        : ""
    }
    ${effect.shadow && effect.shadowBlur > 0 ? `<feDropShadow dx="${effect.shadowOffsetX}" dy="${effect.shadowOffsetY}" stdDeviation="${effect.shadowBlur}" flood-color="${escapeXml(shadow.color)}" flood-opacity="${shadow.opacity}" result="shadowLayer" />` : ""}
    <feMerge>
      ${effect.shadow && effect.shadowBlur > 0 ? `<feMergeNode in="shadowLayer" />` : ""}
      ${effect.glow && effect.glowBlur > 0 ? `<feMergeNode in="glowLayer" />` : ""}
      ${effect.outline && effect.outlineWidth > 0 ? `<feMergeNode in="outlineLayer" />` : ""}
      <feMergeNode in="SourceGraphic" />
    </feMerge>
  </filter>`;
}

function productImageSvg(dataUrl: string, x: number, y: number, width: number, height: number, mode: "meet" | "cover" = "meet", effect?: ProductImageRenderEffect) {
  if (!dataUrl) {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#ffffff" opacity="0.7" />`;
  }

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = effect ? ` transform="translate(${effect.productOffsetX} ${effect.productOffsetY}) rotate(${effect.productRotation} ${cx} ${cy}) translate(${cx} ${cy}) scale(${effect.productScale}) translate(${-cx} ${-cy})"` : "";
  const preserveMode = mode === "cover" ? "slice" : "meet";
  return `<g${transform}><image href="${dataUrl}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid ${preserveMode}" filter="url(#productShadow)" /></g>`;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function contentTypeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function resolveOptionalFontFile(value?: string) {
  if (!value) return "";
  const normalized = value.replace(/\\/g, "/").trim();
  const fileName = path.basename(normalized);
  if (!/^[^/]+\.(?:ttf|ttc|otf)$/i.test(fileName)) return "";

  if (normalized.startsWith("/fonts/") || normalized.startsWith("fonts/")) {
    return path.join(process.cwd(), "public", "fonts", fileName);
  }

  const configuredFontDir = process.env.ADATLAS_FONT_DIR;
  if (configuredFontDir && !path.isAbsolute(normalized)) {
    return path.join(configuredFontDir, fileName);
  }

  return "";
}

function fontFormatFromFile(filePath: string) {
  return filePath.toLowerCase().endsWith(".otf") ? "opentype" : "truetype";
}

function fontFileToFileUrl(filePath: string) {
  const safeFilePath = resolveOptionalFontFile(filePath);
  return safeFilePath ? pathToFileURL(safeFilePath).href : "";
}

function buildFontFaceCss(family: string, fileUrl: string, format: string, weight: number | string) {
  if (!fileUrl) return "";
  return `@font-face { font-family: '${family}'; src: url('${fileUrl}') format('${format}'); font-weight: ${weight}; font-style: normal; }`;
}

function getFoodTemplate001ImageFrames(count: number): Array<{ x: number; y: number; width: number; height: number; mode: "cover" | "meet" }> {
  const normalizedCount = Math.max(1, Math.min(4, count || 1));
  const gap = 0;

  if (normalizedCount === 1) {
    return [{ x: 0, y: 0, width: 1200, height: 1200, mode: "cover" }];
  }

  if (normalizedCount === 2) {
    return [
      { x: 0, y: 0, width: 600 - gap / 2, height: 1200, mode: "cover" },
      { x: 600 + gap / 2, y: 0, width: 600 - gap / 2, height: 1200, mode: "cover" },
    ];
  }

  if (normalizedCount === 3) {
    return [
      { x: 0, y: 0, width: 1200, height: 600, mode: "cover" },
      { x: 0, y: 600, width: 600 - gap / 2, height: 600, mode: "cover" },
      { x: 600 + gap / 2, y: 600, width: 600 - gap / 2, height: 600, mode: "cover" },
    ];
  }

  return [
    { x: 0, y: 0, width: 600 - gap / 2, height: 600, mode: "cover" },
    { x: 600 + gap / 2, y: 0, width: 600 - gap / 2, height: 600, mode: "cover" },
    { x: 0, y: 600, width: 600 - gap / 2, height: 600, mode: "cover" },
    { x: 600 + gap / 2, y: 600, width: 600 - gap / 2, height: 600, mode: "cover" },
  ];
}

async function imageToDataUrl(imagePathOrUrl: string) {
  if (!imagePathOrUrl) return "";
  if (/^data:image\//.test(imagePathOrUrl)) return imagePathOrUrl;

  const catalogBuffer = await readCatalogAssetFromUrl(imagePathOrUrl);
  if (catalogBuffer) {
    const png = await sharp(catalogBuffer).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  }

  if (isHttpUrl(imagePathOrUrl)) {
    const response = await fetch(imagePathOrUrl);
    if (!response.ok) throw new Error(`상품 이미지 다운로드 실패: HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (/image\/(?:webp|avif)/i.test(contentType)) {
      const png = await sharp(buffer).png().toBuffer();
      return `data:image/png;base64,${png.toString("base64")}`;
    }
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  }

  const publicRelativePath = imagePathOrUrl.replace(/^\/+/, "");
  const filePath = path.join(process.cwd(), "public", publicRelativePath);
  const buffer = await fs.readFile(filePath);
  if (/\.(?:webp|avif)$/i.test(filePath)) {
    const png = await sharp(buffer).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  }
  return `data:${contentTypeFromPath(filePath)};base64,${buffer.toString("base64")}`;
}

function backgroundBlurValue(level?: "low" | "medium" | "high") {
  if (level === "low") return 2;
  if (level === "medium") return 5;
  return 9;
}

function backgroundDimOpacity(level?: "low" | "medium" | "high") {
  if (level === "low") return 0.42;
  if (level === "medium") return 0.54;
  return 0.66;
}

function selectedBackgroundBlur(body: RenderBody) {
  if (body.backgroundComposition?.sourceType === "library") {
    if (body.backgroundStyle?.blurLevel === "low") return 0;
    return body.backgroundStyle?.blurLevel === "medium" ? 3 : 7;
  }
  if (body.backgroundComposition?.sourceType === "site") return 24;
  return backgroundBlurValue(body.backgroundStyle?.blurLevel);
}

function selectedBackgroundOverlay(body: RenderBody) {
  const requested = Number(body.backgroundStyle?.overlayOpacity);
  if (Number.isFinite(requested)) return Math.max(0, Math.min(0.72, requested));
  return backgroundDimOpacity(body.backgroundStyle?.dimLevel);
}

function compositionProductPosition(body: RenderBody): AdProductPosition {
  const layout = body.backgroundComposition?.layoutPreset;
  if (layout === "text-left-product-right" || layout === "price-focused") return "center-right";
  if (layout === "text-right-product-left") return "center-left";
  if (layout === "text-top-product-bottom" || layout === "centered-product-promotion") {
    return "bottom-center";
  }
  if (layout === "premium-minimal") return "center-right";
  return body.backgroundComposition?.productPosition || "center-right";
}

function compositionProductFrame(body: RenderBody, options: { width: number; height: number; top: number; bottomTop?: number }) {
  const position = compositionProductPosition(body);
  const xRatio: Record<AdProductPosition, number> = {
    left: 0.04,
    "center-left": 0.16,
    center: 0.5,
    "center-right": 0.84,
    right: 0.96,
    "bottom-left": 0.04,
    "bottom-center": 0.5,
    "bottom-right": 0.96,
  };
  const centerX = xRatio[position] * 1200;
  const x = Math.max(28, Math.min(1200 - options.width - 28, centerX - options.width / 2));
  const y = position.startsWith("bottom-") ? (options.bottomTop ?? Math.max(options.top, 500)) : options.top;
  return { x, y, width: options.width, height: options.height };
}

function optimizedProductEffect(body: RenderBody, template: BannerTemplateDefinition): Partial<ProductImageRenderEffect> | undefined {
  if (!body.selectedBackgroundSource || !body.backgroundComposition?.productPosition) {
    return body.productEffect;
  }
  const productSlot = (template.slots || []).find((slot) => slot.type === "image" && slot.id !== "background" && slot.id !== "scene" && slot.role !== "background" && slot.role !== "scene");
  if (!productSlot) return body.productEffect;

  const position = compositionProductPosition(body);
  const horizontalTarget: Record<AdProductPosition, number> = {
    left: 260,
    "center-left": 390,
    center: 600,
    "center-right": 830,
    right: 940,
    "bottom-left": 270,
    "bottom-center": 600,
    "bottom-right": 930,
  };
  const verticalTarget = position.startsWith("bottom-") ? 760 : 600;
  const slotCenterX = productSlot.x + productSlot.width / 2;
  const slotCenterY = productSlot.y + productSlot.height / 2;
  const requested = body.productEffect || {};
  return {
    ...requested,
    productOffsetX: Math.max(-220, Math.min(220, Number(requested.productOffsetX || 0) + horizontalTarget[position] - slotCenterX)),
    productOffsetY: Math.max(-220, Math.min(220, Number(requested.productOffsetY || 0) + verticalTarget - slotCenterY)),
  };
}

function estimateWidth(text: string, fontSize: number, letterSpacing = 0) {
  let width = 0;
  for (const char of text) {
    if (/[가-힣]/.test(char)) {
      width += fontSize * 1.08;
    } else if (/[0-9]/.test(char)) {
      width += fontSize * 0.7;
    } else {
      width += fontSize * 0.64;
    }
  }
  return width + Math.max(0, text.length - 1) * letterSpacing;
}

function fitLines(
  text: string,
  options: {
    maxWidth: number;
    maxLines: number;
    initialSize: number;
    minSize: number;
    letterSpacing?: number;
    allowBelowMin?: boolean;
    lineHeight?: number;
    boxHeight?: number;
    slot?: keyof GeneratedAdCopyVariant;
  }
) {
  const maxFontSize = Math.max(options.minSize, options.initialSize);
  const minFontSize = options.allowBelowMin === false ? options.minSize : Math.min(options.minSize, 8);
  const result = fitTextToBox({
    text,
    boxWidth: options.maxWidth,
    boxHeight: options.boxHeight ?? options.maxLines * maxFontSize * (options.lineHeight ?? 1.1),
    maxLines: options.maxLines,
    minFontSize,
    maxFontSize,
    letterSpacing: options.letterSpacing,
    lineHeight: options.lineHeight,
  });

  if (options.slot) {
    const fitting = currentRenderFitting();
    if (fitting) {
      fitting.slots[options.slot] = {
        didShrink: result.didShrink,
        didTruncate: result.didTruncate,
        fontSize: result.fontSize,
        lines: result.lines,
      };
    }
  }

  return result;
}

function textSvg(lines: TextLine[], fontFamily: string) {
  return lines
    .map((line) => {
      const strokeAttrs = line.stroke ? ` stroke="${escapeXml(line.strokeColor || "#111111")}" stroke-width="${line.strokeWidth || 0}" paint-order="stroke fill" stroke-linejoin="round"` : "";
      const filterAttr = line.filter ? ` filter="url(#${line.filter})"` : "";
      return `<text x="${line.x}" y="${line.y}" text-anchor="${line.anchor || "middle"}" dominant-baseline="${line.dominantBaseline || "auto"}" font-family="${escapeXml(line.fontFamily || fontFamily)}" font-size="${line.fontSize}" font-weight="${line.weight || 800}" letter-spacing="${line.letterSpacing ?? 0}" fill="${line.fill}"${strokeAttrs}${filterAttr}>${escapeXml(line.text)}</text>`;
    })
    .join("");
}

function aiDisclosureSvg(disclosure: RenderBody["aiDisclosure"], fontFamily: string, width: number, height: number) {
  if (!disclosure?.enabled) return "";
  const text = (disclosure.text || "AI 활용 콘텐츠입니다.").trim();
  if (!text) return "";

  return `<text x="${width / 2}" y="${height - 28}" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(fontFamily)}" font-size="18" font-weight="500" letter-spacing="0" fill="rgba(255,255,255,0.82)" stroke="rgba(0,0,0,0.36)" stroke-width="2" paint-order="stroke fill">${escapeXml(text)}</text>`;
}

function logoOverlaySvg(logoImageDataUrl: string, options: { x?: number; y?: number; size?: number; opacity?: number } = {}) {
  if (!logoImageDataUrl) return "";
  const x = options.x ?? 1012;
  const y = options.y ?? 38;
  const size = options.size ?? 136;
  const opacity = options.opacity ?? 1;
  return `<image href="${logoImageDataUrl}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" opacity="${opacity}" />`;
}

async function adaptiveLogoDataUrl(params: { logoImageDataUrl: string; surfaceDataUrl?: string; x?: number; y?: number; size?: number; fallbackTone?: "light" | "dark" }) {
  if (!params.logoImageDataUrl) return "";
  const size = params.size ?? 136;
  return prepareLogoDataUrlForSurface({
    logoDataUrl: params.logoImageDataUrl,
    surfaceDataUrl: params.surfaceDataUrl,
    surfaceBox: {
      x: params.x ?? 1012,
      y: params.y ?? 38,
      width: size,
      height: size,
    },
    fallbackTone: params.fallbackTone,
  });
}

function splitAccentSegments(text: string, accentPhrase: string | undefined, defaultFill: string, accentFill: string) {
  const explicitSegments: { text: string; fill: string }[] = [];
  const markerPattern = /\[\[([\s\S]+?)\]\]/g;
  let lastIndex = 0;
  let markerMatch: RegExpExecArray | null;

  while ((markerMatch = markerPattern.exec(text)) !== null) {
    if (markerMatch.index > lastIndex) {
      explicitSegments.push({ text: text.slice(lastIndex, markerMatch.index), fill: defaultFill });
    }
    explicitSegments.push({ text: markerMatch[1], fill: accentFill });
    lastIndex = markerMatch.index + markerMatch[0].length;
  }

  if (explicitSegments.length) {
    if (lastIndex < text.length) explicitSegments.push({ text: text.slice(lastIndex), fill: defaultFill });
    return explicitSegments.filter((segment) => segment.text);
  }

  const phrases = (accentPhrase || "")
    .split(",")
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (!phrases.length) return [{ text, fill: defaultFill }];

  const segments: { text: string; fill: string }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const matched = phrases.find((phrase) => text.slice(cursor).startsWith(phrase));
    if (matched) {
      segments.push({ text: matched, fill: accentFill });
      cursor += matched.length;
      continue;
    }
    const nextMatchIndex = phrases
      .map((phrase) => text.indexOf(phrase, cursor + 1))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    const end = nextMatchIndex ?? text.length;
    segments.push({ text: text.slice(cursor, end), fill: defaultFill });
    cursor = end;
  }

  return segments.filter((segment) => segment.text);
}

function inferAccentPhraseFromCopy(copy: Partial<GeneratedAdCopy>) {
  const source = [copy.headline, copy.bodyCopy, copy.highlightCopy, copy.bottomBarCopy].filter(Boolean).join(" ");
  const explicit = Array.from(source.matchAll(/\[\[([\s\S]+?)\]\]/g))
    .map((match) => match[1].trim())
    .filter(Boolean);
  if (explicit.length) return explicit.slice(0, 4).join(",");

  const candidates = [...Array.from(source.matchAll(/[0-9][0-9,]*(?:원|만원|kg|KG|g|%)/g)).map((match) => match[0]), ...Array.from(source.matchAll(/[가-힣A-Za-z0-9]{2,}(?:등심|갈비|한우|설록우|특가|무료배송|폭락가|육즙|선물|구성|할인|반칙)/g)).map((match) => match[0]), ...Array.from(source.matchAll(/(?:국내산|역대급|파격|특별|무료|첫출시|고급|대용량)\s*[가-힣A-Za-z0-9]{2,}/g)).map((match) => match[0].trim())];

  return Array.from(new Set(candidates))
    .filter((phrase) => phrase.length >= 2 && phrase.length <= 16)
    .slice(0, 4)
    .join(",");
}

function inferSplitMeatDealHeadlineAccents(headline: string, explicitAccent?: string) {
  if (explicitAccent?.trim()) return explicitAccent;

  const candidates = [...Array.from(headline.matchAll(/[0-9][0-9,]*(?:원|만원|만\s*원|%)/g)).map((match) => match[0]), ...Array.from(headline.matchAll(/(?:선물|생색|특가|구성|가격|가성비|등심|갈비|한우|설록우)/g)).map((match) => match[0])];

  return Array.from(new Set(candidates))
    .filter((phrase) => phrase.length >= 2 && phrase.length <= 12)
    .slice(0, 4)
    .join(",");
}

function mixedTextSvg(options: { text: string; x: number; y: number; anchor?: "start" | "middle"; fontFamily: string; fontSize: number; fontWeight: number; defaultFill: string; accentFill: string; accentPhrase?: string; letterSpacing?: number; dominantBaseline?: "middle" | "auto"; strokeColor?: string; strokeWidth?: number }) {
  const strokeAttrs = options.strokeWidth ? ` stroke="${escapeXml(options.strokeColor || "#111111")}" stroke-width="${options.strokeWidth}" paint-order="stroke fill" stroke-linejoin="round"` : "";
  const segments = splitAccentSegments(options.text, options.accentPhrase, options.defaultFill, options.accentFill);
  return `<text x="${options.x}" y="${options.y}" text-anchor="${options.anchor || "middle"}" dominant-baseline="${options.dominantBaseline || "auto"}" font-family="${escapeXml(options.fontFamily)}" font-size="${options.fontSize}" font-weight="${options.fontWeight}" letter-spacing="${options.letterSpacing ?? 0}"${strokeAttrs}>${segments.map((segment) => `<tspan fill="${escapeXml(segment.fill)}">${escapeXml(segment.text)}</tspan>`).join("")}</text>`;
}

function lineText(
  lines: string[],
  options: {
    x: number;
    startY: number;
    fontSize: number;
    lineHeight: number;
    fill: string;
    weight: number;
    letterSpacing?: number;
  }
) {
  return lines.map((line, index) => ({
    text: line,
    x: options.x,
    y: options.startY + index * options.fontSize * options.lineHeight,
    fontSize: options.fontSize,
    fill: options.fill,
    weight: options.weight,
    letterSpacing: options.letterSpacing,
  }));
}

function centeredLineText(
  lines: string[],
  options: {
    x: number;
    centerY: number;
    fontSize: number;
    lineHeight: number;
    fill: string;
    weight: number;
    letterSpacing?: number;
  }
) {
  const step = options.fontSize * options.lineHeight;
  const firstY = options.centerY - ((lines.length - 1) * step) / 2;
  return lines.map((line, index) => ({
    text: line,
    x: options.x,
    y: firstY + index * step,
    fontSize: options.fontSize,
    fill: options.fill,
    weight: options.weight,
    letterSpacing: options.letterSpacing,
    dominantBaseline: "middle" as const,
  }));
}

function resolveHeadlineStyle(templateId: string, style: NonNullable<RenderBody["style"]>) {
  const presetId = style.headlineFontPreset || templateHeadlinePresetMap[templateId] || foodImpactHeroTemplate.style.headlineFontPreset;
  const preset = headlineFontPresets[presetId] || headlineFontPresets["impact-korean-red"];
  const textStroke = Boolean(style.headlineTextStroke ?? preset.textStroke);
  const textStrokeWidth = Number(style.headlineTextStrokeWidth ?? preset.textStrokeWidth ?? (textStroke ? 4 : 0));
  const textShadow = Boolean(style.headlineShadow ?? preset.textShadow);

  return {
    fontFamily: style.headlineFontFamily || preset.fontFamily,
    fontWeight: Number(style.headlineFontWeight ?? preset.fontWeight),
    fontSize: Number(style.headlineFontSize ?? foodImpactHeroTemplate.typography.headlineFontSize),
    letterSpacing: Number(style.headlineLetterSpacing ?? preset.letterSpacing),
    lineHeight: Number(style.headlineLineHeight ?? preset.lineHeight),
    color: style.headlineColor || preset.color,
    textStroke,
    textStrokeColor: style.headlineTextStrokeColor || preset.textStrokeColor || "#111111",
    textStrokeWidth,
    textShadow,
    shadowColor: style.headlineShadowColor || preset.shadowColor || "rgba(0,0,0,0.2)",
    shadowBlur: Number(style.headlineShadowBlur ?? preset.shadowBlur ?? (textShadow ? 2 : 0)),
    shadowOffsetX: Number(style.headlineShadowOffsetX ?? preset.shadowOffsetX ?? (textShadow ? 2 : 0)),
    shadowOffsetY: Number(style.headlineShadowOffsetY ?? preset.shadowOffsetY ?? (textShadow ? 3 : 0)),
  };
}

function foodImpactFallbackCopy(productInfo?: ProductInfoForPrompt) {
  if (productInfo) return buildUspFirstFallbackCopy(productInfo);
  return {
    headline: "상품 핵심을 확인하세요",
    bodyCopy: "상세페이지의 확인된 정보로 문구를 생성합니다.",
    highlightCopy: "확인된 상품 정보",
    bottomBarCopy: "가격과 혜택은 확인된 내용만 표시합니다.",
    cta: "상품 정보 보기",
  };
}

const genericFoodImpactCopyPattern = /(?:정말\s*저렴|특별한\s*가격|만나는\s*기회|만나보세요|합리적인\s*가격|고품질\s*상품|한정가에|제공합니다|뛰어난\s*한우)/;

function foodImpactCopyValue(value: string | undefined, fallback: string) {
  const trimmed = value?.trim() || "";
  if (!trimmed || genericFoodImpactCopyPattern.test(trimmed)) return fallback;
  return trimmed;
}

export {
  compactRequestedProductImagePaths,
  outputDir,
  escapeXml,
  resolveProductEffect,
  productEffectFilterDef,
  productImageSvg,
  resolveOptionalFontFile,
  fontFormatFromFile,
  fontFileToFileUrl,
  buildFontFaceCss,
  getFoodTemplate001ImageFrames,
  imageToDataUrl,
  selectedBackgroundBlur,
  selectedBackgroundOverlay,
  compositionProductFrame,
  optimizedProductEffect,
  estimateWidth,
  fitLines,
  textSvg,
  aiDisclosureSvg,
  logoOverlaySvg,
  adaptiveLogoDataUrl,
  inferAccentPhraseFromCopy,
  inferSplitMeatDealHeadlineAccents,
  mixedTextSvg,
  lineText,
  centeredLineText,
  resolveHeadlineStyle,
  foodImpactFallbackCopy,
  foodImpactCopyValue,
};
export type { RenderStyle, RenderBody, TextLine };
