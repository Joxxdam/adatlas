import "server-only";

import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { removeBackgroundToPng } from "../mvp/imageEffects";
import { categoryCreativeJobDirectory, readCategoryCreativeSourceFile } from "./repository.server";
import type { CategoryCreativeCopy, CategoryCreativeJob, CategoryCreativeSource, CategoryCreativeStyle } from "./types";

type Ratio = "square" | "vertical";

const palettes = {
  auto: { background: "#ece6df", backgroundAlt: "#d7c5c3", text: "#171719", accent: "#725b75" },
  editorial: { background: "#eee9e4", backgroundAlt: "#cbc0b8", text: "#141414", accent: "#5f5368" },
  practical: { background: "#f4f2ec", backgroundAlt: "#d8d8ce", text: "#151515", accent: "#455c5f" },
  seasonal: { background: "#eadfdc", backgroundAlt: "#c8c1d4", text: "#1c171b", accent: "#8b3f55" },
  friendly: { background: "#f4e5e7", backgroundAlt: "#d9e5df", text: "#21191b", accent: "#9a5e6c" },
} as const;

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] || character);
}

function lines(value: string, maxCharacters: number, maxLines: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharacters && current) {
      result.push(current);
      current = word;
    } else current = next;
  }
  if (current) result.push(current);
  return result.slice(0, maxLines);
}

async function preparedSource(source: CategoryCreativeSource) {
  const raw = await readCategoryCreativeSourceFile(source);
  const normalized = await sharp(raw).rotate().resize({ width: 1500, height: 1800, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const metadata = await sharp(normalized).metadata();
  if (metadata.hasAlpha) return normalized;
  try {
    const cutout = await removeBackgroundToPng(normalized, { extractionScope: "sales-unit", threshold: 42, featherRadius: 0.55 });
    const alphaStats = await sharp(cutout).ensureAlpha().extractChannel(3).stats();
    if (alphaStats.channels[0].mean > 32) return cutout;
  } catch {
    // A failed local cutout must not alter or block the original product image.
  }
  return normalized;
}

function backgroundSvg(width: number, height: number, palette: CategoryCreativeJob["palette"], ratio: Ratio) {
  const circleX = ratio === "square" ? width * 0.82 : width * 0.78;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.background}"/><stop offset="1" stop-color="${palette.backgroundAlt}"/></linearGradient><filter id="grain"><feTurbulence baseFrequency="0.8" numOctaves="2" seed="8" type="fractalNoise"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .035 0"/></filter></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><circle cx="${circleX}" cy="${height * 0.18}" r="${width * 0.28}" fill="#ffffff" opacity=".22"/><path d="M0 ${height * 0.7} C ${width * 0.25} ${height * 0.61}, ${width * 0.67} ${height * 0.83}, ${width} ${height * 0.68} V ${height} H0Z" fill="#fff" opacity=".16"/><rect width="100%" height="100%" filter="url(#grain)" opacity=".55"/>
  </svg>`);
}

function textSvg(width: number, height: number, copy: CategoryCreativeCopy, palette: CategoryCreativeJob["palette"], ratio: Ratio, fontBase64: string) {
  const headlineLines = lines(copy.headline, ratio === "square" ? 15 : 13, 3);
  const headlineSize = ratio === "square" ? 77 : 76;
  const startY = ratio === "square" ? 92 : 145;
  const lineHeight = Math.round(headlineSize * 1.18);
  const textNodes = headlineLines.map((line, index) => `<text x="${ratio === "square" ? 72 : 74}" y="${startY + headlineSize + lineHeight * index}" font-size="${headlineSize}" font-weight="800" fill="${palette.text}">${escapeXml(line)}</text>`).join("");
  const subY = startY + headlineSize + lineHeight * headlineLines.length + 30;
  const ctaY = ratio === "square" ? height - 58 : height - 96;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><style>@font-face{font-family:Noto;src:url(data:font/ttf;base64,${fontBase64})} text{font-family:Noto,sans-serif}</style>
    ${textNodes}
    ${copy.subheadline ? `<rect x="${ratio === "square" ? 72 : 74}" y="${subY - 35}" width="${Math.min(width - 144, Math.max(280, copy.subheadline.length * 31))}" height="58" rx="4" fill="${palette.accent}" opacity=".92"/><text x="${ratio === "square" ? 90 : 92}" y="${subY + 7}" font-size="30" font-weight="650" fill="#fff">${escapeXml(copy.subheadline)}</text>` : ""}
    ${copy.cta ? `<text x="${width - 70}" y="${ctaY}" text-anchor="end" font-size="28" font-weight="700" fill="${palette.text}" opacity=".82">${escapeXml(copy.cta)} →</text>` : ""}
  </svg>`);
}

function layout(ratio: Ratio, count: number) {
  if (ratio === "square") {
    const layouts = [
      { left: 55, top: 410, width: 365, height: 690, rotate: -3 },
      { left: 330, top: 360, width: 430, height: 760, rotate: 1 },
      { left: 690, top: 405, width: 430, height: 700, rotate: 3 },
      { left: 860, top: 520, width: 285, height: 555, rotate: 4 },
      { left: 35, top: 560, width: 290, height: 530, rotate: -5 },
    ];
    return layouts.slice(0, count);
  }
  const layouts = [
    { left: 45, top: 650, width: 430, height: 760, rotate: -2 },
    { left: 445, top: 590, width: 560, height: 900, rotate: 2 },
    { left: 65, top: 1240, width: 430, height: 600, rotate: -1 },
    { left: 530, top: 1340, width: 480, height: 500, rotate: 2 },
    { left: 310, top: 1030, width: 440, height: 700, rotate: 0 },
  ];
  return layouts.slice(0, count);
}

async function renderBase(job: CategoryCreativeJob, sources: CategoryCreativeSource[], ratio: Ratio) {
  const width = ratio === "square" ? 1200 : 1080;
  const height = ratio === "square" ? 1200 : 1920;
  const prepared = await Promise.all(sources.map(preparedSource));
  const positions = layout(ratio, prepared.length);
  const composites = await Promise.all(prepared.map(async (buffer, index) => {
    const position = positions[index];
    const image = await sharp(buffer).resize({ width: position.width, height: position.height, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).rotate(position.rotate, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    return { input: image, left: position.left, top: position.top };
  }));
  const buffer = await sharp(backgroundSvg(width, height, job.palette, ratio)).composite(composites).png().toBuffer();
  const fileName = `${ratio}-base.png`;
  await fs.writeFile(path.join(categoryCreativeJobDirectory(job.id), fileName), buffer);
  return { buffer, fileName, width, height };
}

async function renderFinal(job: CategoryCreativeJob, ratio: Ratio, baseBuffer?: Buffer) {
  const output = job.outputs?.[ratio];
  const width = ratio === "square" ? 1200 : 1080;
  const height = ratio === "square" ? 1200 : 1920;
  const base = baseBuffer || await fs.readFile(path.join(categoryCreativeJobDirectory(job.id), output?.baseFileName || `${ratio}-base.png`));
  const fontBase64 = (await fs.readFile(path.join(process.cwd(), "public", "fonts", "NotoSansKR-Variable.ttf"))).toString("base64");
  const fileName = `${ratio}.jpg`;
  await sharp(base).composite([{ input: textSvg(width, height, job.copy, job.palette, ratio, fontBase64), left: 0, top: 0 }]).jpeg({ quality: 84, mozjpeg: true }).toFile(path.join(categoryCreativeJobDirectory(job.id), fileName));
  const metadata = await sharp(path.join(categoryCreativeJobDirectory(job.id), fileName)).metadata();
  if (metadata.width !== width || metadata.height !== height || metadata.format !== "jpeg") throw new Error(`${ratio} 결과 규격 검증에 실패했습니다.`);
  return { fileName, width, height };
}

export function defaultCategoryCreativeCopy(categoryName: string, style: CategoryCreativeStyle): CategoryCreativeCopy {
  const seasonal = style === "seasonal" || style === "auto";
  return {
    headline: seasonal ? `요즘 ${categoryName}, 이렇게 입어요` : `${categoryName} 코디를 한눈에`,
    subheadline: "서로 다른 무드를 한 장에서 비교해보세요",
    cta: "스타일 모아보기",
  };
}

export async function composeCategoryCreative(job: CategoryCreativeJob, sources: CategoryCreativeSource[]) {
  await fs.mkdir(categoryCreativeJobDirectory(job.id), { recursive: true });
  const squareBase = await renderBase(job, sources, "square");
  const verticalBase = await renderBase(job, sources, "vertical");
  const square = await renderFinal(job, "square", squareBase.buffer);
  const vertical = await renderFinal(job, "vertical", verticalBase.buffer);
  return {
    square: { width: 1200 as const, height: 1200 as const, fileName: square.fileName, baseFileName: squareBase.fileName },
    vertical: { width: 1080 as const, height: 1920 as const, fileName: vertical.fileName, baseFileName: verticalBase.fileName },
  };
}

export async function rerenderCategoryCreativeCopy(job: CategoryCreativeJob) {
  await renderFinal(job, "square");
  await renderFinal(job, "vertical");
}

export function paletteForStyle(style: CategoryCreativeStyle) {
  return palettes[style];
}
