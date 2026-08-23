import "server-only";

import { Codex } from "@openai/codex-sdk";
import { resolveRuntimeTimeout } from "./fastCreativeRuntime";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { normalizeReferenceRawLines, type ReferenceNativeCopy, type ReferenceTextRegion } from "./referenceLibraryManagement";

type OcrPayload = {
  rawText: string;
  rawLines: string[];
  textRegions: Array<{
    id: string;
    role: ReferenceTextRegion["role"];
    text: string;
    lines: string[];
    box?: { x: number; y: number; width: number; height: number };
    align?: ReferenceTextRegion["align"];
    emphasis?: ReferenceTextRegion["emphasis"];
    colorHint?: string;
    confidence?: number;
  }>;
  confidence?: number;
};

const ocrSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rawText", "rawLines", "textRegions", "confidence"],
  properties: {
    rawText: { type: "string" },
    rawLines: { type: "array", items: { type: "string" } },
    textRegions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "role", "text", "lines", "box", "confidence"],
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: ["headline", "support", "proof", "offer", "cta", "badge", "other"] },
          text: { type: "string" },
          lines: { type: "array", items: { type: "string" } },
          box: {
            type: "object",
            additionalProperties: false,
            required: ["x", "y", "width", "height"],
            properties: {
              x: { type: "number", minimum: 0, maximum: 1 },
              y: { type: "number", minimum: 0, maximum: 1 },
              width: { type: "number", minimum: 0, maximum: 1 },
              height: { type: "number", minimum: 0, maximum: 1 },
            },
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          align: { type: "string", enum: ["left", "center", "right", "unknown"] },
          emphasis: { type: "string", enum: ["none", "light", "strong"] },
          colorHint: { type: "string" },
        },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

function cleanLines(value: unknown) {
  return normalizeReferenceRawLines(Array.isArray(value) ? value : []);
}

export function normalizeReferenceNativeCopy(value: Partial<ReferenceNativeCopy> | undefined): ReferenceNativeCopy | undefined {
  if (!value) return undefined;
  const rawLines = cleanLines(value.rawLines?.length ? value.rawLines : String(value.rawText || "").split("\n"));
  const rawText = rawLines.join("\n");
  return {
    referenceId: String(value.referenceId || ""),
    rawText,
    rawLines,
    textRegions: Array.isArray(value.textRegions)
      ? value.textRegions.map((region, index) => ({
          id: String(region.id || `region-${index + 1}`),
          role: region.role || "other",
          text: String(region.text || cleanLines(region.lines).join("\n")),
          lines: cleanLines(region.lines?.length ? region.lines : String(region.text || "").split("\n")),
          box: region.box || (typeof region.x === "number" && typeof region.y === "number" && typeof region.width === "number" && typeof region.height === "number" ? { x: region.x, y: region.y, width: region.width, height: region.height } : undefined),
          x: region.x ?? region.box?.x,
          y: region.y ?? region.box?.y,
          width: region.width ?? region.box?.width,
          height: region.height ?? region.box?.height,
          align: region.align || "unknown",
          emphasis: region.emphasis || "none",
          colorHint: region.colorHint,
          confidence: region.confidence,
        }))
      : [],
    confidence: value.confidence,
    ocrConfidence: value.ocrConfidence ?? value.confidence,
    manuallyCorrected: Boolean(value.manuallyCorrected),
    useForCopyAdaptation: value.useForCopyAdaptation !== false,
    extractionSource: value.extractionSource || (value.manuallyCorrected ? "manual" : "unavailable"),
    extractedAt: value.extractedAt,
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

export function buildReferenceNativeCopyOcrPrompt(imagePath: string) {
  return `첨부 경로의 광고 이미지를 직접 확인하고 이미지에 실제로 적힌 모든 문구를 원문 그대로 전사한다.

이미지 경로: ${imagePath}

필수 규칙:
- 요약하거나 광고 문구를 새로 만들지 않는다.
- 보이는 줄바꿈, 띄어쓰기, 문장부호, 이모지, ㅋㅋ, ;;, .., 겨 같은 구어체를 가능한 그대로 보존한다.
- 잘 안 보이는 글자를 추측해 상품 사실을 만들지 않는다.
- rawLines는 위에서 아래, 왼쪽에서 오른쪽의 실제 읽기 순서다.
- rawText는 rawLines를 줄바꿈으로 연결한 값이다.
- textRegions에는 headline/support/proof/offer/cta/badge/other 역할과 0~1 비율 좌표를 기록한다.
- 광고 이미지의 상품명·가격·CTA·로고 텍스트도 보이는 대로 포함한다.
- JSON 스키마만 반환한다.`;
}

export async function extractReferenceNativeCopy(imagePath: string): Promise<ReferenceNativeCopy> {
  const now = new Date().toISOString();
  if (!(await codexLocalAuthenticated())) {
    return { referenceId: "", rawText: "", rawLines: [], textRegions: [], manuallyCorrected: false, useForCopyAdaptation: false, extractionSource: "unavailable", updatedAt: now };
  }
  const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
  const thread = codex.startThread({
    workingDirectory: process.cwd(),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol",
    modelReasoningEffort: "low",
  });
  const response = await thread.run(buildReferenceNativeCopyOcrPrompt(imagePath), {
    outputSchema: ocrSchema,
    signal: AbortSignal.timeout(resolveRuntimeTimeout(process.env.ADATLAS_CODEX_REFERENCE_OCR_TIMEOUT_MS, 180_000, 30_000)),
  });
  const payload = JSON.parse(response.finalResponse) as OcrPayload;
  return normalizeReferenceNativeCopy({
    ...payload,
    manuallyCorrected: false,
    useForCopyAdaptation: Boolean(payload.rawLines?.length),
    extractionSource: "codex-local",
    extractedAt: now,
    updatedAt: now,
  })!;
}
