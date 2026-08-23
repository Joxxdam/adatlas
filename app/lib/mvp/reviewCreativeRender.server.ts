import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import sharp from "sharp";
import { loadSafeProductImageBuffer } from "./backgroundRemoval";
import { clampReviewBox, REVIEW_RENDER_VERSION } from "./reviewCreative";
import type { NormalizedImageBox, ReviewCreativeTemplate, ReviewPrivacyRegion } from "./types";

export type ReviewRenderSource = {
  id: string;
  imagePath: string;
  crop: NormalizedImageBox;
  privacyMasks: ReviewPrivacyRegion[];
  highlightBox?: NormalizedImageBox;
};

export type ReviewCreativeRenderInput = {
  template: ReviewCreativeTemplate;
  headline: string;
  reviews: ReviewRenderSource[];
  productImagePath?: string;
  backgroundImagePath?: string;
  accentColor?: string;
};

type Placement = { x: number; y: number; width: number; height: number };

const outputDir = path.join(process.cwd(), "public", "generated-ads");

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function fontFileUrl() {
  return pathToFileURL(path.join(process.cwd(), "public", "fonts", "DoHyeon-Regular.ttf")).href;
}

function wrapHeadline(value: string, maxChars = 20) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if ([...next].length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push("실제 사용 후기에서 나온 반응");
  return lines.slice(0, 3);
}

function templatePalette(template: ReviewCreativeTemplate, accent?: string) {
  if (template === "real-review-focus") return { background: "#f7f2e8", surface: "#ffffff", text: "#171717", accent: "#ef3b35" };
  if (template === "review-collection") return { background: "#17121f", surface: "#ffffff", text: "#ffffff", accent: accent || "#ffcc42" };
  if (template === "before-after-usage") return { background: "#111827", surface: "#ffffff", text: "#ffffff", accent: accent || "#60a5fa" };
  return { background: "#050607", surface: "#ffffff", text: "#35f2c7", accent: accent || "#ef4444" };
}

function baseSvg(template: ReviewCreativeTemplate, accent?: string) {
  const palette = templatePalette(template, accent);
  const extra = template === "reaction-comment" ? `<rect x="80" y="54" width="1040" height="88" rx="4" fill="${palette.accent}" opacity="0.94"/>` : template === "review-collection" ? `<circle cx="1070" cy="95" r="170" fill="${palette.accent}" opacity="0.16"/><circle cx="110" cy="1120" r="230" fill="${palette.accent}" opacity="0.1"/>` : `<rect x="0" y="0" width="1200" height="18" fill="${palette.accent}"/>`;
  return Buffer.from(`<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="1200" fill="${palette.background}"/>
    ${extra}
  </svg>`);
}

function headlineSvg(template: ReviewCreativeTemplate, headline: string, accent?: string) {
  const palette = templatePalette(template, accent);
  const lines = wrapHeadline(headline, template === "reaction-comment" ? 24 : 21);
  const top = template === "reaction-comment" ? 72 : 60;
  const fontSize = lines.length >= 3 ? 52 : lines.length === 2 ? 62 : 72;
  const lineHeight = Math.round(fontSize * 1.16);
  const texts = lines.map((line, index) => `<text x="600" y="${top + fontSize + index * lineHeight}" text-anchor="middle" fill="${template === "reaction-comment" && index === 0 ? "#35f2c7" : palette.text}" font-family="AdAtlasReview" font-size="${fontSize}" font-weight="700">${escapeXml(line)}</text>`).join("");
  return Buffer.from(`<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg">
    <style>@font-face { font-family: 'AdAtlasReview'; src: url('${fontFileUrl()}'); }</style>
    ${texts}
  </svg>`);
}

function cropPixels(box: NormalizedImageBox, width: number, height: number) {
  const safe = clampReviewBox(box);
  const left = Math.max(0, Math.min(width - 1, Math.floor(safe.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.floor(safe.y * height)));
  const cropWidth = Math.max(1, Math.min(width - left, Math.round(safe.width * width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.round(safe.height * height)));
  return { left, top, width: cropWidth, height: cropHeight };
}

async function maskOverlay(source: Buffer, mask: ReviewPrivacyRegion, width: number, height: number) {
  const rect = cropPixels(mask.box, width, height);
  if (mask.maskStyle === "solid") {
    return {
      input: await sharp({
        create: { width: rect.width, height: rect.height, channels: 4, background: "#273142" },
      })
        .png()
        .toBuffer(),
      left: rect.left,
      top: rect.top,
    };
  }
  const region = sharp(source).extract(rect);
  const processed =
    mask.maskStyle === "mosaic"
      ? await region
          .resize(Math.max(2, Math.round(rect.width / 14)), Math.max(2, Math.round(rect.height / 14)))
          .resize(rect.width, rect.height, { kernel: sharp.kernel.nearest })
          .png()
          .toBuffer()
      : await region
          .blur(Math.max(3, Math.min(18, Math.round(rect.height / 4))))
          .png()
          .toBuffer();
  return { input: processed, left: rect.left, top: rect.top };
}

async function prepareReviewCard(source: ReviewRenderSource, placement: Placement) {
  const input = await loadSafeProductImageBuffer(source.imagePath);
  const rotated = await sharp(input).rotate().png().toBuffer();
  const metadata = await sharp(rotated).metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const overlays = await Promise.all(
    source.privacyMasks
      .filter((mask) => mask.enabled)
      .slice(0, 30)
      .map((mask) => maskOverlay(rotated, mask, width, height))
  );
  const masked = overlays.length ? await sharp(rotated).composite(overlays).png().toBuffer() : rotated;
  const highlighted = source.highlightBox
    ? await sharp(masked)
        .composite([
          {
            input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
              <rect x="${source.highlightBox.x * width}" y="${source.highlightBox.y * height}" width="${source.highlightBox.width * width}" height="${source.highlightBox.height * height}" rx="2" fill="none" stroke="#ef2e2e" stroke-width="${Math.max(3, width * 0.004)}"/>
            </svg>`),
            left: 0,
            top: 0,
          },
        ])
        .png()
        .toBuffer()
    : masked;
  const crop = cropPixels(source.crop, width, height);
  const frame = 8;
  return sharp(highlighted)
    .extract(crop)
    .resize(placement.width - frame * 2, placement.height - frame * 2, {
      fit: "contain",
      background: "#ffffff",
      withoutEnlargement: false,
    })
    .extend({ top: frame, right: frame, bottom: frame, left: frame, background: "#ffffff" })
    .png()
    .toBuffer();
}

function reviewPlacements(template: ReviewCreativeTemplate, count: number): Placement[] {
  if (template === "reaction-comment") {
    return count >= 2
      ? [
          { x: 50, y: 300, width: 920, height: 260 },
          { x: 90, y: 585, width: 880, height: 245 },
        ]
      : [{ x: 40, y: 270, width: 1120, height: 620 }];
  }
  if (template === "real-review-focus") return [{ x: 60, y: 250, width: 1080, height: 680 }];
  if (template === "before-after-usage") {
    return count >= 2
      ? [
          { x: 35, y: 270, width: 555, height: 690 },
          { x: 610, y: 270, width: 555, height: 690 },
        ]
      : [{ x: 60, y: 270, width: 1080, height: 700 }];
  }
  const available = Math.max(1, Math.min(3, count));
  const cardHeight = available === 3 ? 245 : available === 2 ? 330 : 550;
  return Array.from({ length: available }, (_, index) => ({
    x: 45,
    y: 260 + index * (cardHeight + 24),
    width: available === 1 ? 1060 : 790,
    height: cardHeight,
  }));
}

async function prepareProduct(productImagePath: string, placement: Placement) {
  const input = await loadSafeProductImageBuffer(productImagePath);
  const product = await sharp(input)
    .rotate()
    .ensureAlpha()
    .resize(placement.width, placement.height, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  const metadata = await sharp(product).metadata();
  const width = metadata.width || placement.width;
  const height = metadata.height || placement.height;
  const alpha = await sharp(product).extractChannel("alpha").blur(13).linear(0.24).png().toBuffer();
  const shadow = await sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .joinChannel(alpha)
    .png()
    .toBuffer();
  return { product, shadow };
}

function productPlacement(template: ReviewCreativeTemplate): Placement {
  if (template === "review-collection") return { x: 790, y: 700, width: 390, height: 470 };
  if (template === "reaction-comment") return { x: 790, y: 845, width: 380, height: 330 };
  if (template === "real-review-focus") return { x: 850, y: 945, width: 310, height: 225 };
  return { x: 900, y: 990, width: 250, height: 180 };
}

async function backgroundCanvas(template: ReviewCreativeTemplate, backgroundPath?: string, accent?: string) {
  if (!backgroundPath) return sharp(baseSvg(template, accent)).png().toBuffer();
  try {
    const source = await loadSafeProductImageBuffer(backgroundPath);
    const covered = await sharp(source).rotate().resize(1200, 1200, { fit: "cover" }).blur(8).modulate({ brightness: 0.58, saturation: 0.75 }).png().toBuffer();
    const palette = templatePalette(template, accent);
    const dim = Buffer.from(`<svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="1200" fill="#050607" opacity="0.62"/>
      <rect width="1200" height="18" fill="${palette.accent}"/>
    </svg>`);
    return sharp(covered)
      .composite([{ input: dim, blend: "over" }])
      .png()
      .toBuffer();
  } catch {
    return sharp(baseSvg(template, accent)).png().toBuffer();
  }
}

function cacheDescriptor(input: ReviewCreativeRenderInput) {
  return JSON.stringify({
    version: REVIEW_RENDER_VERSION,
    template: input.template,
    headline: input.headline,
    reviews: input.reviews.map((review) => ({
      id: review.id,
      imagePath: review.imagePath,
      crop: review.crop,
      highlightBox: review.highlightBox || null,
      masks: review.privacyMasks.map((mask) => ({
        id: mask.id,
        box: mask.box,
        enabled: mask.enabled,
        maskStyle: mask.maskStyle,
      })),
    })),
    productImagePath: input.productImagePath || "",
    backgroundImagePath: input.backgroundImagePath || "",
    accentColor: input.accentColor || "",
  });
}

export async function renderReviewCreative(input: ReviewCreativeRenderInput) {
  if (!input.reviews.length) throw new Error("후기 이미지를 한 개 이상 선택해주세요.");
  const reviewLimit = input.template === "review-collection" ? 3 : input.template === "reaction-comment" ? 2 : 2;
  const reviews = input.reviews.slice(0, reviewLimit);
  const key = crypto
    .createHash("sha256")
    .update(cacheDescriptor({ ...input, reviews }))
    .digest("hex");
  const fileName = `review-${input.template}-${key.slice(0, 18)}.png`;
  const outputPath = path.join(outputDir, fileName);
  const publicPath = `/generated-ads/${fileName}`;
  await fs.mkdir(outputDir, { recursive: true });
  try {
    const existing = await fs.stat(outputPath);
    if (existing.size > 0) return { imagePath: publicPath, cached: true, width: 1200, height: 1200 };
  } catch {
    // Render and populate the cache below.
  }

  const placements = reviewPlacements(input.template, reviews.length);
  const cards = await Promise.all(reviews.map((review, index) => prepareReviewCard(review, placements[index])));
  const canvas = await backgroundCanvas(input.template, input.backgroundImagePath, input.accentColor);
  const composites: Array<{ input: Buffer; left: number; top: number }> = cards.map((card, index) => ({
    input: card,
    left: placements[index].x,
    top: placements[index].y,
  }));
  composites.push({ input: headlineSvg(input.template, input.headline, input.accentColor), left: 0, top: 0 });

  let productApplied = false;
  if (input.productImagePath) {
    try {
      const placement = productPlacement(input.template);
      const prepared = await prepareProduct(input.productImagePath, placement);
      composites.push({ input: prepared.shadow, left: placement.x + 9, top: placement.y + 18 });
      composites.push({ input: prepared.product, left: placement.x, top: placement.y });
      productApplied = true;
    } catch {
      productApplied = false;
    }
  }

  await sharp(canvas).composite(composites).png().resize(1200, 1200).toFile(outputPath);
  return {
    imagePath: publicPath,
    cached: false,
    width: 1200,
    height: 1200,
    productApplied,
    reviewIds: reviews.map((review) => review.id),
  };
}
