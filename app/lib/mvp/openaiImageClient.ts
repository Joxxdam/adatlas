import path from "path";
import { readCreativeRasterAsset } from "../creative-generation/assets.server.ts";

type ImageSize =
  | "1024x1024"
  | "1536x1024"
  | "1024x1536";
type ImageQuality = "low" | "medium" | "high";
type ImageBackground = "transparent" | "opaque" | "auto";
type ImageOutputFormat = "png" | "jpeg" | "webp";

type ImageClientResult = {
  imageBuffer: Buffer;
  promptUsed: string;
};

function assertExplicitPaidImageAuthorization(explicitlyAuthorized: boolean | undefined) {
  const serverEnabled = process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED === "true";
  if (explicitlyAuthorized !== true || !serverEnabled) {
    throw new Error(
      "유료 OpenAI 이미지 API는 사용자가 해당 작업에서 별도로 공급자를 선택하고 서버 허용이 켜진 경우에만 사용할 수 있습니다. 기본 제작은 Codex·ChatGPT 로그인으로 실행됩니다."
    );
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("선택한 유료 OpenAI 이미지 공급자의 서버 인증정보를 확인해 주세요.");
  }
}

export function getOpenAIImageModel() {
  return process.env.ADATLAS_IMAGE_MODEL || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5";
}

export function getOpenAIImageQuality(): ImageQuality {
  const value = String(process.env.ADATLAS_IMAGE_QUALITY || "high").toLowerCase();
  return value === "low" || value === "medium" ? value : "high";
}

export function getOpenAIImageSize(): ImageSize {
  const value = String(process.env.ADATLAS_IMAGE_SIZE || "1024x1024");
  return ["1024x1024", "1536x1024", "1024x1536"].includes(value)
    ? (value as ImageSize)
    : "1024x1024";
}

function contentTypeFromSource(source: string) {
  const lower = source.toLowerCase();
  if (lower.includes("image/png") || lower.endsWith(".png")) return "image/png";
  if (lower.includes("image/webp") || lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function fileNameFromSource(source: string) {
  if (source.startsWith("data:")) return "source-image.png";
  try {
    const url = new URL(source);
    return path.basename(url.pathname) || "source-image.jpg";
  } catch {
    return path.basename(source) || "source-image.jpg";
  }
}

async function imageBufferFromOpenAIResponse(response: Response) {
  const result = await response.json();
  const firstImage = result.data?.[0] ?? {};
  if (firstImage.b64_json) {
    return Buffer.from(firstImage.b64_json, "base64");
  }
  if (firstImage.url) {
    const imageResponse = await fetch(firstImage.url);
    if (!imageResponse.ok) {
      throw new Error(`Generated image download failed: HTTP ${imageResponse.status}`);
    }
    return Buffer.from(await imageResponse.arrayBuffer());
  }
  throw new Error("OpenAI 이미지 응답에서 이미지 데이터를 찾지 못했습니다.");
}

export async function generateImageFromText(params: {
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  background?: ImageBackground;
  outputFormat?: ImageOutputFormat;
  explicitPaidApiAuthorization?: boolean;
}): Promise<ImageClientResult> {
  assertExplicitPaidImageAuthorization(params.explicitPaidApiAuthorization);
  const body: Record<string, unknown> = {
    model: getOpenAIImageModel(),
    prompt: params.prompt,
    size: params.size || "1024x1024",
    quality: params.quality || "medium",
    n: 1,
  };
  if (params.background) body.background = params.background;
  if (params.outputFormat) body.output_format = params.outputFormat;

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`GPT 이미지 생성에 실패했습니다. ${await response.text()}`);
  }

  return {
    imageBuffer: await imageBufferFromOpenAIResponse(response),
    promptUsed: params.prompt,
  };
}

export async function editImageFromSource(params: {
  sourceImagePath: string;
  referenceImagePaths?: string[];
  prompt: string;
  size?: ImageSize;
  quality?: ImageQuality;
  explicitPaidApiAuthorization?: boolean;
}): Promise<ImageClientResult> {
  assertExplicitPaidImageAuthorization(params.explicitPaidApiAuthorization);
  if (!params.sourceImagePath) {
    throw new Error("선택 이미지 기준 생성에는 원본 기준 이미지가 필요합니다.");
  }

  const sourceBuffer = await readCreativeRasterAsset(params.sourceImagePath);
  const contentType = contentTypeFromSource(params.sourceImagePath);
  const fileName = fileNameFromSource(params.sourceImagePath);
  const formData = new FormData();
  formData.append("model", getOpenAIImageModel());
  formData.append("prompt", params.prompt);
  formData.append("size", params.size || "1024x1024");
  formData.append("quality", params.quality || "medium");
  formData.append("input_fidelity", "high");
  formData.append("background", "opaque");
  formData.append("output_format", "png");
  formData.append("image[]", new Blob([sourceBuffer], { type: contentType }), fileName);

  const referenceImagePaths = Array.from(new Set(params.referenceImagePaths ?? []))
    .filter(Boolean)
    .slice(0, 3);
  for (const referenceImagePath of referenceImagePaths) {
    const referenceBuffer = await readCreativeRasterAsset(referenceImagePath);
    formData.append(
      "image[]",
      new Blob([referenceBuffer], { type: contentTypeFromSource(referenceImagePath) }),
      fileNameFromSource(referenceImagePath)
    );
  }

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(
      `선택된 기준 이미지를 사용한 GPT 이미지 생성에 실패했습니다. ${await response.text()}`
    );
  }

  return {
    imageBuffer: await imageBufferFromOpenAIResponse(response),
    promptUsed: params.prompt,
  };
}
