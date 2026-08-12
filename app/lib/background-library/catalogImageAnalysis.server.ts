import { createHash } from "node:crypto";

import sharp from "sharp";

import type { BackgroundCatalogItem } from "./catalogTypes.ts";

export type SupportedCatalogImageFormat = "jpeg" | "png" | "webp" | "avif";

export function detectCatalogImageSignature(buffer: Buffer): SupportedCatalogImageFormat | null {
  if (buffer.length < 16) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp" && /avif|avis/.test(buffer.subarray(8, 16).toString("ascii"))) return "avif";
  return null;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function rgbToHsv(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return { saturation: max === 0 ? 0 : (max - min) / max, value: max };
}

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;
}

function perceptualDifferenceHash(gray: number[], width: number, height: number) {
  let output = "";
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      nibble = (nibble << 1) | (gray[y * width + x] > gray[y * width + x + 1] ? 1 : 0);
      bits += 1;
      if (bits === 4) {
        output += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  if (bits) output += (nibble << (4 - bits)).toString(16);
  return output;
}

type LocalAnalysis = Pick<
  BackgroundCatalogItem,
  | "dominantColor"
  | "secondaryColors"
  | "brightness"
  | "saturation"
  | "contrast"
  | "entropy"
  | "edgeDensity"
  | "clutterLevel"
  | "negativeSpaceDirection"
  | "productPlacementSpace"
  | "focalPoint"
  | "cropSafety"
  | "backgroundSuitabilityScore"
  | "adCompositionScore"
  | "recommendedProductPosition"
  | "recommendedCopyPosition"
  | "overlayReadability"
  | "needsDarkOverlay"
  | "needsLightOverlay"
  | "squareCropScore"
  | "perceptualHash"
> & { width: number; height: number; format: SupportedCatalogImageFormat };

export async function analyzeCatalogImage(buffer: Buffer): Promise<LocalAnalysis> {
  const signature = detectCatalogImageSignature(buffer);
  if (!signature) throw new Error("이미지 signature와 허용 형식이 일치하지 않습니다.");
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height || width > 16_000 || height > 16_000 || width * height > 120_000_000) {
    throw new Error("이미지 해상도가 처리 한도를 초과합니다.");
  }
  if (metadata.format !== signature) {
    throw new Error("파일 signature와 실제 이미지 형식이 다릅니다.");
  }

  const sampleWidth = 64;
  const sampleHeight = 64;
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize(sampleWidth, sampleHeight, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const luma: number[] = [];
  const histogram = new Array<number>(32).fill(0);
  const colors = new Map<string, { count: number; r: number; g: number; b: number }>();
  let lumaSum = 0;
  let saturationSum = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const value = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const hsv = rgbToHsv(r, g, b);
    luma.push(value);
    lumaSum += value;
    saturationSum += hsv.saturation;
    histogram[Math.min(31, Math.floor(value * 32))] += 1;
    const qr = Math.round(r / 32) * 32;
    const qg = Math.round(g / 32) * 32;
    const qb = Math.round(b / 32) * 32;
    const key = `${qr},${qg},${qb}`;
    const entry = colors.get(key) || { count: 0, r: qr, g: qg, b: qb };
    entry.count += 1;
    colors.set(key, entry);
  }
  const pixelCount = luma.length;
  const brightness = lumaSum / pixelCount;
  const saturation = saturationSum / pixelCount;
  const contrast = Math.sqrt(luma.reduce((sum, value) => sum + (value - brightness) ** 2, 0) / pixelCount) * 2.4;
  const entropy = -histogram.reduce((sum, count) => {
    if (!count) return sum;
    const probability = count / pixelCount;
    return sum + probability * Math.log2(probability);
  }, 0) / 5;

  let edgeCount = 0;
  const regionEdges = { left: 0, right: 0, top: 0, bottom: 0 };
  const regionPixels = { left: 0, right: 0, top: 0, bottom: 0 };
  for (let y = 1; y < sampleHeight - 1; y += 1) {
    for (let x = 1; x < sampleWidth - 1; x += 1) {
      const gx = Math.abs(luma[y * sampleWidth + x + 1] - luma[y * sampleWidth + x - 1]);
      const gy = Math.abs(luma[(y + 1) * sampleWidth + x] - luma[(y - 1) * sampleWidth + x]);
      const edge = gx + gy > 0.24 ? 1 : 0;
      edgeCount += edge;
      if (x < sampleWidth / 2) { regionEdges.left += edge; regionPixels.left += 1; }
      else { regionEdges.right += edge; regionPixels.right += 1; }
      if (y < sampleHeight / 2) { regionEdges.top += edge; regionPixels.top += 1; }
      else { regionEdges.bottom += edge; regionPixels.bottom += 1; }
    }
  }
  const edgeDensity = edgeCount / ((sampleWidth - 2) * (sampleHeight - 2));
  const openness = Object.fromEntries(
    Object.keys(regionEdges).map((key) => [key, 1 - regionEdges[key as keyof typeof regionEdges] / regionPixels[key as keyof typeof regionPixels]])
  ) as Record<"left" | "right" | "top" | "bottom", number>;
  const mostOpen = (Object.entries(openness) as Array<[keyof typeof openness, number]>).sort((a, b) => b[1] - a[1])[0];
  const negativeSpaceDirection = mostOpen[0] === "left" ? "center-left" : mostOpen[0] === "right" ? "center-right" : mostOpen[0] === "top" ? "top-center" : "bottom-center";
  const productPosition = mostOpen[0] === "left" ? "center-left" : mostOpen[0] === "right" ? "center-right" : mostOpen[0] === "top" ? "center" : "bottom-center";
  const copyPosition = mostOpen[0] === "left" ? "top-left" : mostOpen[0] === "right" ? "top-right" : mostOpen[0] === "top" ? "top-center" : "bottom-center";
  const squareCropScore = Math.min(width, height) / Math.max(width, height);
  const productPlacementSpace = clamp(mostOpen[1] * 0.78 + squareCropScore * 0.22);
  const clutterLevel = clamp(edgeDensity * 2.3 + entropy * 0.18);
  const overlayReadability = clamp((1 - clutterLevel) * 0.72 + contrast * 0.28);
  const cropSafety = clamp(squareCropScore * 0.7 + productPlacementSpace * 0.3);
  const backgroundSuitabilityScore = clamp(productPlacementSpace * 0.35 + cropSafety * 0.3 + overlayReadability * 0.25 + (1 - Math.abs(brightness - 0.55)) * 0.1);
  const adCompositionScore = clamp(backgroundSuitabilityScore * 0.72 + (1 - clutterLevel) * 0.18 + contrast * 0.1);
  const palette = [...colors.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  const gray = await sharp(buffer).rotate().resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();

  return {
    width,
    height,
    format: signature,
    dominantColor: palette[0] ? toHex(palette[0].r, palette[0].g, palette[0].b) : "#808080",
    secondaryColors: palette.slice(1).map((color) => toHex(color.r, color.g, color.b)),
    brightness: clamp(brightness),
    saturation: clamp(saturation),
    contrast: clamp(contrast),
    entropy: clamp(entropy),
    edgeDensity: clamp(edgeDensity),
    clutterLevel,
    negativeSpaceDirection,
    productPlacementSpace,
    focalPoint: { x: mostOpen[0] === "left" ? 0.7 : mostOpen[0] === "right" ? 0.3 : 0.5, y: 0.52 },
    cropSafety,
    backgroundSuitabilityScore,
    adCompositionScore,
    recommendedProductPosition: productPosition,
    recommendedCopyPosition: copyPosition,
    overlayReadability,
    needsDarkOverlay: brightness > 0.62,
    needsLightOverlay: brightness < 0.3,
    squareCropScore,
    perceptualHash: perceptualDifferenceHash([...gray], 9, 8),
  };
}

export function catalogContentHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function perceptualHashDistance(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const xor = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    distance += ((xor >> 0) & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1);
  }
  return distance;
}
