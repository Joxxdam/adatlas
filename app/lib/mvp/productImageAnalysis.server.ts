import crypto from "crypto";
import sharp from "sharp";
import { validatePublicHttpUrl } from "../store-analysis/urlSafety";
import { hammingDistance, normalizeProductImageUrl } from "./productImagePipeline";
import type { DetectedProductObject, NormalizedImageBox, ProductImageCandidate, ProductRepresentation, SourceImageCandidate } from "./types";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_REDIRECTS = 4;

type DownloadedImage = {
  buffer: Buffer;
  contentType: string;
  finalUrl: string;
};

async function readLimitedImage(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error("image exceeds 12MB");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("image exceeds 12MB");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function downloadImage(value: string): Promise<DownloadedImage> {
  let current = await validatePublicHttpUrl(value);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; AdAtlasProductImageAnalyzer/1.0)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) throw new Error("too many redirects");
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    await validatePublicHttpUrl(response.url || current.toString());
    if (!response.ok) throw new Error(`image HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/") || /svg/.test(contentType)) {
      throw new Error("response is not a supported raster image");
    }
    return {
      buffer: await readLimitedImage(response),
      contentType,
      finalUrl: response.url || current.toString(),
    };
  }
  throw new Error("too many redirects");
}

function colorDistance(data: Buffer, index: number, color: [number, number, number]) {
  return Math.sqrt((data[index] - color[0]) ** 2 + (data[index + 1] - color[1]) ** 2 + (data[index + 2] - color[2]) ** 2);
}

function normalizedBox(minX: number, minY: number, maxX: number, maxY: number, width: number, height: number): NormalizedImageBox {
  return {
    x: minX / width,
    y: minY / height,
    width: (maxX - minX + 1) / width,
    height: (maxY - minY + 1) / height,
  };
}

function unionBoxes(boxes: NormalizedImageBox[]): NormalizedImageBox | undefined {
  if (!boxes.length) return undefined;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.width));
  const maxY = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function detectForegroundObjects(data: Buffer, width: number, height: number, hasAlpha: boolean) {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const background = corners.reduce<[number, number, number]>(
    (sum, position) => {
      const index = position * 4;
      return [sum[0] + data[index], sum[1] + data[index + 1], sum[2] + data[index + 2]];
    },
    [0, 0, 0]
  );
  background[0] /= corners.length;
  background[1] /= corners.length;
  background[2] /= corners.length;
  const foreground = new Uint8Array(width * height);
  for (let position = 0; position < foreground.length; position += 1) {
    const index = position * 4;
    const alpha = data[index + 3];
    foreground[position] = hasAlpha ? (alpha > 20 ? 1 : 0) : colorDistance(data, index, background) > 34 ? 1 : 0;
  }

  // Bridge tiny gaps so labels, caps, straps, meat edges and separated pixels form stable objects.
  const closed = foreground.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const position = y * width + x;
      if (foreground[position]) continue;
      let neighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          neighbors += foreground[(y + offsetY) * width + x + offsetX];
        }
      }
      if (neighbors >= 5) closed[position] = 1;
    }
  }

  const columnOccupancy = Array.from({ length: width }, (_, x) => {
    let count = 0;
    for (let y = 0; y < height; y += 1) count += foreground[y * width + x];
    return count / height;
  });
  const denseColumnRuns: Array<{ start: number; end: number; score: number }> = [];
  for (let x = 0; x < width; x += 1) {
    if (columnOccupancy[x] < 0.58) continue;
    const start = x;
    let total = 0;
    while (x < width && columnOccupancy[x] >= 0.58) {
      total += columnOccupancy[x];
      x += 1;
    }
    denseColumnRuns.push({ start, end: x - 1, score: total });
  }
  const centerX = width / 2;
  const centralRun = denseColumnRuns
    .filter((run) => run.end - run.start >= width * 0.08)
    .sort((left, right) => {
      const leftDistance = Math.abs((left.start + left.end) / 2 - centerX) / width;
      const rightDistance = Math.abs((right.start + right.end) / 2 - centerX) / width;
      return leftDistance - rightDistance || right.score - left.score;
    })[0];
  let centralProductBox: NormalizedImageBox | undefined;
  if (centralRun) {
    const rowOccupancy = Array.from({ length: height }, (_, y) => {
      let count = 0;
      for (let x = centralRun.start; x <= centralRun.end; x += 1) {
        count += foreground[y * width + x];
      }
      return count / Math.max(1, centralRun.end - centralRun.start + 1);
    });
    const activeRows = rowOccupancy
      .map((value, y) => ({ value, y }))
      .filter((item) => item.value >= 0.56)
      .map((item) => item.y);
    if (activeRows.length) {
      const minY = Math.max(0, Math.min(...activeRows) - Math.round(height * 0.025));
      const maxY = Math.min(height - 1, Math.max(...activeRows) + Math.round(height * 0.025));
      const minX = Math.max(0, centralRun.start - Math.round(width * 0.025));
      const maxX = Math.min(width - 1, centralRun.end + Math.round(width * 0.025));
      let candidateBox = normalizedBox(minX, minY, maxX, maxY, width, height);
      if (candidateBox.height / Math.max(0.01, candidateBox.width) >= 1.3 && candidateBox.width > 0.4) {
        candidateBox = {
          ...candidateBox,
          x: 0.3,
          width: 0.4,
        };
      }
      if (candidateBox.width * candidateBox.height >= 0.06) centralProductBox = candidateBox;
    }
  }

  const visited = new Uint8Array(width * height);
  const components: Array<{ area: number; box: NormalizedImageBox }> = [];
  for (let start = 0; start < closed.length; start += 1) {
    if (!closed[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const position = queue[cursor];
      const x = position % width;
      const y = Math.floor(position / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const neighbors = [position - 1, position + 1, position - width, position + width];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || neighbor >= closed.length || visited[neighbor] || !closed[neighbor]) continue;
        if (Math.abs((neighbor % width) - x) > 1) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    const relativeArea = area / (width * height);
    if (relativeArea >= 0.0015) {
      components.push({
        area: relativeArea,
        box: normalizedBox(minX, minY, maxX, maxY, width, height),
      });
    }
  }
  return {
    components: components.sort((left, right) => right.area - left.area).slice(0, 12),
    centralProductBox,
  };
}

async function perceptualHash(buffer: Buffer) {
  const pixels = await sharp(buffer).rotate().resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) bits += pixels[y * 9 + x] > pixels[y * 9 + x + 1] ? "1" : "0";
  }
  return bits;
}

function sourceTypeFor(candidate: ProductImageCandidate): SourceImageCandidate["sourceType"] {
  if (candidate.type === "main") return "product-gallery";
  if (candidate.type === "gallery") return "product-gallery";
  if (candidate.type === "detail" || candidate.type === "content") return "detail-content";
  return "unknown";
}

function sourceQualityScore(input: { width: number; height: number; foregroundRatio: number; objectCount: number; hasText: boolean; hasAlpha: boolean; touchesEdges: boolean; sourceScore: number; imageUrl: string }) {
  const shortest = Math.min(input.width, input.height);
  const longest = Math.max(input.width, input.height);
  let score = Math.min(1, shortest / 900) * 0.28 + Math.min(1, longest / 1400) * 0.12;
  score += input.foregroundRatio >= 0.08 && input.foregroundRatio <= 0.82 ? 0.24 : 0.08;
  score += input.hasAlpha ? 0.16 : 0.06;
  score += input.touchesEdges ? 0 : 0.12;
  score += Math.min(0.08, Math.max(0, input.sourceScore) / 1000);
  if (input.hasText) score -= 0.22;
  if (input.objectCount > 10) score -= 0.08;
  if (input.height / Math.max(1, input.width) > 3.5) score -= 0.24;
  if (/\/(?:extra|detail|contents?|editor)\//i.test(input.imageUrl)) score -= 0.1;
  if (/\/product\/(?:big|original)\//i.test(input.imageUrl)) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function salesMatchScore(representation: ProductRepresentation, objectCount: number, candidate: ProductImageCandidate) {
  const expected = representation.expectedUnitCount;
  let score = candidate.type === "main" || candidate.type === "gallery" ? 0.72 : 0.58;
  if (["multi-unit-set", "bundle-components", "irregular-product"].includes(representation.type)) {
    score += objectCount > 1 ? 0.16 : expected && expected > 1 ? -0.18 : 0.04;
    if (expected && objectCount > 0) {
      score += Math.max(-0.16, 0.16 - Math.abs(expected - objectCount) * 0.04);
    }
  } else if (representation.type === "single-product") {
    score += objectCount === 1 ? 0.16 : objectCount <= 3 ? 0.02 : -0.12;
  } else {
    score += objectCount >= 1 ? 0.12 : -0.1;
  }
  return Math.max(0, Math.min(1, score));
}

async function analyzeCandidate(candidate: ProductImageCandidate, representation: ProductRepresentation, index: number): Promise<SourceImageCandidate> {
  const downloaded = await downloadImage(candidate.url);
  const metadata = await sharp(downloaded.buffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error("invalid image dimensions");
  if (Math.min(width, height) < 240 || Math.max(width, height) / Math.max(1, Math.min(width, height)) > 4) {
    throw new Error("image is too small or elongated for product cutout");
  }
  const sample = await sharp(downloaded.buffer).rotate().resize({ width: 192, height: 192, fit: "inside", withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let transparentPixels = 0;
  for (let index = 3; index < sample.data.length; index += 4) {
    if (sample.data[index] < 245) transparentPixels += 1;
  }
  const hasAlpha = Boolean(metadata.hasAlpha) && transparentPixels / Math.max(1, sample.info.width * sample.info.height) > 0.01;
  const foregroundDetection = detectForegroundObjects(sample.data, sample.info.width, sample.info.height, hasAlpha);
  const components = foregroundDetection.components;
  const objectCount = components.length;
  const foregroundRatio = Math.min(
    1,
    components.reduce((sum, item) => sum + item.area, 0)
  );
  const hasText = /배너|광고|할인|특가|event|banner|promotion|상세/i.test(`${candidate.alt || ""} ${candidate.reason || ""} ${candidate.url}`);
  const useCentralPrimary = representation.type === "single-product" && Boolean(foregroundDetection.centralProductBox);
  const detectedObjects: DetectedProductObject[] = [
    ...(useCentralPrimary && foregroundDetection.centralProductBox
      ? [
          {
            id: "object-primary",
            box: foregroundDetection.centralProductBox,
            confidence: 0.78,
            relativeArea: foregroundDetection.centralProductBox.width * foregroundDetection.centralProductBox.height,
            selected: true,
            role: "primary" as const,
          },
        ]
      : []),
    ...components.slice(0, useCentralPrimary ? 7 : 12).map((component, objectIndex) => ({
      id: `object-${objectIndex + 1}`,
      box: component.box,
      confidence: Math.max(0.45, Math.min(0.96, 0.58 + component.area)),
      relativeArea: component.area,
      selected: !useCentralPrimary,
      role: !useCentralPrimary && objectIndex === 0 ? ("primary" as const) : ("component" as const),
    })),
  ];
  const groupBox = unionBoxes(detectedObjects.filter((object) => object.selected).map((object) => object.box));
  const touchesEdges = Boolean(groupBox && (groupBox.x <= 0.01 || groupBox.y <= 0.01 || groupBox.x + groupBox.width >= 0.99 || groupBox.y + groupBox.height >= 0.99));
  const quality = sourceQualityScore({
    width,
    height,
    foregroundRatio,
    objectCount,
    hasText,
    hasAlpha,
    touchesEdges,
    sourceScore: candidate.score,
    imageUrl: candidate.url,
  });
  const salesMatch = salesMatchScore(representation, objectCount, candidate);
  const recommendationScore = Math.max(0, Math.min(1, quality * 0.54 + salesMatch * 0.38 + representation.confidence * 0.08 + (candidate.type === "main" ? 0.16 : candidate.type === "gallery" ? 0.05 : 0)));
  const warnings: string[] = [];
  if (Math.min(width, height) < 500) warnings.push("해상도가 낮습니다.");
  if (hasText) warnings.push("문구 또는 프로모션 그래픽이 포함될 수 있습니다.");
  if (touchesEdges) warnings.push("상품이 이미지 가장자리에서 잘렸을 수 있습니다.");
  if (!objectCount) warnings.push("상품 영역을 안정적으로 감지하지 못했습니다.");
  return {
    id: `source-${String(index + 1).padStart(3, "0")}`,
    type: index === 0 ? "hero" : "detail",
    imagePath: downloaded.finalUrl,
    originalUrl: candidate.url,
    label: index === 0 ? "자동 추천 원본" : `상품 이미지 후보 ${index + 1}`,
    selected: false,
    createdAt: new Date().toISOString(),
    width,
    height,
    sourceType: sourceTypeFor(candidate),
    sourceImageQualityScore: quality,
    salesUnitMatchScore: salesMatch,
    recommendationScore,
    analysisReason: `원본 품질 ${Math.round(quality * 100)}점 · 판매 구성 ${Math.round(salesMatch * 100)}점`,
    expectedRepresentationType: hasAlpha ? "already-transparent" : representation.type,
    expectedExtractionScope: hasAlpha ? "visible-all" : representation.recommendedExtractionScope,
    detectedObjects,
    detectedGroupBox: groupBox,
    hasText,
    hasMultipleObjects: objectCount > 1,
    multipleObjectsAreSalesUnit: objectCount > 1 && ["multi-unit-set", "bundle-components", "irregular-product", "plated-product"].includes(representation.type),
    contentHash: crypto.createHash("sha256").update(downloaded.buffer).digest("hex"),
    perceptualHash: await perceptualHash(downloaded.buffer),
    alreadyTransparent: hasAlpha,
    warnings,
  };
}

export async function analyzeProductSourceCandidates(input: { candidates: ProductImageCandidate[]; representation: ProductRepresentation; limit?: number }) {
  const normalizedSeen = new Set<string>();
  const unique = input.candidates.filter((candidate) => {
    const normalized = normalizeProductImageUrl(candidate.url);
    if (!normalized || normalizedSeen.has(normalized)) return false;
    normalizedSeen.add(normalized);
    return true;
  });
  const attempts = await Promise.allSettled(unique.slice(0, 12).map((candidate, index) => analyzeCandidate(candidate, input.representation, index)));
  const analyzed = attempts
    .filter((result): result is PromiseFulfilledResult<SourceImageCandidate> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((left, right) => (right.recommendationScore || 0) - (left.recommendationScore || 0) || (right.width || 0) * (right.height || 0) - (left.width || 0) * (left.height || 0));
  const deduped: SourceImageCandidate[] = [];
  for (const candidate of analyzed) {
    const duplicate = deduped.some((existing) => existing.contentHash === candidate.contentHash || hammingDistance(existing.perceptualHash, candidate.perceptualHash) <= 5);
    if (!duplicate) deduped.push(candidate);
  }
  const limited = deduped.slice(0, Math.max(3, Math.min(6, input.limit || 6)));
  return limited.map((candidate, index) => ({
    ...candidate,
    id: `source-${String(index + 1).padStart(3, "0")}`,
    label: index === 0 ? "자동 추천 원본" : `상품 이미지 후보 ${index + 1}`,
    selected: index === 0,
  }));
}
