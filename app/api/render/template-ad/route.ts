import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { pathToFileURL } from "url";
import sharp from "sharp";
import { NextResponse } from "next/server";
import {
  foodCategoryTemplateIds,
  foodImpactHeroTemplate,
  headlineFontPresets,
  templateHeadlinePresetMap,
  templatesById,
  type BannerTemplateDefinition,
} from "@/lib/bannerTemplates";
import {
  prepareBannerRender,
  type PreparedBannerRender,
} from "../../../lib/mvp/bannerRenderPipeline";
import { getCreativeTextStylePreset } from "../../../lib/creative/textStylePresets";
import { buildOptimizedTemplateSvg } from "../../../lib/mvp/optimizedTemplateSvg";
import { buildAdaptiveCreativeSvg } from "../../../lib/mvp/adaptiveCreativeSvg";
import { prepareLogoDataUrlForSurface } from "../../../lib/mvp/adaptiveLogo.server";
import { getSelectedProductImagePath } from "../../../lib/mvp/imageEffects";
import { buildUspFirstFallbackCopy } from "../../../lib/mvp/productUsp";
import { fitCopyToTemplate } from "../../../lib/mvp/templateCopyFitter";
import { fitTextToBox } from "../../../lib/mvp/textFit";
import type {
  AdaptiveCreativePlan,
  AutomaticLayoutPreset,
} from "../../../lib/background-library/types";
import { readCatalogAssetFromUrl } from "../../../lib/background-library/catalogStore.server";
import type {
  AdHookType,
  AdProductPosition,
  AdTextSafeArea,
  GeneratedAdCopy,
  GeneratedAdCopyVariant,
  CopyVariantKey,
  ProductInfoForPrompt,
  ProductImageRenderEffect,
  ProductImageState,
  TemplateCopyLimits,
} from "../../../lib/mvp/types";

export const runtime = "nodejs";

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
  const selectedProcessedProductPath =
    body.productImageState?.selectedImageMode === "styled-cutout"
      ? body.productImageState.styledCutoutImagePath
      : body.productImageState?.selectedImageMode === "cutout"
        ? body.productImageState.cutoutImagePath
        : "";
  const originalProductImagePath = body.productImageState?.originalImagePath?.trim() || "";
  const values = [
    selectedProcessedProductPath,
    ...(body.productImagePaths || []),
    body.productImagePath,
    body.secondaryProductImagePath,
    body.selectedProductImagePath,
    body.productImageState?.originalImagePath,
  ];
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const value of values) {
    const imagePath = value?.trim();
    if (!imagePath || seen.has(imagePath)) continue;
    if (
      selectedProcessedProductPath &&
      originalProductImagePath &&
      imagePath === originalProductImagePath
    ) {
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
const supportedTemplateIds = new Set([
  "food-impact-hero-001",
  ...foodCategoryTemplateIds,
  "bold-commerce-001",
  "shock-headline-001",
  "price-proof-002",
  "home-shopping-max-010",
  "premium-gift-006",
  "ugc-meme-005",
]);

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
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isProcessedProductPath(value: string) {
  return value.startsWith("/processed-products/");
}

function resolveProductEffect(
  imagePath: string,
  requestEffect?: Partial<ProductImageRenderEffect>,
  templateEffect?: Partial<ProductImageRenderEffect>
) {
  const hasRequestEffect = Boolean(requestEffect && Object.keys(requestEffect).length);
  const hasTemplateEffect = Boolean(templateEffect && Object.keys(templateEffect).length);
  if (!hasRequestEffect && !hasTemplateEffect && !isProcessedProductPath(imagePath))
    return undefined;

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

function productImageSvg(
  dataUrl: string,
  x: number,
  y: number,
  width: number,
  height: number,
  mode: "meet" | "cover" = "meet",
  effect?: ProductImageRenderEffect
) {
  if (!dataUrl) {
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="22" fill="#ffffff" opacity="0.7" />`;
  }

  const cx = x + width / 2;
  const cy = y + height / 2;
  const transform = effect
    ? ` transform="translate(${effect.productOffsetX} ${effect.productOffsetY}) rotate(${effect.productRotation} ${cx} ${cy}) translate(${cx} ${cy}) scale(${effect.productScale}) translate(${-cx} ${-cy})"`
    : "";
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

function buildFontFaceCss(
  family: string,
  fileUrl: string,
  format: string,
  weight: number | string
) {
  if (!fileUrl) return "";
  return `@font-face { font-family: '${family}'; src: url('${fileUrl}') format('${format}'); font-weight: ${weight}; font-style: normal; }`;
}

function getFoodTemplate001ImageFrames(
  count: number
): Array<{ x: number; y: number; width: number; height: number; mode: "cover" | "meet" }> {
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

function compositionProductFrame(
  body: RenderBody,
  options: { width: number; height: number; top: number; bottomTop?: number }
) {
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
  const y = position.startsWith("bottom-")
    ? (options.bottomTop ?? Math.max(options.top, 500))
    : options.top;
  return { x, y, width: options.width, height: options.height };
}

function optimizedProductEffect(
  body: RenderBody,
  template: BannerTemplateDefinition
): Partial<ProductImageRenderEffect> | undefined {
  if (!body.selectedBackgroundSource || !body.backgroundComposition?.productPosition) {
    return body.productEffect;
  }
  const productSlot = (template.slots || []).find(
    (slot) =>
      slot.type === "image" &&
      slot.id !== "background" &&
      slot.id !== "scene" &&
      slot.role !== "background" &&
      slot.role !== "scene"
  );
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
    productOffsetX: Math.max(
      -220,
      Math.min(
        220,
        Number(requested.productOffsetX || 0) + horizontalTarget[position] - slotCenterX
      )
    ),
    productOffsetY: Math.max(
      -220,
      Math.min(220, Number(requested.productOffsetY || 0) + verticalTarget - slotCenterY)
    ),
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

function pushLongToken(
  lines: string[],
  token: string,
  maxWidth: number,
  fontSize: number,
  letterSpacing: number,
  maxLines: number
) {
  let current = "";
  for (const char of token) {
    const candidate = `${current}${char}`;
    if (estimateWidth(candidate, fontSize, letterSpacing) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = char;
    }
    if (lines.length >= maxLines) return "";
  }
  return current;
}

function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  maxLines: number,
  letterSpacing = 0
) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [""];

  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const candidate = current ? `${current} ${token}` : token;
    if (estimateWidth(candidate, fontSize, letterSpacing) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
      if (lines.length >= maxLines) break;
    }

    if (estimateWidth(token, fontSize, letterSpacing) > maxWidth) {
      current = pushLongToken(lines, token, maxWidth, fontSize, letterSpacing, maxLines);
      if (lines.length >= maxLines) break;
    } else {
      current = token;
    }
  }

  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
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
  const minFontSize =
    options.allowBelowMin === false ? options.minSize : Math.min(options.minSize, 8);
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
      const strokeAttrs = line.stroke
        ? ` stroke="${escapeXml(line.strokeColor || "#111111")}" stroke-width="${line.strokeWidth || 0}" paint-order="stroke fill" stroke-linejoin="round"`
        : "";
      const filterAttr = line.filter ? ` filter="url(#${line.filter})"` : "";
      return `<text x="${line.x}" y="${line.y}" text-anchor="${line.anchor || "middle"}" dominant-baseline="${line.dominantBaseline || "auto"}" font-family="${escapeXml(line.fontFamily || fontFamily)}" font-size="${line.fontSize}" font-weight="${line.weight || 800}" letter-spacing="${line.letterSpacing ?? 0}" fill="${line.fill}"${strokeAttrs}${filterAttr}>${escapeXml(line.text)}</text>`;
    })
    .join("");
}

function aiDisclosureSvg(
  disclosure: RenderBody["aiDisclosure"],
  fontFamily: string,
  width: number,
  height: number
) {
  if (!disclosure?.enabled) return "";
  const text = (disclosure.text || "AI 활용 콘텐츠입니다.").trim();
  if (!text) return "";

  return `<text x="${width / 2}" y="${height - 28}" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(fontFamily)}" font-size="18" font-weight="500" letter-spacing="0" fill="rgba(255,255,255,0.82)" stroke="rgba(0,0,0,0.36)" stroke-width="2" paint-order="stroke fill">${escapeXml(text)}</text>`;
}

function logoOverlaySvg(
  logoImageDataUrl: string,
  options: { x?: number; y?: number; size?: number; opacity?: number } = {}
) {
  if (!logoImageDataUrl) return "";
  const x = options.x ?? 1012;
  const y = options.y ?? 38;
  const size = options.size ?? 136;
  const opacity = options.opacity ?? 1;
  return `<image href="${logoImageDataUrl}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" opacity="${opacity}" />`;
}

async function adaptiveLogoDataUrl(params: {
  logoImageDataUrl: string;
  surfaceDataUrl?: string;
  x?: number;
  y?: number;
  size?: number;
  fallbackTone?: "light" | "dark";
}) {
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

function splitAccentSegments(
  text: string,
  accentPhrase: string | undefined,
  defaultFill: string,
  accentFill: string
) {
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
    if (lastIndex < text.length)
      explicitSegments.push({ text: text.slice(lastIndex), fill: defaultFill });
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
  const source = [copy.headline, copy.bodyCopy, copy.highlightCopy, copy.bottomBarCopy]
    .filter(Boolean)
    .join(" ");
  const explicit = Array.from(source.matchAll(/\[\[([\s\S]+?)\]\]/g))
    .map((match) => match[1].trim())
    .filter(Boolean);
  if (explicit.length) return explicit.slice(0, 4).join(",");

  const candidates = [
    ...Array.from(source.matchAll(/[0-9][0-9,]*(?:원|만원|kg|KG|g|%)/g)).map((match) => match[0]),
    ...Array.from(
      source.matchAll(
        /[가-힣A-Za-z0-9]{2,}(?:등심|갈비|한우|설록우|특가|무료배송|폭락가|육즙|선물|구성|할인|반칙)/g
      )
    ).map((match) => match[0]),
    ...Array.from(
      source.matchAll(/(?:국내산|역대급|파격|특별|무료|첫출시|고급|대용량)\s*[가-힣A-Za-z0-9]{2,}/g)
    ).map((match) => match[0].trim()),
  ];

  return Array.from(new Set(candidates))
    .filter((phrase) => phrase.length >= 2 && phrase.length <= 16)
    .slice(0, 4)
    .join(",");
}

function inferSplitMeatDealHeadlineAccents(headline: string, explicitAccent?: string) {
  if (explicitAccent?.trim()) return explicitAccent;

  const candidates = [
    ...Array.from(headline.matchAll(/[0-9][0-9,]*(?:원|만원|만\s*원|%)/g)).map((match) => match[0]),
    ...Array.from(
      headline.matchAll(/(?:선물|생색|특가|구성|가격|가성비|등심|갈비|한우|설록우)/g)
    ).map((match) => match[0]),
  ];

  return Array.from(new Set(candidates))
    .filter((phrase) => phrase.length >= 2 && phrase.length <= 12)
    .slice(0, 4)
    .join(",");
}

function mixedTextSvg(options: {
  text: string;
  x: number;
  y: number;
  anchor?: "start" | "middle";
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  defaultFill: string;
  accentFill: string;
  accentPhrase?: string;
  letterSpacing?: number;
  dominantBaseline?: "middle" | "auto";
  strokeColor?: string;
  strokeWidth?: number;
}) {
  const strokeAttrs = options.strokeWidth
    ? ` stroke="${escapeXml(options.strokeColor || "#111111")}" stroke-width="${options.strokeWidth}" paint-order="stroke fill" stroke-linejoin="round"`
    : "";
  const segments = splitAccentSegments(
    options.text,
    options.accentPhrase,
    options.defaultFill,
    options.accentFill
  );
  return `<text x="${options.x}" y="${options.y}" text-anchor="${options.anchor || "middle"}" dominant-baseline="${options.dominantBaseline || "auto"}" font-family="${escapeXml(options.fontFamily)}" font-size="${options.fontSize}" font-weight="${options.fontWeight}" letter-spacing="${options.letterSpacing ?? 0}"${strokeAttrs}>${segments
    .map((segment) => `<tspan fill="${escapeXml(segment.fill)}">${escapeXml(segment.text)}</tspan>`)
    .join("")}</text>`;
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
  const presetId =
    style.headlineFontPreset ||
    templateHeadlinePresetMap[templateId] ||
    foodImpactHeroTemplate.style.headlineFontPreset;
  const preset = headlineFontPresets[presetId] || headlineFontPresets["impact-korean-red"];
  const textStroke = Boolean(style.headlineTextStroke ?? preset.textStroke);
  const textStrokeWidth = Number(
    style.headlineTextStrokeWidth ?? preset.textStrokeWidth ?? (textStroke ? 4 : 0)
  );
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
    shadowOffsetX: Number(
      style.headlineShadowOffsetX ?? preset.shadowOffsetX ?? (textShadow ? 2 : 0)
    ),
    shadowOffsetY: Number(
      style.headlineShadowOffsetY ?? preset.shadowOffsetY ?? (textShadow ? 3 : 0)
    ),
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

const genericFoodImpactCopyPattern =
  /(?:정말\s*저렴|특별한\s*가격|만나는\s*기회|만나보세요|합리적인\s*가격|고품질\s*상품|한정가에|제공합니다|뛰어난\s*한우)/;

function foodImpactCopyValue(value: string | undefined, fallback: string) {
  const trimmed = value?.trim() || "";
  if (!trimmed || genericFoodImpactCopyPattern.test(trimmed)) return fallback;
  return trimmed;
}

async function renderFoodImpactHero(body: RenderBody) {
  const width = body.canvasSize?.width || 1200;
  const height = body.canvasSize?.height || 1200;
  if (width !== 1200 || height !== 1200) {
    throw new Error("현재 템플릿은 1200x1200만 지원합니다.");
  }

  const copy = body.copy ?? {};
  const fallbackCopy = foodImpactFallbackCopy(body.productInfo);
  const foodCopy = {
    ...copy,
    headline: foodImpactCopyValue(copy.headline, fallbackCopy.headline),
    bodyCopy: foodImpactCopyValue(copy.bodyCopy, fallbackCopy.bodyCopy),
    highlightCopy: foodImpactCopyValue(copy.highlightCopy, fallbackCopy.highlightCopy),
    bottomBarCopy: foodImpactCopyValue(copy.bottomBarCopy, fallbackCopy.bottomBarCopy),
    cta: foodImpactCopyValue(copy.cta, fallbackCopy.cta),
  };
  const preset = foodImpactHeroTemplate;
  const templateId = body.templateId || preset.id;
  const styleOverrides = body.style ?? {};
  const style = { ...preset.style, ...styleOverrides };
  const type = preset.typography;
  const headlineStyle = resolveHeadlineStyle(templateId, styleOverrides);
  const hasManualBodyFontSize = styleOverrides.bodyFontSize !== undefined;
  const bodyFontSize = Number(styleOverrides.bodyFontSize ?? type.bodyFontSize);
  const requestedProductImagePaths = compactRequestedProductImagePaths(body);
  const productStateSelectedPath =
    body.productImageState?.selectedImageMode &&
    body.productImageState.selectedImageMode !== "original"
      ? getSelectedProductImagePath(body.productImageState)
      : "";
  const selectedProductImagePath =
    requestedProductImagePaths[0] ||
    productStateSelectedPath ||
    body.productImagePath ||
    body.productImageState?.originalImagePath ||
    "";
  const productEffect = resolveProductEffect(
    selectedProductImagePath,
    body.productEffect,
    (preset as { productEffect?: Partial<ProductImageRenderEffect> }).productEffect
  );
  const imageLayoutPaths = requestedProductImagePaths.length
    ? requestedProductImagePaths
    : selectedProductImagePath
      ? [selectedProductImagePath]
      : [];
  const productImageDataUrls = await Promise.all(
    imageLayoutPaths.slice(0, 2).map((imagePath) => imageToDataUrl(imagePath).catch(() => ""))
  );
  const heroImageUrls =
    productImageDataUrls.length === 1
      ? [productImageDataUrls[0], productImageDataUrls[0]]
      : productImageDataUrls.slice(0, 2);
  const rawLogoImageDataUrl = body.logoImagePath
    ? await imageToDataUrl(body.logoImagePath).catch(() => "")
    : "";
  const logoImageDataUrl = await adaptiveLogoDataUrl({
    logoImageDataUrl: rawLogoImageDataUrl,
    surfaceDataUrl: heroImageUrls[1] || heroImageUrls[0],
    x: width - 168,
    y: 42,
    size: 126,
    fallbackTone: "light",
  });
  const selectedFontFile = resolveOptionalFontFile(styleOverrides.selectedFontFile);
  const selectedFontFormat = fontFormatFromFile(selectedFontFile);
  const headlineFontFile = resolveOptionalFontFile(
    styleOverrides.headlineFontFile || styleOverrides.selectedFontFile
  );
  const headlineFontFormat = fontFormatFromFile(headlineFontFile);
  const selectedFontFileUrl = fontFileToFileUrl(selectedFontFile);
  const headlineFontFileUrl = fontFileToFileUrl(headlineFontFile);
  const selectedFontWeight = Number(
    styleOverrides.selectedFontWeight ?? styleOverrides.bodyFontWeight ?? 800
  );
  const bodyFontWeight = Number(styleOverrides.bodyFontWeight ?? 800);
  const headlineFontFaceWeight = Number(
    styleOverrides.headlineFontWeight ?? headlineStyle.fontWeight ?? 900
  );
  const selectedFontFamily = `AdAtlasSelectedFont, ${String(style.fontFamily)}`;
  const headlineFontFamily = `AdAtlasHeadlineFont, ${headlineStyle.fontFamily}`;
  const hasCta = Boolean(foodCopy.cta?.trim());
  const hasPrice = Boolean(foodCopy.price?.trim());

  const headline = fitLines(foodCopy.headline || "", {
    maxWidth: 1100,
    maxLines: 2,
    initialSize: headlineStyle.fontSize,
    minSize: 78,
    letterSpacing: headlineStyle.letterSpacing,
    lineHeight: headlineStyle.lineHeight,
    boxHeight: 176,
    slot: "headline",
  });
  const headlineStartY = headline.lines.length > 1 ? 68 : 96;
  const headlineBottom =
    headlineStartY +
    (headline.lines.length - 1) * headline.fontSize * headlineStyle.lineHeight +
    headline.fontSize * 0.9;

  const bodyCopy = fitLines(foodCopy.bodyCopy || "", {
    maxWidth: 980,
    maxLines: 2,
    initialSize: Math.min(bodyFontSize, 48),
    minSize: hasManualBodyFontSize ? Math.max(30, Math.min(bodyFontSize, 48)) : 30,
    allowBelowMin: !hasManualBodyFontSize,
    lineHeight: type.bodyLineHeight,
    boxHeight: 116,
    slot: "bodyCopy",
  });
  const bodyStartY = Math.max(178, headlineBottom + 24);
  const bodyBottom =
    bodyStartY + (bodyCopy.lines.length - 1) * bodyCopy.fontSize * type.bodyLineHeight;

  const highlight = fitLines(foodCopy.highlightCopy || "", {
    maxWidth: 1100,
    maxLines: 1,
    initialSize: Math.min(type.highlightFontSize, 38),
    minSize: 28,
    lineHeight: type.highlightLineHeight,
    boxHeight: 52,
    slot: "highlightCopy",
  });
  const highlightPaddingX = 12;
  const highlightPaddingY = 4;
  const highlightLineStep = highlight.fontSize * type.highlightLineHeight;
  const highlightTextWidth = Math.max(
    ...highlight.lines.map((line) => estimateWidth(line, highlight.fontSize))
  );
  const highlightBoxWidth = Math.min(
    1120,
    Math.max(760, highlightTextWidth + highlightPaddingX * 2)
  );
  const highlightBoxHeight = Math.max(
    42,
    highlight.lines.length * highlightLineStep + highlightPaddingY * 2
  );
  const highlightBoxX = (width - highlightBoxWidth) / 2;
  const highlightBoxY = Math.min(332, Math.max(296, bodyBottom + 18));
  const highlightCenterY = highlightBoxY + highlightBoxHeight / 2;

  const ctaHeight = hasCta ? 130 : 0;
  const ctaY = hasCta ? 1070 : 1200;
  const bottomBarY = hasCta ? 965 : 1095;
  const bottomBarHeight = hasCta ? 105 : 105;
  const imageTop = 355;
  const imageBottom = bottomBarY;
  const imageHeight = imageBottom - imageTop;

  const bottom = fitLines(foodCopy.bottomBarCopy || "", {
    maxWidth: 1040,
    maxLines: 1,
    initialSize: 44,
    minSize: 30,
    lineHeight: 1.16,
    boxHeight: bottomBarHeight - 12,
    slot: "bottomBarCopy",
  });
  const cta = fitLines(foodCopy.cta || fallbackCopy.cta, {
    maxWidth: 860,
    maxLines: 1,
    initialSize: 40,
    minSize: 28,
    lineHeight: 1,
    boxHeight: ctaHeight || 72,
    slot: "cta",
  });
  const salePriceText = (foodCopy.price || "").trim();
  const oldPriceText = (body.productOriginalPrice || body.productOldPrice || "").trim();
  const salePrice = fitLines(salePriceText, {
    maxWidth: 340,
    maxLines: 1,
    initialSize: 58,
    minSize: 36,
    lineHeight: 1,
    boxHeight: 66,
    slot: "price",
  });
  const oldPrice = fitLines(oldPriceText, {
    maxWidth: 230,
    maxLines: 1,
    initialSize: 32,
    minSize: 20,
    lineHeight: 1,
    boxHeight: 42,
    slot: "price",
  });
  const priceBlockX = 86;
  const priceBlockY = imageBottom - 126;
  const dealBadgeWidth = 120;
  const dealBadgeHeight = 42;
  const salePriceX = priceBlockX + dealBadgeWidth + 24;
  const salePriceY = priceBlockY + 80;
  const oldPriceX = priceBlockX + 205;
  const oldPriceY = priceBlockY + 28;

  const textLines: TextLine[] = [
    ...lineText(headline.lines, {
      x: 600,
      startY: headlineStartY,
      fontSize: headline.fontSize,
      lineHeight: headlineStyle.lineHeight,
      fill: headlineStyle.color,
      weight: headlineStyle.fontWeight,
      letterSpacing: headlineStyle.letterSpacing,
    }).map((line) => ({
      ...line,
      fontFamily: headlineFontFamily,
      stroke: headlineStyle.textStroke,
      strokeColor: headlineStyle.textStrokeColor,
      strokeWidth: headlineStyle.textStrokeWidth,
      filter: headlineStyle.textShadow ? "headlineShadow" : undefined,
    })),
    ...lineText(bodyCopy.lines, {
      x: 600,
      startY: bodyStartY,
      fontSize: bodyCopy.fontSize,
      lineHeight: type.bodyLineHeight,
      fill: style.bodyColor,
      weight: bodyFontWeight,
    }),
    ...centeredLineText(highlight.lines, {
      x: 600,
      centerY: highlightCenterY,
      fontSize: highlight.fontSize,
      lineHeight: type.highlightLineHeight,
      fill: style.highlightTextColor,
      weight: 900,
    }),
    ...centeredLineText(bottom.lines, {
      x: 600,
      centerY: bottomBarY + bottomBarHeight / 2,
      fontSize: bottom.fontSize,
      lineHeight: 1.16,
      fill: style.bottomBarTextColor,
      weight: 800,
    }),
  ];

  if (hasCta) {
    textLines.push(
      ...centeredLineText(cta.lines, {
        x: 56,
        centerY: ctaY + ctaHeight / 2,
        fontSize: cta.fontSize,
        lineHeight: 1,
        fill: style.ctaTextColor,
        weight: 700,
      }).map((line) => ({ ...line, anchor: "start" as const }))
    );
  }

  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      ${buildFontFaceCss("AdAtlasSelectedFont", selectedFontFileUrl, selectedFontFormat, selectedFontWeight)}
      ${buildFontFaceCss("AdAtlasHeadlineFont", headlineFontFileUrl, headlineFontFormat, headlineFontFaceWeight)}
    </style>
    ${productEffectFilterDef(productEffect)}
    <filter id="headlineShadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="${headlineStyle.shadowOffsetX}" dy="${headlineStyle.shadowOffsetY}" stdDeviation="${headlineStyle.shadowBlur}" flood-color="${escapeXml(headlineStyle.shadowColor)}"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${style.backgroundColor}" />
  <rect x="0" y="0" width="${width}" height="385" fill="#ffffff" />
  <rect x="0" y="${imageTop}" width="${width}" height="${imageHeight}" fill="#ffffff" />
  <rect x="${highlightBoxX}" y="${highlightBoxY}" width="${highlightBoxWidth}" height="${highlightBoxHeight}" rx="0" fill="${style.highlightBackground}" />
  ${
    heroImageUrls.length
      ? heroImageUrls
          .map((dataUrl, index) =>
            productImageSvg(
              dataUrl,
              index === 0 ? 42 : 596,
              imageTop + 18,
              562,
              imageHeight - 24,
              "cover",
              productEffect
            )
          )
          .join("\n  ")
      : `<rect x="0" y="${imageTop}" width="${width}" height="${imageHeight}" fill="#f4f4f4" />
  <text x="600" y="${imageTop + imageHeight / 2}" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(selectedFontFamily)}" font-size="34" font-weight="800" fill="#777777">PRODUCT IMAGE</text>`
  }
  ${
    oldPriceText
      ? `<text x="${priceBlockX + 8}" y="${oldPriceY}" text-anchor="start" dominant-baseline="middle" font-family="${escapeXml(selectedFontFamily)}" font-size="${oldPrice.fontSize}" font-weight="800" fill="#ffffff">기존가</text>
  <text x="${oldPriceX}" y="${oldPriceY}" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(selectedFontFamily)}" font-size="${oldPrice.fontSize}" font-weight="800" fill="#ffffff">${escapeXml(oldPrice.lines[0] || "")}</text>
  <line x1="${oldPriceX - 130}" y1="${oldPriceY}" x2="${oldPriceX + 130}" y2="${oldPriceY}" stroke="#ffffff" stroke-width="5" />`
      : ""
  }
  <rect x="${priceBlockX}" y="${priceBlockY + 78}" width="${dealBadgeWidth}" height="${dealBadgeHeight}" rx="10" fill="${style.priceColor}" />
  <text x="${priceBlockX + dealBadgeWidth / 2}" y="${priceBlockY + 99}" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(selectedFontFamily)}" font-size="26" font-weight="900" fill="#ffffff">파격특가</text>
  ${hasPrice ? `<text x="${salePriceX}" y="${salePriceY}" text-anchor="start" dominant-baseline="middle" font-family="${escapeXml(headlineFontFamily)}" font-size="${salePrice.fontSize}" font-weight="900" fill="#fff238" stroke="#111111" stroke-width="7" paint-order="stroke fill">${escapeXml(salePrice.lines[0] || "")}</text>` : ""}
  <rect x="0" y="${bottomBarY}" width="${width}" height="${bottomBarHeight}" fill="${style.bottomBarColor}" />
  ${hasCta ? `<rect x="0" y="${ctaY}" width="${width}" height="${ctaHeight}" rx="0" fill="${style.ctaBarColor}" />` : ""}
  ${textSvg(textLines, selectedFontFamily)}
  ${hasCta ? `<text x="1132" y="${ctaY + ctaHeight / 2}" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(selectedFontFamily)}" font-size="68" font-weight="700" fill="${style.ctaTextColor}">›</text>` : ""}
  ${logoOverlaySvg(logoImageDataUrl, { x: width - 168, y: 42, size: 126 })}
  ${aiDisclosureSvg(body.aiDisclosure, selectedFontFamily, width, height)}
</svg>`;

  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `generated-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
  const outputPath = path.join(outputDir, fileName);
  await sharp(Buffer.from(svg)).png().resize(1200, 1200).toFile(outputPath);

  return `/generated-ads/${fileName}`;
}

async function renderFoodCategoryTemplate(body: RenderBody, templateId: string) {
  const width = body.canvasSize?.width || 1200;
  const height = body.canvasSize?.height || 1200;
  const template = templatesById.get(templateId) ?? templatesById.get("food-template-001");
  if (!template) return renderFoodImpactHero({ ...body, templateId: foodImpactHeroTemplate.id });

  const copy = body.copy ?? {};
  const templateStyle = template.style as Record<string, string | number | boolean>;
  const styleOverrides = body.style ?? {};
  const style = { ...foodImpactHeroTemplate.style, ...templateStyle, ...styleOverrides };
  const styleRecord = style as Record<string, unknown>;
  const type = { ...foodImpactHeroTemplate.typography, ...template.typography };
  const headlineStyle = resolveHeadlineStyle(templateId, style as RenderStyle);
  const requestedProductImagePaths = compactRequestedProductImagePaths(body);
  const productStateSelectedPath =
    body.productImageState?.selectedImageMode &&
    body.productImageState.selectedImageMode !== "original"
      ? getSelectedProductImagePath(body.productImageState)
      : "";
  const selectedProductImagePath =
    requestedProductImagePaths[0] ||
    productStateSelectedPath ||
    body.productImagePath ||
    body.productImageState?.originalImagePath ||
    "";
  const originalProductImagePath =
    body.productImageState?.originalImagePath || body.productImagePath || selectedProductImagePath;
  const isCutoutProductSelected = Boolean(
    body.productImageState &&
    body.productImageState.selectedImageMode !== "original" &&
    selectedProductImagePath
  );
  const productEffect = resolveProductEffect(
    selectedProductImagePath,
    body.productEffect,
    (template as { productEffect?: Partial<ProductImageRenderEffect> }).productEffect
  );
  const productImageDataUrls = await Promise.all(
    requestedProductImagePaths.map((imagePath) => imageToDataUrl(imagePath).catch(() => ""))
  );
  const productImageDataUrl =
    productImageDataUrls[0] ||
    (await imageToDataUrl(selectedProductImagePath || "").catch(() => ""));
  const secondaryProductImageDataUrl =
    productImageDataUrls[1] ||
    (await imageToDataUrl(body.secondaryProductImagePath || selectedProductImagePath || "").catch(
      () => productImageDataUrl
    ));
  const templateProductImages = (
    productImageDataUrls.length ? productImageDataUrls : [productImageDataUrl]
  ).filter(Boolean);
  const backgroundMode =
    templateId === "food-template-005"
      ? body.backgroundMode === "none"
        ? "auto-detail-blur-dark"
        : body.backgroundMode || "auto-detail-blur-dark"
      : body.backgroundMode || "none";
  const backgroundSource =
    backgroundMode === "selected-detail-blur-dark"
      ? body.selectedBackgroundSource || selectedProductImagePath || ""
      : backgroundMode === "auto-detail-blur-dark"
        ? body.selectedBackgroundSource || selectedProductImagePath || ""
        : "";
  const backgroundImageDataUrl = backgroundSource
    ? await imageToDataUrl(backgroundSource).catch(() => "")
    : "";
  const rawLogoImageDataUrl = body.logoImagePath
    ? await imageToDataUrl(body.logoImagePath).catch(() => "")
    : "";
  const selectedFontFile = resolveOptionalFontFile(styleOverrides.selectedFontFile);
  const selectedFontFormat = fontFormatFromFile(selectedFontFile);
  const headlineFontFile = resolveOptionalFontFile(
    styleOverrides.headlineFontFile || styleOverrides.selectedFontFile
  );
  const headlineFontFormat = fontFormatFromFile(headlineFontFile);
  const selectedFontFileUrl = fontFileToFileUrl(selectedFontFile);
  const headlineFontFileUrl = fontFileToFileUrl(headlineFontFile);
  const selectedFontWeight = Number(style.selectedFontWeight ?? style.bodyFontWeight ?? 800);
  const bodyFontWeight = Number(style.bodyFontWeight ?? 800);
  const headlineFontFaceWeight = Number(
    style.headlineFontWeight ?? headlineStyle.fontWeight ?? 900
  );
  const fontFamily = `AdAtlasSelectedFont, ${String(style.fontFamily || foodImpactHeroTemplate.style.fontFamily)}`;
  const headlineFontFamily = `AdAtlasHeadlineFont, ${String(
    style.headlineFontFamily || headlineStyle.fontFamily
  )
    .replaceAll("AdAtlasSelectedFont", "")
    .replaceAll("AdAtlasHeadlineFont", "")}`;
  const hasCta = Boolean(copy.cta?.trim());
  const hasPrice = Boolean(copy.price?.trim());
  const globalLogoOverlay =
    templateId === "food-template-001" || templateId === "food-template-002"
      ? ""
      : logoOverlaySvg(
          await adaptiveLogoDataUrl({
            logoImageDataUrl: rawLogoImageDataUrl,
            surfaceDataUrl: backgroundImageDataUrl || productImageDataUrl,
            x: 1012,
            y: 38,
            size: 136,
            fallbackTone: backgroundImageDataUrl ? "dark" : "light",
          }),
          { x: 1012, y: 38, size: 136 }
        );
  const logoImageDataUrl = await adaptiveLogoDataUrl({
    logoImageDataUrl: rawLogoImageDataUrl,
    surfaceDataUrl: backgroundImageDataUrl || productImageDataUrl,
    x: 1012,
    y: 38,
    size: 136,
    fallbackTone: templateId === "food-template-002" ? "dark" : "light",
  });

  const h = fitLines(copy.headline || "", {
    maxWidth: 1040,
    maxLines: 2,
    initialSize: Number(styleOverrides.headlineFontSize ?? type.headlineFontSize),
    minSize: 22,
    letterSpacing: headlineStyle.letterSpacing,
  });
  const b = fitLines(copy.bodyCopy || "", {
    maxWidth: 980,
    maxLines: 3,
    initialSize: Number(styleOverrides.bodyFontSize ?? type.bodyFontSize),
    minSize: 18,
    allowBelowMin: false,
  });
  const hi = fitLines(copy.highlightCopy || "", {
    maxWidth: 960,
    maxLines: templateId === "food-template-001" ? 2 : 1,
    initialSize: type.highlightFontSize,
    minSize: 16,
  });
  const bot = fitLines(copy.bottomBarCopy || "", {
    maxWidth: 1020,
    maxLines: 2,
    initialSize: type.bottomBarFontSize,
    minSize: 18,
  });
  const price = fitLines(copy.price || "", {
    maxWidth: 430,
    maxLines: 1,
    initialSize: templateId === "food-template-002" ? 76 : 54,
    minSize: 24,
  });
  const textLines: TextLine[] = [];

  const image = (x: number, y: number, w: number, h: number, mode: "meet" | "cover" = "meet") =>
    productImageDataUrl
      ? productImageSvg(productImageDataUrl, x, y, w, h, mode, productEffect)
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#ffffff" opacity="0.7" />`;

  const secondaryImage = (
    x: number,
    y: number,
    w: number,
    h: number,
    mode: "meet" | "cover" = "meet"
  ) =>
    secondaryProductImageDataUrl
      ? productImageSvg(secondaryProductImageDataUrl, x, y, w, h, mode, productEffect)
      : image(x, y, w, h, mode);

  const imageFromDataUrl = (
    dataUrl: string,
    x: number,
    y: number,
    w: number,
    h: number,
    mode: "meet" | "cover" = "meet"
  ) =>
    dataUrl
      ? productImageSvg(dataUrl, x, y, w, h, mode, productEffect)
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#ffffff" opacity="0.7" />`;

  let shapes = "";
  let backgroundLayer = `<rect width="${width}" height="${height}" fill="${style.backgroundColor}" />`;
  let backgroundBlurDef = `<filter id="backgroundBlur" x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="9" edgeMode="duplicate"/></filter>`;
  if (backgroundImageDataUrl) {
    const forceLegacyFoodBackdrop =
      templateId === "food-template-005" &&
      body.backgroundComposition?.sourceType !== "library" &&
      body.backgroundComposition?.sourceType !== "site";
    const blur = forceLegacyFoodBackdrop ? 12 : selectedBackgroundBlur(body);
    const dim = forceLegacyFoodBackdrop ? 0.58 : selectedBackgroundOverlay(body);
    backgroundBlurDef = `<filter id="backgroundBlur" x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="${blur}" edgeMode="duplicate"/></filter>`;
    backgroundLayer = `<image href="${backgroundImageDataUrl}" x="-60" y="-60" width="1320" height="1320" preserveAspectRatio="xMidYMid slice" filter="url(#backgroundBlur)" opacity="0.95" />
  <rect width="${width}" height="${height}" fill="#000000" opacity="${dim}" />`;
  }
  const selectedBackgroundLayer = backgroundLayer;
  const hasSelectedBackgroundLayer = Boolean(backgroundImageDataUrl);

  if (templateId === "food-template-001") {
    const selectedImages = templateProductImages.length
      ? templateProductImages.slice(0, 4)
      : [productImageDataUrl].filter(Boolean);
    const frames = getFoodTemplate001ImageFrames(selectedImages.length || 1);
    const compositionFrame = compositionProductFrame(body, {
      width: 570,
      height: 650,
      top: 238,
      bottomTop: 350,
    });
    const headlineAccentPhrase = inferSplitMeatDealHeadlineAccents(
      copy.headline || "",
      String(styleRecord.accentPhrase || "")
    );
    const headline = fitLines(copy.headline || "이 가격에 이런 구성이라니!", {
      maxWidth: 1160,
      maxLines: 2,
      initialSize: Number(styleOverrides.headlineFontSize ?? 66),
      minSize: 34,
      letterSpacing: -4,
      lineHeight: 0.98,
      boxHeight: 164,
      slot: "headline",
    });
    const productName = fitLines(copy.bodyCopy || "국내산 설록우 찰진 등심", {
      maxWidth: 500,
      maxLines: 1,
      initialSize: Number(styleOverrides.bodyFontSize ?? 31),
      minSize: 22,
      boxHeight: 48,
      slot: "bodyCopy",
    });
    const badge = fitLines(copy.highlightCopy || "파격특가", {
      maxWidth: 140,
      maxLines: 1,
      initialSize: 23,
      minSize: 18,
      boxHeight: 54,
      slot: "highlightCopy",
    });
    const oldPriceText = (body.productOriginalPrice || body.productOldPrice || "").trim();
    const oldPrice = oldPriceText
      ? fitLines(oldPriceText, {
          maxWidth: 230,
          maxLines: 1,
          initialSize: 31,
          minSize: 24,
          boxHeight: 54,
          slot: "bottomBarCopy",
        })
      : null;
    const salePrice = fitLines(copy.price || "", {
      maxWidth: 350,
      maxLines: 1,
      initialSize: 56,
      minSize: 36,
      boxHeight: 88,
      slot: "price",
    });
    const headlineStep = headline.fontSize * 0.92;
    const headlineFirstY = 84 + (2 - headline.lines.length) * 12;

    backgroundLayer = hasSelectedBackgroundLayer
      ? selectedBackgroundLayer
      : `<rect width="1200" height="1200" fill="#100c09" />`;

    shapes += hasSelectedBackgroundLayer
      ? imageFromDataUrl(
          selectedImages[0] || productImageDataUrl,
          compositionFrame.x,
          compositionFrame.y,
          compositionFrame.width,
          compositionFrame.height,
          "meet"
        )
      : frames
          .map((frame, index) => {
            const imageDataUrl = selectedImages[index] || selectedImages[0] || productImageDataUrl;
            return imageFromDataUrl(
              imageDataUrl,
              frame.x,
              frame.y,
              frame.width,
              frame.height,
              frame.mode
            );
          })
          .join("");

    const productNameBoxWidth = Math.min(
      560,
      Math.max(330, estimateWidth(productName.lines[0] || "", productName.fontSize) + 34)
    );
    const oldPriceWidth = oldPrice?.lines[0]
      ? estimateWidth(oldPrice.lines[0], oldPrice.fontSize)
      : 0;

    shapes += `<rect width="1200" height="1200" fill="url(#foodTemplate1Shade)" />
      ${!hasSelectedBackgroundLayer && frames.length === 2 ? `<line x1="600" y1="0" x2="600" y2="1200" stroke="#050505" stroke-width="8" opacity="0.55" />` : ""}
      ${!hasSelectedBackgroundLayer && frames.length === 3 ? `<line x1="0" y1="600" x2="1200" y2="600" stroke="#050505" stroke-width="8" opacity="0.55" /><line x1="600" y1="600" x2="600" y2="1200" stroke="#050505" stroke-width="8" opacity="0.55" />` : ""}
      ${!hasSelectedBackgroundLayer && frames.length === 4 ? `<line x1="600" y1="0" x2="600" y2="1200" stroke="#050505" stroke-width="8" opacity="0.55" /><line x1="0" y1="600" x2="1200" y2="600" stroke="#050505" stroke-width="8" opacity="0.55" />` : ""}
      ${logoImageDataUrl ? `<image href="${logoImageDataUrl}" x="1012" y="42" width="134" height="134" preserveAspectRatio="xMidYMid meet" />` : ""}
      <rect x="16" y="800" width="${productNameBoxWidth}" height="48" rx="4" fill="#060606" opacity="0.94" />
      <rect x="16" y="894" width="132" height="40" rx="4" fill="#ff1f1f" />
      ${salePrice.lines[0] ? `<text x="158" y="907" text-anchor="start" dominant-baseline="middle" font-family="${escapeXml(headlineFontFamily)}" font-size="${salePrice.fontSize}" font-weight="900" fill="#fff238" stroke="#111111" stroke-width="5" paint-order="stroke fill">${escapeXml(salePrice.lines[0])}</text>` : ""}`;

    headline.lines.forEach((line, index) => {
      shapes += mixedTextSvg({
        text: line,
        x: 600,
        y: headlineFirstY + index * headlineStep,
        fontSize: headline.fontSize,
        defaultFill: "#ffffff",
        accentFill: "#fff238",
        accentPhrase: headlineAccentPhrase,
        fontWeight: 900,
        anchor: "middle",
        fontFamily: headlineFontFamily,
        letterSpacing: -3,
        strokeColor: "#111111",
        strokeWidth: 6,
      });
    });
    textLines.push(
      ...lineText(productName.lines, {
        x: 26,
        startY: 831,
        fontSize: productName.fontSize,
        lineHeight: 1,
        fill: "#ffffff",
        weight: 900,
      }).map((line) => ({ ...line, anchor: "start" as const, fontFamily }))
    );
    if (oldPrice?.lines[0]) {
      textLines.push({
        text: "기존가",
        x: 18,
        y: 878,
        fontSize: 24,
        fill: "#ffffff",
        weight: 700,
        anchor: "start",
        fontFamily,
      });
    }
    textLines.push(
      ...centeredLineText(badge.lines, {
        x: 82,
        centerY: 915,
        fontSize: badge.fontSize,
        lineHeight: 1,
        fill: "#ffffff",
        weight: 900,
      })
    );
    if (oldPrice?.lines[0]) {
      textLines.push({
        text: oldPrice.lines[0],
        x: 112,
        y: 878,
        fontSize: oldPrice.fontSize,
        fill: "rgba(255,255,255,0.86)",
        weight: 700,
        anchor: "start",
        fontFamily,
      });
      shapes += `<line x1="110" y1="868" x2="${Math.min(390, 110 + oldPriceWidth)}" y2="868" stroke="rgba(255,255,255,0.9)" stroke-width="4" />`;
    }
  } else if (templateId === "food-template-002") {
    const accentPhrase =
      String(styleRecord.accentPhrase || "").trim() || inferAccentPhraseFromCopy(copy);
    const accentColor = String(styleRecord.accentColor || "#fff200");
    const template2BackgroundSource =
      body.selectedBackgroundSource ||
      (body.backgroundMode === "selected-detail-blur-dark" ? body.selectedBackgroundSource : "") ||
      originalProductImagePath ||
      selectedProductImagePath ||
      "";
    const template2BackgroundDataUrl =
      backgroundImageDataUrl ||
      (template2BackgroundSource
        ? await imageToDataUrl(template2BackgroundSource).catch(() => "")
        : "");
    const backgroundDataUrl = template2BackgroundDataUrl || productImageDataUrl;
    const backgroundScale = Math.min(1.25, Math.max(1, Number(body.backgroundStyle?.scale ?? 1)));
    const backgroundRenderSize = 1200 * backgroundScale;
    const backgroundOffsetX =
      (backgroundRenderSize - 1200) / -2 +
      Math.max(-220, Math.min(220, Number(body.backgroundStyle?.offsetX || 0)));
    const backgroundOffsetY =
      (backgroundRenderSize - 1200) / -2 +
      Math.max(-220, Math.min(220, Number(body.backgroundStyle?.offsetY || 0)));
    const backgroundTransform = body.backgroundStyle?.flipHorizontal
      ? 'transform="translate(1200 0) scale(-1 1)"'
      : "";
    const backgroundBlur = selectedBackgroundBlur(body);
    const backgroundDim = selectedBackgroundOverlay(body);
    const hasBackgroundBlur = backgroundBlur > 0;
    backgroundBlurDef = `<filter id="backgroundBlur" x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="${backgroundBlur}" edgeMode="duplicate"/></filter>`;
    const reviewTop = fitLines(copy.headline || "한 입 먹자마자 입안에서 육즙 폭발해요", {
      maxWidth: 760,
      maxLines: 1,
      initialSize: 32,
      minSize: 16,
      boxHeight: 54,
      slot: "bodyCopy",
    });
    const reviewBottom = fitLines(copy.bodyCopy || "아웃백 갈 돈으로 집에서 등심 1kg 먹습니다", {
      maxWidth: 760,
      maxLines: 1,
      initialSize: 31,
      minSize: 16,
      boxHeight: 54,
      slot: "bodyCopy",
    });
    const main = fitLines(copy.highlightCopy || copy.headline || "", {
      maxWidth: 1100,
      maxLines: 2,
      initialSize: 122,
      minSize: 58,
      letterSpacing: -5,
      boxHeight: 230,
      slot: "highlightCopy",
    });
    const oldPriceSource = [
      (copy as Record<string, unknown>).oldPrice,
      (copy as Record<string, unknown>).originalPrice,
      (copy as Record<string, unknown>).compareAtPrice,
      copy.bottomBarCopy?.match(/[\d,]+\s*원/)?.[0],
    ].find((value) => typeof value === "string" && value.trim()) as string | undefined;
    const oldPrice =
      oldPriceSource && oldPriceSource !== copy.price
        ? fitLines(oldPriceSource, { maxWidth: 280, maxLines: 1, initialSize: 48, minSize: 28 })
        : null;
    const priceText = price.lines[0] || "";
    const weightText =
      /\b\d+(?:\.\d+)?\s*(?:kg|KG|Kg|g)\b/.exec(
        [copy.headline, copy.bodyCopy, copy.highlightCopy, copy.bottomBarCopy].join(" ")
      )?.[0] || "";
    const priceGroupWidth = oldPrice ? 720 : 520;
    const priceStartX = 600 - priceGroupWidth / 2;
    const reviewTopBox = {
      x: 62,
      y: 108,
      width: Math.min(
        860,
        Math.max(520, (reviewTop.lines[0] || "").length * reviewTop.fontSize * 0.82 + 48)
      ),
      height: 62,
    };
    const reviewBottomBox = {
      x: 116,
      y: 168,
      width: Math.min(
        900,
        Math.max(560, (reviewBottom.lines[0] || "").length * reviewBottom.fontSize * 0.82 + 48)
      ),
      height: 62,
    };

    backgroundLayer = backgroundDataUrl
      ? `<image href="${backgroundDataUrl}" x="${backgroundOffsetX}" y="${backgroundOffsetY}" width="${backgroundRenderSize}" height="${backgroundRenderSize}" preserveAspectRatio="xMidYMid slice" ${backgroundTransform} ${hasBackgroundBlur ? `filter="url(#backgroundBlur)"` : ""} />
        <rect width="1200" height="1200" fill="${escapeXml(body.backgroundStyle?.overlayColor || "#000000")}" opacity="${Math.max(0.04, backgroundDim * 0.42)}" />
        <rect width="1200" height="1200" fill="url(#foodTemplate2Shade)" />`
      : `<rect width="1200" height="1200" fill="#1b1712" />
        <rect width="1200" height="1200" fill="#000000" opacity="0.38" />`;

    shapes += `<rect x="${reviewTopBox.x}" y="${reviewTopBox.y}" width="${reviewTopBox.width}" height="${reviewTopBox.height}" fill="#ffffff" stroke="#e60000" stroke-width="4" />
      <rect x="${reviewBottomBox.x}" y="${reviewBottomBox.y}" width="${reviewBottomBox.width}" height="${reviewBottomBox.height}" fill="#ffffff" stroke="#e60000" stroke-width="4" />
      ${logoImageDataUrl ? `<image href="${logoImageDataUrl}" x="1012" y="38" width="136" height="136" preserveAspectRatio="xMidYMid meet" />` : ""}
      ${isCutoutProductSelected && productImageDataUrl ? productImageSvg(productImageDataUrl, 210, 275, 780, 420, "meet", productEffect) : ""}
      ${
        oldPrice
          ? `<text x="${priceStartX}" y="780" text-anchor="start" dominant-baseline="middle" font-family="${escapeXml(fontFamily)}" font-size="${oldPrice.fontSize}" font-weight="500" fill="rgba(255,255,255,0.82)">${escapeXml(oldPrice.lines[0] || "")}</text>
      <line x1="${priceStartX - 6}" y1="780" x2="${priceStartX + 260}" y2="780" stroke="rgba(255,255,255,0.88)" stroke-width="5" />`
          : ""
      }
      ${hasPrice ? `<text x="${oldPrice ? priceStartX + 294 : 600}" y="780" text-anchor="${oldPrice ? "start" : "middle"}" dominant-baseline="middle" font-family="${escapeXml(headlineFontFamily)}" font-size="${Math.max(76, price.fontSize)}" font-weight="900" fill="#e60000" stroke="#ffffff" stroke-width="10" paint-order="stroke fill">${escapeXml(priceText)}</text>` : ""}
      ${weightText ? `<text x="${oldPrice ? priceStartX + 620 : 840}" y="784" text-anchor="start" dominant-baseline="middle" font-family="${escapeXml(fontFamily)}" font-size="42" font-weight="700" fill="#ffffff">${escapeXml(`(${weightText})`)}</text>` : ""}`;

    shapes += mixedTextSvg({
      text: reviewTop.lines[0] || "",
      x: reviewTopBox.x + 22,
      y: reviewTopBox.y + reviewTop.fontSize + 16,
      anchor: "start",
      fontFamily,
      fontSize: reviewTop.fontSize,
      fontWeight: 800,
      defaultFill: "#111111",
      accentFill: accentColor,
      accentPhrase,
    });
    shapes += mixedTextSvg({
      text: reviewBottom.lines[0] || "",
      x: reviewBottomBox.x + 22,
      y: reviewBottomBox.y + reviewBottom.fontSize + 16,
      anchor: "start",
      fontFamily,
      fontSize: reviewBottom.fontSize,
      fontWeight: 800,
      defaultFill: "#111111",
      accentFill: accentColor,
      accentPhrase,
    });
    const mainStep = main.fontSize * 0.95;
    const mainFirstY = 1004 - ((main.lines.length - 1) * mainStep) / 2;
    main.lines.forEach((line, index) => {
      shapes += mixedTextSvg({
        text: line,
        x: 600,
        y: mainFirstY + index * mainStep,
        anchor: "middle",
        dominantBaseline: "middle",
        fontFamily: headlineFontFamily,
        fontSize: main.fontSize,
        fontWeight: 900,
        defaultFill: index === 0 ? "#ffffff" : "#e60000",
        accentFill: accentColor,
        accentPhrase,
        letterSpacing: -5,
        strokeColor: index === 0 ? "rgba(0,0,0,0.75)" : "#ffffff",
        strokeWidth: index === 0 ? 5 : 10,
      });
    });
  } else if (templateId === "food-template-003") {
    const leftTitle = h.lines[0] || copy.headline || "PR pick";
    const rightTitle = h.lines[1] || copy.highlightCopy || "Social pick";
    const leftBody = fitLines(copy.bodyCopy || "", {
      maxWidth: 380,
      maxLines: 7,
      initialSize: Math.min(30, b.fontSize),
      minSize: 16,
    });
    const rightBody = fitLines(copy.highlightCopy || "", {
      maxWidth: 380,
      maxLines: 4,
      initialSize: Math.min(34, hi.fontSize),
      minSize: 18,
    });
    shapes += `<rect width="1200" height="1200" fill="#ffffff" opacity="${hasSelectedBackgroundLayer ? "0.88" : "1"}" />
      <line x1="600" y1="112" x2="600" y2="1088" stroke="#111111" stroke-width="4" />
      ${image(150, 214, 300, 280)}
      ${image(750, 214, 300, 280)}
      <text x="900" y="312" text-anchor="middle" font-family="${escapeXml(fontFamily)}" font-size="46" font-weight="800" fill="#ff595e">♥  ✦  🍀</text>`;
    textLines.push({
      text: leftTitle,
      x: 300,
      y: 142,
      fontSize: 44,
      fill: "#111111",
      weight: 900,
      fontFamily: headlineFontFamily,
    });
    textLines.push({
      text: rightTitle,
      x: 900,
      y: 142,
      fontSize: 44,
      fill: "#111111",
      weight: 900,
      fontFamily: headlineFontFamily,
    });
    textLines.push(
      ...lineText(leftBody.lines, {
        x: 300,
        startY: 560,
        fontSize: leftBody.fontSize,
        lineHeight: 1.34,
        fill: "#111111",
        weight: Math.min(bodyFontWeight, 700),
      })
    );
    textLines.push(
      ...centeredLineText(rightBody.lines, {
        x: 900,
        centerY: 646,
        fontSize: rightBody.fontSize,
        lineHeight: 1.28,
        fill: "#111111",
        weight: Math.max(bodyFontWeight, 800),
      })
    );
    textLines.push(
      ...centeredLineText(bot.lines, {
        x: 600,
        centerY: 1116,
        fontSize: 34,
        lineHeight: 1.1,
        fill: "#111111",
        weight: 800,
      })
    );
  } else if (templateId === "food-template-004") {
    backgroundLayer = hasSelectedBackgroundLayer
      ? selectedBackgroundLayer
      : productImageDataUrl
        ? `<image href="${productImageDataUrl}" x="0" y="0" width="1200" height="780" preserveAspectRatio="xMidYMid slice" />
        <rect width="1200" height="780" fill="#000000" opacity="0.18" />`
        : `<rect width="1200" height="780" fill="#dfc8a5" />`;
    const centerProductImage = productImageDataUrl
      ? `<rect x="504" y="418" width="330" height="250" rx="20" fill="#ffffff" opacity="0.92" />
      <rect x="504" y="418" width="330" height="250" rx="20" fill="none" stroke="#ffffff" stroke-width="8" opacity="0.92" />
      ${productImageSvg(productImageDataUrl, 520, 434, 298, 218, "cover", productEffect)}
      <rect x="504" y="418" width="330" height="250" rx="20" fill="none" stroke="rgba(17,24,39,0.34)" stroke-width="3" />`
      : "";
    const priceBadge = fitLines(hasPrice ? `${price.lines[0]} 인기` : "월 평균 판매량 1000개", {
      maxWidth: 300,
      maxLines: 1,
      initialSize: 36,
      minSize: 24,
      boxHeight: 64,
      slot: "price",
    });
    const priceBadgeText = priceBadge.lines[0] || "";
    const priceBadgeFontSize = priceBadge.fontSize;
    const priceBadgeWidth = Math.min(
      360,
      Math.max(190, estimateWidth(priceBadgeText, priceBadgeFontSize) + 54)
    );
    const priceBadgeHeight = Math.max(62, priceBadgeFontSize + 28);
    const priceBadgeX = 1130 - priceBadgeWidth;
    const priceBadgeY = 758;
    const priceBadgeCenterX = priceBadgeX + priceBadgeWidth / 2;
    const priceBadgeCenterY = priceBadgeY + priceBadgeHeight / 2;
    shapes += `<rect x="96" y="80" width="440" height="72" rx="36" fill="#30240d" opacity="0.95" />
      <ellipse cx="876" cy="314" rx="210" ry="82" fill="#ffffff" stroke="#111111" stroke-width="3" />
      <ellipse cx="272" cy="612" rx="220" ry="86" fill="#ffffff" stroke="#111111" stroke-width="3" />
      ${centerProductImage}
      <rect x="0" y="780" width="1200" height="420" fill="#241a0d" />
      <rect x="${priceBadgeX}" y="${priceBadgeY}" width="${priceBadgeWidth}" height="${priceBadgeHeight}" rx="${priceBadgeHeight / 2}" fill="#ff3939" stroke="#ffffff" stroke-width="4" />`;
    textLines.push(
      ...centeredLineText(hi.lines, {
        x: 316,
        centerY: 116,
        fontSize: Math.min(hi.fontSize, 30),
        lineHeight: 1,
        fill: "#ffffff",
        weight: 800,
      })
    );
    textLines.push(
      ...lineText(h.lines, {
        x: 96,
        startY: 248,
        fontSize: h.fontSize,
        lineHeight: 1.02,
        fill: "#ffffff",
        weight: 900,
        letterSpacing: -2,
      }).map((line) => ({
        ...line,
        anchor: "start" as const,
        fontFamily: headlineFontFamily,
        stroke: true,
        strokeColor: "rgba(0,0,0,0.55)",
        strokeWidth: 3,
      }))
    );
    textLines.push(
      ...centeredLineText(b.lines.slice(0, 2), {
        x: 876,
        centerY: 314,
        fontSize: Math.min(b.fontSize, 28),
        lineHeight: 1.16,
        fill: "#111111",
        weight: 700,
      })
    );
    textLines.push(
      ...centeredLineText(bot.lines, {
        x: 272,
        centerY: 612,
        fontSize: Math.min(bot.fontSize, 30),
        lineHeight: 1.12,
        fill: "#111111",
        weight: 800,
      })
    );
    textLines.push({
      text: priceBadgeText,
      x: priceBadgeCenterX,
      y: priceBadgeCenterY,
      fontSize: priceBadgeFontSize,
      fill: "#ffffff",
      weight: 900,
      dominantBaseline: "middle",
    });
    textLines.push({
      text: "평점 4.95  ★★★★★",
      x: 84,
      y: 854,
      fontSize: 35,
      fill: "#ffe762",
      weight: 900,
      anchor: "start",
    });
    textLines.push({
      text: `● ${copy.bodyCopy || "한 번 먹으면 계속 찾는 구성"}`.slice(0, 44),
      x: 84,
      y: 926,
      fontSize: 27,
      fill: "#ffffff",
      weight: 700,
      anchor: "start",
    });
    textLines.push({
      text: `● ${copy.highlightCopy || "선물용으로도 반응 좋은 구성"}`.slice(0, 44),
      x: 84,
      y: 990,
      fontSize: 27,
      fill: "#ffffff",
      weight: 700,
      anchor: "start",
    });
    textLines.push({
      text: `● ${copy.bottomBarCopy || "지금 구성 놓치면 아쉬움"}`.slice(0, 44),
      x: 84,
      y: 1054,
      fontSize: 27,
      fill: "#ffffff",
      weight: 700,
      anchor: "start",
    });
  } else if (templateId === "food-template-005") {
    shapes += `<rect x="0" y="0" width="1200" height="1200" fill="#050505" opacity="0.18" />
      <rect x="66" y="66" width="1068" height="1068" rx="0" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2" />
      ${image(142, 660, 284, 300, "cover")}
      ${image(458, 660, 284, 300, "cover")}
      ${image(774, 660, 284, 300, "cover")}
      ${hasPrice ? `<text x="600" y="1080" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(headlineFontFamily)}" font-size="${Math.max(86, price.fontSize)}" font-weight="900" fill="${style.priceColor}" stroke="#ffffff" stroke-width="12" paint-order="stroke fill">${escapeXml(price.lines[0] || "")}</text>` : ""}
      <text x="600" y="956" text-anchor="middle" font-family="${escapeXml(fontFamily)}" font-size="28" font-weight="800" fill="#ffffff">AI 활용 콘텐츠이며, 가상 인물을 포함할 수 있습니다</text>`;
    textLines.push(
      ...centeredLineText([h.lines[0] || ""], {
        x: 600,
        centerY: 226,
        fontSize: Math.min(h.fontSize, 82),
        lineHeight: 1,
        fill: "#ff1f1f",
        weight: 900,
        letterSpacing: -3,
      }).map((line) => ({
        ...line,
        fontFamily: headlineFontFamily,
        stroke: true,
        strokeColor: "#111111",
        strokeWidth: 5,
      }))
    );
    textLines.push(
      ...centeredLineText([h.lines[1] || b.lines[0] || ""].filter(Boolean), {
        x: 600,
        centerY: 352,
        fontSize: 72,
        lineHeight: 1,
        fill: "#ffffff",
        weight: 900,
        letterSpacing: -2,
      }).map((line) => ({
        ...line,
        fontFamily: headlineFontFamily,
        stroke: true,
        strokeColor: "#111111",
        strokeWidth: 5,
      }))
    );
    textLines.push(
      ...centeredLineText(hi.lines, {
        x: 600,
        centerY: 500,
        fontSize: Math.min(hi.fontSize + 18, 72),
        lineHeight: 1,
        fill: "#fff238",
        weight: 900,
        letterSpacing: -2,
      }).map((line) => ({
        ...line,
        fontFamily: headlineFontFamily,
        stroke: true,
        strokeColor: "#111111",
        strokeWidth: 4,
      }))
    );
    textLines.push(
      ...centeredLineText(bot.lines, {
        x: 600,
        centerY: 585,
        fontSize: Math.min(bot.fontSize + 8, 52),
        lineHeight: 1.05,
        fill: "#ffffff",
        weight: 900,
      }).map((line) => ({
        ...line,
        fontFamily: headlineFontFamily,
        stroke: true,
        strokeColor: "#111111",
        strokeWidth: 4,
      }))
    );
  } else if (templateId === "camping-popularity-impact") {
    const compositionFrame = compositionProductFrame(body, {
      width: 540,
      height: 570,
      top: 430,
      bottomTop: 470,
    });
    const topCopy = fitLines(copy.bodyCopy || copy.bottomBarCopy || "", {
      maxWidth: 1060,
      maxLines: 1,
      initialSize: 58,
      minSize: 34,
      boxHeight: 76,
      slot: "bodyCopy",
    });
    const mainHeadline = fitLines(copy.headline || "", {
      maxWidth: 1080,
      maxLines: 2,
      initialSize: 126,
      minSize: 58,
      letterSpacing: -4,
      lineHeight: 0.94,
      boxHeight: 180,
      slot: "headline",
    });
    const productNameLine = fitLines(
      body.productOriginalPrice
        ? copy.bodyCopy || ""
        : copy.bodyCopy || body.productOriginalPrice || copy.bottomBarCopy || "",
      {
        maxWidth: 560,
        maxLines: 1,
        initialSize: 48,
        minSize: 26,
        slot: "bodyCopy",
      }
    );
    const oldPrice = fitLines(body.productOriginalPrice || body.productOldPrice || "", {
      maxWidth: 250,
      maxLines: 1,
      initialSize: 46,
      minSize: 24,
    });
    const salePrice = fitLines(copy.price || "", {
      maxWidth: 300,
      maxLines: 1,
      initialSize: 72,
      minSize: 42,
      slot: "price",
    });
    const ctaLine = fitLines(copy.cta || copy.bottomBarCopy || "구성 보러가기 >>", {
      maxWidth: 1040,
      maxLines: 1,
      initialSize: 52,
      minSize: 30,
      slot: "cta",
    });

    shapes += `${hasSelectedBackgroundLayer ? `<rect x="0" y="0" width="1200" height="410" fill="#ffffff" opacity="0.9" />` : `<rect width="1200" height="1200" fill="#ffffff" />`}
      ${hasSelectedBackgroundLayer ? image(compositionFrame.x, compositionFrame.y, compositionFrame.width, compositionFrame.height, "meet") : image(0, 410, 1200, 640, "cover")}
      <rect x="0" y="410" width="1200" height="640" fill="url(#foodTemplate2Shade)" opacity="0.38" />
      <rect x="0" y="300" width="1200" height="116" fill="#e60000" />
      <rect x="0" y="1050" width="1200" height="150" fill="#e60000" />
      ${
        oldPrice.lines[0]
          ? `<text x="680" y="362" text-anchor="start" dominant-baseline="middle" font-family="${escapeXml(fontFamily)}" font-size="${oldPrice.fontSize}" font-weight="700" fill="rgba(255,255,255,0.76)">${escapeXml(oldPrice.lines[0])}</text>
      <line x1="672" y1="362" x2="880" y2="362" stroke="rgba(255,255,255,0.82)" stroke-width="5" />`
          : ""
      }
      ${
        salePrice.lines[0]
          ? `<text x="920" y="362" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(headlineFontFamily)}" font-size="${salePrice.fontSize}" font-weight="900" fill="#fff200">${escapeXml(salePrice.lines[0])}</text>`
          : ""
      }`;
    textLines.push(
      ...centeredLineText(topCopy.lines, {
        x: 600,
        centerY: 84,
        fontSize: topCopy.fontSize,
        lineHeight: 1,
        fill: "#111111",
        weight: 800,
        letterSpacing: -1,
      })
    );
    textLines.push(
      ...centeredLineText(mainHeadline.lines, {
        x: 600,
        centerY: 210,
        fontSize: mainHeadline.fontSize,
        lineHeight: 0.94,
        fill: "#e60000",
        weight: 900,
        letterSpacing: -4,
      }).map((line) => ({ ...line, fontFamily: headlineFontFamily }))
    );
    textLines.push(
      ...centeredLineText(productNameLine.lines, {
        x: 330,
        centerY: 362,
        fontSize: productNameLine.fontSize,
        lineHeight: 1,
        fill: "#ffffff",
        weight: 800,
      })
    );
    textLines.push(
      ...centeredLineText(ctaLine.lines, {
        x: 600,
        centerY: 1128,
        fontSize: ctaLine.fontSize,
        lineHeight: 1,
        fill: "#ffffff",
        weight: 900,
      })
    );
  } else if (templateId === "circle-focus-review") {
    const compositionFrame = compositionProductFrame(body, {
      width: 520,
      height: 560,
      top: 120,
      bottomTop: 210,
    });
    const focusCenterX = compositionFrame.x + compositionFrame.width / 2;
    const focusCenterY = compositionFrame.y + compositionFrame.height / 2;
    const reviewCopy = fitLines(copy.headline || copy.bodyCopy || "", {
      maxWidth: 1080,
      maxLines: 3,
      initialSize: 74,
      minSize: 42,
      lineHeight: 1.15,
      boxHeight: 300,
      slot: "headline",
    });
    const priceBadge = fitLines(copy.price || copy.highlightCopy || "", {
      maxWidth: 260,
      maxLines: 1,
      initialSize: 30,
      minSize: 20,
      slot: "price",
    });
    shapes += `${hasSelectedBackgroundLayer ? "" : `<rect width="1200" height="1200" fill="#ffffff" />`}
      ${hasSelectedBackgroundLayer ? image(compositionFrame.x, compositionFrame.y, compositionFrame.width, compositionFrame.height, "meet") : image(0, 0, 1200, 790, "cover")}
      <circle cx="${hasSelectedBackgroundLayer ? focusCenterX : 600}" cy="${hasSelectedBackgroundLayer ? focusCenterY : 382}" r="${hasSelectedBackgroundLayer ? 255 : 300}" fill="none" stroke="#e60000" stroke-width="7" opacity="0.96" />
      <rect x="0" y="790" width="1200" height="410" fill="#ffffff" />
      ${
        priceBadge.lines[0]
          ? `<rect x="824" y="1060" width="280" height="64" rx="32" fill="#e60000" />
      <text x="964" y="1093" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(fontFamily)}" font-size="${priceBadge.fontSize}" font-weight="900" fill="#ffffff">${escapeXml(priceBadge.lines[0])}</text>`
          : ""
      }`;
    textLines.push(
      ...centeredLineText(reviewCopy.lines, {
        x: 600,
        centerY: 992,
        fontSize: reviewCopy.fontSize,
        lineHeight: 1.16,
        fill: "#111111",
        weight: 900,
        letterSpacing: -2,
      }).map((line, index) => ({
        ...line,
        fill: index === reviewCopy.lines.length - 1 ? "#000000" : "#111111",
        fontFamily: headlineFontFamily,
      }))
    );
  } else if (templateId === "black-repeat-product") {
    const topScript = fitLines(copy.bodyCopy || copy.bottomBarCopy || "", {
      maxWidth: 1060,
      maxLines: 1,
      initialSize: 48,
      minSize: 28,
      slot: "bodyCopy",
    });
    const blackHeadline = fitLines(copy.headline || "", {
      maxWidth: 1100,
      maxLines: 2,
      initialSize: 106,
      minSize: 58,
      letterSpacing: -3,
      lineHeight: 0.98,
      boxHeight: 220,
      slot: "headline",
    });
    const infoBar = fitLines(
      [copy.highlightCopy, copy.price, copy.bottomBarCopy].filter(Boolean).join(" · "),
      {
        maxWidth: 980,
        maxLines: 2,
        initialSize: 40,
        minSize: 26,
        lineHeight: 1.1,
        boxHeight: 86,
        slot: "highlightCopy",
      }
    );
    const repeatImages = [0, 1, 2, 3].map(
      (index) =>
        templateProductImages[index] ||
        templateProductImages[index % templateProductImages.length] ||
        productImageDataUrl
    );
    shapes += `<rect width="1200" height="1200" fill="#050505" opacity="${hasSelectedBackgroundLayer ? "0.5" : "1"}" />
      <rect x="0" y="0" width="1200" height="1200" fill="url(#foodTemplate1Shade)" opacity="0.35" />
      ${repeatImages
        .map((dataUrl, index) => {
          const x = 82 + index * 260;
          const rotation = [-5, -2, 2, 5][index];
          return `<g transform="rotate(${rotation} ${x + 140} 690)">${imageFromDataUrl(dataUrl, x, 380, 280, 620, "meet")}</g>`;
        })
        .join("")}
      <rect x="50" y="1018" width="1100" height="112" rx="40" fill="#18ead8" />`;
    textLines.push(
      ...centeredLineText(topScript.lines, {
        x: 600,
        centerY: 78,
        fontSize: topScript.fontSize,
        lineHeight: 1,
        fill: "#ffffff",
        weight: 700,
      })
    );
    blackHeadline.lines.forEach((line, index) => {
      shapes += mixedTextSvg({
        text: line,
        x: 600,
        y: 174 + index * blackHeadline.fontSize * 0.98,
        anchor: "middle",
        dominantBaseline: "middle",
        fontFamily: headlineFontFamily,
        fontSize: blackHeadline.fontSize,
        fontWeight: 900,
        defaultFill: "#ffffff",
        accentFill: "#18ead8",
        accentPhrase: styleOverrides.accentPhrase || inferAccentPhraseFromCopy(copy),
        letterSpacing: -3,
      });
    });
    textLines.push(
      ...centeredLineText(infoBar.lines, {
        x: 600,
        centerY: 1074,
        fontSize: infoBar.fontSize,
        lineHeight: 1.08,
        fill: "#001111",
        weight: 900,
      })
    );
  } else if (templateId === "sports-benefit-chip") {
    backgroundLayer = hasSelectedBackgroundLayer
      ? selectedBackgroundLayer
      : secondaryProductImageDataUrl
        ? `<image href="${secondaryProductImageDataUrl}" x="-40" y="-40" width="1280" height="1280" preserveAspectRatio="xMidYMid slice" filter="url(#backgroundBlur)" />
      <rect width="1200" height="1200" fill="#000000" opacity="0.64" />`
        : backgroundLayer;
    const sportsHeadline = fitLines(copy.headline || "", {
      maxWidth: 560,
      maxLines: 5,
      initialSize: 72,
      minSize: 38,
      lineHeight: 1.06,
      boxHeight: 430,
      slot: "headline",
    });
    const chipTexts = [
      copy.highlightCopy || "핵심 성분",
      copy.bodyCopy || "체감 포인트",
      copy.bottomBarCopy || "데일리 케어",
    ];
    const ctaSmall = fitLines([copy.cta, copy.price].filter(Boolean).join(" "), {
      maxWidth: 780,
      maxLines: 1,
      initialSize: 32,
      minSize: 22,
      slot: "cta",
    });
    shapes += `<rect width="1200" height="1200" fill="#050b0f" opacity="${hasSelectedBackgroundLayer ? "0.48" : secondaryProductImageDataUrl ? "0" : "1"}" />
      <circle cx="885" cy="612" r="285" fill="#ffffff" opacity="0.16" />
      ${image(665, 270, 465, 760, "meet")}
      ${chipTexts
        .map((text, index) => {
          const y = 535 + index * 100;
          const fill = index === 1 ? "#ffffff" : "#18e6c5";
          const textFill = index === 1 ? "#111111" : "#001111";
          return `<rect x="65" y="${y}" width="520" height="74" rx="37" fill="${fill}" />
          <text x="325" y="${y + 38}" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(fontFamily)}" font-size="34" font-weight="900" fill="${textFill}">${escapeXml(text.slice(0, 18))}</text>`;
        })
        .join("")}`;
    sportsHeadline.lines.forEach((line, index) => {
      shapes += mixedTextSvg({
        text: line,
        x: 55,
        y: 112 + index * sportsHeadline.fontSize * 1.06,
        anchor: "start",
        fontFamily: headlineFontFamily,
        fontSize: sportsHeadline.fontSize,
        fontWeight: 900,
        defaultFill: "#ffffff",
        accentFill: "#18e6c5",
        accentPhrase: styleOverrides.accentPhrase || inferAccentPhraseFromCopy(copy),
        letterSpacing: -3,
        strokeColor: "rgba(0,0,0,0.5)",
        strokeWidth: 3,
      });
    });
    textLines.push(
      ...lineText(ctaSmall.lines, {
        x: 60,
        startY: 1130,
        fontSize: ctaSmall.fontSize,
        lineHeight: 1,
        fill: "#ffffff",
        weight: 800,
      }).map((line) => ({ ...line, anchor: "start" as const }))
    );
  } else if (templateId === "before-after-split-review") {
    const leftImage = backgroundImageDataUrl || secondaryProductImageDataUrl || productImageDataUrl;
    const rightHeadline = fitLines(copy.headline || "", {
      maxWidth: 500,
      maxLines: 5,
      initialSize: 66,
      minSize: 36,
      lineHeight: 1.08,
      boxHeight: 360,
      slot: "headline",
    });
    const topNote = fitLines(copy.bodyCopy || "", {
      maxWidth: 500,
      maxLines: 1,
      initialSize: 32,
      minSize: 22,
      slot: "bodyCopy",
    });
    const sideNotes = [copy.highlightCopy, copy.bottomBarCopy, copy.cta].filter(
      (note): note is string => Boolean(note)
    );
    const smallPrice = fitLines(copy.price || "", {
      maxWidth: 360,
      maxLines: 1,
      initialSize: 38,
      minSize: 24,
      slot: "price",
    });
    shapes += `<rect width="1200" height="1200" fill="#ffffff" />
      ${imageFromDataUrl(leftImage, 0, 0, 600, 1200, "cover")}
      <rect x="0" y="780" width="600" height="420" fill="url(#foodTemplate1Shade)" opacity="0.65" />
      <rect x="600" y="0" width="600" height="1200" fill="#ffffff" />
      ${image(790, 620, 310, 450, "meet")}
      ${
        smallPrice.lines[0]
          ? `<text x="900" y="1110" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(headlineFontFamily)}" font-size="${smallPrice.fontSize}" font-weight="900" fill="#00afa5">${escapeXml(smallPrice.lines[0])}</text>`
          : ""
      }`;
    textLines.push(
      ...lineText(topNote.lines, {
        x: 660,
        startY: 110,
        fontSize: topNote.fontSize,
        lineHeight: 1,
        fill: "#111111",
        weight: 700,
      }).map((line) => ({ ...line, anchor: "start" as const }))
    );
    rightHeadline.lines.forEach((line, index) => {
      shapes += mixedTextSvg({
        text: line,
        x: 660,
        y: 190 + index * rightHeadline.fontSize * 1.08,
        anchor: "start",
        fontFamily: headlineFontFamily,
        fontSize: rightHeadline.fontSize,
        fontWeight: 900,
        defaultFill: "#111111",
        accentFill: "#00afa5",
        accentPhrase: styleOverrides.accentPhrase || inferAccentPhraseFromCopy(copy),
        letterSpacing: -2,
      });
    });
    sideNotes.slice(0, 3).forEach((note, index) => {
      const x = [660, 1000, 720][index] ?? 660;
      const y = [610, 690, 1028][index] ?? 610;
      const rotation = [-4, 4, -2][index] ?? 0;
      shapes += `<text x="${x}" y="${y}" text-anchor="${index === 1 ? "end" : "start"}" transform="rotate(${rotation} ${x} ${y})" font-family="${escapeXml(fontFamily)}" font-size="32" font-weight="800" fill="#111111">${escapeXml(note.slice(0, 18))}</text>`;
    });
  } else {
    const selectedImages =
      templateProductImages.length === 1
        ? [templateProductImages[0], templateProductImages[0]]
        : templateProductImages.slice(0, 4);
    const productGrid =
      selectedImages.length <= 2
        ? `${imageFromDataUrl(selectedImages[0] || productImageDataUrl, 0, 260, 600, 600, "cover")}
      ${imageFromDataUrl(selectedImages[1] || selectedImages[0] || productImageDataUrl, 600, 204, 600, 690, "cover")}`
        : `${imageFromDataUrl(selectedImages[0] || productImageDataUrl, 0, 250, 600, 330, "cover")}
      ${imageFromDataUrl(selectedImages[1] || selectedImages[0] || productImageDataUrl, 600, 250, 600, 330, "cover")}
      ${imageFromDataUrl(selectedImages[2] || selectedImages[0] || productImageDataUrl, 0, 580, 600, 300, "cover")}
      ${selectedImages[3] ? imageFromDataUrl(selectedImages[3], 600, 580, 600, 300, "cover") : ""}`;
    backgroundLayer = hasSelectedBackgroundLayer
      ? selectedBackgroundLayer
      : `<rect width="600" height="1200" fill="#24170f" />
      <rect x="600" y="0" width="600" height="1200" fill="#16110e" />`;
    shapes += `${productGrid}
      <rect width="1200" height="1200" fill="#000000" opacity="0.22" />
      <rect x="0" y="800" width="560" height="250" fill="#070707" opacity="0.78" />
      <rect x="58" y="928" width="190" height="58" rx="10" fill="#ff1f1f" />
      ${hasPrice ? `<text x="276" y="976" text-anchor="start" font-family="${escapeXml(headlineFontFamily)}" font-size="70" font-weight="900" fill="#fff238">${escapeXml(price.lines[0] || "")}</text>` : ""}`;
    textLines.push(
      ...centeredLineText(h.lines, {
        x: 600,
        centerY: 142,
        fontSize: h.fontSize,
        lineHeight: 0.96,
        fill: "#ffffff",
        weight: 900,
        letterSpacing: -3,
      }).map((line, index) => ({
        ...line,
        fill: index === 0 ? "#fff238" : "#ffffff",
        fontFamily: headlineFontFamily,
        stroke: true,
        strokeColor: "#111111",
        strokeWidth: 5,
      }))
    );
    textLines.push(
      ...lineText(b.lines.slice(0, 1), {
        x: 50,
        startY: 848,
        fontSize: Math.min(b.fontSize, 32),
        lineHeight: 1.1,
        fill: "#ffffff",
        weight: 800,
      }).map((line) => ({ ...line, anchor: "start" as const }))
    );
    textLines.push({
      text: "기존가",
      x: 58,
      y: 902,
      fontSize: 28,
      fill: "#ffffff",
      weight: 700,
      anchor: "start",
    });
    textLines.push({
      text: "파격특가",
      x: 153,
      y: 958,
      fontSize: 28,
      fill: "#ffffff",
      weight: 900,
    });
    textLines.push(
      ...centeredLineText(hi.lines, {
        x: 600,
        centerY: 1096,
        fontSize: Math.min(hi.fontSize, 38),
        lineHeight: 1.08,
        fill: "#ffffff",
        weight: 900,
      }).map((line) => ({ ...line, stroke: true, strokeColor: "#111111", strokeWidth: 3 }))
    );
  }

  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      ${buildFontFaceCss("AdAtlasSelectedFont", selectedFontFileUrl, selectedFontFormat, selectedFontWeight)}
      ${buildFontFaceCss("AdAtlasHeadlineFont", headlineFontFileUrl, headlineFontFormat, headlineFontFaceWeight)}
      text[y="956"][font-size="28"] { display: none; }
    </style>
    ${productEffectFilterDef(productEffect)}
    ${backgroundBlurDef}
    <linearGradient id="foodTemplate2Shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0" />
      <stop offset="52%" stop-color="#000000" stop-opacity="0.04" />
      <stop offset="70%" stop-color="#000000" stop-opacity="0.42" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.88" />
    </linearGradient>
    <linearGradient id="foodTemplate1Bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#20130c" />
      <stop offset="46%" stop-color="#080604" />
      <stop offset="100%" stop-color="#120c08" />
    </linearGradient>
    <linearGradient id="foodTemplate1Shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.18" />
      <stop offset="45%" stop-color="#000000" stop-opacity="0" />
      <stop offset="68%" stop-color="#000000" stop-opacity="0.16" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0.82" />
    </linearGradient>
    <filter id="headlineShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#000000"/></filter>
  </defs>
  ${backgroundLayer}
  ${shapes}
  ${textSvg(textLines, fontFamily)}
  ${globalLogoOverlay}
  ${aiDisclosureSvg(body.aiDisclosure, fontFamily, width, height)}
</svg>`;

  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `generated-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${templateId}.png`;
  const outputPath = path.join(outputDir, fileName);
  await sharp(Buffer.from(svg)).png().resize(1200, 1200).toFile(outputPath);
  return `/generated-ads/${fileName}`;
}

async function renderOptimizedTemplate(
  body: RenderBody,
  template: BannerTemplateDefinition,
  plan: PreparedBannerRender
) {
  const styleOverrides = body.style || {};
  const selectedFontFile = resolveOptionalFontFile(styleOverrides.selectedFontFile);
  const selectedFontFormat = fontFormatFromFile(selectedFontFile);
  const headlineFontFile = resolveOptionalFontFile(
    styleOverrides.headlineFontFile || styleOverrides.selectedFontFile
  );
  const headlineFontFormat = fontFormatFromFile(headlineFontFile);
  const selectedFontFileUrl = fontFileToFileUrl(selectedFontFile);
  const headlineFontFileUrl = fontFileToFileUrl(headlineFontFile);
  const selectedFontWeight = Number(styleOverrides.selectedFontWeight || 800);
  const headlineFontWeight = Number(styleOverrides.headlineFontWeight || 900);
  const creativeTextStylePresetId =
    typeof styleOverrides.creativeTextStylePresetId === "string"
      ? styleOverrides.creativeTextStylePresetId.trim()
      : "";
  const creativeTextStylePreset = creativeTextStylePresetId
    ? getCreativeTextStylePreset(creativeTextStylePresetId)
    : undefined;
  const frameData = await Promise.all(
    plan.imageFrames.map(async (frame) => {
      try {
        return { dataUrl: await imageToDataUrl(frame.imagePath) };
      } catch {
        return { dataUrl: "" };
      }
    })
  );
  const rawLogoDataUrl = body.logoImagePath
    ? await imageToDataUrl(body.logoImagePath).catch(() => "")
    : "";
  const logoDataUrl = await adaptiveLogoDataUrl({
    logoImageDataUrl: rawLogoDataUrl,
    surfaceDataUrl: frameData[0]?.dataUrl,
    x: 1028,
    y: 40,
    size: 126,
    fallbackTone: "light",
  });
  const fontFaceCss =
    buildFontFaceCss(
      "AdAtlasSelectedFont",
      selectedFontFileUrl,
      selectedFontFormat,
      selectedFontWeight
    ) +
    buildFontFaceCss(
      "AdAtlasHeadlineFont",
      headlineFontFileUrl,
      headlineFontFormat,
      headlineFontWeight
    );
  const svg = buildOptimizedTemplateSvg({
    template,
    plan,
    productInfo: body.productInfo,
    productOriginalPrice: body.productOriginalPrice,
    productOldPrice: body.productOldPrice,
    frameData,
    logoDataUrl,
    aiDisclosureText: body.aiDisclosure?.enabled
      ? body.aiDisclosure.text || "AI 활용 콘텐츠입니다."
      : "",
    fontFaceCss,
    productEffect: optimizedProductEffect(body, template),
    textOverrides: {
      creativePreset: creativeTextStylePreset,
      fontFamily:
        typeof styleOverrides.fontFamily === "string" ? styleOverrides.fontFamily : undefined,
      headlineFontFamily:
        typeof styleOverrides.headlineFontFamily === "string"
          ? styleOverrides.headlineFontFamily
          : undefined,
      headlineFontSize:
        typeof styleOverrides.headlineFontSize === "number"
          ? styleOverrides.headlineFontSize
          : undefined,
      headlineColor:
        styleOverrides.manualTextColors && typeof styleOverrides.headlineColor === "string"
          ? styleOverrides.headlineColor
          : undefined,
      headlineFontWeight:
        typeof styleOverrides.headlineFontWeight === "number"
          ? styleOverrides.headlineFontWeight
          : undefined,
      headlineLetterSpacing:
        typeof styleOverrides.headlineLetterSpacing === "number"
          ? styleOverrides.headlineLetterSpacing
          : undefined,
      headlineLineHeight:
        typeof styleOverrides.headlineLineHeight === "number"
          ? styleOverrides.headlineLineHeight
          : undefined,
      headlineTextStroke:
        typeof styleOverrides.headlineTextStroke === "boolean"
          ? styleOverrides.headlineTextStroke
          : undefined,
      headlineTextStrokeColor:
        typeof styleOverrides.headlineTextStrokeColor === "string"
          ? styleOverrides.headlineTextStrokeColor
          : undefined,
      headlineTextStrokeWidth:
        typeof styleOverrides.headlineTextStrokeWidth === "number"
          ? styleOverrides.headlineTextStrokeWidth
          : undefined,
      headlineShadow:
        typeof styleOverrides.headlineShadow === "boolean"
          ? styleOverrides.headlineShadow
          : undefined,
      bodyColor:
        styleOverrides.manualTextColors && typeof styleOverrides.bodyColor === "string"
          ? styleOverrides.bodyColor
          : undefined,
      bodyFontSize:
        typeof styleOverrides.bodyFontSize === "number" ? styleOverrides.bodyFontSize : undefined,
      bodyFontWeight:
        typeof styleOverrides.bodyFontWeight === "number"
          ? styleOverrides.bodyFontWeight
          : undefined,
    },
    backgroundTreatment: {
      blur: body.selectedBackgroundSource ? selectedBackgroundBlur(body) : 0,
      brightness: Math.max(0.55, Math.min(1.35, Number(body.backgroundStyle?.brightness ?? 1))),
      overlayColor: body.backgroundStyle?.overlayColor || "#000000",
      overlayOpacity: Math.max(
        0,
        Math.min(0.72, Number(body.selectedBackgroundSource ? selectedBackgroundOverlay(body) : 0))
      ),
      scale: Math.max(1, Math.min(1.45, Number(body.backgroundStyle?.scale ?? 1))),
      offsetX: Math.max(-220, Math.min(220, Number(body.backgroundStyle?.offsetX ?? 0))),
      offsetY: Math.max(-220, Math.min(220, Number(body.backgroundStyle?.offsetY ?? 0))),
      flipHorizontal: body.backgroundStyle?.flipHorizontal === true,
    },
  });
  await fs.mkdir(outputDir, { recursive: true });
  const fileName =
    "generated-" +
    Date.now() +
    "-" +
    crypto.randomBytes(4).toString("hex") +
    "-" +
    template.id +
    ".png";
  const outputPath = path.join(outputDir, fileName);
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  return "/generated-ads/" + fileName;
}

async function renderAdaptiveCreative(body: RenderBody, plan: AdaptiveCreativePlan) {
  const styleOverrides = body.style || {};
  const selectedFontFile = resolveOptionalFontFile(styleOverrides.selectedFontFile);
  const headlineFontFile = resolveOptionalFontFile(
    styleOverrides.headlineFontFile || styleOverrides.selectedFontFile
  );
  const selectedFontFileUrl = fontFileToFileUrl(selectedFontFile);
  const headlineFontFileUrl = fontFileToFileUrl(headlineFontFile);
  const fontFaceCss =
    buildFontFaceCss(
      "AdAtlasBody",
      selectedFontFileUrl,
      fontFormatFromFile(selectedFontFile),
      Number(styleOverrides.selectedFontWeight || styleOverrides.bodyFontWeight || 800)
    ) +
    buildFontFaceCss(
      "AdAtlasHeadline",
      headlineFontFileUrl,
      fontFormatFromFile(headlineFontFile),
      Number(styleOverrides.headlineFontWeight || 900)
    );
  const backgroundDataUrl = await imageToDataUrl(body.selectedBackgroundSource || "");
  const productPath = compactRequestedProductImagePaths(body)[0] || "";
  const productDataUrl = productPath ? await imageToDataUrl(productPath).catch(() => "") : "";
  const rawLogoDataUrl = body.logoImagePath
    ? await imageToDataUrl(body.logoImagePath).catch(() => "")
    : "";
  const adaptiveLogoSize = 118;
  const adaptiveLogoX = plan.textPlacement.x < 600 ? 1050 : 32;
  const logoDataUrl = await adaptiveLogoDataUrl({
    logoImageDataUrl: rawLogoDataUrl,
    surfaceDataUrl: backgroundDataUrl,
    x: adaptiveLogoX,
    y: 32,
    size: adaptiveLogoSize,
    fallbackTone: plan.colorPalette.panel.toLowerCase() === "#181818" ? "dark" : "light",
  });
  const activeCopy: GeneratedAdCopyVariant = {
    headline: String(body.copy?.headline || ""),
    bodyCopy: String(body.copy?.bodyCopy || ""),
    highlightCopy: String(body.copy?.highlightCopy || ""),
    bottomBarCopy: String(body.copy?.bottomBarCopy || ""),
    cta: String(body.copy?.cta || ""),
    price: String(body.copy?.price || body.productInfo?.price || ""),
  };
  const svg = buildAdaptiveCreativeSvg({
    plan: {
      ...plan,
      backgroundAdjustments: {
        ...plan.backgroundAdjustments,
        scale: Math.max(
          1,
          Math.min(1.45, Number(body.backgroundStyle?.scale ?? plan.backgroundAdjustments.scale))
        ),
        offsetX: Math.max(
          -220,
          Math.min(220, Number(body.backgroundStyle?.offsetX ?? plan.backgroundAdjustments.offsetX))
        ),
        offsetY: Math.max(
          -220,
          Math.min(220, Number(body.backgroundStyle?.offsetY ?? plan.backgroundAdjustments.offsetY))
        ),
        blur: Math.max(
          0,
          Math.min(
            18,
            body.selectedBackgroundSource
              ? selectedBackgroundBlur(body)
              : plan.backgroundAdjustments.blur
          )
        ),
        brightness: Math.max(
          0.55,
          Math.min(
            1.35,
            Number(body.backgroundStyle?.brightness ?? plan.backgroundAdjustments.brightness)
          )
        ),
      },
    },
    copy: activeCopy,
    backgroundDataUrl,
    productDataUrl,
    logoDataUrl,
    aiDisclosureText: body.aiDisclosure?.enabled
      ? body.aiDisclosure.text || "AI 활용 콘텐츠입니다."
      : "",
    fontFaceCss,
    fontFamily:
      typeof styleOverrides.fontFamily === "string" ? styleOverrides.fontFamily : undefined,
    headlineFontFamily:
      typeof styleOverrides.headlineFontFamily === "string"
        ? styleOverrides.headlineFontFamily
        : undefined,
    productEffect: body.productEffect,
    backgroundFlipHorizontal: body.backgroundStyle?.flipHorizontal,
  });
  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `generated-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-adaptive-${plan.layoutVariant}.png`;
  const outputPath = path.join(outputDir, fileName);
  await sharp(Buffer.from(svg)).png().resize(1200, 1200).toFile(outputPath);
  const palette = {
    primaryColor: plan.colorPalette.accent,
    secondaryColor: plan.colorPalette.panel,
    accentColor: plan.colorPalette.accent,
    backgroundColor: plan.colorPalette.panel,
    surfaceColor: plan.colorPalette.panel,
    textDarkColor: plan.colorPalette.headline,
    textLightColor: plan.colorPalette.body,
    mutedColor: plan.colorPalette.body,
    highlightColor: plan.colorPalette.price,
    dangerColor: plan.colorPalette.price,
    sourceImagePath: body.selectedBackgroundSource,
    confidence: 0.9,
  };
  return {
    imagePath: `/generated-ads/${fileName}`,
    diagnostics: {
      templateId: `adaptive-${plan.layoutType}`,
      paletteApplied: true,
      palettePolicy: "full-auto",
      palette,
      selectedVariant: body.selectedVariant || "base",
      variantReason: "선택한 배경의 안전 영역과 시각적 위계에 맞춘 적응형 레이아웃입니다.",
      fitResults: [],
      collisionResult: {
        hasCollision: false,
        collisions: [],
        actions: [],
        finalItems: [],
        warnings: [],
      },
      imagePathsUsed: [body.selectedBackgroundSource, productPath].filter(Boolean),
      hiddenElements: [],
      optimizationFlags: {
        autoPaletteApplied: true,
        textFittingApplied: true,
        collisionResolved: true,
        lowPriorityElementsHidden: false,
      },
      warnings: productDataUrl ? [] : ["상품 이미지를 읽지 못해 배경과 문구만 렌더링했습니다."],
      qualityScore: productDataUrl ? 96 : 78,
      qualityStatus: productDataUrl ? "stable" : "review",
    },
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RenderBody;
    if (body.adaptiveCreativePlan && body.selectedBackgroundSource) {
      const adaptive = await renderAdaptiveCreative(body, body.adaptiveCreativePlan);
      return NextResponse.json({
        success: true,
        imagePath: adaptive.imagePath,
        templateId: `adaptive-${body.adaptiveCreativePlan.layoutType}`,
        diagnostics: adaptive.diagnostics,
      });
    }
    const requestedTemplateId = body.templateId || "food-template-001";
    const templateId = supportedTemplateIds.has(requestedTemplateId)
      ? requestedTemplateId
      : "food-template-001";
    const registeredTemplate = templatesById.get(templateId);
    const template =
      registeredTemplate ??
      (templateId === foodImpactHeroTemplate.id ? foodImpactHeroTemplate : undefined);
    if (registeredTemplate?.renderMode === "slot-engine") {
      const activeCopy: GeneratedAdCopyVariant = {
        headline: String(body.copy?.headline || ""),
        bodyCopy: String(body.copy?.bodyCopy || ""),
        highlightCopy: String(body.copy?.highlightCopy || ""),
        bottomBarCopy: String(body.copy?.bottomBarCopy || ""),
        cta: String(body.copy?.cta || ""),
        price: String(body.copy?.price || body.productInfo?.price || ""),
      };
      const plan = await prepareBannerRender({
        template: registeredTemplate,
        activeCopy,
        selectedVariant: body.selectedVariant,
        copyVariants: body.copyVariants,
        productInfo: body.productInfo,
        imagePaths: compactRequestedProductImagePaths(body),
        backgroundImagePath:
          body.backgroundMode === "none" ? undefined : body.selectedBackgroundSource,
        originalPrice:
          body.productOriginalPrice ||
          body.productOldPrice ||
          body.productInfo?.originalPrice ||
          body.productInfo?.oldPrice,
      });
      const imagePath = await renderOptimizedTemplate(body, registeredTemplate, plan);
      return NextResponse.json({
        success: true,
        imagePath,
        templateId,
        diagnostics: plan.diagnostics,
      });
    }
    const fittedCopy = fitCopyToTemplate({
      copy: body.copy ?? {},
      templateId,
      copyLimits: template?.copyLimits,
    });
    const bodyWithFittedCopy: RenderBody = {
      ...body,
      templateId,
      copy:
        templateId === "food-template-002"
          ? {
              ...body.copy,
              price: fittedCopy.price || body.copy?.price,
            }
          : {
              ...body.copy,
              headline: fittedCopy.headline,
              bodyCopy: fittedCopy.bodyCopy,
              highlightCopy: fittedCopy.highlightCopy,
              bottomBarCopy: fittedCopy.bottomBarCopy,
              cta: fittedCopy.cta,
              price: fittedCopy.price || body.copy?.price,
            },
    };
    const imagePath = foodCategoryTemplateIds.includes(templateId)
      ? await renderFoodCategoryTemplate(bodyWithFittedCopy, templateId)
      : await renderFoodImpactHero(bodyWithFittedCopy);
    return NextResponse.json({ success: true, imagePath, templateId });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "배너 생성 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
