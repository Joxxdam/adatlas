import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { foodCategoryTemplateIds, foodImpactHeroTemplate, headlineFontPresets, templateHeadlinePresetMap, templatesById } from "@/lib/bannerTemplates";

export const runtime = "nodejs";

type RenderStyle = Partial<typeof foodImpactHeroTemplate.style> & {
  bodyFontSize?: number;
  selectedFontFile?: string;
  headlineFontFile?: string;
};

type RenderBody = {
  templateId?: string;
  canvasSize?: { width?: number; height?: number };
  copy?: {
    headline?: string;
    bodyCopy?: string;
    highlightCopy?: string;
    bottomBarCopy?: string;
    cta?: string;
    price?: string;
  };
  productImagePath?: string;
  secondaryProductImagePath?: string;
  productImagePaths?: string[];
  backgroundMode?: "none" | "auto-detail-blur-dark" | "selected-detail-blur-dark";
  selectedBackgroundSource?: string;
  backgroundStyle?: {
    blurLevel?: "low" | "medium" | "high";
    dimLevel?: "low" | "medium" | "high";
    overlayColor?: string;
    scale?: number;
  };
  style?: RenderStyle;
};

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

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  if (!/^C:\/(?:Windows\/Fonts|Users\/[^/]+\/AppData\/Local\/Microsoft\/Windows\/Fonts)\/[^/]+\.(?:ttf|ttc|otf)$/i.test(normalized)) {
    return "C:/Windows/Fonts/malgun.ttf";
  }
  return normalized;
}

function fontFormatFromFile(filePath: string) {
  return filePath.toLowerCase().endsWith(".otf") ? "opentype" : "truetype";
}

function fontMimeFromFile(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".otf")) return "font/otf";
  if (lower.endsWith(".ttc")) return "font/collection";
  return "font/ttf";
}

async function fontFileToDataUrl(filePath: string) {
  const safePath = safeWindowsFontFile(filePath);
  try {
    const buffer = await fs.readFile(safePath);
    return `data:${fontMimeFromFile(safePath)};base64,${buffer.toString("base64")}`;
  } catch {
    const fallback = "C:/Windows/Fonts/malgun.ttf";
    const buffer = await fs.readFile(fallback);
    return `data:${fontMimeFromFile(fallback)};base64,${buffer.toString("base64")}`;
  }
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

function pushLongToken(lines: string[], token: string, maxWidth: number, fontSize: number, letterSpacing: number, maxLines: number) {
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

function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number, letterSpacing = 0) {
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

function fitLines(text: string, options: { maxWidth: number; maxLines: number; initialSize: number; minSize: number; letterSpacing?: number; allowBelowMin?: boolean }) {
  const letterSpacing = options.letterSpacing ?? 0;
  const compact = (value: string) => value.replace(/\s+/g, "");
  const hardMinSize = options.allowBelowMin === false ? options.minSize : Math.min(options.minSize, 8);
  for (let size = options.initialSize; size >= hardMinSize; size -= 2) {
    const lines = wrapText(text, options.maxWidth, size, options.maxLines, letterSpacing);
    if (lines.every((line) => estimateWidth(line, size, letterSpacing) <= options.maxWidth) && compact(lines.join("")) === compact(text)) {
      return { lines, fontSize: size };
    }
  }
  const compactText = text.replace(/\s+/g, "");
  return {
    lines: wrapText(compactText, options.maxWidth, hardMinSize, options.maxLines, letterSpacing),
    fontSize: hardMinSize,
  };
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

function lineText(lines: string[], options: { x: number; startY: number; fontSize: number; lineHeight: number; fill: string; weight: number; letterSpacing?: number }) {
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

function centeredLineText(lines: string[], options: { x: number; centerY: number; fontSize: number; lineHeight: number; fill: string; weight: number; letterSpacing?: number }) {
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
  const productImageDataUrl = await imageToDataUrl(body.productImagePath || "");
  const backgroundMode = body.backgroundMode || "none";
  const backgroundSource =
    backgroundMode === "auto-detail-blur-dark"
      ? body.selectedBackgroundSource || body.productImagePath || ""
      : backgroundMode === "selected-detail-blur-dark"
        ? body.selectedBackgroundSource || ""
        : "";
  const backgroundImageDataUrl = backgroundSource
    ? await imageToDataUrl(backgroundSource).catch(() => "")
    : "";
  const hasBackgroundImage = Boolean(backgroundImageDataUrl && backgroundMode !== "none");
  const backgroundScale = Math.min(1.18, Math.max(1, Number(body.backgroundStyle?.scale ?? 1.08)));
  const backgroundBlur = backgroundBlurValue(body.backgroundStyle?.blurLevel);
  const backgroundDim = backgroundDimOpacity(body.backgroundStyle?.dimLevel);
  const selectedFontFile = safeWindowsFontFile(styleOverrides.selectedFontFile);
  const selectedFontFormat = fontFormatFromFile(selectedFontFile);
  const headlineFontFile = safeWindowsFontFile(styleOverrides.headlineFontFile || styleOverrides.selectedFontFile);
  const headlineFontFormat = fontFormatFromFile(headlineFontFile);
  const selectedFontDataUrl = await fontFileToDataUrl(selectedFontFile);
  const headlineFontDataUrl = await fontFileToDataUrl(headlineFontFile);
  const hasCta = Boolean(copy.cta?.trim());
  const hasPrice = Boolean(copy.price?.trim());

  const headline = fitLines(copy.headline || "", {
    maxWidth: 1060,
    maxLines: 2,
    initialSize: headlineStyle.fontSize,
    minSize: 18,
    letterSpacing: headlineStyle.letterSpacing,
  });
  const headlineStartY = headline.lines.length > 1 ? 124 : 148;
  const headlineBottom = headlineStartY + (headline.lines.length - 1) * headline.fontSize * headlineStyle.lineHeight + headline.fontSize * 0.9;

  const bodyCopy = fitLines(copy.bodyCopy || "", {
    maxWidth: 950,
    maxLines: hasManualBodyFontSize ? 3 : 2,
    initialSize: bodyFontSize,
    minSize: hasManualBodyFontSize ? Math.max(18, bodyFontSize) : 18,
    allowBelowMin: !hasManualBodyFontSize,
  });
  const bodyStartY = Math.max(250, headlineBottom + 42);
  const bodyBottom = bodyStartY + (bodyCopy.lines.length - 1) * bodyCopy.fontSize * type.bodyLineHeight;

  const highlight = fitLines(copy.highlightCopy || "", {
    maxWidth: 1120,
    maxLines: 1,
    initialSize: type.highlightFontSize,
    minSize: 14,
  });
  const highlightPaddingX = 4;
  const highlightPaddingY = 2;
  const highlightLineStep = highlight.fontSize * type.highlightLineHeight;
  const highlightTextWidth = Math.max(...highlight.lines.map((line) => estimateWidth(line, highlight.fontSize)));
  const highlightBoxWidth = Math.min(1152, Math.max(1, highlightTextWidth + highlightPaddingX * 2));
  const highlightBoxHeight = Math.max(22, highlight.lines.length * highlightLineStep + highlightPaddingY * 2);
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
  });
  const cta = fitLines(`${copy.cta || "구성 보러가기"}  >`, {
    maxWidth: 800,
    maxLines: 1,
    initialSize: type.ctaFontSize,
    minSize: 18,
  });
  const priceBadge = { x: 810, y: Math.min(imageTop + imageHeight - 108, bottomBarY - 110), width: 350, height: 86 };
  const price = fitLines(copy.price || "", {
    maxWidth: priceBadge.width - 56,
    maxLines: 1,
    initialSize: 40,
    minSize: 20,
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
      weight: 800,
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
    textLines.push(...centeredLineText(cta.lines, {
      x: 600,
      centerY: ctaY + ctaHeight / 2,
      fontSize: cta.fontSize,
      lineHeight: 1,
      fill: style.ctaTextColor,
      weight: 800,
    }));
  }

  if (hasPrice) {
    textLines.push(...centeredLineText(price.lines, {
      x: priceBadge.x + priceBadge.width / 2,
      centerY: priceBadge.y + priceBadge.height / 2,
      fontSize: price.fontSize,
      lineHeight: 1,
      fill: "#ffffff",
      weight: 900,
    }));
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
        src: url('${selectedFontDataUrl}') format('${selectedFontFormat}');
        font-weight: 400 900;
      }
      @font-face {
        font-family: 'AdAtlasHeadlineFont';
        src: url('${headlineFontDataUrl}') format('${headlineFontFormat}');
        font-weight: 400 900;
      }
    </style>
    <filter id="productShadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#000000" flood-opacity="0.18"/>
    </filter>
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
      ? `<image href="${productImageDataUrl}" x="42" y="${imageTop}" width="1116" height="${imageHeight}" preserveAspectRatio="xMidYMid meet" filter="url(#productShadow)" />`
      : `<rect x="70" y="${imageTop + 30}" width="1060" height="${Math.max(300, imageHeight - 60)}" rx="28" fill="#ffffff" />`
  }
  ${hasPrice ? `<rect x="${priceBadge.x}" y="${priceBadge.y}" width="${priceBadge.width}" height="${priceBadge.height}" rx="${priceBadge.height / 2}" fill="${style.priceColor}" />` : ""}
  <rect x="0" y="${bottomBarY}" width="${width}" height="${bottomBarHeight}" fill="${style.bottomBarColor}" />
  ${hasCta ? `<rect x="178" y="${ctaY}" width="844" height="${ctaHeight}" rx="${ctaHeight / 2}" fill="${style.ctaBarColor}" />` : ""}
  ${textSvg(textLines, `AdAtlasKR, ${style.fontFamily}`)}
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
  const requestedProductImagePaths = (body.productImagePaths?.length
    ? body.productImagePaths
    : [body.productImagePath, body.secondaryProductImagePath]).filter(Boolean).slice(0, 4) as string[];
  const productImageDataUrls = await Promise.all(requestedProductImagePaths.map((imagePath) => imageToDataUrl(imagePath).catch(() => "")));
  const productImageDataUrl = productImageDataUrls[0] || await imageToDataUrl(body.productImagePath || "").catch(() => "");
  const secondaryProductImageDataUrl = productImageDataUrls[1] || await imageToDataUrl(body.secondaryProductImagePath || body.productImagePath || "").catch(() => productImageDataUrl);
  const templateProductImages = (productImageDataUrls.length ? productImageDataUrls : [productImageDataUrl]).filter(Boolean);
  const backgroundMode = templateId === "food-template-005" ? (body.backgroundMode === "none" ? "auto-detail-blur-dark" : body.backgroundMode || "auto-detail-blur-dark") : body.backgroundMode || "none";
  const backgroundSource = backgroundMode === "selected-detail-blur-dark"
    ? body.selectedBackgroundSource || body.productImagePath || ""
    : backgroundMode === "auto-detail-blur-dark"
      ? body.selectedBackgroundSource || body.productImagePath || ""
      : "";
  const backgroundImageDataUrl = backgroundSource ? await imageToDataUrl(backgroundSource).catch(() => "") : "";
  const selectedFontFile = safeWindowsFontFile(styleOverrides.selectedFontFile);
  const selectedFontFormat = fontFormatFromFile(selectedFontFile);
  const headlineFontFile = safeWindowsFontFile(styleOverrides.headlineFontFile || styleOverrides.selectedFontFile);
  const headlineFontFormat = fontFormatFromFile(headlineFontFile);
  const selectedFontDataUrl = await fontFileToDataUrl(selectedFontFile);
  const headlineFontDataUrl = await fontFileToDataUrl(headlineFontFile);
  const fontFamily = `AdAtlasSelectedFont, ${String(style.fontFamily || foodImpactHeroTemplate.style.fontFamily)}`;
  const headlineFontFamily = String(style.headlineFontFamily || headlineStyle.fontFamily).replace("AdAtlasSelectedFont", "AdAtlasHeadlineFont");
  const hasCta = Boolean(copy.cta?.trim());
  const hasPrice = Boolean(copy.price?.trim());

  const h = fitLines(copy.headline || "", { maxWidth: 1040, maxLines: 2, initialSize: Number(styleOverrides.headlineFontSize ?? type.headlineFontSize), minSize: 22, letterSpacing: headlineStyle.letterSpacing });
  const b = fitLines(copy.bodyCopy || "", { maxWidth: 980, maxLines: 3, initialSize: Number(styleOverrides.bodyFontSize ?? type.bodyFontSize), minSize: 18, allowBelowMin: false });
  const hi = fitLines(copy.highlightCopy || "", { maxWidth: 960, maxLines: templateId === "food-template-001" ? 2 : 1, initialSize: type.highlightFontSize, minSize: 16 });
  const bot = fitLines(copy.bottomBarCopy || "", { maxWidth: 1020, maxLines: 2, initialSize: type.bottomBarFontSize, minSize: 18 });
  const price = fitLines(copy.price || "", { maxWidth: 430, maxLines: 1, initialSize: templateId === "food-template-002" ? 76 : 54, minSize: 24 });
  const textLines: TextLine[] = [];

  const image = (x: number, y: number, w: number, h: number, mode: "meet" | "cover" = "meet") =>
    productImageDataUrl
      ? `<image href="${productImageDataUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid ${mode}" filter="url(#productShadow)" />`
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#ffffff" opacity="0.7" />`;

  const secondaryImage = (x: number, y: number, w: number, h: number, mode: "meet" | "cover" = "meet") =>
    secondaryProductImageDataUrl
      ? `<image href="${secondaryProductImageDataUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid ${mode}" filter="url(#productShadow)" />`
      : image(x, y, w, h, mode);

  const imageFromDataUrl = (dataUrl: string, x: number, y: number, w: number, h: number, mode: "meet" | "cover" = "meet") =>
    dataUrl
      ? `<image href="${dataUrl}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid ${mode}" filter="url(#productShadow)" />`
      : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="#ffffff" opacity="0.7" />`;

  let shapes = "";
  let backgroundLayer = `<rect width="${width}" height="${height}" fill="${style.backgroundColor}" />`;
  let backgroundBlurDef = `<filter id="backgroundBlur" x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="9" edgeMode="duplicate"/></filter>`;
  if (backgroundImageDataUrl) {
    const blur = templateId === "food-template-005" ? 12 : backgroundBlurValue(body.backgroundStyle?.blurLevel);
    const dim = templateId === "food-template-005" ? 0.58 : backgroundDimOpacity(body.backgroundStyle?.dimLevel);
    backgroundBlurDef = `<filter id="backgroundBlur" x="-12%" y="-12%" width="124%" height="124%"><feGaussianBlur stdDeviation="${blur}" edgeMode="duplicate"/></filter>`;
    backgroundLayer = `<image href="${backgroundImageDataUrl}" x="-60" y="-60" width="1320" height="1320" preserveAspectRatio="xMidYMid slice" filter="url(#backgroundBlur)" opacity="0.95" />
  <rect width="${width}" height="${height}" fill="#000000" opacity="${dim}" />`;
  }

  if (templateId === "food-template-002") {
    shapes += `<rect width="1200" height="1200" fill="#fffdf2" />
      <rect x="46" y="46" width="1108" height="1108" rx="42" fill="#ffffff" stroke="#111111" stroke-width="6" />
      <rect x="774" y="124" width="316" height="116" rx="58" fill="${style.accentColor}" />
      <rect x="78" y="306" width="680" height="540" rx="34" fill="#fff4d0" />
      ${image(96, 328, 644, 500)}
      <rect x="782" y="352" width="330" height="330" rx="165" fill="#ff1f1f" />
      <rect x="0" y="1020" width="1200" height="128" fill="${style.bottomBarColor}" />
      ${hasPrice ? `<text x="947" y="548" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(headlineFontFamily)}" font-size="${price.fontSize}" font-weight="900" fill="#ffffff" stroke="${String(styleRecord.priceStrokeColor || "#111111")}" stroke-width="${Number(styleRecord.priceStrokeWidth || 0)}" paint-order="stroke fill">${escapeXml(price.lines[0] || "")}</text>` : ""}`;
    textLines.push(...lineText(h.lines, { x: 86, startY: 120, fontSize: h.fontSize, lineHeight: 0.98, fill: String(style.headlineColor), weight: 900, letterSpacing: -3 }).map((line) => ({ ...line, anchor: "start" as const, fontFamily: headlineFontFamily })));
    textLines.push(...centeredLineText(hi.lines, { x: 932, centerY: 182, fontSize: hi.fontSize, lineHeight: 1.04, fill: "#111111", weight: 900 }));
    textLines.push(...centeredLineText(b.lines, { x: 600, centerY: 905, fontSize: b.fontSize, lineHeight: 1.15, fill: "#111111", weight: 800 }));
    textLines.push(...centeredLineText(bot.lines, { x: 600, centerY: 1084, fontSize: bot.fontSize, lineHeight: 1.1, fill: String(style.bottomBarTextColor), weight: 900 }));
  } else if (templateId === "food-template-003") {
    const leftTitle = h.lines[0] || copy.headline || "PR pick";
    const rightTitle = h.lines[1] || copy.highlightCopy || "Social pick";
    const leftBody = fitLines(copy.bodyCopy || "", { maxWidth: 380, maxLines: 7, initialSize: Math.min(30, b.fontSize), minSize: 16 });
    const rightBody = fitLines(copy.highlightCopy || "", { maxWidth: 380, maxLines: 4, initialSize: Math.min(34, hi.fontSize), minSize: 18 });
    shapes += `<rect width="1200" height="1200" fill="#ffffff" />
      <line x1="600" y1="112" x2="600" y2="1088" stroke="#111111" stroke-width="4" />
      ${image(150, 214, 300, 280)}
      ${image(750, 214, 300, 280)}
      <text x="900" y="312" text-anchor="middle" font-family="${escapeXml(fontFamily)}" font-size="46" font-weight="800" fill="#ff595e">♥  ✦  🍀</text>`;
    textLines.push({ text: leftTitle, x: 300, y: 142, fontSize: 44, fill: "#111111", weight: 900, fontFamily: headlineFontFamily });
    textLines.push({ text: rightTitle, x: 900, y: 142, fontSize: 44, fill: "#111111", weight: 900, fontFamily: headlineFontFamily });
    textLines.push(...lineText(leftBody.lines, { x: 300, startY: 560, fontSize: leftBody.fontSize, lineHeight: 1.34, fill: "#111111", weight: 600 }));
    textLines.push(...centeredLineText(rightBody.lines, { x: 900, centerY: 646, fontSize: rightBody.fontSize, lineHeight: 1.28, fill: "#111111", weight: 900 }));
    textLines.push(...centeredLineText(bot.lines, { x: 600, centerY: 1116, fontSize: 34, lineHeight: 1.1, fill: "#111111", weight: 800 }));
  } else if (templateId === "food-template-004") {
    backgroundLayer = productImageDataUrl
      ? `<image href="${productImageDataUrl}" x="0" y="0" width="1200" height="780" preserveAspectRatio="xMidYMid slice" />
        <rect width="1200" height="780" fill="#000000" opacity="0.18" />`
      : `<rect width="1200" height="780" fill="#dfc8a5" />`;
    shapes += `<rect x="96" y="80" width="440" height="72" rx="36" fill="#30240d" opacity="0.95" />
      <ellipse cx="876" cy="314" rx="210" ry="82" fill="#ffffff" stroke="#111111" stroke-width="3" />
      <ellipse cx="272" cy="612" rx="220" ry="86" fill="#ffffff" stroke="#111111" stroke-width="3" />
      <rect x="0" y="780" width="1200" height="420" fill="#241a0d" />
      <rect x="736" y="730" width="394" height="118" rx="8" fill="#ff3939" stroke="#ffffff" stroke-width="4" />`;
    textLines.push(...centeredLineText(hi.lines, { x: 316, centerY: 116, fontSize: Math.min(hi.fontSize, 30), lineHeight: 1, fill: "#ffffff", weight: 800 }));
    textLines.push(...lineText(h.lines, { x: 96, startY: 248, fontSize: h.fontSize, lineHeight: 1.02, fill: "#ffffff", weight: 900, letterSpacing: -2 }).map((line) => ({ ...line, anchor: "start" as const, fontFamily: headlineFontFamily, stroke: true, strokeColor: "rgba(0,0,0,0.55)", strokeWidth: 3 })));
    textLines.push(...centeredLineText(b.lines.slice(0, 2), { x: 876, centerY: 314, fontSize: Math.min(b.fontSize, 28), lineHeight: 1.16, fill: "#111111", weight: 700 }));
    textLines.push(...centeredLineText(bot.lines, { x: 272, centerY: 612, fontSize: Math.min(bot.fontSize, 30), lineHeight: 1.12, fill: "#111111", weight: 800 }));
    textLines.push({ text: hasPrice ? `${price.lines[0]} 인기` : "월 평균 판매량 1000개!", x: 933, y: 790, fontSize: 42, fill: "#ffffff", weight: 900 });
    textLines.push({ text: "평점 4.95  ★★★★★", x: 84, y: 854, fontSize: 35, fill: "#ffe762", weight: 900, anchor: "start" });
    textLines.push({ text: `● ${copy.bodyCopy || "한 번 먹으면 계속 찾는 구성"}`.slice(0, 44), x: 84, y: 926, fontSize: 27, fill: "#ffffff", weight: 700, anchor: "start" });
    textLines.push({ text: `● ${copy.highlightCopy || "선물용으로도 반응 좋은 구성"}`.slice(0, 44), x: 84, y: 990, fontSize: 27, fill: "#ffffff", weight: 700, anchor: "start" });
    textLines.push({ text: `● ${copy.bottomBarCopy || "지금 구성 놓치면 아쉬움"}`.slice(0, 44), x: 84, y: 1054, fontSize: 27, fill: "#ffffff", weight: 700, anchor: "start" });
  } else if (templateId === "food-template-005") {
    shapes += `<rect x="0" y="0" width="1200" height="1200" fill="#050505" opacity="0.18" />
      <rect x="66" y="66" width="1068" height="1068" rx="0" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2" />
      ${image(118, 650, 964, 330, "cover")}
      ${hasPrice ? `<text x="600" y="1080" text-anchor="middle" dominant-baseline="middle" font-family="${escapeXml(headlineFontFamily)}" font-size="${Math.max(86, price.fontSize)}" font-weight="900" fill="${style.priceColor}" stroke="#ffffff" stroke-width="12" paint-order="stroke fill">${escapeXml(price.lines[0] || "")}</text>` : ""}
      <text x="600" y="956" text-anchor="middle" font-family="${escapeXml(fontFamily)}" font-size="28" font-weight="800" fill="#ffffff">AI 활용 콘텐츠이며, 가상 인물을 포함할 수 있습니다</text>`;
    textLines.push(...centeredLineText([h.lines[0] || ""], { x: 600, centerY: 226, fontSize: Math.min(h.fontSize, 82), lineHeight: 1, fill: "#ff1f1f", weight: 900, letterSpacing: -3 }).map((line) => ({ ...line, fontFamily: headlineFontFamily, stroke: true, strokeColor: "#111111", strokeWidth: 5 })));
    textLines.push(...centeredLineText([h.lines[1] || b.lines[0] || ""].filter(Boolean), { x: 600, centerY: 352, fontSize: 72, lineHeight: 1, fill: "#ffffff", weight: 900, letterSpacing: -2 }).map((line) => ({ ...line, fontFamily: headlineFontFamily, stroke: true, strokeColor: "#111111", strokeWidth: 5 })));
    textLines.push(...centeredLineText(hi.lines, { x: 600, centerY: 500, fontSize: Math.min(hi.fontSize + 18, 72), lineHeight: 1, fill: "#fff238", weight: 900, letterSpacing: -2 }).map((line) => ({ ...line, fontFamily: headlineFontFamily, stroke: true, strokeColor: "#111111", strokeWidth: 4 })));
    textLines.push(...centeredLineText(bot.lines, { x: 600, centerY: 585, fontSize: Math.min(bot.fontSize + 8, 52), lineHeight: 1.05, fill: "#ffffff", weight: 900 }).map((line) => ({ ...line, fontFamily: headlineFontFamily, stroke: true, strokeColor: "#111111", strokeWidth: 4 })));
  } else {
    const selectedImages = templateProductImages.length === 1
      ? [templateProductImages[0], templateProductImages[0]]
      : templateProductImages.slice(0, 4);
    const productGrid = selectedImages.length <= 2
      ? `${imageFromDataUrl(selectedImages[0] || productImageDataUrl, 0, 260, 600, 600, "cover")}
      ${imageFromDataUrl(selectedImages[1] || selectedImages[0] || productImageDataUrl, 600, 204, 600, 690, "cover")}`
      : `${imageFromDataUrl(selectedImages[0] || productImageDataUrl, 0, 250, 600, 330, "cover")}
      ${imageFromDataUrl(selectedImages[1] || selectedImages[0] || productImageDataUrl, 600, 250, 600, 330, "cover")}
      ${imageFromDataUrl(selectedImages[2] || selectedImages[0] || productImageDataUrl, 0, 580, 600, 300, "cover")}
      ${selectedImages[3] ? imageFromDataUrl(selectedImages[3], 600, 580, 600, 300, "cover") : ""}`;
    backgroundLayer = `<rect width="600" height="1200" fill="#24170f" />
      <rect x="600" y="0" width="600" height="1200" fill="#16110e" />`;
    shapes += `${productGrid}
      <rect width="1200" height="1200" fill="#000000" opacity="0.22" />
      <rect x="0" y="800" width="560" height="250" fill="#070707" opacity="0.78" />
      <rect x="58" y="928" width="190" height="58" rx="10" fill="#ff1f1f" />
      ${hasPrice ? `<text x="276" y="976" text-anchor="start" font-family="${escapeXml(headlineFontFamily)}" font-size="70" font-weight="900" fill="#fff238">${escapeXml(price.lines[0] || "")}</text>` : ""}`;
    textLines.push(...centeredLineText(h.lines, { x: 600, centerY: 142, fontSize: h.fontSize, lineHeight: 0.96, fill: "#ffffff", weight: 900, letterSpacing: -3 }).map((line, index) => ({ ...line, fill: index === 0 ? "#fff238" : "#ffffff", fontFamily: headlineFontFamily, stroke: true, strokeColor: "#111111", strokeWidth: 5 })));
    textLines.push(...lineText(b.lines.slice(0, 1), { x: 50, startY: 848, fontSize: Math.min(b.fontSize, 32), lineHeight: 1.1, fill: "#ffffff", weight: 800 }).map((line) => ({ ...line, anchor: "start" as const })));
    textLines.push({ text: "기존가", x: 58, y: 902, fontSize: 28, fill: "#ffffff", weight: 700, anchor: "start" });
    textLines.push({ text: "파격특가", x: 153, y: 958, fontSize: 28, fill: "#ffffff", weight: 900 });
    textLines.push(...centeredLineText(hi.lines, { x: 600, centerY: 1096, fontSize: Math.min(hi.fontSize, 38), lineHeight: 1.08, fill: "#ffffff", weight: 900 }).map((line) => ({ ...line, stroke: true, strokeColor: "#111111", strokeWidth: 3 })));
  }

  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @font-face { font-family: 'AdAtlasSelectedFont'; src: url('${selectedFontDataUrl}') format('${selectedFontFormat}'); font-weight: 400 900; }
      @font-face { font-family: 'AdAtlasHeadlineFont'; src: url('${headlineFontDataUrl}') format('${headlineFontFormat}'); font-weight: 400 900; }
    </style>
    <filter id="productShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="12" flood-color="#000000" flood-opacity="0.22"/></filter>
    ${backgroundBlurDef}
    <filter id="headlineShadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#000000"/></filter>
  </defs>
  ${backgroundLayer}
  ${shapes}
  ${textSvg(textLines, fontFamily)}
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
    const templateId = supportedTemplateIds.has(requestedTemplateId) ? requestedTemplateId : "food-template-001";
    const imagePath = foodCategoryTemplateIds.includes(templateId)
      ? await renderFoodCategoryTemplate({ ...body, templateId }, templateId)
      : await renderFoodImpactHero({ ...body, templateId });
    return NextResponse.json({ success: true, imagePath, templateId });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "배너 생성 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
