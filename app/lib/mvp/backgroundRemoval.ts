import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
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
  fallbackMessage?: string;
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
  return "application/octet-stream";
}

async function validatePublicImagePath(imagePath: string) {
  if (/^data:image\//i.test(imagePath)) {
    return "Data URL images are not allowed for background removal.";
  }

  if (/^https?:\/\//i.test(imagePath)) {
    try {
      const url = new URL(imagePath);
      const hostname = url.hostname.toLowerCase();
      const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
      const isPrivateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|169\.254\.)/.test(hostname);
      if (isLocalhost || isPrivateIpv4) {
        return "Private or localhost image URLs are not allowed for background removal.";
      }
      return null;
    } catch {
      return "Invalid remote image URL.";
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

function failureResult(
  input: RemoveBackgroundInput,
  error: string,
  fallbackMessage = "Background removal failed. Keeping the original image.",
): RemoveBackgroundResult {
  return {
    success: false,
    originalImagePath: input.imagePath,
    processedImagePath: null,
    provider: input.provider || "removebg",
    error,
    fallbackMessage,
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
    const validationError = await validatePublicImagePath(imagePath);
    if (validationError) {
      return failureResult(
        { ...input, imagePath, provider },
        validationError,
      );
    }

    const sourceBuffer = await imageSourceToBuffer(imagePath);

    if (provider === "mock") {
      const processedBuffer = await removeBackgroundToPng(sourceBuffer);
      const processedImagePath = await saveResult(imagePath, provider, processedBuffer);
      return { success: true, originalImagePath: imagePath, processedImagePath, provider };
    }

    const apiKey = process.env.REMOVE_BG_API_KEY;
    if (!apiKey) {
      return failureResult(
        { ...input, imagePath, provider },
        "REMOVE_BG_API_KEY is not configured",
        "remove.bg API 키가 설정되지 않았습니다. .env.local에 REMOVE_BG_API_KEY=... 를 추가한 뒤 서버를 재시작해 주세요.",
      );
    }

    const formData = new FormData();
    formData.append(
      "image_file",
      new Blob([new Uint8Array(sourceBuffer)], { type: getContentType(imagePath) }),
      getFileNameFromImagePath(imagePath),
    );
    formData.append("size", "auto");
    formData.append("format", "png");
    formData.append("type", "product");

    const response = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": apiKey },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[remove-background] remove.bg API failed", {
        status: response.status,
        responseText: errorText,
      });
      return failureResult(
        { ...input, imagePath, provider },
        `remove.bg API failed: HTTP ${response.status}`,
        `remove.bg API 호출 실패: HTTP ${response.status}. 서버 콘솔의 remove.bg 응답 내용을 확인해 주세요.`,
      );
    }

    const processedBuffer = Buffer.from(await response.arrayBuffer());
    const processedImagePath = await saveResult(imagePath, provider, processedBuffer);
    return { success: true, originalImagePath: imagePath, processedImagePath, provider };
  } catch (error) {
    console.error("[remove-background] background removal failed", error);
    return failureResult(
      { ...input, imagePath, provider },
      error instanceof Error ? error.message : "Background removal failed.",
    );
  }
}
