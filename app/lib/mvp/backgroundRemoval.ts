import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import { validatePublicHttpUrl } from "../store-analysis/urlSafety";
import {
  prepareProductSourceBuffer,
  removeBackgroundToPng,
  saveProcessedProductImage,
} from "./imageEffects";
import { inspectCutoutQuality } from "./cutoutQuality";
import {
  PRODUCT_IMAGE_PIPELINE_VERSION,
  productCutoutCacheDescriptor,
} from "./productImagePipeline";
import {
  applySelectedObjectBoxes,
  refineProductCutoutAlpha,
} from "./productMaskPostprocess";
import {
  appendProcessedProductImage,
  readProcessedProducts,
} from "./processedProductStore";
import type {
  NormalizedImageBox,
  ProductCutoutQuality,
  ProductExtractionScope,
  ProductRepresentationType,
} from "./types";

const allowedPublicPrefixes = [
  "product-images/",
  "extracted/",
  "generated-product-images/",
  "collected-images/",
  "uploaded-source-images/",
  "background-images/",
  "processed-products/",
];
const maxRemoteImageBytes = 12 * 1024 * 1024;
const maxImagePixels = 40_000_000;
const maxRedirects = 4;

export type BackgroundRemovalProvider = "removebg" | "clipdrop" | "mock";

export type RemoveBackgroundInput = {
  imagePath: string;
  provider?: BackgroundRemovalProvider;
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
  selectedObjectIds?: string[];
  selectedObjectBoxes?: NormalizedImageBox[];
  cropBox?: NormalizedImageBox;
  expectedUnitCount?: number;
  cleanupStrength?: "light" | "balanced" | "strong";
};

export type RemoveBackgroundResult = {
  success: boolean;
  originalImagePath: string;
  processedImagePath?: string | null;
  croppedImagePath?: string;
  provider: BackgroundRemovalProvider;
  quality?: ProductCutoutQuality;
  retryCount?: number;
  cacheKey?: string;
  error?: string;
  detail?: string;
  fallbackMessage?: string;
  sourceKind?: "local-public-file" | "remote-url-downloaded" | "mock";
  debug?: {
    contentType?: string;
    byteLength?: number;
    fileName?: string;
    foregroundType?: "product" | "auto";
    normalizedContentType?: string;
    normalizedByteLength?: number;
    removeBgStatus?: number;
    removeBgStatusText?: string;
    cacheHit?: boolean;
  };
};

type PreparedImage = {
  buffer: Buffer;
  filename: string;
  contentType: string;
  sourceKind: "local-public-file" | "remote-url-downloaded";
};

function isRemoteUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function localPublicPath(imagePath: string) {
  const relative = imagePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!relative || relative.includes("..")) throw new Error("Invalid imagePath.");
  if (!allowedPublicPrefixes.some((prefix) => relative.startsWith(prefix))) {
    throw new Error("imagePath is outside allowed public image directories.");
  }
  const publicDir = path.resolve(process.cwd(), "public");
  const absolute = path.resolve(publicDir, relative);
  if (!absolute.startsWith(`${publicDir}${path.sep}`)) throw new Error("imagePath escapes public.");
  return absolute;
}

async function readLimitedBody(response: Response) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxRemoteImageBytes) throw new Error("Remote image exceeds 12MB.");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxRemoteImageBytes) {
      await reader.cancel();
      throw new Error("Remote image exceeds 12MB.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function downloadRemoteImage(imagePath: string): Promise<PreparedImage> {
  let current = await validatePublicHttpUrl(imagePath);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetch(current, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.5",
        "User-Agent": "Mozilla/5.0 (compatible; AdAtlasBackgroundRemoval/1.0)",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || redirectCount === maxRedirects) throw new Error("Too many redirects.");
      current = await validatePublicHttpUrl(new URL(location, current).toString());
      continue;
    }
    await validatePublicHttpUrl(response.url || current.toString());
    if (!response.ok) throw new Error(`Remote image HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith("image/") || contentType.includes("svg")) {
      throw new Error("Remote response is not a supported raster image.");
    }
    return {
      buffer: await readLimitedBody(response),
      filename: path.basename(current.pathname) || "remote-product",
      contentType,
      sourceKind: "remote-url-downloaded",
    };
  }
  throw new Error("Too many redirects.");
}

async function prepareImage(imagePath: string): Promise<PreparedImage> {
  if (/^(?:data|blob|file):/i.test(imagePath)) throw new Error("Unsafe image URL protocol.");
  const prepared = isRemoteUrl(imagePath)
    ? await downloadRemoteImage(imagePath)
    : {
        buffer: await fs.readFile(localPublicPath(imagePath)),
        filename: path.basename(imagePath) || "product-image",
        contentType: "application/octet-stream",
        sourceKind: "local-public-file" as const,
      };
  if (!prepared.buffer.length || prepared.buffer.length > maxRemoteImageBytes) {
    throw new Error("Image must be between 1 byte and 12MB.");
  }
  const metadata = await sharp(prepared.buffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height || width > 10_000 || height > 10_000 || width * height > maxImagePixels) {
    throw new Error("Image dimensions exceed the processing limit.");
  }
  if (!metadata.format || !["png", "jpeg", "webp", "avif"].includes(metadata.format)) {
    throw new Error("Only PNG, JPEG, WEBP, or AVIF raster images are supported.");
  }
  return prepared;
}

export async function loadSafeProductImageBuffer(imagePath: string) {
  return (await prepareImage(imagePath)).buffer;
}

export function buildProductCutoutCacheKey(input: {
  contentHash: string;
  provider: string;
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
  selectedObjectIds?: string[];
  cropBox?: NormalizedImageBox;
  cleanupStrength?: string;
}) {
  const stable = productCutoutCacheDescriptor(input);
  return crypto.createHash("sha256").update(stable).digest("hex");
}

async function cachedResult(cacheKey: string) {
  const records = await readProcessedProducts().catch(() => []);
  const publicDir = path.resolve(process.cwd(), "public");
  for (const record of records) {
    if (record.cacheKey !== cacheKey) continue;
    const relative = record.processedImagePath.replace(/^\/+/, "").replace(/\\/g, "/");
    const absolute = path.resolve(publicDir, relative);
    if (!relative.startsWith("processed-products/") || !absolute.startsWith(`${publicDir}${path.sep}`))
      continue;
    try {
      const buffer = await fs.readFile(absolute);
      if (buffer.length) return { path: record.processedImagePath, buffer };
    } catch {
      // Ignore a stale cache row.
    }
  }
  return null;
}

async function saveResult(input: {
  originalImagePath: string;
  provider: BackgroundRemovalProvider;
  cacheKey: string;
  buffer: Buffer;
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
}) {
  const processedImagePath = await saveProcessedProductImage(
    input.buffer,
    `${input.provider}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`
  );
  await appendProcessedProductImage({
    id: crypto.randomUUID(),
    provider: input.provider,
    originalImagePath: input.originalImagePath,
    processedImagePath,
    cacheKey: input.cacheKey,
    representationType: input.representationType,
    extractionScope: input.extractionScope,
    pipelineVersion: PRODUCT_IMAGE_PIPELINE_VERSION,
    createdAt: new Date().toISOString(),
  }).catch((error) => console.error("[remove-background] cache write failed", error));
  return processedImagePath;
}

function removeBgFormData(buffer: Buffer, filename: string, foregroundType: "product" | "auto") {
  const formData = new FormData();
  formData.append("image_file", new Blob([new Uint8Array(buffer)], { type: "image/png" }), `${filename}.png`);
  formData.append("size", "auto");
  formData.append("format", "png");
  if (foregroundType === "product") formData.append("type", "product");
  return formData;
}

async function callRemoveBg(buffer: Buffer, filename: string, foregroundType: "product" | "auto") {
  const apiKey = process.env.REMOVE_BG_API_KEY;
  if (!apiKey) throw new Error("REMOVE_BG_API_KEY is not configured");
  const response = await fetch("https://api.remove.bg/v1.0/removebg", {
    method: "POST",
    headers: { "X-Api-Key": apiKey },
    body: removeBgFormData(buffer, filename, foregroundType),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 500);
    throw new Error(`remove.bg HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function finalizeCandidate(buffer: Buffer, input: RemoveBackgroundInput) {
  let refined = await refineProductCutoutAlpha(buffer, {
    representationType: input.representationType,
    extractionScope: input.extractionScope,
    cleanupStrength: input.cleanupStrength,
  });
  if (input.selectedObjectBoxes?.length) {
    refined = await applySelectedObjectBoxes(refined, input.selectedObjectBoxes, input.cropBox);
  }
  const quality = await inspectCutoutQuality(refined, {
    representationType: input.representationType,
    extractionScope: input.extractionScope,
    expectedUnitCount: input.expectedUnitCount,
  });
  return { buffer: refined, quality };
}

export async function removeProductBackground(
  input: RemoveBackgroundInput
): Promise<RemoveBackgroundResult> {
  const imagePath = String(input.imagePath || "").trim();
  const provider = input.provider || "removebg";
  if (!imagePath) {
    return { success: false, originalImagePath: "", provider, error: "imagePath is required." };
  }
  if (provider === "clipdrop") {
    return {
      success: false,
      originalImagePath: imagePath,
      provider,
      error: "Clipdrop provider is not implemented.",
      fallbackMessage: "Clipdrop 연결이 없어 기존 provider 또는 로컬 방식으로 다시 시도해 주세요.",
    };
  }

  try {
    const source = await prepareImage(imagePath);
    const contentHash = crypto.createHash("sha256").update(source.buffer).digest("hex");
    const cacheKey = buildProductCutoutCacheKey({
      contentHash,
      provider,
      representationType: input.representationType,
      extractionScope: input.extractionScope,
      selectedObjectIds: input.selectedObjectIds,
      cropBox: input.cropBox,
      cleanupStrength: input.cleanupStrength,
    });
    const cached = await cachedResult(cacheKey);
    if (cached) {
      const quality = await inspectCutoutQuality(cached.buffer, {
        representationType: input.representationType,
        extractionScope: input.extractionScope,
        expectedUnitCount: input.expectedUnitCount,
      });
      if (quality.usable) {
        return {
          success: true,
          originalImagePath: imagePath,
          processedImagePath: cached.path,
          provider,
          quality,
          retryCount: 0,
          cacheKey,
          sourceKind: source.sourceKind,
          debug: { cacheHit: true },
        };
      }
    }

    const normalized = await prepareProductSourceBuffer(source.buffer, input.cropBox);
    let croppedImagePath: string | undefined;
    if (input.cropBox) {
      croppedImagePath = await saveProcessedProductImage(
        normalized,
        `crop-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.png`
      );
    }
    if (input.extractionScope === "original") {
      const quality = await inspectCutoutQuality(normalized, { extractionScope: "original" });
      const processedImagePath = await saveResult({
        originalImagePath: imagePath,
        provider,
        cacheKey,
        buffer: normalized,
        representationType: input.representationType,
        extractionScope: input.extractionScope,
      });
      return {
        success: true,
        originalImagePath: imagePath,
        processedImagePath,
        croppedImagePath,
        provider,
        quality,
        retryCount: 0,
        cacheKey,
        sourceKind: source.sourceKind,
        fallbackMessage: "사용자 선택에 따라 원본 구성을 유지했습니다.",
      };
    }

    const attempts: Array<() => Promise<Buffer>> = [];
    if (provider === "removebg" && process.env.REMOVE_BG_API_KEY) {
      attempts.push(
        () => callRemoveBg(normalized, source.filename, "product"),
        () => callRemoveBg(normalized, source.filename, "auto")
      );
    }
    attempts.push(
      () =>
        removeBackgroundToPng(normalized, {
          representationType: input.representationType,
          extractionScope: input.extractionScope,
          threshold: 36,
          featherRadius: 0.6,
        }),
      () =>
        removeBackgroundToPng(normalized, {
          representationType: input.representationType,
          extractionScope: input.extractionScope,
          threshold: 46,
          featherRadius: 0.9,
        })
    );

    let bestQuality: ProductCutoutQuality | undefined;
    let retryCount = 0;
    for (const attempt of attempts.slice(0, 4)) {
      try {
        const candidate = await finalizeCandidate(await attempt(), input);
        if (!bestQuality || candidate.quality.score > bestQuality.score) bestQuality = candidate.quality;
        if (!candidate.quality.usable) {
          retryCount += 1;
          continue;
        }
        const processedImagePath = await saveResult({
          originalImagePath: imagePath,
          provider,
          cacheKey,
          buffer: candidate.buffer,
          representationType: input.representationType,
          extractionScope: input.extractionScope,
        });
        return {
          success: true,
          originalImagePath: imagePath,
          processedImagePath,
          croppedImagePath,
          provider,
          quality: candidate.quality,
          retryCount,
          cacheKey,
          sourceKind: source.sourceKind,
          fallbackMessage:
            retryCount > 0
              ? `${retryCount}회 설정을 조정해 품질 기준을 통과한 누끼를 선택했습니다.`
              : process.env.REMOVE_BG_API_KEY
                ? undefined
                : "외부 API 키가 없어 로컬 배경 제거 방식으로 처리했습니다.",
          debug: {
            byteLength: source.buffer.length,
            fileName: source.filename,
            normalizedContentType: "image/png",
            normalizedByteLength: normalized.length,
          },
        };
      } catch (error) {
        retryCount += 1;
        console.warn("[remove-background] attempt failed", {
          message: error instanceof Error ? error.message : "unknown failure",
          retryCount,
        });
      }
    }

    return {
      success: false,
      originalImagePath: imagePath,
      croppedImagePath,
      provider,
      quality: bestQuality,
      retryCount,
      cacheKey,
      sourceKind: source.sourceKind,
      error: "CUTOUT_QUALITY_FAILED",
      fallbackMessage:
        "품질 기준을 통과한 누끼를 만들지 못해 원본을 유지했습니다. 다른 원본·추출 범위·직접 영역을 선택해 주세요.",
    };
  } catch (error) {
    return {
      success: false,
      originalImagePath: imagePath,
      provider,
      error: "REMOVE_BG_FAILED",
      detail: process.env.NODE_ENV === "development" && error instanceof Error ? error.message : undefined,
      fallbackMessage:
        "이미지를 안전하게 처리하지 못해 원본을 유지했습니다. 파일 형식·크기 또는 원격 이미지 접근을 확인해 주세요.",
    };
  }
}
