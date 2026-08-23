import sharp, { type OverlayOptions } from "sharp";
import { removeBackgroundToPng } from "../mvp/imageEffects.ts";
import { readCreativeRasterAsset } from "./assets.server.ts";
import type { MasterSceneSpec, PlacementBox } from "./types.ts";

function integerBox(box: PlacementBox) {
  const x = Math.max(0, Math.min(1199, Math.round(box.x)));
  const y = Math.max(0, Math.min(1199, Math.round(box.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(1200 - x, Math.round(box.width))),
    height: Math.max(1, Math.min(1200 - y, Math.round(box.height))),
  };
}

async function alphaSilhouette(product: Buffer, opacity: number, blur: number) {
  const { data, info } = await sharp(product).ensureAlpha().extractChannel(3).blur(blur).raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);
  for (let index = 0; index < data.length; index += 1) {
    rgba[index * 4 + 3] = Math.round(data[index] * (opacity / 255));
  }
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png()
    .toBuffer();
}

function contactShadow(box: PlacementBox) {
  const width = Math.max(80, Math.round(box.width * 0.72));
  const height = Math.max(24, Math.round(box.height * 0.075));
  return {
    input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><filter id="b"><feGaussianBlur stdDeviation="${Math.max(8, height * 0.22)}"/></filter></defs><ellipse cx="${width / 2}" cy="${height / 2}" rx="${width * 0.42}" ry="${height * 0.24}" fill="#05070a" opacity=".52" filter="url(#b)"/></svg>`),
    left: Math.round(box.x + (box.width - width) / 2),
    top: Math.min(1199 - height, Math.round(box.y + box.height - height * 0.58)),
  };
}

export async function createProtectedProductComposite(input: { backgroundPath: string; productImagePath: string; productTransparent?: boolean; spec: MasterSceneSpec }) {
  const backgroundSource = await readCreativeRasterAsset(input.backgroundPath);
  const productSource = await readCreativeRasterAsset(input.productImagePath);
  const target = integerBox(input.spec.productSafeZone);
  const background = await sharp(backgroundSource).rotate().resize(1200, 1200, { fit: "cover", position: "centre" }).modulate({ brightness: 0.98, saturation: 0.96 }).png().toBuffer();
  const isolatedProduct = input.productTransparent
    ? productSource
    : await removeBackgroundToPng(productSource, {
        extractionScope: "sales-unit",
        featherRadius: 0.7,
      });
  const trimmed = await sharp(isolatedProduct)
    .rotate()
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const angle = /3\s*[~～-]\s*6도/.test(input.spec.productPlacement.angle) ? -3.5 : 0;
  const product = await sharp(trimmed)
    .rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize(target.width, target.height, {
      fit: "contain",
      position: "centre",
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .modulate({ brightness: 0.99, saturation: 0.98 })
    .sharpen({ sigma: 0.7, m1: 0.5, m2: 1.2 })
    .png()
    .toBuffer();
  const shadow = await alphaSilhouette(product, 115, 16);
  const rim = await alphaSilhouette(product, 72, 5);
  const reflection = await sharp(product).flip().modulate({ brightness: 0.86, saturation: 0.75 }).blur(2.2).linear(0.18).png().toBuffer();
  const reflectionHeight = Math.max(1, Math.min(Math.round(target.height * 0.16), 1200 - target.y - target.height));
  const reflectionCrop = reflectionHeight > 1 ? await sharp(reflection).extract({ left: 0, top: 0, width: target.width, height: reflectionHeight }).png().toBuffer() : null;
  const composites: OverlayOptions[] = [
    {
      input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200"><defs><radialGradient id="r"><stop offset="0" stop-color="#ffffff" stop-opacity=".11"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient></defs><ellipse cx="${target.x + target.width / 2}" cy="${target.y + target.height / 2}" rx="${target.width * 0.7}" ry="${target.height * 0.68}" fill="url(#r)"/></svg>`),
      left: 0,
      top: 0,
    },
    contactShadow(target),
    { input: shadow, left: Math.min(1199, target.x + 14), top: Math.min(1199, target.y + 20), blend: "multiply" },
    ...(reflectionCrop ? [{ input: reflectionCrop, left: target.x, top: target.y + target.height, blend: "soft-light" as const }] : []),
    { input: rim, left: Math.max(0, target.x - 2), top: Math.max(0, target.y - 2), blend: "screen" },
    { input: product, left: target.x, top: target.y },
  ];
  const buffer = await sharp(background).composite(composites).removeAlpha().webp({ quality: 92, effort: 5 }).toBuffer();
  return {
    buffer,
    productBounds: target,
    estimatedProductAreaRatio: Number(((target.width * target.height * 0.63) / (1200 * 1200)).toFixed(4)),
    repairs: ["실제 상품 픽셀 유지", ...(angle ? ["장면 방향에 맞춘 미세 원근·각도 보정"] : []), "장면 색온도·노출 보정", "주변광·림라이트 적용", "접촉 그림자와 약한 반사광 적용", "투명 경계 feathering과 halo 정리"],
  };
}

/**
 * Restores the authoritative package raster after AI scene/copy editing.
 * No color, label, shape, rotation or sharpening edit is applied to the
 * product layer; only transparent isolation and proportional resizing occur.
 */
export async function createIdentityLockedProductComposite(input: { backgroundPath: string; productImagePath: string; placements: PlacementBox[] }) {
  const backgroundSource = await readCreativeRasterAsset(input.backgroundPath);
  const productSource = await readCreativeRasterAsset(input.productImagePath);
  const metadata = await sharp(productSource).metadata();
  const isolatedProduct = metadata.hasAlpha
    ? await sharp(productSource).rotate().ensureAlpha().png().toBuffer()
    : await removeBackgroundToPng(productSource, {
        extractionScope: "sales-unit",
        featherRadius: 0.55,
      });
  const trimmed = await sharp(isolatedProduct)
    .ensureAlpha()
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const placements = input.placements.slice(0, 3).map(integerBox);
  const overlays: OverlayOptions[] = [];
  for (const placement of placements) {
    const product = await sharp(trimmed)
      .resize(placement.width, placement.height, {
        fit: "contain",
        position: "centre",
        withoutEnlargement: false,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();
    overlays.push(contactShadow(placement));
    overlays.push({ input: product, left: placement.x, top: placement.y });
  }
  const buffer = await sharp(backgroundSource).rotate().resize(1200, 1200, { fit: "cover", position: "centre" }).composite(overlays).png().toBuffer();
  return {
    buffer,
    productBounds: placements,
    repairs: ["원본 화장품 패키지 픽셀 보호", "원본 라벨·로고·용기 형태 복원", "접촉 그림자 적용"],
  };
}
