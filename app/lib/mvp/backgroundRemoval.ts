import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import sharp from "sharp";
import {
  imageSourceToBuffer,
  removeBackgroundToPng,
  saveProcessedProductImage,
} from "./imageEffects";
import { appendProcessedProductImage } from "./processedProductStore";

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

export type BackgroundRemovalProvider =
  | "removebg"
  | "clipdrop"
  | "mock";

export type RemoveBackgroundInput = {
  imagePath: string;
  provider?: BackgroundRemovalProvider;
};

export type RemoveBackgroundResult = {
  success: boolean;
  originalImagePath: string;
  processedImagePath?: string | null;
  provider: BackgroundRemovalProvider;
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
    removeBgResponseText?: string;
  };
};

type PreparedImageFile = {
  buffer: Buffer;
  filename: string;
  contentType: string;
  byteLength: number;
};

function getFileNameFromImagePath(imagePath: string) {
  try {
    const url = new URL(imagePath);
    return path.basename(url.pathname) || "product-image.png";
  } catch {
    return path.basename(imagePath) || "product-image.png";
  }
}

function getContentType(imagePath: string) {
  const extension = getFileNameFromImagePath(imagePath).toLowerCase().split(".").pop();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  return "application/octet-stream";
}

function isRemoteUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function assertSafeRemoteHostname(hostname: string) {
  const normalized = hostname.toLowerCase();

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized === "::1"
  ) {
    throw new Error("localhost or loopback image URLs are not allowed for background removal.");
  }

  const ipv4Match = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4Match) return;

  const [a, b] = ipv4Match.slice(1).map(Number);
  if (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  ) {
    throw new Error("Private network image URLs are not allowed for background removal.");
  }
}

function extensionFromContentType(contentType: string) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

function truncateForLog(value: string, maxLength = 1600) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function isUnknownForegroundError(status: number, responseText: string) {
  if (status !== 400) return false;
  return /unknown_foreground|foreground|identify.*foreground|could not identify|can't identify|cannot identify|not find.*foreground|find.*foreground/i.test(responseText);
}

async function createLocalFallbackCutout(
  imagePath: string,
  provider: BackgroundRemovalProvider,
  debug?: RemoveBackgroundResult["debug"],
): Promise<RemoveBackgroundResult | null> {
  try {
    const sourceBuffer = await imageSourceToBuffer(imagePath);
    const processedBuffer = await removeBackgroundToPng(sourceBuffer);
    const processedImagePath = await saveResult(imagePath, provider, processedBuffer);
    return {
      success: true,
      originalImagePath: imagePath,
      processedImagePath,
      provider,
      sourceKind: "mock",
      fallbackMessage:
        "remove.bg가 상품 전경을 찾지 못해 로컬 간이 누끼로 처리했습니다. 결과가 어색하면 상품만 크게 나온 다른 이미지를 선택해주세요.",
      debug: {
        ...debug,
        foregroundType: "auto",
      },
    };
  } catch (error) {
    console.error("[remove-background] local fallback cutout failed", error);
    return null;
  }
}

async function validateImagePath(imagePath: string) {
  if (/^(data|blob|file):/i.test(imagePath)) {
    return "data:, blob:, and file: image URLs are not allowed for background removal.";
  }

  if (isRemoteUrl(imagePath)) {
    try {
      const url = new URL(imagePath);
      if (url.protocol !== "https:") {
        return "Remote product images must use an https URL.";
      }
      assertSafeRemoteHostname(url.hostname);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid remote image URL.";
    }
  }

  const publicRelativePath = imagePath.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!publicRelativePath || publicRelativePath.includes("..")) {
    return "Invalid imagePath.";
  }

  if (!allowedPublicPrefixes.some((prefix) => publicRelativePath.startsWith(prefix))) {
    return "imagePath is outside allowed public image directories.";
  }

  const publicDir = path.join(process.cwd(), "public");
  const absolutePath = path.resolve(publicDir, publicRelativePath);
  if (!absolutePath.startsWith(publicDir)) {
    return "imagePath escapes the public directory.";
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return "imagePath is not a file.";
  } catch {
    return "imagePath file does not exist.";
  }

  return null;
}

async function downloadRemoteImageAsBlob(imageUrl: string): Promise<PreparedImageFile> {
  const url = new URL(imageUrl);

  if (url.protocol !== "https:") {
    throw new Error("Remote product images must use an https URL.");
  }

  assertSafeRemoteHostname(url.hostname);

  const response = await fetch(url.toString(), {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Remote image download failed: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(
      `Remote URL is not an image file. content-type=${contentType || "unknown"}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxRemoteImageBytes) {
    throw new Error("Remote image is too large. Please use an image under 12MB.");
  }

  const extension = extensionFromContentType(contentType);

  return {
    buffer: Buffer.from(arrayBuffer),
    filename: `remote-product-${Date.now()}.${extension}`,
    contentType: contentType || "image/jpeg",
    byteLength: arrayBuffer.byteLength,
  };
}

async function readLocalPublicImageAsBlob(imagePath: string): Promise<PreparedImageFile> {
  const publicRelativePath = imagePath.replace(/^\/+/, "").replace(/\\/g, "/");
  const publicDir = path.join(process.cwd(), "public");
  const absolutePath = path.resolve(publicDir, publicRelativePath);
  const buffer = await fs.readFile(absolutePath);
  const contentType = getContentType(imagePath);
  const filename = getFileNameFromImagePath(imagePath);

  return {
    buffer,
    filename,
    contentType,
    byteLength: buffer.byteLength,
  };
}

async function buildRemoveBgFormData(imagePath: string, foregroundType?: "product" | "auto") {
  const isRemote = isRemoteUrl(imagePath);
  const imageFile = isRemote
    ? await downloadRemoteImageAsBlob(imagePath)
    : await readLocalPublicImageAsBlob(imagePath);
  const normalizedPngBuffer = await sharp(imageFile.buffer)
    .rotate()
    .png()
    .toBuffer();
  const pngFileName = imageFile.filename.replace(/\.[^.]+$/, "") + ".png";
  const formData = new FormData();

  formData.append(
    "image_file",
    new Blob([new Uint8Array(normalizedPngBuffer)], { type: "image/png" }),
    pngFileName,
  );
  formData.append("size", "auto");
  formData.append("format", "png");
  if (foregroundType && foregroundType !== "auto") {
    formData.append("type", foregroundType);
  }

  return {
    formData,
    sourceKind: isRemote ? "remote-url-downloaded" as const : "local-public-file" as const,
    debug: {
      contentType: imageFile.contentType,
      byteLength: imageFile.byteLength,
      fileName: pngFileName,
      foregroundType,
      normalizedContentType: "image/png",
      normalizedByteLength: normalizedPngBuffer.byteLength,
    },
  };
}

function failureResult(
  input: RemoveBackgroundInput,
  error: string,
  fallbackMessage = "Background removal failed. Keeping the original image.",
  extra?: Pick<RemoveBackgroundResult, "detail" | "sourceKind" | "debug">,
): RemoveBackgroundResult {
  return {
    success: false,
    originalImagePath: input.imagePath,
    processedImagePath: null,
    provider: input.provider || "removebg",
    error,
    fallbackMessage,
    ...extra,
  };
}

async function saveResult(
  originalImagePath: string,
  provider: BackgroundRemovalProvider,
  buffer: Buffer,
) {
  const processedImagePath = await saveProcessedProductImage(
    buffer,
    `${provider}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`,
  );

  await appendProcessedProductImage({
    id: crypto.randomUUID(),
    provider,
    originalImagePath,
    processedImagePath,
    createdAt: new Date().toISOString(),
  }).catch((error) => {
    console.error("[remove-background] processed product store write failed", error);
  });

  return processedImagePath;
}

export async function removeProductBackground(
  input: RemoveBackgroundInput,
): Promise<RemoveBackgroundResult> {
  const provider = input.provider || "removebg";
  const imagePath = String(input.imagePath || "").trim();

  if (!imagePath) {
    return failureResult({ ...input, provider }, "imagePath is required.");
  }

  if (provider === "clipdrop") {
    return failureResult(
      { ...input, imagePath, provider },
      "Clipdrop provider is not implemented.",
      "Clipdrop is not implemented yet. Keeping the original image.",
    );
  }

  try {
    const validationError = await validateImagePath(imagePath);
    if (validationError) {
      return failureResult(
        { ...input, imagePath, provider },
        validationError,
        "이미지 경로를 확인해 주세요. 원격 이미지는 공개 https 이미지 URL만 처리할 수 있습니다.",
      );
    }

    if (provider === "mock") {
      const sourceBuffer = await imageSourceToBuffer(imagePath);
      const processedBuffer = await removeBackgroundToPng(sourceBuffer);
      const processedImagePath = await saveResult(imagePath, provider, processedBuffer);
      return {
        success: true,
        originalImagePath: imagePath,
        processedImagePath,
        provider,
        sourceKind: "mock",
      };
    }

    const apiKey = process.env.REMOVE_BG_API_KEY;
    if (!apiKey) {
      return failureResult(
        { ...input, imagePath, provider },
        "REMOVE_BG_API_KEY is not configured",
        "remove.bg API 키가 설정되지 않았습니다. .env.local에 REMOVE_BG_API_KEY를 추가한 뒤 서버를 재시작해 주세요.",
      );
    }

    const { formData, sourceKind, debug } = await buildRemoveBgFormData(imagePath, "product");
    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: formData,
    });

    if (!response.ok) {
      const contentType = response.headers.get("content-type") || "";
      const errorText = truncateForLog(await response.text().catch(() => ""));
      if (isUnknownForegroundError(response.status, errorText)) {
        const retry = await buildRemoveBgFormData(imagePath, "auto");
        const retryResponse = await fetch("https://api.remove.bg/v1.0/removebg", {
          method: "POST",
          headers: { "X-Api-Key": apiKey },
          body: retry.formData,
        });

        if (retryResponse.ok) {
          const processedBuffer = Buffer.from(await retryResponse.arrayBuffer());
          const processedImagePath = await saveResult(imagePath, provider, processedBuffer);
          return {
            success: true,
            originalImagePath: imagePath,
            processedImagePath,
            provider,
            sourceKind: retry.sourceKind,
            debug: retry.debug,
          };
        }

        const retryContentType = retryResponse.headers.get("content-type") || "";
        const retryErrorText = truncateForLog(await retryResponse.text().catch(() => ""));
        console.error("[remove-background] remove.bg API retry failed", {
          status: retryResponse.status,
          statusText: retryResponse.statusText,
          contentType: retryContentType,
          responseText: retryErrorText,
          sourceKind: retry.sourceKind,
          foregroundType: "auto",
          debug: retry.debug,
        });

        if (isUnknownForegroundError(retryResponse.status, retryErrorText)) {
          const localFallback = await createLocalFallbackCutout(imagePath, provider, {
            ...retry.debug,
            removeBgStatus: retryResponse.status,
            removeBgStatusText: retryResponse.statusText,
            removeBgResponseText: process.env.NODE_ENV === "development" ? retryErrorText : undefined,
          });

          if (localFallback) return localFallback;
        }

        return failureResult(
          { ...input, imagePath, provider },
          `remove.bg API failed: HTTP ${retryResponse.status}`,
          "remove.bg could not identify a clear product foreground in this image. Please choose another image with a larger product and clearer background separation, or keep using the original image.",
          {
            detail: process.env.NODE_ENV === "development"
              ? retryErrorText || retryResponse.statusText
              : undefined,
            sourceKind: retry.sourceKind,
            debug: {
              ...retry.debug,
              removeBgStatus: retryResponse.status,
              removeBgStatusText: retryResponse.statusText,
              removeBgResponseText: process.env.NODE_ENV === "development" ? retryErrorText : undefined,
            },
          },
        );
      }
      console.error("[remove-background] remove.bg API failed", {
        status: response.status,
        statusText: response.statusText,
        contentType,
        responseText: errorText,
        sourceKind,
        debug,
      });

      return failureResult(
        { ...input, imagePath, provider },
        `remove.bg API failed: HTTP ${response.status}`,
        `remove.bg API request failed: HTTP ${response.status}. Please check the image format or remote image access.`,
        {
          detail: process.env.NODE_ENV === "development"
            ? errorText || response.statusText
            : undefined,
          sourceKind,
          debug: {
            ...debug,
            removeBgStatus: response.status,
            removeBgStatusText: response.statusText,
            removeBgResponseText: process.env.NODE_ENV === "development" ? errorText : undefined,
          },
        },
      );
    }

    const processedBuffer = Buffer.from(await response.arrayBuffer());
    const processedImagePath = await saveResult(imagePath, provider, processedBuffer);
    return {
      success: true,
      originalImagePath: imagePath,
      processedImagePath,
      provider,
      sourceKind,
      debug,
    };
  } catch (error) {
    console.error("[remove-background] background removal failed", error);
    return failureResult(
      { ...input, imagePath, provider },
      error instanceof Error ? error.message : "Background removal failed.",
      "배경 제거에 실패했습니다. 원본 이미지를 계속 사용하거나 상품 이미지를 직접 업로드해 주세요.",
    );
  }
}
