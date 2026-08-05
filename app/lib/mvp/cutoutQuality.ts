import sharp from "sharp";

export type CutoutQuality = {
  usable: boolean;
  transparencyRatio: number;
  opaqueEdgeRatio: number;
};

export async function inspectCutoutQuality(buffer: Buffer): Promise<CutoutQuality> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = Math.max(1, info.width * info.height);
  let transparentPixels = 0;
  for (let index = 3; index < data.length; index += info.channels) {
    if (data[index] <= 8) transparentPixels += 1;
  }

  let opaqueEdgePixels = 0;
  let edgePixelCount = 0;
  const countEdgePixel = (x: number, y: number) => {
    edgePixelCount += 1;
    const alpha = data[(y * info.width + x) * info.channels + 3];
    if (alpha > 8) opaqueEdgePixels += 1;
  };
  for (let x = 0; x < info.width; x += 1) {
    countEdgePixel(x, 0);
    countEdgePixel(x, info.height - 1);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    countEdgePixel(0, y);
    countEdgePixel(info.width - 1, y);
  }

  const transparencyRatio = transparentPixels / pixelCount;
  const opaqueEdgeRatio = opaqueEdgePixels / Math.max(1, edgePixelCount);
  return {
    usable:
      transparencyRatio >= 0.005 && transparencyRatio <= 0.98 && opaqueEdgeRatio <= 0.6,
    transparencyRatio,
    opaqueEdgeRatio,
  };
}
