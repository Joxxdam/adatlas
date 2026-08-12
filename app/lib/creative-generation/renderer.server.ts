import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { prepareLogoForSurface } from "../mvp/adaptiveLogo.server.ts";
import { getCreativeBlueprint } from "./blueprints.ts";
import { readCreativeRasterAsset } from "./assets.server.ts";
import { brandPalette } from "./planner.ts";
import { qaRenderedCreative } from "./qa.ts";
import type {
  CopyPlan,
  GenerationJob,
  GenerationResult,
  LayoutPlan,
  PlacementBox,
  ProductCompositionInstance,
  ProductCompositionPlan,
  RenderPlan,
} from "./types";

const OUTPUT_DIR = path.join(process.cwd(), "public", "generated-ads");
const FONT_FAMILY = "Pretendard, Noto Sans KR, Apple SD Gothic Neo, Arial, sans-serif";

function xml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function charUnits(value: string) {
  return Array.from(value).reduce((sum, character) => sum + (/^[\x00-\x7f]$/.test(character) ? 0.58 : 1), 0);
}

function wrapParagraph(value: string, maxUnits: number) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = "";
  const pushLongWord = (word: string) => {
    let segment = "";
    for (const character of Array.from(word)) {
      if (segment && charUnits(segment + character) > maxUnits) {
        lines.push(segment);
        segment = character;
      } else segment += character;
    }
    current = segment;
  };
  for (const word of words) {
    if (!current && charUnits(word) > maxUnits) {
      pushLongWord(word);
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (current && charUnits(candidate) > maxUnits) {
      lines.push(current);
      if (charUnits(word) > maxUnits) pushLongWord(word);
      else current = word;
    } else current = candidate;
  }
  if (current) lines.push(current);
  return lines;
}

type FittedText = { lines: string[]; fontSize: number; lineHeight: number; overflow: boolean };

function fitText(value: string, box: PlacementBox, startSize: number, minSize: number, maxLines: number): FittedText {
  const normalized = String(value || "").replace(/\r/g, "").trim();
  if (!normalized) return { lines: [], fontSize: startSize, lineHeight: startSize * 1.16, overflow: false };
  for (let fontSize = startSize; fontSize >= minSize; fontSize -= 2) {
    const maxUnits = Math.max(4, box.width / (fontSize * 0.96));
    const lines = normalized.split("\n").flatMap((part) => wrapParagraph(part, maxUnits));
    const lineHeight = fontSize * 1.16;
    if (lines.length <= maxLines && lines.length * lineHeight <= box.height) {
      return { lines, fontSize, lineHeight, overflow: false };
    }
  }
  const lines = normalized
    .split("\n")
    .flatMap((part) => wrapParagraph(part, Math.max(4, box.width / (minSize * 0.96))));
  return { lines, fontSize: minSize, lineHeight: minSize * 1.12, overflow: lines.length > maxLines || lines.length * minSize * 1.12 > box.height };
}

function textSvg(fit: FittedText, x: number, y: number, color: string, weight = 800, anchor: "start" | "middle" = "start") {
  return `<text x="${x}" y="${y}" fill="${color}" font-family="${FONT_FAMILY}" font-size="${fit.fontSize}" font-weight="${weight}" text-anchor="${anchor}">${fit.lines.map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : fit.lineHeight}">${xml(line)}</tspan>`).join("")}</text>`;
}

function layoutFor(job: GenerationJob, result: GenerationResult, repairPass: number): LayoutPlan {
  const blueprint = getCreativeBlueprint(result.blueprintId);
  const colors = brandPalette(job.creativePlan.brandProfile, job.creativePlan.categoryProfile.fallbackColors);
  return {
    blueprintId: result.blueprintId,
    placement: {
      product: blueprint.productBox,
      text: blueprint.textSafeArea,
      logo: blueprint.logoBox,
      scene: { x: 0, y: 0, width: 1200, height: 1200 },
      safeMargin: 48,
    },
    colors,
    fontFamily: FONT_FAMILY,
    headlineFontSize: repairPass ? 62 : 70,
    bodyFontSize: repairPass ? 34 : 38,
    minFontSize: repairPass ? 28 : 30,
  };
}

function copyFor(result: GenerationResult, overrides: Partial<CopyPlan> = {}): CopyPlan {
  const base: CopyPlan = {
    headline: result.hookPlan.headline,
    body: result.hookPlan.body,
    proof: result.hookPlan.proof,
    offer: result.hookPlan.offer,
    cta: result.hookPlan.cta,
    factIds: result.hookPlan.factIds,
    numericTokens: result.hookPlan.numericTokens,
  };
  return { ...base, ...overrides, factIds: base.factIds, numericTokens: base.numericTokens };
}

function singleProductComposition(
  productBox: PlacementBox,
  fit: "contain" | "cover" = "contain",
  rotation = 0
): ProductCompositionPlan {
  return {
    mode: "single",
    requiresTransparentProduct: false,
    instances: [{ ...productBox, role: "primary", fit, rotation }],
  };
}

export function buildRenderPlan(
  job: GenerationJob,
  result: GenerationResult,
  overrides: Partial<CopyPlan> = {},
  repairPass = 0
): RenderPlan {
  const layout = layoutFor(job, result, repairPass);
  return {
    id: `render-${job.id}-${result.id}-${repairPass}`,
    jobId: job.id,
    resultId: result.id,
    width: 1200,
    height: 1200,
    outputFormat: "webp",
    maxFileSizeBytes: 800 * 1024,
    copy: copyFor(result, overrides),
    layout,
    scene: result.scenePlan,
    productImagePaths: job.productTruth.imagePaths,
    productComposition:
      getCreativeBlueprint(result.blueprintId).productComposition ||
      singleProductComposition(
        layout.placement.product,
        result.blueprintId === "chat-ugc" ? "cover" : "contain"
      ),
    logoAsset: job.creativePlan.brandProfile.logoAssets[0],
    repairPass,
  };
}

function underlaySvg(plan: RenderPlan) {
  const { blueprintId: id, colors } = plan.layout;
  const common = `<defs><linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#05080d" stop-opacity=".94"/><stop offset="1" stop-color="#05080d" stop-opacity=".04"/></linearGradient><linearGradient id="bottom" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05080d" stop-opacity="0"/><stop offset="1" stop-color="#05080d" stop-opacity=".94"/></linearGradient></defs>`;
  const shapes = {
    "problem-solution-split": `<rect x="650" width="550" height="900" fill="#fff"/><rect y="900" width="1200" height="300" fill="#080b10"/><rect x="650" y="590" width="550" height="310" fill="#05080d"/>`,
    "editorial-story": `<rect width="1200" height="470" fill="#090b0d"/><rect y="470" width="1200" height="730" fill="url(#bottom)"/><rect x="70" y="310" width="920" height="86" rx="8" fill="${colors.accent}"/>`,
    "chat-ugc": `<rect width="1200" height="1200" fill="#c9ddeb"/><rect y="935" width="1200" height="265" fill="#07090c"/><circle cx="115" cy="80" r="45" fill="#8797a2"/><rect x="190" y="665" width="600" height="92" rx="28" fill="#fff"/><rect x="530" y="770" width="590" height="150" rx="28" fill="#ffe500"/>`,
    "comparison-versus": `<path d="M0 0H650L410 1200H0Z" fill="#ff4b35" opacity=".38"/><path d="M650 0H1200V1200H410Z" fill="#36c8ff" opacity=".32"/><path d="M653 0L410 1200" stroke="#fff" stroke-opacity=".9" stroke-width="8"/><rect y="730" width="1200" height="470" fill="url(#bottom)"/>`,
    "product-hero-lifestyle": `<rect width="760" height="1200" fill="url(#fade)"/><rect y="900" width="1200" height="300" fill="url(#bottom)"/><circle cx="850" cy="650" r="340" fill="${colors.accent}" opacity=".14"/>`,
    "proof-data": `<rect width="1200" height="1200" fill="#080b10" opacity=".9"/><rect x="70" y="500" width="680" height="355" rx="28" fill="#151b22" stroke="#303a46" stroke-width="3"/><rect x="92" y="525" width="305" height="280" rx="18" fill="${colors.accent}" opacity=".13"/><rect x="420" y="525" width="305" height="280" rx="18" fill="#2768ff" opacity=".16"/><path d="M110 760C210 610 290 725 380 585S565 680 700 555" fill="none" stroke="${colors.accent}" stroke-width="12"/>`,
  }[id];
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">${common}${shapes}</svg>`);
}

function overlaySvg(plan: RenderPlan) {
  const { blueprintId: id, colors, placement } = plan.layout;
  const c = plan.copy;
  const fits: FittedText[] = [];
  const add = (fit: FittedText) => (fits.push(fit), fit);
  let markup = "";
  if (id === "problem-solution-split") {
    const headline = add(fitText(c.headline, { x: 705, y: 95, width: 425, height: 390 }, 72, 48, 5));
    const body = add(fitText(c.body, { x: 705, y: 500, width: 420, height: 105 }, 38, 30, 2));
    const offer = add(fitText(c.offer, { x: 705, y: 955, width: 410, height: 105 }, 44, 30, 2));
    markup += textSvg(headline, 705, 150, "#07090c") + textSvg(body, 705, 540, colors.accent, 800) + textSvg(offer, 340, 1005, "#fff", 800);
  } else if (id === "editorial-story") {
    const headline = add(fitText(c.headline, { x: 70, y: 55, width: 880, height: 240 }, 68, 48, 3));
    const proof = add(fitText(c.proof, { x: 95, y: 325, width: 850, height: 70 }, 38, 28, 1));
    const body = add(fitText(c.body, { x: 450, y: 865, width: 650, height: 140 }, 42, 30, 3));
    markup += textSvg(headline, 70, 125, "#fff") + textSvg(proof, 95, 365, "#07110f", 900) + textSvg(body, 450, 925, "#fff", 750);
  } else if (id === "chat-ugc") {
    const headline = add(fitText(c.headline, { x: 220, y: 675, width: 540, height: 74 }, 42, 32, 2));
    const body = add(fitText(c.body, { x: 565, y: 785, width: 515, height: 132 }, 38, 30, 3));
    const cta = add(fitText(c.cta, { x: 70, y: 985, width: 1050, height: 160 }, 44, 30, 3));
    markup += `<text x="260" y="100" font-family="${FONT_FAMILY}" font-size="38" font-weight="800" fill="#34444f">상품 이야기</text>` + textSvg(headline, 220, 720, "#111", 750) + textSvg(body, 565, 825, "#111", 850) + textSvg(cta, 70, 1040, "#fff", 850);
  } else if (id === "comparison-versus") {
    const proof = add(fitText(c.proof, { x: 600, y: 55, width: 500, height: 90 }, 38, 28, 1));
    const headline = add(fitText(c.headline, { x: 70, y: 755, width: 1060, height: 300 }, 74, 48, 4));
    const body = add(fitText(c.body, { x: 70, y: 1040, width: 920, height: 90 }, 36, 28, 2));
    markup += `<rect x="60" y="60" width="470" height="80" rx="40" fill="#fff" opacity=".94"/>` + textSvg(proof, 295, 112, "#101318", 850, "middle") + textSvg(headline, 70, 835, "#fff", 950) + textSvg(body, 70, 1090, colors.accent, 800);
  } else if (id === "product-hero-lifestyle") {
    const headline = add(fitText(c.headline, placement.text, 72, 50, 5));
    const body = add(fitText(c.body, { x: 80, y: 565, width: 480, height: 170 }, 40, 30, 3));
    const offer = add(fitText(c.offer, { x: 80, y: 930, width: 1000, height: 110 }, 42, 30, 2));
    markup += textSvg(headline, 80, 180, "#fff", 900) + textSvg(body, 80, 620, colors.accent, 800) + textSvg(offer, 80, 1000, "#fff", 850);
  } else {
    const headline = add(fitText(c.headline, { x: 70, y: 50, width: 1020, height: 310 }, 66, 46, 4));
    const proof = add(fitText(c.proof, { x: 120, y: 570, width: 260, height: 170 }, 58, 38, 3));
    const body = add(fitText(c.body, { x: 90, y: 880, width: 630, height: 180 }, 38, 28, 3));
    markup += textSvg(headline, 70, 125, "#fff", 900) + textSvg(proof, 120, 640, colors.accent, 950) + textSvg(body, 90, 940, "#fff", 750);
  }
  const ctaX = id === "proof-data" ? 400 : 830;
  const cta = fitText(c.cta, { x: ctaX + 15, y: 1090, width: 285, height: 70 }, 30, 26, 1);
  fits.push(cta);
  markup += `<rect x="${ctaX}" y="1080" width="310" height="72" rx="36" fill="${colors.accent}"/>${textSvg(cta, ctaX + 155, 1127, "#07110f", 850, "middle")}`;
  return {
    buffer: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">${markup}</svg>`),
    overflow: fits.some((fit) => fit.overflow),
    minFontSize: Math.min(...fits.filter((fit) => fit.lines.length).map((fit) => fit.fontSize), 999),
  };
}

async function fitRaster(buffer: Buffer, box: PlacementBox, mode: "contain" | "cover" = "contain") {
  const image = sharp(buffer).rotate().resize(box.width, box.height, {
    fit: mode,
    position: "centre",
    withoutEnlargement: false,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (mode === "cover") {
    return image
      .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"><rect width="100%" height="100%" rx="28" fill="#fff"/></svg>`), blend: "dest-in" }])
      .png()
      .toBuffer();
  }
  return image.png().toBuffer();
}

async function hasUsefulTransparency(buffer: Buffer) {
  try {
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize(96, 96, { fit: "inside", withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let transparent = 0;
    for (let offset = 3; offset < data.length; offset += info.channels) {
      if (data[offset] < 245) transparent += 1;
    }
    return transparent / Math.max(1, info.width * info.height) >= 0.025;
  } catch {
    return false;
  }
}

async function productComposite(
  product: Buffer,
  instance: ProductCompositionInstance
) {
  const raster = await fitRaster(product, instance, instance.fit);
  if (!instance.rotation) return raster;
  return sharp(raster)
    .rotate(instance.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(instance.width, instance.height, {
      fit: "contain",
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

async function encodeWithinLimit(png: Buffer, maxBytes: number) {
  for (const quality of [86, 80, 74, 68, 60, 52, 44, 36]) {
    const buffer = await sharp(png).webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
    if (buffer.length <= maxBytes) return { buffer, quality };
  }
  return { buffer: await sharp(png).webp({ quality: 30, effort: 6 }).toBuffer(), quality: 30 };
}

export async function renderCreativeResult(input: {
  job: GenerationJob;
  result: GenerationResult;
  overrides?: Partial<CopyPlan>;
  repairPass?: number;
}) {
  const renderPlan = buildRenderPlan(input.job, input.result, input.overrides, input.repairPass || 0);
  const blueprint = getCreativeBlueprint(input.result.blueprintId);
  let scene: Buffer;
  try {
    scene = await readCreativeRasterAsset(renderPlan.scene.sceneAsset.file);
  } catch {
    scene = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="${renderPlan.layout.colors.background}"/><circle cx="900" cy="340" r="430" fill="${renderPlan.layout.colors.accent}" opacity=".22"/></svg>`);
  }
  const base = await sharp(scene).rotate().resize(1200, 1200, { fit: "cover", position: "centre" }).png().toBuffer();
  const underlay = underlaySvg(renderPlan);
  const logoSurface = await sharp(base)
    .composite([{ input: underlay, left: 0, top: 0 }])
    .png()
    .toBuffer();
  const composites: Array<{ input: Buffer; left: number; top: number }> = [
    { input: underlay, left: 0, top: 0 },
  ];
  const productPath = renderPlan.productImagePaths[0];
  if (!productPath) throw new Error("광고에 사용할 실제 상품 이미지가 없습니다.");
  const product = await readCreativeRasterAsset(productPath);
  const requestedComposition = renderPlan.productComposition;
  const canRepeat =
    !requestedComposition.requiresTransparentProduct || (await hasUsefulTransparency(product));
  const composition = canRepeat
    ? requestedComposition
    : singleProductComposition(
        blueprint.productBox,
        input.result.blueprintId === "chat-ugc" ? "cover" : "contain"
      );
  renderPlan.productComposition = composition;
  for (const instance of composition.instances) {
    const sourcePath =
      renderPlan.productImagePaths[instance.sourceIndex ?? 0] || productPath;
    const source = sourcePath === productPath ? product : await readCreativeRasterAsset(sourcePath);
    composites.push({
      input: await productComposite(source, instance),
      left: instance.x,
      top: instance.y,
    });
  }
  if (renderPlan.logoAsset?.path) {
    try {
      const logo = await readCreativeRasterAsset(renderPlan.logoAsset.path);
      const logoBox = blueprint.logoBox;
      const preparedLogo = await prepareLogoForSurface({
        logoBuffer: logo,
        // Use the actual layer beneath the logo. Some blueprints add dark or
        // light panels after the scene, so scene-only luminance can choose the
        // wrong brand-mark variant.
        surfaceBuffer: logoSurface,
        surfaceBox: logoBox,
      });
      composites.push({
        input: await fitRaster(preparedLogo.buffer, logoBox),
        left: logoBox.x,
        top: logoBox.y,
      });
    } catch {
      // Missing optional logo never blocks rendering.
    }
  }
  const overlay = overlaySvg(renderPlan);
  composites.push({ input: overlay.buffer, left: 0, top: 0 });
  const png = await sharp(base).composite(composites).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
  const encoded = await encodeWithinLimit(png, renderPlan.maxFileSizeBytes);
  const qa = await qaRenderedCreative({
    buffer: encoded.buffer,
    renderPlan,
    truth: input.job.productTruth,
    textOverflow: overlay.overflow,
    minFontSize: overlay.minFontSize === 999 ? renderPlan.layout.minFontSize : overlay.minFontSize,
  });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const digest = crypto.createHash("sha256").update(encoded.buffer).digest("hex").slice(0, 10);
  const fileName = `creative-${input.job.id}-${input.result.order}-${input.result.blueprintId}-${digest}.webp`;
  await fs.writeFile(path.join(OUTPUT_DIR, fileName), encoded.buffer);
  return {
    imagePath: `/generated-ads/${fileName}`,
    downloadName: `${String(input.job.productTruth.product.productName || "product").replace(/[^a-z0-9가-힣]+/gi, "-")}-${input.result.order}-${input.result.blueprintId}.webp`,
    renderPlan,
    qa,
    outputQuality: encoded.quality,
  };
}
