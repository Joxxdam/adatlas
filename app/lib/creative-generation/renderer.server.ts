import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { prepareLogoForSurface } from "../mvp/adaptiveLogo.server.ts";
import { readCreativeRasterAsset } from "./assets.server.ts";
import { isCompositableImageRole } from "./productImages.server.ts";
import { qaRenderedCreative } from "./qa.ts";
import { resolveRenderedSlots } from "./textLayout.server.ts";
import type {
  CopyPlan,
  GenerationJob,
  GenerationResult,
  LayoutPlan,
  PlacementBox,
  ProductCompositionInstance,
  RenderPlan,
} from "./types.ts";

const OUTPUT_DIR = path.join(process.cwd(), "public", "generated-ads");
const FONT_FAMILY = "Noto Sans KR, Apple SD Gothic Neo, Arial, sans-serif";

function xml(value: string) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function unionBoxes(boxes: PlacementBox[]): PlacementBox {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export async function buildRenderPlan(
  job: GenerationJob,
  result: GenerationResult,
  overrides: Partial<CopyPlan> = {},
  repairPass = 0
): Promise<RenderPlan> {
  const master = job.creativePlan.masterDesign;
  const copy = copyFor(result, overrides);
  const productImageAssets = job.productTruth.imageAssets.filter(
    (asset) => asset.verified && isCompositableImageRole(asset.role)
  );
  const productImagePaths = productImageAssets.map((asset) => asset.path);
  const product = unionBoxes(master.productComposition.instances);
  const layout: LayoutPlan = {
    blueprintId: master.layoutFamily,
    placement: {
      product,
      text: master.headlineBox,
      logo: master.logoBox,
      scene: { x: 0, y: 0, width: 1200, height: 1200 },
      safeMargin: 48,
    },
    colors: master.palette,
    fontFamily: FONT_FAMILY,
    headlineFontSize: master.typography.headlineFontSize,
    bodyFontSize: master.typography.subCopyFontSize,
    minFontSize: Math.min(master.headlineBox.minFontSize, master.subCopyBox.minFontSize),
  };
  return {
    id: `render-${job.id}-${result.id}-${repairPass}`,
    jobId: job.id,
    resultId: result.id,
    width: 1200,
    height: 1200,
    outputFormat: "webp",
    maxFileSizeBytes: 800 * 1024,
    copy,
    layout,
    scene: result.scenePlan,
    productImagePaths,
    productImageAssets,
    productComposition: master.productComposition,
    masterDesignId: master.id,
    backgroundAssetId: master.backgroundAssetId,
    renderedSlots: await resolveRenderedSlots({
      master,
      hooks: job.creativePlan.hookPlans,
      copy,
    }),
    logoAsset: job.creativePlan.brandProfile.logoAssets[0],
    repairPass,
  };
}

function underlaySvg(plan: RenderPlan) {
  const colors = plan.layout.colors;
  const id = plan.layout.blueprintId;
  const common = `<defs>
    <linearGradient id="leftFade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${colors.background}" stop-opacity=".96"/><stop offset=".82" stop-color="${colors.background}" stop-opacity=".63"/><stop offset="1" stop-color="${colors.background}" stop-opacity="0"/></linearGradient>
    <linearGradient id="topFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors.background}" stop-opacity=".95"/><stop offset="1" stop-color="${colors.background}" stop-opacity="0"/></linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${colors.background}" stop-opacity="0"/><stop offset="1" stop-color="${colors.background}" stop-opacity=".94"/></linearGradient>
  </defs>`;
  const shapes: Record<string, string> = {
    "problem-solution-split": `<rect width="650" height="1200" fill="url(#leftFade)"/><path d="M610 0H1200V1200H760Z" fill="${colors.accent}" opacity=".08"/>`,
    "editorial-story": `<rect width="920" height="535" fill="${colors.background}" fill-opacity=".91"/><rect x="920" width="280" height="535" fill="url(#topFade)"/><rect y="650" width="650" height="550" fill="url(#bottomFade)"/><circle cx="890" cy="700" r="330" fill="${colors.accent}" opacity=".10"/>`,
    "chat-ugc": `<rect width="1200" height="1200" fill="${colors.background}" opacity=".26"/><rect x="390" y="120" width="760" height="850" rx="48" fill="${colors.background}" opacity=".16"/>`,
    "comparison-versus": `<rect width="640" height="1200" fill="url(#leftFade)"/><path d="M680 0H1200V1200H480Z" fill="${colors.accent}" opacity=".14"/><path d="M680 0L480 1200" stroke="${colors.foreground}" stroke-opacity=".45" stroke-width="5"/>`,
    "product-hero-lifestyle": `<rect width="650" height="1200" fill="url(#leftFade)"/><circle cx="870" cy="640" r="360" fill="${colors.accent}" opacity=".13"/>`,
    "proof-data": `<rect width="680" height="1200" fill="url(#leftFade)"/><circle cx="890" cy="680" r="340" fill="${colors.accent}" opacity=".11"/>`,
  };
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200">${common}${shapes[id] || shapes["product-hero-lifestyle"]}</svg>`
  );
}

function slotSvg(plan: RenderPlan) {
  const master = plan.layout.colors;
  const slots = plan.renderedSlots;
  const markup = slots
    .map((slot) => {
      const radius = slot.id === "cta" ? Math.floor(slot.box.height / 2) : 20;
      const panel = slot.fillColor
        ? `<rect x="${slot.box.x}" y="${slot.box.y}" width="${slot.box.width}" height="${slot.box.height}" rx="${radius}" fill="${slot.fillColor}" ${slot.id === "cta" ? "" : 'fill-opacity=".92"'}/>`
        : "";
      const anchor = slot.id === "cta" ? "middle" : "start";
      const x = slot.id === "cta" ? slot.box.x + slot.box.width / 2 : slot.textBounds.x;
      const firstBaseline =
        slot.textBounds.y + slot.fontSize * (slot.id === "cta" ? 0.83 : 0.88);
      const text = `<text x="${x}" y="${firstBaseline}" fill="${slot.textColor}" font-family="${FONT_FAMILY}" font-size="${slot.fontSize}" font-weight="${slot.id === "body" ? 700 : 900}" text-anchor="${anchor}">${slot.lines
        .map(
          (line, index) =>
            `<tspan x="${x}" dy="${index === 0 ? 0 : slot.lineHeight}">${xml(line)}</tspan>`
        )
        .join("")}</text>`;
      return `${panel}${text}`;
    })
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><style>text{paint-order:stroke;stroke:${master.background};stroke-width:1.4px;stroke-opacity:.22}</style>${markup}</svg>`
  );
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
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}"><rect width="100%" height="100%" rx="28" fill="#fff"/></svg>`
          ),
          blend: "dest-in",
        },
      ])
      .png()
      .toBuffer();
  }
  return image.png().toBuffer();
}

async function productComposite(product: Buffer, instance: ProductCompositionInstance) {
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

async function productLayer(plan: RenderPlan) {
  if (!plan.productImagePaths[0]) {
    throw new Error(
      "광고 합성용 상품 이미지가 없습니다. 참고 광고가 아닌 제품 단독 이미지 또는 누끼를 확정해 주세요."
    );
  }
  const composites: Array<{ input: Buffer; left: number; top: number }> = [];
  for (const instance of plan.productComposition.instances) {
    const sourcePath =
      plan.productImagePaths[instance.sourceIndex ?? 0] || plan.productImagePaths[0];
    const asset = plan.productImageAssets.find((item) => item.path === sourcePath);
    if (!asset || !isCompositableImageRole(asset.role)) {
      throw new Error("참고 광고·리뷰·배경 이미지를 상품 레이어에 합성하려는 요청을 차단했습니다.");
    }
    if (plan.productComposition.requiresTransparentProduct && !asset.transparent) {
      throw new Error("반복·겹침 배치는 투명 배경의 실제 상품 누끼에서만 사용할 수 있습니다.");
    }
    const source = await readCreativeRasterAsset(sourcePath);
    composites.push({
      input: await productComposite(source, instance),
      left: instance.x,
      top: instance.y,
    });
  }
  const layer = await sharp({
    create: {
      width: 1200,
      height: 1200,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
  const { data, info } = await sharp(layer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      if (alpha < 20) continue;
      visible += alpha / 255;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  const bounds =
    right >= left && bottom >= top
      ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
      : { x: 0, y: 0, width: 0, height: 0 };
  return {
    layer,
    pixelAreaRatio: Number((visible / (1200 * 1200)).toFixed(4)),
    bounds,
  };
}

async function encodeWithinLimit(png: Buffer, maxBytes: number) {
  for (const quality of [88, 82, 76, 70, 64, 56, 48, 40]) {
    const buffer = await sharp(png).webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
    if (buffer.length <= maxBytes) return { buffer, quality };
  }
  return { buffer: await sharp(png).webp({ quality: 34, effort: 6 }).toBuffer(), quality: 34 };
}

export async function renderCreativeResult(input: {
  job: GenerationJob;
  result: GenerationResult;
  overrides?: Partial<CopyPlan>;
  repairPass?: number;
  autoRepairs?: string[];
}) {
  const renderPlan = await buildRenderPlan(
    input.job,
    input.result,
    input.overrides,
    input.repairPass || 0
  );
  let scene: Buffer;
  try {
    scene = await readCreativeRasterAsset(renderPlan.scene.sceneAsset.file);
  } catch {
    scene = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><rect width="1200" height="1200" fill="${renderPlan.layout.colors.background}"/><circle cx="900" cy="420" r="430" fill="${renderPlan.layout.colors.accent}" opacity=".18"/></svg>`
    );
  }
  const base = await sharp(scene)
    .rotate()
    .resize(1200, 1200, { fit: "cover", position: "centre" })
    .png()
    .toBuffer();
  const underlay = underlaySvg(renderPlan);
  const product = await productLayer(renderPlan);
  const baseComposites: Array<{ input: Buffer; left: number; top: number }> = [
    { input: underlay, left: 0, top: 0 },
    { input: product.layer, left: 0, top: 0 },
  ];
  const surfaceBeforeLogo = await sharp(base).composite(baseComposites).png().toBuffer();
  let logoRendered = false;
  if (renderPlan.logoAsset?.path) {
    try {
      const logo = await readCreativeRasterAsset(renderPlan.logoAsset.path);
      const logoBox = input.job.creativePlan.masterDesign.logoBox;
      const preparedLogo = await prepareLogoForSurface({
        logoBuffer: logo,
        surfaceBuffer: surfaceBeforeLogo,
        surfaceBox: logoBox,
      });
      baseComposites.push({
        input: await fitRaster(preparedLogo.buffer, logoBox),
        left: logoBox.x,
        top: logoBox.y,
      });
      logoRendered = true;
    } catch {
      // A missing optional logo does not block a product-first creative.
    }
  }
  const surfaceBeforeText = await sharp(base).composite(baseComposites).png().toBuffer();
  const overlay = slotSvg(renderPlan);
  const png = await sharp(surfaceBeforeText)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  const encoded = await encodeWithinLimit(png, renderPlan.maxFileSizeBytes);
  const qa = await qaRenderedCreative({
    buffer: encoded.buffer,
    surfaceBeforeText,
    renderPlan,
    truth: input.job.productTruth,
    hookPlan: input.result.hookPlan,
    productPixelAreaRatio: product.pixelAreaRatio,
    productBounds: product.bounds,
    logoRendered,
    autoRepairs: input.autoRepairs || [],
  });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const digest = crypto.createHash("sha256").update(encoded.buffer).digest("hex").slice(0, 10);
  const hookCode = input.result.hookPlan.hookCode;
  const fileName = `creative-${input.job.id}-${hookCode}-${input.result.blueprintId}-${digest}.webp`;
  await fs.writeFile(path.join(OUTPUT_DIR, fileName), encoded.buffer);
  const productName = String(input.job.productTruth.product.productName || "product").replace(
    /[^a-z0-9가-힣]+/gi,
    "-"
  );
  return {
    imagePath: `/generated-ads/${fileName}`,
    downloadName: `${productName}-${input.job.creativePlan.testCode}-${hookCode}.webp`,
    renderPlan,
    qa,
    outputQuality: encoded.quality,
  };
}
