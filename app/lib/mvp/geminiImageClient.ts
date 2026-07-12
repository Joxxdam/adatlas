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

function imageBufferFromGeminiResponse(result: Record<string, unknown>) {
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
  throw new Error("Gemini 이미지 응답에서 이미지 데이터를 찾지 못했습니다.");
}

async function callGeminiImageModel(
  parts: Array<Record<string, unknown>>,
  prompt: string
): Promise<GeminiImageClientResult> {
  const apiKey = geminiApiKey();
  if (!apiKey) throw new Error("GEMINI_API_KEY를 확인해주세요.");

  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image-preview";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
        },
      }),
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
