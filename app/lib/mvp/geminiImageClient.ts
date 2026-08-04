import { imageSourceToBuffer } from "./imageEffects";

type GeminiImageClientResult = {
  imageBuffer: Buffer;
  promptUsed: string;
  model: string;
};

function geminiApiKey() {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  );
}

function contentTypeFromSource(source: string) {
  const lower = source.toLowerCase();
  if (lower.includes("image/png") || lower.endsWith(".png")) return "image/png";
  if (lower.includes("image/webp") || lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function imageBufferFromLegacyGeminiResponse(result: Record<string, unknown>) {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  for (const candidate of candidates) {
    const content = (candidate as Record<string, unknown>).content as
      Record<string, unknown> | undefined;
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const part of parts) {
      const inlineData =
        (part as Record<string, unknown>).inlineData ||
        (part as Record<string, unknown>).inline_data;
      if (inlineData && typeof inlineData === "object") {
        const data = (inlineData as Record<string, unknown>).data;
        if (typeof data === "string" && data) return Buffer.from(data, "base64");
      }
    }
  }
  return null;
}

function imageBufferFromInteractionResponse(result: Record<string, unknown>) {
  const visited = new Set<object>();

  function visit(value: unknown): Buffer | null {
    if (!value || typeof value !== "object") return null;
    if (visited.has(value)) return null;
    visited.add(value);

    const record = value as Record<string, unknown>;
    const mimeType = record.mime_type || record.mimeType;
    const type = record.type;
    if (
      typeof record.data === "string" &&
      record.data &&
      ((typeof mimeType === "string" && mimeType.startsWith("image/")) || type === "image")
    ) {
      return Buffer.from(record.data, "base64");
    }

    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const found = visit(item);
          if (found) return found;
        }
      } else {
        const found = visit(child);
        if (found) return found;
      }
    }
    return null;
  }

  return visit(result);
}

function imageBufferFromGeminiResponse(result: Record<string, unknown>) {
  const buffer =
    imageBufferFromInteractionResponse(result) || imageBufferFromLegacyGeminiResponse(result);
  if (buffer) return buffer;
  throw new Error("Gemini 이미지 응답에서 이미지 데이터를 찾지 못했습니다.");
}

function interactionInputFromParts(parts: Array<Record<string, unknown>>) {
  return parts.map((part) => {
    if (typeof part.text === "string") {
      return { type: "text", text: part.text };
    }
    const inlineData = part.inlineData as Record<string, unknown> | undefined;
    return {
      type: "image",
      mime_type: inlineData?.mimeType || "image/png",
      data: inlineData?.data,
    };
  });
}

async function callGeminiImageModel(
  parts: Array<Record<string, unknown>>,
  prompt: string
): Promise<GeminiImageClientResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY를 확인해주세요.");

  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
  const imageSize = model.includes("2.5-flash-image") ? "1K" : "2K";
  const requestBody: Record<string, unknown> = {
    model,
    input: interactionInputFromParts(parts),
    response_format: {
      type: "image",
      mime_type: "image/jpeg",
      aspect_ratio: "1:1",
      image_size: imageSize,
    },
  };
  if (model.includes("3.1-flash-image")) {
    requestBody.generation_config = { thinking_level: "high" };
  }
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(requestBody),
    }
  );

  const text = await response.text();
  let result: Record<string, unknown> = {};
  try {
    result = JSON.parse(text);
  } catch {
    result = {};
  }

  if (!response.ok) {
    throw new Error(`Gemini 나노바나나 이미지 생성에 실패했습니다. ${text}`);
  }

  return {
    imageBuffer: imageBufferFromGeminiResponse(result),
    promptUsed: prompt,
    model,
  };
}

export async function generateGeminiImageFromText(params: {
  prompt: string;
}): Promise<GeminiImageClientResult> {
  return callGeminiImageModel([{ text: params.prompt }], params.prompt);
}

export async function editGeminiImageFromSource(params: {
  sourceImagePath: string;
  referenceImagePaths?: string[];
  prompt: string;
}): Promise<GeminiImageClientResult> {
  if (!params.sourceImagePath) {
    throw new Error("나노바나나 기준 이미지 생성에는 원본 기준 이미지가 필요합니다.");
  }

  const parts: Array<Record<string, unknown>> = [{ text: params.prompt }];
  const sourceBuffer = await imageSourceToBuffer(params.sourceImagePath);
  parts.push({
    inlineData: {
      mimeType: contentTypeFromSource(params.sourceImagePath),
      data: sourceBuffer.toString("base64"),
    },
  });

  const referenceImagePaths = Array.from(new Set(params.referenceImagePaths ?? []))
    .filter(Boolean)
    .slice(0, 3);
  for (const referenceImagePath of referenceImagePaths) {
    const referenceBuffer = await imageSourceToBuffer(referenceImagePath);
    parts.push({
      inlineData: {
        mimeType: contentTypeFromSource(referenceImagePath),
        data: referenceBuffer.toString("base64"),
      },
    });
  }

  return callGeminiImageModel(parts, params.prompt);
}
