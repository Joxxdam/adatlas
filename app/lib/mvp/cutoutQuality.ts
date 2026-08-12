import sharp from "sharp";
import type {
  ProductCutoutQuality,
  ProductExtractionScope,
  ProductRepresentationType,
} from "./types";

export type CutoutQuality = ProductCutoutQuality;

type QualityOptions = {
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
  expectedUnitCount?: number;
};

export async function inspectCutoutQuality(
  buffer: Buffer,
  options: QualityOptions = {}
): Promise<CutoutQuality> {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = Math.max(1, info.width * info.height);
  let transparentPixels = 0;
  let foregroundPixels = 0;
  let haloPixels = 0;
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;
  const foreground = new Uint8Array(pixelCount);

  for (let position = 0; position < pixelCount; position += 1) {
    const index = position * info.channels;
    const alpha = data[index + 3];
    if (alpha <= 8) transparentPixels += 1;
    if (alpha > 20) {
      foreground[position] = 1;
      foregroundPixels += 1;
      const x = position % info.width;
      const y = Math.floor(position / info.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (
        alpha < 245 &&
        data[index] > 220 &&
        data[index + 1] > 220 &&
        data[index + 2] > 220
      ) {
        haloPixels += 1;
      }
    }
  }

  let opaqueEdgePixels = 0;
  let edgePixelCount = 0;
  const edgeSideRatios: number[] = [];
  const inspectEdge = (positions: number[]) => {
    let opaque = 0;
    for (const position of positions) {
      edgePixelCount += 1;
      if (foreground[position]) {
        opaqueEdgePixels += 1;
        opaque += 1;
      }
    }
    edgeSideRatios.push(opaque / Math.max(1, positions.length));
  };
  inspectEdge(Array.from({ length: info.width }, (_, x) => x));
  inspectEdge(Array.from({ length: info.width }, (_, x) => (info.height - 1) * info.width + x));
  inspectEdge(Array.from({ length: info.height }, (_, y) => y * info.width));
  inspectEdge(Array.from({ length: info.height }, (_, y) => y * info.width + info.width - 1));

  const visited = new Uint8Array(pixelCount);
  const componentAreas: number[] = [];
  for (let start = 0; start < pixelCount; start += 1) {
    if (!foreground[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let area = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const position = queue[cursor];
      const x = position % info.width;
      area += 1;
      const neighbors = [position - 1, position + 1, position - info.width, position + info.width];
      for (const neighbor of neighbors) {
        if (
          neighbor < 0 ||
          neighbor >= pixelCount ||
          visited[neighbor] ||
          !foreground[neighbor] ||
          Math.abs((neighbor % info.width) - x) > 1
        )
          continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    if (area / pixelCount >= 0.0005) componentAreas.push(area);
  }

  const transparencyRatio = transparentPixels / pixelCount;
  const foregroundRatio = foregroundPixels / pixelCount;
  const opaqueEdgeRatio = opaqueEdgePixels / Math.max(1, edgePixelCount);
  const haloRatio = haloPixels / Math.max(1, foregroundPixels);
  const componentCount = componentAreas.length;
  const clippedEdgeCount = edgeSideRatios.filter((ratio) => ratio > 0.06).length;
  const warnings: string[] = [];
  let score = 1;

  if (transparencyRatio < 0.02) {
    warnings.push("실제 투명 영역이 거의 없습니다.");
    score -= 0.5;
  }
  if (transparencyRatio > 0.985 || foregroundRatio < 0.015) {
    warnings.push("판매 상품 영역이 지나치게 작거나 사라졌습니다.");
    score -= 0.55;
  }
  if (foregroundRatio > 0.94) {
    warnings.push("마스크가 이미지 대부분을 덮어 배경 제거 여부가 불분명합니다.");
    score -= 0.28;
  }
  if (clippedEdgeCount >= 3) {
    warnings.push("상품 또는 판매 그룹이 여러 이미지 경계에서 잘렸을 수 있습니다.");
    score -= 0.25;
  } else if (clippedEdgeCount === 2) {
    warnings.push("상품이 이미지 경계에 닿아 있습니다.");
    score -= 0.1;
  }
  if (componentCount === 0) {
    warnings.push("유지된 상품 마스크를 찾지 못했습니다.");
    score -= 0.55;
  }
  if (haloRatio > 0.08) {
    warnings.push("밝은색 halo가 가장자리에 남았을 수 있습니다.");
    score -= Math.min(0.2, haloRatio);
  }
  const multiUnit = ["multi-unit-set", "bundle-components", "irregular-product"].includes(
    options.representationType || ""
  );
  if (!multiUnit && componentCount > 8) {
    warnings.push("단일 상품 주변에 관련 없는 작은 조각이 남았을 수 있습니다.");
    score -= 0.15;
  }
  if (
    multiUnit &&
    options.expectedUnitCount &&
    componentCount > 0 &&
    componentCount < Math.min(2, options.expectedUnitCount)
  ) {
    warnings.push("판매 세트의 일부 구성품이 누락됐을 수 있습니다.");
    score -= 0.18;
  }
  if (options.extractionScope === "original") {
    warnings.length = 0;
    score = 1;
  }

  const normalizedScore = Math.max(0, Math.min(1, score));
  const likelyUnremovedSurface =
    clippedEdgeCount >= 3 &&
    foregroundRatio > 0.75 &&
    !["product-and-package", "food-and-plate", "original"].includes(
      options.extractionScope || ""
    );
  const likelyUnrelatedFragments = !multiUnit && componentCount > 8;
  if (likelyUnremovedSurface) {
    warnings.push("도마·바닥·배경 면이 상품과 함께 남았을 가능성이 높습니다.");
  }
  return {
    usable:
      options.extractionScope === "original" ||
      (normalizedScore >= 0.55 &&
        transparencyRatio >= 0.02 &&
        foregroundRatio >= 0.015 &&
        !likelyUnremovedSurface &&
        !likelyUnrelatedFragments),
    score: normalizedScore,
    transparencyRatio,
    opaqueEdgeRatio,
    foregroundRatio,
    componentCount,
    clippedEdgeCount,
    haloRatio,
    warnings,
    foregroundBox:
      maxX >= minX && maxY >= minY
        ? {
            x: minX / info.width,
            y: minY / info.height,
            width: (maxX - minX + 1) / info.width,
            height: (maxY - minY + 1) / info.height,
          }
        : undefined,
  };
}
