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
import { normalizeReferenceRawLines, normalizeReferenceTextRegionBrandPolicy, type ReferenceNativeCopy, type ReferenceTextRegion } from "./referenceLibraryManagement";

export const REFERENCE_NATIVE_COPY_ANALYSIS_VERSION = "reference-native-copy-analysis-v4-full-label-consensus";
export const REFERENCE_NATIVE_COPY_PROMPT_VERSION = "reference-native-copy-ocr-v4-full-label-four-pass-contract";

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
      ? value.textRegions.map((region, index) => normalizeReferenceTextRegionBrandPolicy({
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
- 실제 글자가 없는 그림·빈 영역은 textRegions에 만들지 않는다. 모든 textRegions는 비어 있지 않은 text와 양수 크기의 box를 가져야 한다.
- sourceType은 광고 카피(ad-copy), 원본 광고주/로고(source-brand), 교체될 원본 상품 패키지 인쇄(source-product-label), 장식(decorative), 불확실(uncertain)로 구분한다.
- replacePolicy는 adapt/remove/product-replacement/preserve/review 중 하나다. 패키지 라벨을 광고 카피로 적응하지 않는다.
- 상품과 떨어져 독립적으로 배치된 로고·워드마크·상호·이니셜·인장·문장·엠블럼·도장형 마크는 크기가 작거나 상품명처럼 읽혀도 반드시 source-brand/remove다. 특히 짧은 글자가 2~3단으로 들어간 원형·방패형·양분색 배지를 일반 광고 badge/ad-copy로 분류하지 않는다.
- 반대로 가격·할인·배송·증정·수량·기간·CTA·검증된 품질/원산지 문구가 적힌 프로모션 배지는 ad-copy/adapt다. 모양이 원형이라는 이유만으로 광고 문구를 source-brand로 제거하지 않는다.
- 실제 목표 상품 패키지에 물리적으로 인쇄된 로고와 라벨은 source-product-label/product-replacement이며, 캔버스에 독립적으로 떠 있는 원본 광고주 마크와 구분한다.
- 상품 패키지의 작은 라벨·용량·성분명·인증 마크 주변 문구도 원본 분석 대상이다. 판독 불가 같은 대체 문구를 쓰지 말고 확대 이미지로 실제 글자를 끝까지 확인한다.
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

function allTextualRegions(payload: OcrPayload) {
  return payload.textRegions.filter((region) => region.sourceType !== "decorative");
}

function fullTextForConsensus(payload: OcrPayload) {
  return allTextualRegions(payload)
    .filter((region) => region.text.trim())
    .sort((left, right) => left.readingOrder - right.readingOrder)
    .map((region) => `${region.sourceType}:${region.text}`)
    .join("\n");
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
  // 광고 문구뿐 아니라 상품 패키지의 작은 라벨도 원본 분석의 승인 대상입니다.
  // 순수 장식만 제외하고 모든 실제 텍스트에 좌표·역할·신뢰도를 요구합니다.
  const textualRegions = allTextualRegions(verified);
  const usableRegions = textualRegions.filter((region) => region.text.trim() && region.box && region.box.width > 0 && region.box.height > 0);
  const regionCoverage = textualRegions.length ? usableRegions.length / textualRegions.length : 0;
  const firstNumbers = numericTokens(`${first.rawText || first.rawLines.join("\n")}\n${fullTextForConsensus(first)}`);
  const verifiedNumbers = numericTokens(`${rawText}\n${fullTextForConsensus(verified)}`);
  const numericAgreement = JSON.stringify(firstNumbers) === JSON.stringify(verifiedNumbers) ? 1 : 0;
  const issues: string[] = [];
  if (!rawText.trim()) issues.push("이미지에서 사용할 광고 원문을 확인하지 못했습니다.");
  if (passAgreement < 0.94) issues.push("1차·확대 검수의 문자 판독 결과가 충분히 일치하지 않습니다.");
  if (numericAgreement < 1) issues.push("가격·할인·수량 등 숫자 판독 결과가 서로 다릅니다.");
  if (textCoverage < 0.92) issues.push("전체 원문과 영역별 문구의 문자 커버리지가 부족합니다.");
  if (regionCoverage < 0.95) issues.push("좌표 또는 역할이 없는 문구 영역이 있습니다.");
  if (textualRegions.some((region) => region.reviewRequired || (region.confidence ?? 0) < 0.9)) issues.push("작은 패키지 라벨을 포함해 사람 확인이 필요한 저신뢰 문구 영역이 있습니다.");
  return { textCoverage, regionCoverage, passAgreement, numericAgreement, issues };
}

function validateConsensus(priors: OcrPayload[], candidate: OcrPayload) {
  const validation = validatePasses(priors[priors.length - 1], candidate);
  const candidateText = `${candidate.rawText || candidate.rawLines.join("\n")}\n${fullTextForConsensus(candidate)}`;
  const agreements = priors.map((prior) => agreement(`${prior.rawText || prior.rawLines.join("\n")}\n${fullTextForConsensus(prior)}`, candidateText));
  const candidateNumbers = JSON.stringify(numericTokens(candidateText));
  const numericAgreement = priors.some((prior) => JSON.stringify(numericTokens(`${prior.rawText || prior.rawLines.join("\n")}\n${fullTextForConsensus(prior)}`)) === candidateNumbers) ? 1 : 0;
  const passAgreement = Math.max(validation.passAgreement, ...agreements);
  const issues = validation.issues.filter((issue) => {
    if (issue === "1차·확대 검수의 문자 판독 결과가 충분히 일치하지 않습니다.") return passAgreement < 0.94;
    if (issue === "가격·할인·수량 등 숫자 판독 결과가 서로 다릅니다.") return numericAgreement < 1;
    return true;
  });
  return { ...validation, passAgreement, numericAgreement, issues };
}

function criticalConfidence(payload: OcrPayload) {
  const critical = allTextualRegions(payload);
  const regionConfidence = critical.length ? critical.reduce((sum, region) => sum + (region.confidence ?? 0), 0) / critical.length : payload.confidence ?? 0;
  return Math.min(payload.confidence ?? 0, regionConfidence);
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
  const cropRegions = regions
    .filter((region) => region.sourceType !== "decorative" && region.box)
    .sort((left, right) => {
      const leftPriority = (left.reviewRequired ? 2 : 0) + ((left.confidence ?? 0) < 0.9 ? 1 : 0);
      const rightPriority = (right.reviewRequired ? 2 : 0) + ((right.confidence ?? 0) < 0.9 ? 1 : 0);
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      const leftArea = (left.box?.width || 1) * (left.box?.height || 1);
      const rightArea = (right.box?.width || 1) * (right.box?.height || 1);
      return leftArea - rightArea;
    })
    .slice(0, 48);
  for (const [index, region] of cropRegions.entries()) {
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
    await sharp(fullBuffer).extract({ left, top, width: right - left, height: bottom - top }).resize({ width: 2400, fit: "inside", withoutEnlargement: false }).sharpen().png().toFile(cropPath);
    cropPaths.push(cropPath);
  }
  return { directory, fullPath, cropPaths, imageHash, imageWidth: sourceMetadata.width || width, imageHeight: sourceMetadata.height || height };
}

async function runOcrPass(thread: ReturnType<Codex["startThread"]>, prompt: string) {
  const timeoutMs = resolveRuntimeTimeout(process.env.ADATLAS_CODEX_REFERENCE_OCR_TIMEOUT_MS, 180_000, 30_000);
  const response = await codexCreativeGate.run(async () => {
    const operation = thread.run(prompt, {
      outputSchema: ocrSchema,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          // 일부 Codex SDK 실행은 AbortSignal 이후에도 자식 프로세스 종료를
          // 기다리며 Promise가 남을 수 있습니다. 한 장이 전체 OCR 대기열을
          // 영구 점유하지 않도록 약간의 정리 유예 뒤 게이트를 강제로 풉니다.
          watchdog = setTimeout(() => {
            const error = new Error(`레퍼런스 OCR이 ${Math.round(timeoutMs / 1000)}초 제한을 넘겨 중단됐습니다.`);
            error.name = "TimeoutError";
            reject(error);
          }, timeoutMs + 15_000);
          watchdog.unref?.();
        }),
      ]);
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  });
  return JSON.parse(response.finalResponse) as OcrPayload;
}

export async function extractReferenceNativeCopy(imagePath: string, options: { previousAttemptCount?: number } = {}): Promise<ReferenceNativeCopy> {
  const now = new Date().toISOString();
  if (!(await codexLocalAuthenticated({ force: true }))) {
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
      const verified = await runOcrPass(thread, `${buildReferenceNativeCopyOcrPrompt(verificationFiles.fullPath)}\n\n이것은 확대 검수 단계다. 다음 1차 결과를 그대로 신뢰하지 말고 원본과 영역별 확대 이미지에서 모든 글자·숫자·좌표·역할을 다시 확인해 오류를 교정한다.\n1차 결과: ${JSON.stringify(first)}\n영역별 확대 이미지 경로: ${JSON.stringify(verificationFiles.cropPaths)}\n원본에 보이지 않는 문구를 추가하지 말고 최종 JSON만 반환한다.`);
      const passes: OcrPayload[] = [first, verified];
      let finalPayload = verified;
      let validation = validateConsensus([first], verified);

      // 불일치·좌표 누락·저신뢰 광고 카피만 최대 두 차례 더 확대 판독해
      // 첫 판독을 맹신하거나 곧바로 사람 검수로 넘기지 않습니다.
      for (let repairAttempt = 0; repairAttempt < 2 && validation.issues.length; repairAttempt += 1) {
        const repairFiles = await prepareAnalysisFiles(imagePath, finalPayload.textRegions);
        try {
          const repaired = await runOcrPass(thread, `${buildReferenceNativeCopyOcrPrompt(repairFiles.fullPath)}\n\n이것은 ${repairAttempt + 3}차 자동 합의 검수다. 앞선 판독 사이의 불일치와 아래 검증 오류를 원본 및 확대 이미지로 직접 해결한다. 상품 패키지 라벨·순수 장식과 실제 교체할 광고 카피를 반드시 분리하고, 빈 글자 영역은 제거한다.\n검증 오류: ${JSON.stringify(validation.issues)}\n앞선 판독: ${JSON.stringify(passes)}\n영역별 확대 이미지 경로: ${JSON.stringify(repairFiles.cropPaths)}\n보이지 않는 글자나 숫자를 추측하지 말고 최종 JSON만 반환한다.`);
          finalPayload = repaired;
          validation = validateConsensus(passes, repaired);
          passes.push(repaired);
        } finally {
          await fs.rm(repairFiles.directory, { recursive: true, force: true }).catch(() => undefined);
        }
      }

      const confidence = criticalConfidence(finalPayload);
      const ready = Boolean(finalPayload.rawLines?.some((line) => line.trim())) && confidence >= 0.9 && validation.issues.length === 0;
      return normalizeReferenceNativeCopy({
        ...finalPayload,
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
