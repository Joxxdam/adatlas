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
} from "@/lib/bannerTemplates";
import { getSelectedProductImagePath } from "../../../lib/mvp/imageEffects";
import { fitCopyToTemplate } from "../../../lib/mvp/templateCopyFitter";
import { fitTextToBox } from "../../../lib/mvp/textFit";
import type {
  GeneratedAdCopy,
  GeneratedAdCopyVariant,
  ProductImageRenderEffect,
  ProductImageState,
  TemplateCopyLimits,
} from "../../../lib/mvp/types";

export const runtime = "nodejs";

type RenderStyle = Partial<typeof foodImpactHeroTemplate.style> & {
  bodyFontSize?: number;
  bodyFontWeight?: number;
  selectedFontWeight?: number;
  headlineFontWeight?: number;
  selectedFontFile?: string;
  headlineFontFile?: string;
  accentPhrase?: string;
  accentColor?: string;
};

type RenderBody = {
  templateId?: string;
  canvasSize?: { width?: number; height?: number };
  copy?: Partial<GeneratedAdCopy>;
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
  logoImagePath?: string;
  aiDisclosure?: {
    enabled?: boolean;
    text?: string;
  };
  backgroundStyle?: {
    blurLevel?: "low" | "medium" | "high";
    dimLevel?: "low" | "medium" | "high";
    overlayColor?: string;
    scale?: number;
  };
  style?: RenderStyle;
  productEffect?: Partial<ProductImageRenderEffect>;
};

function compactRequestedProductImagePaths(body: RenderBody): string[] {
  const values = [
    ...(body.productImagePaths || []),
    body.productImagePath,
    body.secondaryProductImagePath,
    body.selectedProductImagePath,
    body.productImageState?.styledCutoutImagePath,
    body.productImageState?.cutoutImagePath,
    body.productImageState?.originalImagePath,
  ];
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const value of values) {
    const imagePath = value?.trim();
    if (!imagePath || seen.has(imagePath)) continue;
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

function safeWindowsFontFile(value?: string) {
  if (!value) return "C:/Windows/Fonts/malgun.ttf";
  const normalized = value.replace(/\\/g, "/");
  if (
    !/^C:\/(?:Windows\/Fonts|Users\/[^/]+\/AppData\/Local\/Microsoft\/Windows\/Fonts)\/[^/]+\.(?:ttf|ttc|otf)$/i.test(
      normalized
    )
  ) {
    return "C:/Windows/Fonts/malgun.ttf";
  }
  return normalized;
}

function fontFormatFromFile(filePath: string) {
  return filePath.toLowerCase().endsWith(".otf") ? "opentype" : "truetype";
}

function fontFileToFileUrl(filePath: string) {
  return pathToFileURL(safeWindowsFontFile(filePath)).href;
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

  if (isHttpUrl(imagePathOrUrl)) {
    const response = await fetch(imagePathOrUrl);
    if (!response.ok) throw new Error(`상품 이미지 다운로드 실패: HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    return `data:${contentType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
  }

  const publicRelativePath = imagePathOrUrl.replace(/^\/+/, "");
  const filePath = path.join(process.cwd(), "public", publicRelativePath);
  const buffer = await fs.readFile(filePath);
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

async function renderFoodImpactHero(body: RenderBody) {
  const width = body.canvasSize?.width || 1200;
  const height = body.canvasSize?.height || 1200;
  if (width !== 1200 || height !== 1200) {
    throw new Error("현재 템플릿은 1200x1200만 지원합니다.");
  }

  const copy = body.copy ?? {};
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
  const productImageDataUrl = await imageToDataUrl(selectedProductImagePath || "");
  const backgroundMode = body.backgroundMode || "none";
  const backgroundSource =
    backgroundMode === "auto-detail-blur-dark"
      ? body.selectedBackgroundSource || selectedProductImagePath || ""
      : backgroundMode === "selected-detail-blur-dark"
        ? body.selectedBackgroundSource || ""
        : "";
  const backgroundImageDataUrl = backgroundSource
    ? await imageToDataUrl(backgroundSource).catch(() => "")
    : "";
  const logoImageDataUrl = body.logoImagePath
    ? await imageToDataUrl(body.logoImagePath).catch(() => "")
    : "";
  const hasBackgroundImage = Boolean(backgroundImageDataUrl && backgroundMode !== "none");
  const backgroundScale = Math.min(1.18, Math.max(1, Number(body.backgroundStyle?.scale ?? 1.08)));
  const backgroundBlur = backgroundBlurValue(body.backgroundStyle?.blurLevel);
  const backgroundDim = backgroundDimOpacity(body.backgroundStyle?.dimLevel);
  const selectedFontFile = safeWindowsFontFile(styleOverrides.selectedFontFile);
  const selectedFontFormat = fontFormatFromFile(selectedFontFile);
  const headlineFontFile = safeWindowsFontFile(
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
  const hasCta = Boolean(copy.cta?.trim());
  const hasPrice = Boolean(copy.price?.trim());

  const headline = fitLines(copy.headline || "", {
    maxWidth: 1060,
    maxLines: 2,
    initialSize: headlineStyle.fontSize,
    minSize: 18,
    letterSpacing: headlineStyle.letterSpacing,
    lineHeight: headlineStyle.lineHeight,
    boxHeight: 210,
    slot: "headline",
  });
  const headlineStartY = headline.lines.length > 1 ? 124 : 148;
  const headlineBottom =
    headlineStartY +
    (headline.lines.length - 1) * headline.fontSize * headlineStyle.lineHeight +
    headline.fontSize * 0.9;

  const bodyCopy = fitLines(copy.bodyCopy || "", {
    maxWidth: 950,
    maxLines: hasManualBodyFontSize ? 3 : 2,
    initialSize: bodyFontSize,
    minSize: hasManualBodyFontSize ? Math.max(18, bodyFontSize) : 18,
    allowBelowMin: !hasManualBodyFontSize,
    lineHeight: type.bodyLineHeight,
    boxHeight: 126,
    slot: "bodyCopy",
  });
  const bodyStartY = Math.max(250, headlineBottom + 42);
  const bodyBottom =
    bodyStartY + (bodyCopy.lines.length - 1) * bodyCopy.fontSize * type.bodyLineHeight;

  const highlight = fitLines(copy.highlightCopy || "", {
    maxWidth: 1120,
    maxLines: 1,
    initialSize: type.highlightFontSize,
    minSize: 14,
    lineHeight: type.highlightLineHeight,
    boxHeight: 54,
    slot: "highlightCopy",
  });
  const highlightPaddingX = 4;
  const highlightPaddingY = 2;
  const highlightLineStep = highlight.fontSize * type.highlightLineHeight;
  const highlightTextWidth = Math.max(
    ...highlight.lines.map((line) => estimateWidth(line, highlight.fontSize))
  );
  const highlightBoxWidth = Math.min(1152, Math.max(1, highlightTextWidth + highlightPaddingX * 2));
  const highlightBoxHeight = Math.max(
    22,
    highlight.lines.length * highlightLineStep + highlightPaddingY * 2
  );
  const highlightBoxX = (width - highlightBoxWidth) / 2;
  const highlightBoxY = Math.max(318, bodyBottom + 20);
  const highlightCenterY = highlightBoxY + highlightBoxHeight / 2;
  const imageTop = highlightBoxY + highlightBoxHeight + 18;

  const ctaHeight = hasCta ? 72 : 0;
  const ctaY = hasCta ? 1092 : 1200;
  const bottomBarY = hasCta ? 974 : 1104;
  const bottomBarHeight = hasCta ? 82 : 96;
  const imageBottom = bottomBarY - 18;
  const imageHeight = Math.max(320, imageBottom - imageTop);

  const bottom = fitLines(copy.bottomBarCopy || "", {
    maxWidth: 1040,
    maxLines: 2,
    initialSize: type.bottomBarFontSize,
    minSize: 18,
    lineHeight: 1.16,
    boxHeight: bottomBarHeight - 12,
    slot: "bottomBarCopy",
  });
  const cta = fitLines(`${copy.cta || "구성 보러가기"}  >`, {
    maxWidth: 800,
    maxLines: 1,
    initialSize: type.ctaFontSize,
    minSize: 18,
    lineHeight: 1,
    boxHeight: ctaHeight || 72,
    slot: "cta",
  });
  const priceBadge = {
    x: 810,
    y: Math.min(imageTop + imageHeight - 108, bottomBarY - 110),
    width: 350,
    height: 86,
  };
  const price = fitLines(copy.price || "", {
    maxWidth: priceBadge.width - 56,
    maxLines: 1,
    initialSize: 40,
    minSize: 20,
    lineHeight: 1,
    boxHeight: priceBadge.height,
    slot: "price",
  });

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
      fontFamily: headlineStyle.fontFamily,
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
        x: 600,
        centerY: ctaY + ctaHeight / 2,
        fontSize: cta.fontSize,
        lineHeight: 1,
        fill: style.ctaTextColor,
        weight: 800,
      })
    );
  }

  if (hasPrice) {
    textLines.push(
      ...centeredLineText(price.lines, {
        x: priceBadge.x + priceBadge.width / 2,
        centerY: priceBadge.y + priceBadge.height / 2,
        fontSize: price.fontSize,
        lineHeight: 1,
        fill: "#ffffff",
        weight: 900,
      })
    );
  }

  const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face {
        font-family: 'AdAtlasKR';
        src: url('file:///C:/Windows/Fonts/malgun.ttf') format('truetype');
        font-weight: 400 900;
      }
      @font-face {
        font-family: 'AdAtlasSelectedFont';
        src: url('${selectedFontFileUrl}') format('${selectedFontFormat}');
        font-weight: ${selectedFontWeight};
        font-style: normal;
      }
      @font-face {
        font-family: 'AdAtlasHeadlineFont';
        src: url('${headlineFontFileUrl}') format('${headlineFontFormat}');
        font-weight: ${headlineFontFaceWeight};
        font-style: normal;
      }
    </style>
    ${productEffectFilterDef(productEffect)}
    <filter id="headlineShadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="${headlineStyle.shadowOffsetX}" dy="${headlineStyle.shadowOffsetY}" stdDeviation="${headlineStyle.shadowBlur}" flood-color="${escapeXml(headlineStyle.shadowColor)}"/>
    </filter>
    <filter id="backgroundBlur" x="-12%" y="-12%" width="124%" height="124%">
      <feGaussianBlur stdDeviation="${backgroundBlur}" edgeMode="duplicate"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="${style.backgroundColor}" />
  ${
    hasBackgroundImage
      ? `<image href="${backgroundImageDataUrl}" x="${(width - width * backgroundScale) / 2}" y="${(height - height * backgroundScale) / 2}" width="${width * backgroundScale}" height="${height * backgroundScale}" preserveAspectRatio="xMidYMid slice" filter="url(#backgroundBlur)" opacity="0.92" />
  <rect width="${width}" height="${height}" fill="${escapeXml(body.backgroundStyle?.overlayColor || "#000000")}" opacity="${backgroundDim}" />`
      : ""
  }
  <rect x="${highlightBoxX}" y="${highlightBoxY}" width="${highlightBoxWidth}" height="${highlightBoxHeight}" rx="0" fill="${style.highlightBackground}" />
  ${
    productImageDataUrl
      ? productImageSvg(productImageDataUrl, 42, imageTop, 1116, imageHeight, "meet", productEffect)
      : `<rect x="70" y="${imageTop + 30}" width="1060" height="${Math.max(300, imageHeight - 60)}" rx="28" fill="#ffffff" />`
  }
  ${hasPrice ? `<rect x="${priceBadge.x}" y="${priceBadge.y}" width="${priceBadge.width}" height="${priceBadge.height}" rx="${priceBadge.height / 2}" fill="${style.priceColor}" />` : ""}
  <rect x="0" y="${bottomBarY}" width="${width}" height="${bottomBarHeight}" fill="${style.bottomBarColor}" />
  ${hasCta ? `<rect x="178" y="${ctaY}" width="844" height="${ctaHeight}" rx="${ctaHeight / 2}" fill="${style.ctaBarColor}" />` : ""}
  ${textSvg(textLines, `AdAtlasKR, ${style.fontFamily}`)}
  ${logoOverlaySvg(logoImageDataUrl, { x: width - 168, y: 42, size: 126 })}
  ${aiDisclosureSvg(body.aiDisclosure, `AdAtlasKR, ${style.fontFamily}`, width, height)}
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
  const logoImageDataUrl = body.logoImagePath
    ? await imageToDataUrl(body.logoImagePath).catch(() => "")
    : "";
  const selectedFontFile = safeWindowsFontFile(styleOverrides.selectedFontFile);
  const selectedFontFormat = fontFormatFromFile(selectedFontFile);
  const headlineFontFile = safeWindowsFontFile(
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
  const headlineFontFamily = String(style.headlineFontFamily || headlineStyle.fontFamily).replace(
    "AdAtlasSelectedFont",
    "AdAtlasHeadlineFont"
  );
  const hasCta = Boolean(copy.cta?.trim());
  const hasPrice = Boolean(copy.price?.trim());
  const globalLogoOverlay =
    templateId === "food-template-001" || templateId === "food-template-002"
      ? ""
      : logoOverlaySvg(logoImageDataUrl, { x: 1012, y: 38, size: 136 });

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
    const blur =
      templateId === "food-template-005"
        ? 12
        : backgroundBlurValue(body.backgroundStyle?.blurLevel);
    const dim =
      templateId === "food-template-005"
        ? 0.58
        : backgroundDimOpacity(body.backgroundStyle?.dimLevel);
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

    backgroundLayer = `<rect width="1200" height="1200" fill="#100c09" />`;

    shapes += frames
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
      ${frames.length === 2 ? `<line x1="600" y1="0" x2="600" y2="1200" stroke="#050505" stroke-width="8" opacity="0.55" />` : ""}
      ${frames.length === 3 ? `<line x1="0" y1="600" x2="1200" y2="600" stroke="#050505" stroke-width="8" opacity="0.55" /><line x1="600" y1="600" x2="600" y2="1200" stroke="#050505" stroke-width="8" opacity="0.55" />` : ""}
      ${frames.length === 4 ? `<line x1="600" y1="0" x2="600" y2="1200" stroke="#050505" stroke-width="8" opacity="0.55" /><line x1="0" y1="600" x2="1200" y2="600" stroke="#050505" stroke-width="8" opacity="0.55" />` : ""}
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
    const backgroundOffset = (backgroundRenderSize - 1200) / -2;
    const backgroundBlur = backgroundBlurValue(body.backgroundStyle?.blurLevel);
    const backgroundDim = backgroundDimOpacity(body.backgroundStyle?.dimLevel);
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
      ? `<image href="${backgroundDataUrl}" x="${backgroundOffset}" y="${backgroundOffset}" width="${backgroundRenderSize}" height="${backgroundRenderSize}" preserveAspectRatio="xMidYMid slice" ${hasBackgroundBlur ? `filter="url(#backgroundBlur)"` : ""} />
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
      @font-face { font-family: 'AdAtlasSelectedFont'; src: url('${selectedFontFileUrl}') format('${selectedFontFormat}'); font-weight: ${selectedFontWeight}; font-style: normal; }
      @font-face { font-family: 'AdAtlasHeadlineFont'; src: url('${headlineFontFileUrl}') format('${headlineFontFormat}'); font-weight: ${headlineFontFaceWeight}; font-style: normal; }
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RenderBody;
    const requestedTemplateId = body.templateId || "food-template-001";
    const templateId = supportedTemplateIds.has(requestedTemplateId)
      ? requestedTemplateId
      : "food-template-001";
    const template =
      templatesById.get(templateId) ??
      (templateId === foodImpactHeroTemplate.id ? foodImpactHeroTemplate : undefined);
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
