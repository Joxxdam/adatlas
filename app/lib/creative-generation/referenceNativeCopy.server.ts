import "server-only";

import { Codex } from "@openai/codex-sdk";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { codexCreativeGate } from "./asyncConcurrencyGate";
import { resolveRuntimeTimeout } from "./fastCreativeRuntime";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { normalizeReferenceRawLines, type ReferenceNativeCopy, type ReferenceTextRegion } from "./referenceLibraryManagement";

export const REFERENCE_NATIVE_COPY_ANALYSIS_VERSION = "reference-native-copy-analysis-v2-two-pass";
export const REFERENCE_NATIVE_COPY_PROMPT_VERSION = "reference-native-copy-ocr-v2-region-contract";

type OcrPayload = {
  rawText: string;
  rawLines: string[];
  textRegions: Array<{
    id: string;
    role: ReferenceTextRegion["role"];
    readingOrder: number;
    sourceType: NonNullable<ReferenceTextRegion["sourceType"]>;
    replacePolicy: NonNullable<ReferenceTextRegion["replacePolicy"]>;
    text: string;
    lines: string[];
    box?: { x: number; y: number; width: number; height: number };
    align?: ReferenceTextRegion["align"];
    emphasis?: ReferenceTextRegion["emphasis"];
    colorHint?: string;
    backgroundHint?: string;
    outlineHint?: string;
    sizeClass?: ReferenceTextRegion["sizeClass"];
    characterBudget?: number;
    reviewRequired?: boolean;
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
        required: ["id", "role", "readingOrder", "sourceType", "replacePolicy", "text", "lines", "box", "align", "emphasis", "colorHint", "backgroundHint", "outlineHint", "sizeClass", "characterBudget", "reviewRequired", "confidence"],
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: ["headline", "support", "proof", "offer", "cta", "badge", "other"] },
          readingOrder: { type: "integer", minimum: 0, maximum: 100 },
          sourceType: { type: "string", enum: ["ad-copy", "source-brand", "source-product-label", "decorative", "uncertain"] },
          replacePolicy: { type: "string", enum: ["adapt", "remove", "product-replacement", "preserve", "review"] },
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
          backgroundHint: { type: "string" },
          outlineHint: { type: "string" },
          sizeClass: { type: "string", enum: ["small", "medium", "large", "hero"] },
          characterBudget: { type: "integer", minimum: 0, maximum: 500 },
          reviewRequired: { type: "boolean" },
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
          readingOrder: Number.isFinite(region.readingOrder) ? Math.max(0, Math.round(region.readingOrder!)) : index,
          sourceType: region.sourceType || "ad-copy",
          replacePolicy: region.replacePolicy || (region.sourceType === "source-product-label" ? "product-replacement" : region.sourceType === "source-brand" ? "remove" : "adapt"),
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
          backgroundHint: region.backgroundHint,
          outlineHint: region.outlineHint,
          sizeClass: region.sizeClass,
          characterBudget: Number.isFinite(region.characterBudget) ? Math.max(0, Math.round(region.characterBudget!)) : Array.from(String(region.text || cleanLines(region.lines).join(""))).length,
          reviewRequired: Boolean(region.reviewRequired),
          confidence: region.confidence,
        }))
      : [],
    confidence: value.confidence,
    ocrConfidence: value.ocrConfidence ?? value.confidence,
    analysisVersion: value.analysisVersion,
    promptVersion: value.promptVersion,
    model: value.model,
    imageHash: value.imageHash,
    imageWidth: value.imageWidth,
    imageHeight: value.imageHeight,
    analysisStatus: value.analysisStatus || (rawLines.length ? "needs-review" : "unavailable"),
    approvalStatus: value.approvalStatus || (value.manuallyCorrected && rawLines.length ? "manually-approved" : "needs-review"),
    approvedAt: value.approvedAt,
    validation: value.validation,
    analysisError: value.analysisError,
    attemptCount: value.attemptCount,
    manuallyCorrected: Boolean(value.manuallyCorrected),
    useForCopyAdaptation: value.useForCopyAdaptation !== false,
    extractionSource: value.extractionSource || (value.manuallyCorrected ? "manual" : "unavailable"),
    extractedAt: value.extractedAt,
    updatedAt: value.updatedAt || new Date().toISOString(),
  };
}

export function buildReferenceNativeCopyOcrPrompt(imagePath: string) {
  return `첨부 경로의 광고 이미지를 원본 해상도로 직접 확인하고 이미지에 실제로 적힌 모든 문구와 편집 구조를 전사한다.

이미지 경로: ${imagePath}

필수 규칙:
- 요약하거나 광고 문구를 새로 만들지 않는다.
- 보이는 줄바꿈, 띄어쓰기, 문장부호, 이모지, ㅋㅋ, ;;, .., 겨 같은 구어체를 가능한 그대로 보존한다.
- 잘 안 보이는 글자를 추측해 상품 사실을 만들지 않는다.
- rawLines는 교체 대상 광고 카피(ad-copy)와 제거할 원본 광고주 문구(source-brand)만 문구 블록별 readingOrder에 따라 담는다. 상품 패키지에 인쇄된 라벨(source-product-label)과 순수 장식(decorative)은 rawLines에서 제외하고 textRegions에만 기록한다.
- 다단·말풍선·배지는 단순 좌표가 아니라 사람이 광고를 읽는 순서를 따른다.
- rawText는 rawLines를 줄바꿈으로 연결한 값이다.
- textRegions에는 headline/support/proof/offer/cta/badge/other 역할과 0~1 비율 좌표를 기록한다.
- sourceType은 광고 카피(ad-copy), 원본 광고주/로고(source-brand), 교체될 원본 상품 패키지 인쇄(source-product-label), 장식(decorative), 불확실(uncertain)로 구분한다.
- replacePolicy는 adapt/remove/product-replacement/preserve/review 중 하나다. 패키지 라벨을 광고 카피로 적응하지 않는다.
- 가격·할인율·수량·용량·기간처럼 숫자가 있는 문구는 한 글자도 추측하지 않는다. 불확실하면 reviewRequired=true로 둔다.
- 각 영역의 정렬, 강조도, 글자 크기 등급, 전경·배경·외곽선 색상 힌트와 원문 글자 예산을 기록한다.
- 광고 이미지의 상품명·가격·CTA·로고 텍스트도 보이는 대로 포함하되 sourceType으로 정확히 분리한다.
- JSON 스키마만 반환한다.`;
}

function comparable(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function agreement(left: string, right: string) {
  const a = Array.from(comparable(left));
  const b = Array.from(comparable(right));
  const maximum = Math.max(a.length, b.length, 1);
  let matches = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] === b[index]) matches += 1;
  return matches / maximum;
}

function numericTokens(value: string) {
  return [...value.matchAll(/(?:~|-)?\d[\d,.]*(?:\s*(?:%|원|개|병|팩|세트|g|kg|ml|l|명|주|일))?/gi)].map((match) => comparable(match[0]));
}

function validatePasses(first: OcrPayload, verified: OcrPayload) {
  const rawText = normalizeReferenceRawLines(verified.rawLines).join("\n");
  const regionText = verified.textRegions
    .filter((region) => region.sourceType !== "source-product-label" && region.sourceType !== "decorative")
    .sort((left, right) => left.readingOrder - right.readingOrder)
    .flatMap((region) => region.lines)
    .join("\n");
  const passAgreement = agreement(first.rawText || first.rawLines.join("\n"), rawText);
  const textCoverage = Math.min(1, comparable(regionText).length / Math.max(1, comparable(rawText).length));
  const usableRegions = verified.textRegions.filter((region) => region.text.trim() && region.box && region.box.width > 0 && region.box.height > 0);
  const regionCoverage = verified.textRegions.length ? usableRegions.length / verified.textRegions.length : 0;
  const firstNumbers = numericTokens(first.rawText || first.rawLines.join("\n"));
  const verifiedNumbers = numericTokens(rawText);
  const numericAgreement = JSON.stringify(firstNumbers) === JSON.stringify(verifiedNumbers) ? 1 : 0;
  const issues: string[] = [];
  if (!rawText.trim()) issues.push("이미지에서 사용할 광고 원문을 확인하지 못했습니다.");
  if (passAgreement < 0.94) issues.push("1차·확대 검수의 문자 판독 결과가 충분히 일치하지 않습니다.");
  if (numericAgreement < 1) issues.push("가격·할인·수량 등 숫자 판독 결과가 서로 다릅니다.");
  if (textCoverage < 0.92) issues.push("전체 원문과 영역별 문구의 문자 커버리지가 부족합니다.");
  if (regionCoverage < 0.95) issues.push("좌표 또는 역할이 없는 문구 영역이 있습니다.");
  if (verified.textRegions.some((region) => region.reviewRequired || (region.confidence ?? 0) < 0.86)) issues.push("사람 확인이 필요한 저신뢰 문구 영역이 있습니다.");
  return { textCoverage, regionCoverage, passAgreement, numericAgreement, issues };
}

async function prepareAnalysisFiles(imagePath: string, regions: OcrPayload["textRegions"] = []) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "adatlas-reference-ocr-"));
  const source = await fs.readFile(imagePath);
  const sourceMetadata = await sharp(source).metadata();
  const imageHash = createHash("sha256").update(source).digest("hex");
  const fullPath = path.join(directory, "full.png");
  const full = sharp(source).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: false });
  const fullBuffer = await full.png().toBuffer();
  const metadata = await sharp(fullBuffer).metadata();
  await fs.writeFile(fullPath, fullBuffer);
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const cropPaths: string[] = [];
  for (const [index, region] of regions.slice(0, 16).entries()) {
    const box = region.box;
    if (!box) continue;
    const paddingX = Math.max(8, Math.round(box.width * width * 0.08));
    const paddingY = Math.max(8, Math.round(box.height * height * 0.12));
    const left = Math.max(0, Math.floor(box.x * width) - paddingX);
    const top = Math.max(0, Math.floor(box.y * height) - paddingY);
    const right = Math.min(width, Math.ceil((box.x + box.width) * width) + paddingX);
    const bottom = Math.min(height, Math.ceil((box.y + box.height) * height) + paddingY);
    if (right - left < 8 || bottom - top < 8) continue;
    const cropPath = path.join(directory, `region-${String(index + 1).padStart(2, "0")}.png`);
    await sharp(fullBuffer).extract({ left, top, width: right - left, height: bottom - top }).resize({ width: 1800, fit: "inside", withoutEnlargement: false }).png().toFile(cropPath);
    cropPaths.push(cropPath);
  }
  return { directory, fullPath, cropPaths, imageHash, imageWidth: sourceMetadata.width || width, imageHeight: sourceMetadata.height || height };
}

async function runOcrPass(thread: ReturnType<Codex["startThread"]>, prompt: string) {
  const response = await codexCreativeGate.run(() =>
    thread.run(prompt, {
      outputSchema: ocrSchema,
      signal: AbortSignal.timeout(resolveRuntimeTimeout(process.env.ADATLAS_CODEX_REFERENCE_OCR_TIMEOUT_MS, 180_000, 30_000)),
    })
  );
  return JSON.parse(response.finalResponse) as OcrPayload;
}

export async function extractReferenceNativeCopy(imagePath: string, options: { previousAttemptCount?: number } = {}): Promise<ReferenceNativeCopy> {
  const now = new Date().toISOString();
  if (!(await codexLocalAuthenticated())) {
    return { referenceId: "", rawText: "", rawLines: [], textRegions: [], analysisVersion: REFERENCE_NATIVE_COPY_ANALYSIS_VERSION, promptVersion: REFERENCE_NATIVE_COPY_PROMPT_VERSION, analysisStatus: "unavailable", approvalStatus: "needs-review", analysisError: "로컬 Codex 로그인이 없습니다.", attemptCount: (options.previousAttemptCount || 0) + 1, manuallyCorrected: false, useForCopyAdaptation: false, extractionSource: "unavailable", updatedAt: now };
  }
  const firstFiles = await prepareAnalysisFiles(imagePath);
  try {
    const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
    const model = process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol";
    const thread = codex.startThread({
      workingDirectory: process.cwd(),
      sandboxMode: "read-only",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      model,
      modelReasoningEffort: "medium",
    });
    const first = await runOcrPass(thread, buildReferenceNativeCopyOcrPrompt(firstFiles.fullPath));
    const verificationFiles = await prepareAnalysisFiles(imagePath, first.textRegions);
    try {
      const verified = await runOcrPass(thread, `${buildReferenceNativeCopyOcrPrompt(verificationFiles.fullPath)}\n\n이것은 독립 확대 검수 단계다. 다음 1차 결과를 그대로 신뢰하지 말고 원본과 영역별 확대 이미지에서 모든 글자·숫자·좌표·역할을 다시 확인해 오류를 교정한다.\n1차 결과: ${JSON.stringify(first)}\n영역별 확대 이미지 경로: ${JSON.stringify(verificationFiles.cropPaths)}\n원본에 보이지 않는 문구를 추가하지 말고 최종 JSON만 반환한다.`);
      const validation = validatePasses(first, verified);
      const confidence = Math.min(verified.confidence ?? 0, verified.textRegions.length ? verified.textRegions.reduce((sum, region) => sum + (region.confidence ?? 0), 0) / verified.textRegions.length : 0);
      const ready = Boolean(verified.rawLines?.some((line) => line.trim())) && confidence >= 0.9 && validation.issues.length === 0;
      return normalizeReferenceNativeCopy({
        ...verified,
        confidence,
        ocrConfidence: confidence,
        analysisVersion: REFERENCE_NATIVE_COPY_ANALYSIS_VERSION,
        promptVersion: REFERENCE_NATIVE_COPY_PROMPT_VERSION,
        model,
        imageHash: firstFiles.imageHash,
        imageWidth: firstFiles.imageWidth,
        imageHeight: firstFiles.imageHeight,
        analysisStatus: ready ? "ready" : "needs-review",
        approvalStatus: ready ? "auto-approved" : "needs-review",
        approvedAt: ready ? now : undefined,
        validation,
        analysisError: validation.issues.join(" ") || undefined,
        attemptCount: (options.previousAttemptCount || 0) + 1,
        manuallyCorrected: false,
        useForCopyAdaptation: ready,
        extractionSource: "codex-local",
        extractedAt: now,
        updatedAt: now,
      })!;
    } finally {
      await fs.rm(verificationFiles.directory, { recursive: true, force: true }).catch(() => undefined);
    }
  } finally {
    await fs.rm(firstFiles.directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
