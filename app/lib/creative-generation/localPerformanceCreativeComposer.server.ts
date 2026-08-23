import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { removeBackgroundToPng } from "../mvp/imageEffects.ts";
import { embeddedFontFace, creativeFontRegistry } from "./creativeFontRegistry.server.ts";
import { assertCreativeCopyAllowed } from "./bannedCreativePhrases.ts";
import type { PerformanceTemplate, PaletteId } from "./performanceTemplateRegistry";
import type { GenerationJob, GenerationResult } from "./types";

export const LOCAL_COMPOSER_VERSION = "local-performance-composer-v1";

const palettes: Record<PaletteId, { ink: string; accent: string; surface: string; bar: string; inverse: string }> = {
  FOOD_SALE: { ink: "#111111", accent: "#ffde00", surface: "#fff6e7", bar: "#e61010", inverse: "#ffffff" },
  FOOD_EDITORIAL: { ink: "#20160f", accent: "#e6b95f", surface: "#f8f0e4", bar: "#43291c", inverse: "#ffffff" },
  BODY_COOLING: { ink: "#061f2d", accent: "#19e6c1", surface: "#e6fbff", bar: "#063f63", inverse: "#ffffff" },
  UGC_NATURAL: { ink: "#102519", accent: "#8bea4a", surface: "#f4ffe8", bar: "#174c31", inverse: "#ffffff" },
  PREMIUM_DARK: { ink: "#ffffff", accent: "#f4cf61", surface: "#11151e", bar: "#05070b", inverse: "#ffffff" },
};

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function hashSeed(value: string) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619);
  return hash >>> 0;
}

export function seededHandwritingStyle(seedValue: string) {
  let state = hashSeed(seedValue) || 1;
  const next = () => ((state = Math.imul(state ^ (state >>> 15), 1 | state)) >>> 0) / 4294967296;
  return {
    rotation: Number((-4 + next() * 8).toFixed(2)),
    baseline: Number((-4 + next() * 8).toFixed(2)),
    outline: Number((2 + next() * 3).toFixed(2)),
    underlineWave: Number((3 + next() * 6).toFixed(2)),
  };
}

function wrapKorean(value: string, maxChars: number, maxLines = 2) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (Array.from(next).length <= maxChars || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const characters = Array.from(clean.replace(/\s+/g, " "));
  const perLine = Math.ceil(characters.length / maxLines);
  return Array.from({ length: maxLines }, (_, index) =>
    characters
      .slice(index * perLine, (index + 1) * perLine)
      .join("")
      .trim()
  ).filter(Boolean);
}

function textBlock(lines: string[], x: number, y: number, fontSize: number, color: string, family: string, anchor: "start" | "middle" = "start", weight = 800, lineHeight = 1.05) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${color}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" paint-order="stroke" stroke="rgba(0,0,0,.08)" stroke-width="1">${lines.map((line, index) => `<tspan x="${x}" dy="${index ? fontSize * lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function productBox(templateId: PerformanceTemplate["id"]) {
  const boxes: Record<PerformanceTemplate["id"], { x: number; y: number; width: number; height: number; repeat: number; angle: number }> = {
    T01_PRICE_SHOCK: { x: 590, y: 285, width: 530, height: 620, repeat: 1, angle: -2 },
    T02_URGENT_OFFER: { x: 620, y: 300, width: 490, height: 650, repeat: 1, angle: 3 },
    T03_QUALITY_PROOF: { x: 615, y: 230, width: 505, height: 690, repeat: 1, angle: 0 },
    T04_SENSORY_EXPERIENCE: { x: 650, y: 285, width: 445, height: 680, repeat: 1, angle: -5 },
    T05_BELIEF_REVERSAL: { x: 640, y: 350, width: 450, height: 640, repeat: 1, angle: 6 },
    T06_USE_CASE: { x: 660, y: 315, width: 430, height: 640, repeat: 1, angle: 0 },
    T07_SOCIAL_PROOF: { x: 670, y: 350, width: 410, height: 590, repeat: 1, angle: -2 },
    T08_UGC_PROBLEM_SOLUTION: { x: 610, y: 400, width: 470, height: 600, repeat: 1, angle: 4 },
    T09_PRODUCT_HERO: { x: 385, y: 260, width: 520, height: 720, repeat: 1, angle: 0 },
    T10_LINEUP_BENEFIT: { x: 220, y: 360, width: 760, height: 590, repeat: 3, angle: 0 },
  };
  return boxes[templateId];
}

async function isolateProduct(file: string, transparent: boolean) {
  const source = await readFile(file);
  const isolated = transparent ? source : await removeBackgroundToPng(source, { extractionScope: "sales-unit", featherRadius: 0.7 });
  return sharp(isolated)
    .rotate()
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function productLayers(product: Buffer, template: PerformanceTemplate) {
  const box = productBox(template.id);
  const count = box.repeat;
  const width = count > 1 ? Math.round(box.width / (count + 0.35)) : box.width;
  const positions = count === 1 ? [box.x] : [box.x, box.x + width * 0.75, box.x + width * 1.5];
  const layers: OverlayOptions[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = count > 1 ? (index - 1) * 4 : box.angle;
    const rendered = await sharp(product)
      .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .resize(width, box.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .sharpen({ sigma: 0.6, m1: 0.5, m2: 1.1 })
      .png()
      .toBuffer();
    const meta = await sharp(rendered).metadata();
    const left = Math.round(positions[index]);
    const top = Math.round(box.y + (count > 1 && index !== 1 ? 40 : 0));
    layers.push({
      input: Buffer.from(`<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="${(meta.width || 1) / 2}" cy="${(meta.height || 1) - 22}" rx="${(meta.width || 1) * 0.34}" ry="22" fill="#000" opacity=".35" filter="blur(12px)"/></svg>`),
      left,
      top,
    });
    layers.push({ input: rendered, left, top });
  }
  return { layers, box };
}

function backgroundOverlay(template: PerformanceTemplate, palette: (typeof palettes)[PaletteId]) {
  const dark = template.id === "T04_SENSORY_EXPERIENCE" || template.id === "T06_USE_CASE" || template.id === "T08_UGC_PROBLEM_SOLUTION";
  return Buffer.from(`<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${palette.surface}" stop-opacity="${dark ? 0.92 : 0.97}"/><stop offset=".52" stop-color="${palette.surface}" stop-opacity="${dark ? 0.55 : 0.22}"/><stop offset="1" stop-color="${palette.surface}" stop-opacity=".04"/></linearGradient></defs><rect width="1200" height="1200" fill="url(#g)"/><rect y="0" width="1200" height="18" fill="${palette.accent}"/></svg>`);
}

async function copyOverlay(input: { job: GenerationJob; result: GenerationResult; template: PerformanceTemplate; palette: (typeof palettes)[PaletteId] }) {
  const { job, result, template, palette } = input;
  const mainRole = template.fontRoles[0];
  const noteRole = template.fontRoles[1] || "HANDWRITTEN_MARKER";
  const [mainFace, noteFace, bodyFace] = await Promise.all([embeddedFontFace(mainRole), embeddedFontFace(noteRole), embeddedFontFace("ROUNDED_BOLD")]);
  const mainFamily = creativeFontRegistry[mainRole].family;
  const noteFamily = creativeFontRegistry[noteRole].family;
  const bodyFamily = creativeFontRegistry.ROUNDED_BOLD.family;
  const headline = result.hookPlan.headline.trim();
  const body = result.hookPlan.body.trim();
  const offer = result.hookPlan.offer.trim();
  const cta = template.cta === "hidden" ? "" : result.hookPlan.cta.trim();
  assertCreativeCopyAllowed([headline, body, offer, cta].join(" "));
  const mainLines = wrapKorean(headline, headline.length > 30 ? 22 : 17, 2);
  const bodyLines = wrapKorean(body, 30, 2);
  const centered = template.id === "T09_PRODUCT_HERO" || template.id === "T10_LINEUP_BENEFIT";
  const x = centered ? 600 : 72;
  const anchor = centered ? "middle" : "start";
  const mainSize = headline.length > 34 ? 64 : headline.length > 24 ? 72 : 84;
  const note = seededHandwritingStyle(`${job.productTruth.productId}:${result.hookPlan.hookCode}:${template.id}`);
  const noteText = bodyLines[0] || "";
  const noteWidth = Math.min(480, Math.max(220, Array.from(noteText).length * 30));
  const price = offer && /\d/.test(offer) ? offer : "";
  const topBanner = template.id === "T02_URGENT_OFFER" && offer ? `<rect x="0" y="18" width="1200" height="92" fill="${palette.bar}"/><text x="600" y="80" text-anchor="middle" fill="${palette.inverse}" font-family="${mainFamily}" font-size="43">${escapeXml(offer)}</text>` : "";
  const bodyY = template.id === "T02_URGENT_OFFER" ? 310 : 275;
  const mainY = template.id === "T02_URGENT_OFFER" ? 190 : 105;
  const priceBar = price && ["T01_PRICE_SHOCK", "T10_LINEUP_BENEFIT"].includes(template.id) ? `<rect x="0" y="1010" width="1200" height="190" fill="${palette.bar}"/><text x="600" y="1133" text-anchor="middle" fill="${palette.accent}" font-family="${mainFamily}" font-size="88" font-weight="900">${escapeXml(price)}</text>` : "";
  const noteX = centered ? 600 - noteWidth / 2 : 72;
  const noteY = template.id === "T08_UGC_PROBLEM_SOLUTION" ? 860 : bodyY + 54;
  const handwriting = noteText ? `<g transform="rotate(${note.rotation} ${noteX + noteWidth / 2} ${noteY})"><rect x="${noteX - 14}" y="${noteY - 43}" width="${noteWidth + 28}" height="58" rx="10" fill="${palette.accent}" opacity=".96"/><text x="${noteX}" y="${noteY + note.baseline}" fill="${palette.ink}" font-family="${noteFamily}" font-size="36" stroke="${palette.surface}" stroke-width="${note.outline}" paint-order="stroke">${escapeXml(noteText)}</text><path d="M ${noteX} ${noteY + 16} q ${noteWidth * 0.22} ${note.underlineWave} ${noteWidth * 0.45} 0 t ${noteWidth * 0.45} 0" stroke="${palette.ink}" stroke-width="5" fill="none" stroke-linecap="round"/></g>` : "";
  const ctaBlock = cta ? `<rect x="72" y="920" width="${Math.min(420, Math.max(210, cta.length * 30))}" height="70" rx="35" fill="${palette.accent}"/><text x="102" y="967" fill="${palette.ink}" font-family="${bodyFamily}" font-size="29" font-weight="800">${escapeXml(cta)}  ›</text>` : "";
  const svg = `<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg"><style>${mainFace}${noteFace}${bodyFace}</style>${topBanner}${textBlock(mainLines, x, mainY, mainSize, palette.ink, mainFamily, anchor, 900, 1.02)}${handwriting}${bodyLines.slice(1).length ? textBlock(bodyLines.slice(1), x, bodyY + 78, 30, palette.ink, bodyFamily, anchor, 700, 1.2) : ""}${ctaBlock}${priceBar}</svg>`;
  return { buffer: Buffer.from(svg), exactText: { headline, body, offer, cta } };
}

export async function composeLocalPerformanceCreative(input: { job: GenerationJob; result: GenerationResult; template: PerformanceTemplate; backgroundPath: string; productImagePath: string; productTransparent?: boolean; outputPath: string }) {
  const paletteId = input.template.palettes[(input.result.order - 1) % input.template.palettes.length];
  const palette = palettes[paletteId];
  const [backgroundSource, product] = await Promise.all([readFile(input.backgroundPath), isolateProduct(input.productImagePath, Boolean(input.productTransparent))]);
  const background = await sharp(backgroundSource).rotate().resize(1200, 1200, { fit: "cover", position: "centre" }).modulate({ brightness: 0.98, saturation: 0.98 }).png().toBuffer();
  const products = await productLayers(product, input.template);
  const copy = await copyOverlay({ job: input.job, result: input.result, template: input.template, palette });
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await sharp(background)
    .composite([{ input: backgroundOverlay(input.template, palette), left: 0, top: 0 }, ...products.layers, { input: copy.buffer, left: 0, top: 0 }])
    .png()
    .toFile(input.outputPath);
  const metadata = await sharp(input.outputPath).metadata();
  if (metadata.width !== 1200 || metadata.height !== 1200) throw new Error("로컬 합성 결과가 1200×1200 규격이 아닙니다.");
  await writeFile(
    `${input.outputPath}.composition.json`,
    `${JSON.stringify(
      {
        version: LOCAL_COMPOSER_VERSION,
        templateId: input.template.id,
        paletteId,
        productSource: input.productImagePath,
        productComposed: true,
        exactText: copy.exactText,
        seededStyle: seededHandwritingStyle(`${input.job.productTruth.productId}:${input.result.hookPlan.hookCode}:${input.template.id}`),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return { templateId: input.template.id, paletteId, productComposed: true, exactText: copy.exactText, productBounds: products.box };
}
