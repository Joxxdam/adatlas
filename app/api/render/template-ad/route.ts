import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

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
  style?: {
    backgroundColor?: string;
    headlineColor?: string;
    highlightBackground?: string;
    bottomBarColor?: string;
    ctaBarColor?: string;
  };
};

type TextLine = {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fill: string;
  weight?: number;
  anchor?: "start" | "middle";
};

const outputDir = path.join(process.cwd(), "public", "generated-ads");

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

async function imageToDataUrl(imagePathOrUrl: string) {
  if (!imagePathOrUrl) return "";

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

function estimateWidth(text: string, fontSize: number) {
  let width = 0;
  for (const char of text) {
    width += /[가-힣]/.test(char) ? fontSize * 0.95 : fontSize * 0.56;
  }
  return width;
}

function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimateWidth(candidate, fontSize) <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && current) lines.push(current);
  return lines.slice(0, maxLines);
}

function fitLines(text: string, options: { maxWidth: number; maxLines: number; initialSize: number; minSize: number }) {
  for (let size = options.initialSize; size >= options.minSize; size -= 2) {
    const lines = wrapText(text, options.maxWidth, size, options.maxLines);
    if (lines.every((line) => estimateWidth(line, size) <= options.maxWidth)) {
      return { lines, fontSize: size };
    }
  }
  return { lines: wrapText(text, options.maxWidth, options.minSize, options.maxLines), fontSize: options.minSize };
}

function textSvg(lines: TextLine[]) {
  return lines
    .map((line) => (
      `<text x="${line.x}" y="${line.y}" text-anchor="${line.anchor || "middle"}" font-family="AdAtlasKR, 'Malgun Gothic', sans-serif" font-size="${line.fontSize}" font-weight="${line.weight || 800}" fill="${line.fill}">${escapeXml(line.text)}</text>`
    ))
    .join("");
}

async function renderBoldCommerce(body: RenderBody) {
  const width = body.canvasSize?.width || 1200;
  const height = body.canvasSize?.height || 1200;
  if (width !== 1200 || height !== 1200) {
    throw new Error("현재 템플릿은 1200x1200만 지원합니다.");
  }

  const copy = body.copy ?? {};
  const style = {
    backgroundColor: body.style?.backgroundColor || "#ffffff",
    headlineColor: body.style?.headlineColor || "#e60012",
    highlightBackground: body.style?.highlightBackground || "#fff200",
    bottomBarColor: body.style?.bottomBarColor || "#e60012",
    ctaBarColor: body.style?.ctaBarColor || "#de6f6f",
  };
  const productImageDataUrl = await imageToDataUrl(body.productImagePath || "");

  const headline = fitLines(copy.headline || "", { maxWidth: 1040, maxLines: 2, initialSize: 82, minSize: 48 });
  const bodyCopy = fitLines(copy.bodyCopy || "", { maxWidth: 980, maxLines: 2, initialSize: 36, minSize: 24 });
  const highlight = fitLines(copy.highlightCopy || "", { maxWidth: 900, maxLines: 1, initialSize: 40, minSize: 24 });
  const bottom = fitLines(copy.bottomBarCopy || "", { maxWidth: 1040, maxLines: 1, initialSize: 38, minSize: 24 });
  const cta = fitLines(copy.cta || "", { maxWidth: 760, maxLines: 1, initialSize: 38, minSize: 24 });
  const price = fitLines(copy.price || "", { maxWidth: 320, maxLines: 1, initialSize: 40, minSize: 24 });

  const textLines: TextLine[] = [
    ...headline.lines.map((line, index) => ({ text: line, x: 600, y: 95 + index * (headline.fontSize + 8), fontSize: headline.fontSize, fill: style.headlineColor, weight: 900 })),
    ...bodyCopy.lines.map((line, index) => ({ text: line, x: 600, y: 255 + index * (bodyCopy.fontSize + 8), fontSize: bodyCopy.fontSize, fill: "#111111", weight: 800 })),
    ...highlight.lines.map((line) => ({ text: line, x: 600, y: 354, fontSize: highlight.fontSize, fill: "#111111", weight: 900 })),
    ...bottom.lines.map((line) => ({ text: line, x: 600, y: 1048, fontSize: bottom.fontSize, fill: "#ffffff", weight: 900 })),
    ...cta.lines.map((line) => ({ text: line, x: 600, y: 1144, fontSize: cta.fontSize, fill: "#ffffff", weight: 900 })),
  ];

  if (copy.price) {
    textLines.push(...price.lines.map((line) => ({ text: line, x: 980, y: 840, fontSize: price.fontSize, fill: "#ffffff", weight: 900 })));
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
    </style>
  </defs>
  <rect width="${width}" height="${height}" fill="${style.backgroundColor}" />
  <rect x="126" y="312" width="948" height="68" rx="12" fill="${style.highlightBackground}" />
  ${productImageDataUrl ? `<image href="${productImageDataUrl}" x="230" y="405" width="740" height="520" preserveAspectRatio="xMidYMid meet" />` : `<rect x="250" y="430" width="700" height="460" rx="26" fill="#f3f4f6" /><text x="600" y="670" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="800" fill="#6b7280">PRODUCT IMAGE</text>`}
  ${copy.price ? `<rect x="804" y="772" width="352" height="96" rx="48" fill="${style.bottomBarColor}" />` : ""}
  <rect x="0" y="990" width="${width}" height="94" fill="${style.bottomBarColor}" />
  <rect x="210" y="1100" width="780" height="70" rx="35" fill="${style.ctaBarColor}" />
  ${textSvg(textLines)}
</svg>`;

  await fs.mkdir(outputDir, { recursive: true });
  const fileName = `generated-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`;
  const outputPath = path.join(outputDir, fileName);
  await sharp(Buffer.from(svg)).png().resize(1200, 1200).toFile(outputPath);

  return `/generated-ads/${fileName}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RenderBody;
    const templateId = body.templateId || "bold-commerce-001";
    if (templateId !== "bold-commerce-001") {
      return NextResponse.json({ success: false, error: "지원하지 않는 templateId입니다." }, { status: 400 });
    }

    const imagePath = await renderBoldCommerce(body);
    return NextResponse.json({ success: true, imagePath, templateId });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "배너 생성 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
