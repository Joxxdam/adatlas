import path from "path";
import { imageSourceToBuffer } from "./imageEffects";

type ImageSize = "1024x1024" | "1536x1024" | "1024x1536";

type ImageClientResult = {
  imageBuffer: Buffer;
  promptUsed: string;
};

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
}): Promise<ImageClientResult> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      prompt: params.prompt,
      size: params.size || "1024x1024",
      quality: "medium",
      n: 1,
    }),
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
}): Promise<ImageClientResult> {
  if (!params.sourceImagePath) {
    throw new Error("선택 이미지 기준 생성에는 원본 기준 이미지가 필요합니다.");
  }

  const sourceBuffer = await imageSourceToBuffer(params.sourceImagePath);
  const contentType = contentTypeFromSource(params.sourceImagePath);
  const fileName = fileNameFromSource(params.sourceImagePath);
  const formData = new FormData();
  formData.append("model", process.env.OPENAI_IMAGE_MODEL || "gpt-image-1");
  formData.append("prompt", params.prompt);
  formData.append("size", params.size || "1024x1024");
  formData.append("quality", "medium");
  formData.append("image[]", new Blob([sourceBuffer], { type: contentType }), fileName);

  const referenceImagePaths = Array.from(new Set(params.referenceImagePaths ?? [])).filter(Boolean).slice(0, 3);
  for (const referenceImagePath of referenceImagePaths) {
    const referenceBuffer = await imageSourceToBuffer(referenceImagePath);
    formData.append(
      "image[]",
      new Blob([referenceBuffer], { type: contentTypeFromSource(referenceImagePath) }),
      fileNameFromSource(referenceImagePath),
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
    throw new Error(`선택된 기준 이미지를 사용한 GPT 이미지 생성에 실패했습니다. ${await response.text()}`);
  }

  return {
    imageBuffer: await imageBufferFromOpenAIResponse(response),
    promptUsed: params.prompt,
  };
}
