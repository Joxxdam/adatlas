import sharp from "sharp";
import type { NormalizedImageBox, ProductExtractionScope, ProductRepresentationType } from "./types";

type MaskOptions = {
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
  featherRadius?: number;
  cleanupStrength?: "light" | "balanced" | "strong";
};

type Component = {
  positions: number[];
  area: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

function boxDistance(left: Component, right: Component, width: number, height: number) {
  const horizontal = Math.max(0, left.minX - right.maxX, right.minX - left.maxX) / width;
  const vertical = Math.max(0, left.minY - right.maxY, right.minY - left.maxY) / height;
  return Math.sqrt(horizontal ** 2 + vertical ** 2);
}

function findComponents(alpha: Buffer, width: number, height: number) {
  const visited = new Uint8Array(width * height);
  const components: Component[] = [];
  for (let start = 0; start < alpha.length; start += 1) {
    if (alpha[start] <= 20 || visited[start]) continue;
    const queue = [start];
    const positions: number[] = [];
    visited[start] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const position = queue[cursor];
      const x = position % width;
      const y = Math.floor(position / width);
      positions.push(position);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbors = [position - 1, position + 1, position - width, position + width];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= alpha.length || visited[neighbor] || alpha[neighbor] <= 20 || Math.abs((neighbor % width) - x) > 1) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    components.push({ positions, area: positions.length, minX, minY, maxX, maxY });
  }
  return components.sort((left, right) => right.area - left.area);
}

export async function refineProductCutoutAlpha(buffer: Buffer, options: MaskOptions = {}) {
  if (options.extractionScope === "original") return sharp(buffer).rotate().png().toBuffer();
  const image = sharp(buffer).rotate().ensureAlpha();
  const metadata = await image.metadata();
  const originalWidth = metadata.width || 1;
  const originalHeight = metadata.height || 1;
  const sample = await image.clone().resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = Buffer.alloc(sample.info.width * sample.info.height);
  for (let position = 0; position < alpha.length; position += 1) {
    alpha[position] = sample.data[position * 4 + 3];
  }
  const components = findComponents(alpha, sample.info.width, sample.info.height);
  if (!components.length) return sharp(buffer).rotate().png().toBuffer();
  const totalPixels = sample.info.width * sample.info.height;
  const multiUnit = ["multi-unit-set", "bundle-components", "irregular-product", "packaged-product", "product-package-group", "plated-product", "apparel-or-soft-product", "transparent-or-reflective-product", "already-transparent"].includes(options.representationType || "");
  const minimumRatio = options.cleanupStrength === "strong" ? 0.0015 : options.cleanupStrength === "light" ? 0.0002 : 0.0006;
  const primary = components[0];
  const kept = components.filter((component, index) => {
    const relativeArea = component.area / totalPixels;
    if (index === 0 || relativeArea >= minimumRatio) return true;
    if (multiUnit && relativeArea >= minimumRatio * 0.45) return true;
    // Keep nearby caps, pumps, handles, straps and detached accessories instead of only the largest blob.
    return boxDistance(component, primary, sample.info.width, sample.info.height) <= 0.045;
  });
  const keepMask = Buffer.alloc(alpha.length);
  for (const component of kept) {
    for (const position of component.positions) keepMask[position] = alpha[position];
  }
  const resizedMask = await sharp(keepMask, {
    raw: { width: sample.info.width, height: sample.info.height, channels: 1 },
  })
    .resize(originalWidth, originalHeight, { kernel: sharp.kernel.lanczos3 })
    .blur(Math.max(0.3, Math.min(1.2, options.featherRadius || 0.65)))
    .toColourspace("b-w")
    .raw()
    .toBuffer();
  const original = await image.raw().toBuffer({ resolveWithObject: true });
  for (let position = 0; position < originalWidth * originalHeight; position += 1) {
    const index = position * 4;
    original.data[index + 3] = Math.min(original.data[index + 3], resizedMask[position]);
    if (original.data[index + 3] <= 4) {
      original.data[index] = 0;
      original.data[index + 1] = 0;
      original.data[index + 2] = 0;
      original.data[index + 3] = 0;
    }
  }
  return sharp(original.data, {
    raw: { width: originalWidth, height: originalHeight, channels: 4 },
  })
    .png()
    .toBuffer();
}

export async function applySelectedObjectBoxes(buffer: Buffer, boxes: NormalizedImageBox[], cropBox?: NormalizedImageBox) {
  if (!boxes.length) return buffer;
  const image = await sharp(buffer).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cropMargin = cropBox ? 0.035 : 0;
  const cropX = cropBox ? Math.max(0, cropBox.x - cropMargin) : 0;
  const cropY = cropBox ? Math.max(0, cropBox.y - cropMargin) : 0;
  const cropWidth = cropBox ? Math.min(1, cropBox.x + cropBox.width + cropMargin) - cropX : 1;
  const cropHeight = cropBox ? Math.min(1, cropBox.y + cropBox.height + cropMargin) - cropY : 1;
  const relativeBoxes = boxes.map((box) => {
    const margin = 0.018;
    const x = (box.x - margin - cropX) / Math.max(0.001, cropWidth);
    const y = (box.y - margin - cropY) / Math.max(0.001, cropHeight);
    const right = (box.x + box.width + margin - cropX) / Math.max(0.001, cropWidth);
    const bottom = (box.y + box.height + margin - cropY) / Math.max(0.001, cropHeight);
    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      width: Math.min(1, right) - Math.max(0, x),
      height: Math.min(1, bottom) - Math.max(0, y),
    };
  });
  for (let y = 0; y < image.info.height; y += 1) {
    for (let x = 0; x < image.info.width; x += 1) {
      const normalizedX = x / image.info.width;
      const normalizedY = y / image.info.height;
      const selected = relativeBoxes.some((box) => normalizedX >= box.x && normalizedX <= box.x + box.width && normalizedY >= box.y && normalizedY <= box.y + box.height);
      if (selected) continue;
      const index = (y * image.info.width + x) * 4;
      image.data[index] = 0;
      image.data[index + 1] = 0;
      image.data[index + 2] = 0;
      image.data[index + 3] = 0;
    }
  }
  return sharp(image.data, {
    raw: { width: image.info.width, height: image.info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
