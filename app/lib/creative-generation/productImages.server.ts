import sharp from "sharp";
import { readCreativeRasterAsset } from "./assets.server.ts";
import type { CreativeImageAsset, CreativeImageRole, ProductTruth } from "./types.ts";

const compositableRoles = new Set<CreativeImageRole>([
  "product-cutout",
  "product-packshot",
  "product-lifestyle",
]);

export function isCompositableImageRole(role: CreativeImageRole) {
  return compositableRoles.has(role);
}

async function inspectImage(asset: CreativeImageAsset) {
  const buffer = await readCreativeRasterAsset(asset.path);
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(160, 160, {
      fit: "inside",
      withoutEnlargement: true,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  for (let offset = 3; offset < data.length; offset += info.channels) {
    if (data[offset] < 245) transparentPixels += 1;
  }
  const transparent = transparentPixels / Math.max(1, info.width * info.height) >= 0.025;
  const metadata = await sharp(buffer).metadata();
  return {
    ...asset,
    role:
      transparent && asset.role === "product-packshot"
        ? ("product-cutout" as const)
        : asset.role,
    transparent,
    width: metadata.width,
    height: metadata.height,
    verified:
      asset.verified &&
      Boolean(metadata.width && metadata.height) &&
      Math.min(metadata.width || 0, metadata.height || 0) >= 180 &&
      !asset.hasText,
    reason:
      Math.min(metadata.width || 0, metadata.height || 0) < 180
        ? "상품 이미지 해상도가 너무 작아 합성에서 제외"
        : asset.hasText
          ? "글자가 포함된 상세·광고 이미지는 상품 합성에서 제외"
          : asset.reason,
  } satisfies CreativeImageAsset;
}

export async function inspectProductTruthImages(truth: ProductTruth): Promise<ProductTruth> {
  const inspected = await Promise.all(
    truth.imageAssets.map(async (asset) => {
      if (!isCompositableImageRole(asset.role)) return asset;
      try {
        return await inspectImage(asset);
      } catch {
        return {
          ...asset,
          verified: false,
          reason: "상품 이미지 파일을 안전하게 읽거나 디코딩하지 못해 합성에서 제외",
        };
      }
    })
  );
  const productImages = inspected
    .filter((asset) => asset.verified && isCompositableImageRole(asset.role))
    .sort((left, right) => {
      const score = (asset: CreativeImageAsset) =>
        (asset.role === "product-cutout" ? 300 : asset.role === "product-packshot" ? 200 : 100) +
        (asset.source === "known-product" ? 80 : asset.source === "user-confirmed" ? 60 : 0);
      return score(right) - score(left);
    });
  return {
    ...truth,
    imageAssets: inspected,
    referenceImages: inspected.filter((asset) => asset.role === "ad-reference"),
    imagePaths: productImages.map((asset) => asset.path),
    confirmedProductImage: productImages[0],
  };
}

export function assertProductImageReady(truth: ProductTruth) {
  if (!truth.confirmedProductImage || !truth.imagePaths.length) {
    throw new Error(
      "광고 합성에 사용할 실제 상품 이미지가 확인되지 않았습니다. 상품 이미지 작업대에서 누끼 또는 제품 단독 이미지를 확정해 주세요."
    );
  }
  if (!isCompositableImageRole(truth.confirmedProductImage.role)) {
    throw new Error("참고 광고·리뷰·배경 이미지는 상품 합성 레이어로 사용할 수 없습니다.");
  }
}
