import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import type {
  NormalizedImageBox,
  ProductExtractionScope,
  ProductImageEffectPreset,
  ProductImageState,
  ProductRepresentationType,
} from "./types";

const processedDir = path.join(process.cwd(), "public", "processed-products");

export function getSelectedProductImagePath(productImageState: ProductImageState) {
  if (
    productImageState.selectedImageMode === "styled-cutout" &&
    productImageState.styledCutoutImagePath
  ) {
    return productImageState.styledCutoutImagePath;
  }

  if (productImageState.selectedImageMode === "cutout" && productImageState.cutoutImagePath) {
    return productImageState.cutoutImagePath;
  }

  return productImageState.originalImagePath;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function dataUrlToBuffer(value: string) {
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[2], "base64");
}

export async function imageSourceToBuffer(sourceImagePath: string) {
  if (!sourceImagePath) throw new Error("sourceImagePath is required.");

  const dataBuffer = dataUrlToBuffer(sourceImagePath);
  if (dataBuffer) return dataBuffer;

  if (isHttpUrl(sourceImagePath)) {
    const response = await fetch(sourceImagePath);
    if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  const publicRelativePath = sourceImagePath.replace(/^\/+/, "");
  const filePath = path.join(process.cwd(), "public", publicRelativePath);
  return fs.readFile(filePath);
}

function colorDistance(a: number[], b: number[]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function sampleBackgroundColors(data: Buffer, width: number, height: number) {
  const sampleSize = Math.max(4, Math.floor(Math.min(width, height) * 0.06));
  const areas = [
    [0, 0],
    [width - sampleSize, 0],
    [0, height - sampleSize],
    [width - sampleSize, height - sampleSize],
  ];

  const cornerColors = areas.map(([startX, startY]) => {
    const samples: number[][] = [];
    for (let y = startY; y < startY + sampleSize; y += 2) {
      for (let x = startX; x < startX + sampleSize; x += 2) {
        const index = (y * width + x) * 4;
        samples.push([data[index], data[index + 1], data[index + 2]]);
      }
    }
    const average = [0, 0, 0];
    for (const sample of samples) {
      average[0] += sample[0];
      average[1] += sample[1];
      average[2] += sample[2];
    }
    return average.map((value) => value / Math.max(1, samples.length));
  });

  const clusteredColors = cornerColors.filter((color, index) =>
    cornerColors.some(
      (otherColor, otherIndex) => otherIndex !== index && colorDistance(color, otherColor) <= 58
    )
  );

  if (clusteredColors.length >= 2) return clusteredColors;

  const average = [0, 0, 0];
  for (const color of cornerColors) {
    average[0] += color[0];
    average[1] += color[1];
    average[2] += color[2];
  }
  return [average.map((value) => value / Math.max(1, cornerColors.length))];
}

function pixelIndex(x: number, y: number, width: number) {
  return (y * width + x) * 4;
}

function isLikelyConnectedBackground(data: Buffer, index: number, backgroundColors: number[][]) {
  const alpha = data[index + 3];
  if (alpha <= 8) return true;

  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const distance = Math.min(
    ...backgroundColors.map((backgroundColor) => colorDistance([red, green, blue], backgroundColor))
  );
  return distance <= 38;
}

export type LocalBackgroundRemovalOptions = {
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
  cropBox?: NormalizedImageBox;
  threshold?: number;
  featherRadius?: number;
};

function normalizedCropRegion(box: NormalizedImageBox | undefined, width: number, height: number) {
  if (!box) return undefined;
  const margin = 0.035;
  const x = Math.max(0, Math.min(1, box.x - margin));
  const y = Math.max(0, Math.min(1, box.y - margin));
  const right = Math.max(x, Math.min(1, box.x + box.width + margin));
  const bottom = Math.max(y, Math.min(1, box.y + box.height + margin));
  const left = Math.floor(x * width);
  const top = Math.floor(y * height);
  return {
    left,
    top,
    width: Math.max(1, Math.ceil(right * width) - left),
    height: Math.max(1, Math.ceil(bottom * height) - top),
  };
}

export async function prepareProductSourceBuffer(
  sourceImageBuffer: Buffer,
  cropBox?: NormalizedImageBox
) {
  let pipeline = sharp(sourceImageBuffer).rotate();
  const metadata = await pipeline.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const cropRegion = normalizedCropRegion(cropBox, width, height);
  if (cropRegion) pipeline = pipeline.extract(cropRegion);
  return pipeline
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
}

export async function removeBackgroundToPng(
  sourceImageBuffer: Buffer,
  options: LocalBackgroundRemovalOptions = {}
) {
  if (options.extractionScope === "original") {
    return prepareProductSourceBuffer(sourceImageBuffer, options.cropBox);
  }
  const prepared = await prepareProductSourceBuffer(sourceImageBuffer, options.cropBox);
  const input = sharp(prepared).ensureAlpha();
  const metadata = await input.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const { data } = await input.raw().toBuffer({ resolveWithObject: true });
  const backgroundColors = sampleBackgroundColors(data, width, height);
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const removeMask = new Uint8Array(totalPixels);
  const queue: number[] = [];

  function enqueue(x: number, y: number) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const position = y * width + x;
    if (visited[position]) return;
    const index = pixelIndex(x, y, width);
    const matchesDefault = isLikelyConnectedBackground(data, index, backgroundColors);
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const distance = Math.min(
      ...backgroundColors.map((backgroundColor) =>
        colorDistance([red, green, blue], backgroundColor)
      )
    );
    if (!matchesDefault && distance > (options.threshold || 38)) return;
    visited[position] = 1;
    removeMask[position] = 1;
    queue.push(position);
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const position = queue[cursor];
    const x = position % width;
    const y = Math.floor(position / width);
    enqueue(x + 1, y);
    enqueue(x - 1, y);
    enqueue(x, y + 1);
    enqueue(x, y - 1);
  }

  const alpha = Buffer.alloc(totalPixels);
  for (let position = 0; position < totalPixels; position += 1) {
    const index = position * 4;
    alpha[position] = removeMask[position] ? 0 : data[index + 3];
  }
  const softenedAlpha = Buffer.alloc(totalPixels);
  const featherPasses = (options.featherRadius || 0.7) > 0.8 ? 2 : 1;
  let currentAlpha = alpha;
  for (let pass = 0; pass < featherPasses; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let total = 0;
        let count = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = x + offsetX;
            const sampleY = y + offsetY;
            if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) continue;
            total += currentAlpha[sampleY * width + sampleX];
            count += 1;
          }
        }
        softenedAlpha[y * width + x] = Math.round(total / Math.max(1, count));
      }
    }
    currentAlpha = Buffer.from(softenedAlpha);
  }
  for (let position = 0; position < totalPixels; position += 1) {
    const index = position * 4;
    const nextAlpha = removeMask[position]
      ? Math.min(softenedAlpha[position], 96)
      : Math.max(softenedAlpha[position], alpha[position]);
    data[index + 3] = nextAlpha <= 5 ? 0 : nextAlpha;
    if (data[index + 3] === 0) {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
    }
  }

  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function effectConfig(effectPreset: ProductImageEffectPreset) {
  if (effectPreset === "clean-outline")
    return { outlineWidth: 2, glowBlur: 0, shadowBlur: 0, shadowY: 0 };
  if (effectPreset === "soft-glow")
    return { outlineWidth: 0, glowBlur: 18, shadowBlur: 0, shadowY: 0 };
  if (effectPreset === "commerce-shadow")
    return { outlineWidth: 0, glowBlur: 0, shadowBlur: 22, shadowY: 16 };
  if (effectPreset === "outline-glow-shadow")
    return { outlineWidth: 5, glowBlur: 10, shadowBlur: 18, shadowY: 12 };
  return { outlineWidth: 0, glowBlur: 0, shadowBlur: 0, shadowY: 0 };
}

export async function applyProductEffectToPng(
  cutoutImageBuffer: Buffer,
  effectPreset: ProductImageEffectPreset
) {
  const image = sharp(cutoutImageBuffer).rotate().ensureAlpha();
  const metadata = await image.metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const padding = effectPreset === "none" ? 0 : 48;
  const config = effectConfig(effectPreset);
  const dataUrl = `data:image/png;base64,${cutoutImageBuffer.toString("base64")}`;
  const svg = `
<svg width="${width + padding * 2}" height="${height + padding * 2}" viewBox="0 0 ${width + padding * 2} ${height + padding * 2}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="productEffect" x="-30%" y="-30%" width="160%" height="170%">
      ${
        config.outlineWidth
          ? `<feMorphology in="SourceAlpha" operator="dilate" radius="${config.outlineWidth}" result="outline" />
      <feFlood flood-color="#ffffff" flood-opacity="0.96" result="outlineColor" />
      <feComposite in="outlineColor" in2="outline" operator="in" result="outlineLayer" />`
          : ""
      }
      ${
        config.glowBlur
          ? `<feGaussianBlur in="SourceAlpha" stdDeviation="${config.glowBlur}" result="glow" />
      <feFlood flood-color="#fff4a8" flood-opacity="0.52" result="glowColor" />
      <feComposite in="glowColor" in2="glow" operator="in" result="glowLayer" />`
          : ""
      }
      ${config.shadowBlur ? `<feDropShadow dx="0" dy="${config.shadowY}" stdDeviation="${config.shadowBlur}" flood-color="#000000" flood-opacity="0.34" result="shadowLayer" />` : ""}
      <feMerge>
        ${config.shadowBlur ? `<feMergeNode in="shadowLayer" />` : ""}
        ${config.glowBlur ? `<feMergeNode in="glowLayer" />` : ""}
        ${config.outlineWidth ? `<feMergeNode in="outlineLayer" />` : ""}
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </defs>
  <image href="${dataUrl}" x="${padding}" y="${padding}" width="${width}" height="${height}" filter="url(#productEffect)" />
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function saveProcessedProductImage(buffer: Buffer, fileName: string) {
  await fs.mkdir(processedDir, { recursive: true });
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const filePath = path.join(processedDir, safeFileName);
  await fs.writeFile(filePath, buffer);
  return `/processed-products/${safeFileName}`;
}
