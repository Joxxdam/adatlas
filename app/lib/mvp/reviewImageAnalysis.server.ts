import { execFile } from "child_process";
import crypto from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import sharp from "sharp";
import { loadSafeProductImageBuffer } from "./backgroundRemoval";
import {
  clampReviewBox,
  dedupeReviewCandidates,
  detectPrivacyRegions,
  inferReviewType,
  recommendReviewCrop,
  REVIEW_ANALYSIS_VERSION,
  reviewCandidateContextScore,
  scoreReviewCandidate,
  selectKeyReviewSentence,
} from "./reviewCreative";
import type {
  NormalizedImageBox,
  ReviewImageRegion,
  ReviewSourceCandidate,
  ReviewSourceType,
} from "./types";

const execFileAsync = promisify(execFile);
const maxReviewBytes = 12 * 1024 * 1024;
const maxReviewPixels = 40_000_000;
const reviewCachePath = path.join(process.cwd(), "data", "review-analysis-cache.json");
let cacheWriteQueue = Promise.resolve();

type ReviewCacheRecord = {
  key: string;
  candidate: ReviewSourceCandidate;
  createdAt: string;
};

export type ReviewRawCandidate = {
  url: string;
  sourceType: ReviewSourceType;
  sourceContext?: string;
  alt?: string;
  width?: number;
  height?: number;
  manuallyUploaded?: boolean;
};

type OcrResult = {
  provider: ReviewSourceCandidate["ocrProvider"];
  lines: ReviewImageRegion[];
  faces: ReviewImageRegion[];
  warning?: string;
};

type AppleVisionOutput = {
  lines?: Array<{ text?: string; confidence?: number; box?: NormalizedImageBox }>;
  faces?: Array<{ confidence?: number; box?: NormalizedImageBox }>;
};

async function normalizedReviewBuffer(imagePath: string) {
  const source = await loadSafeProductImageBuffer(imagePath);
  if (!source.length || source.length > maxReviewBytes) throw new Error("후기 이미지는 12MB 이하만 지원합니다.");
  const metadata = await sharp(source).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height || width > 10_000 || height > 10_000 || width * height > maxReviewPixels) {
    throw new Error("후기 이미지 해상도가 처리 한도를 초과했습니다.");
  }
  if (!metadata.format || !["png", "jpeg", "webp", "avif"].includes(metadata.format)) {
    throw new Error("PNG, JPG, WEBP 후기 이미지만 지원합니다.");
  }
  const buffer = await sharp(source)
    .rotate()
    .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  return { source, buffer, width, height, format: metadata.format };
}

async function perceptualHash(buffer: Buffer) {
  const { data } = await sharp(buffer)
    .greyscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

function expectedOcrProvider() {
  if (process.env.OPENAI_API_KEY?.trim()) return "openai-vision";
  if (process.platform === "darwin") return "apple-vision";
  return "unavailable";
}

function reviewAnalysisCacheKey(contentHash: string, productText: string) {
  return crypto
    .createHash("sha256")
    .update(`${contentHash}:${expectedOcrProvider()}:${REVIEW_ANALYSIS_VERSION}:${productText}`)
    .digest("hex");
}

async function readReviewCache() {
  try {
    const parsed = JSON.parse(await fs.readFile(reviewCachePath, "utf8"));
    return Array.isArray(parsed) ? (parsed as ReviewCacheRecord[]) : [];
  } catch {
    return [] as ReviewCacheRecord[];
  }
}

async function cachedReviewCandidate(key: string) {
  const records = await readReviewCache();
  return records.find((record) => record.key === key)?.candidate;
}

function saveReviewCandidateToCache(key: string, candidate: ReviewSourceCandidate) {
  cacheWriteQueue = cacheWriteQueue.then(async () => {
    const records = (await readReviewCache()).filter((record) => record.key !== key).slice(-119);
    records.push({ key, candidate, createdAt: new Date().toISOString() });
    await fs.mkdir(path.dirname(reviewCachePath), { recursive: true });
    const tempPath = `${reviewCachePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(records, null, 2));
    await fs.rename(tempPath, reviewCachePath);
  });
  return cacheWriteQueue;
}

function imageDataUrl(buffer: Buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function responseText(payload: unknown) {
  const value = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (value.output_text) return value.output_text;
  return (value.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" || item.text)
    .map((item) => item.text || "")
    .join("\n");
}

function jsonFromText(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fenced || value.match(/\{[\s\S]*\}/)?.[0] || value;
  return JSON.parse(source) as AppleVisionOutput;
}

async function openAiOcr(buffer: Buffer): Promise<OcrResult | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || "gpt-4.1-mini",
        temperature: 0,
        max_output_tokens: 3500,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "이미지에 실제로 보이는 텍스트만 OCR 하세요. 보이지 않는 문장은 만들지 마세요. 각 줄의 normalized bounding box는 좌상단 원점 x,y,width,height 0~1입니다. 식별 가능한 얼굴도 boxes로 반환하세요. JSON만 반환: {\"lines\":[{\"text\":\"\",\"confidence\":0,\"box\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0}}],\"faces\":[{\"confidence\":0,\"box\":{\"x\":0,\"y\":0,\"width\":0,\"height\":0}}]}",
              },
              { type: "input_image", image_url: imageDataUrl(buffer), detail: "high" },
            ],
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const parsed = jsonFromText(responseText(await response.json()));
    const lines = (parsed.lines || [])
      .filter((line) => String(line.text || "").trim() && line.box)
      .map(
        (line, index): ReviewImageRegion => ({
          id: `text-${index + 1}`,
          role: "text",
          text: String(line.text || "").trim(),
          confidence: Math.max(0, Math.min(1, Number(line.confidence) || 0.5)),
          box: clampReviewBox(line.box as NormalizedImageBox),
        })
      );
    const faces = (parsed.faces || []).filter((face) => face.box).map(
      (face, index): ReviewImageRegion => ({
        id: `face-${index + 1}`,
        role: "face",
        confidence: Math.max(0, Math.min(1, Number(face.confidence) || 0.7)),
        box: clampReviewBox(face.box as NormalizedImageBox),
      })
    );
    return { provider: "openai-vision", lines, faces };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function swiftExecutable() {
  const xcodeSwift =
    "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin/swift";
  return xcodeSwift;
}

async function appleVisionOcr(buffer: Buffer): Promise<OcrResult | null> {
  if (process.platform !== "darwin") return null;
  const scriptPath = path.join(process.cwd(), "scripts", "review-ocr.swift");
  const taskId = crypto.randomBytes(8).toString("hex");
  const tempPath = path.join(os.tmpdir(), `adatlas-review-${taskId}.png`);
  const moduleCache = path.join(os.tmpdir(), "adatlas-swift-module-cache");
  const sdkRoot =
    "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk";
  try {
    await fs.writeFile(tempPath, buffer);
    const { stdout } = await execFileAsync(swiftExecutable(), [scriptPath, tempPath], {
      timeout: 25_000,
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        SDKROOT: sdkRoot,
        CLANG_MODULE_CACHE_PATH: moduleCache,
        SWIFT_MODULE_CACHE_PATH: moduleCache,
      },
    });
    const parsed = JSON.parse(stdout) as AppleVisionOutput;
    const lines = (parsed.lines || [])
      .filter((line) => String(line.text || "").trim() && line.box)
      .map(
        (line, index): ReviewImageRegion => ({
          id: `text-${index + 1}`,
          role: "text",
          text: String(line.text || "").trim(),
          confidence: Math.max(0, Math.min(1, Number(line.confidence) || 0)),
          box: clampReviewBox(line.box as NormalizedImageBox),
        })
      );
    const faces = (parsed.faces || []).filter((face) => face.box).map(
      (face, index): ReviewImageRegion => ({
        id: `face-${index + 1}`,
        role: "face",
        confidence: Math.max(0, Math.min(1, Number(face.confidence) || 0)),
        box: clampReviewBox(face.box as NormalizedImageBox),
      })
    );
    return { provider: "apple-vision", lines, faces };
  } catch (error) {
    return {
      provider: "unavailable",
      lines: [],
      faces: [],
      warning: error instanceof Error ? `로컬 OCR 실패: ${error.message}` : "로컬 OCR 실패",
    };
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

async function runOcr(buffer: Buffer): Promise<OcrResult> {
  const openAi = await openAiOcr(buffer);
  if (openAi) return openAi;
  const apple = await appleVisionOcr(buffer);
  if (apple?.lines.length) return apple;
  return {
    provider: "unavailable",
    lines: [],
    faces: [],
    warning:
      apple?.warning ||
      "사용 가능한 OCR provider가 없습니다. 후기 유형·크롭·핵심 문장을 직접 입력해주세요.",
  };
}

function averageConfidence(regions: ReviewImageRegion[]) {
  if (!regions.length) return 0;
  return regions.reduce((sum, region) => sum + region.confidence, 0) / regions.length;
}

export async function analyzeReviewImage(input: {
  imagePath: string;
  originalUrl?: string;
  sourceType?: ReviewSourceType;
  sourceContext?: string;
  productName?: string;
  productDescription?: string;
  manuallyUploaded?: boolean;
}): Promise<ReviewSourceCandidate> {
  const prepared = await normalizedReviewBuffer(input.imagePath);
  const contentHash = crypto.createHash("sha256").update(prepared.source).digest("hex");
  const productText = `${input.productName || ""} ${input.productDescription || ""}`;
  const cacheKey = reviewAnalysisCacheKey(contentHash, productText);
  const cached = await cachedReviewCandidate(cacheKey);
  if (cached) {
    return {
      ...cached,
      imagePath: input.imagePath,
      originalUrl: input.originalUrl,
      sourceType: input.sourceType || cached.sourceType,
      sourceContext: input.sourceContext || cached.sourceContext,
      selected: false,
      recommended: false,
    };
  }
  const [ocr, pHash] = await Promise.all([runOcr(prepared.buffer), perceptualHash(prepared.buffer)]);
  const ocrText = ocr.lines.map((line) => line.text).filter(Boolean).join("\n");
  const inferred = inferReviewType({
    sourceContext: input.sourceContext,
    ocrText,
    textRegionCount: ocr.lines.length,
    faceCount: ocr.faces.length,
    width: prepared.width,
    height: prepared.height,
    manuallyUploaded: input.manuallyUploaded,
  });
  const keySentence = selectKeyReviewSentence(ocrText, productText);
  const privacyRegions = detectPrivacyRegions(ocr.lines, ocr.faces);
  const crop = recommendReviewCrop({
    type: inferred.type,
    textRegions: ocr.lines,
    keySentence,
    width: prepared.width,
    height: prepared.height,
  });
  const contextScore = reviewCandidateContextScore({
    url: input.originalUrl || input.imagePath,
    context: input.sourceContext,
    width: prepared.width,
    height: prepared.height,
  });
  const scores = scoreReviewCandidate({
    width: prepared.width,
    height: prepared.height,
    ocrText,
    ocrConfidence: averageConfidence(ocr.lines),
    type: inferred.type,
    keySentence,
    productText,
    privacyCount: privacyRegions.length,
    contextScore,
  });
  const warnings = [
    ocr.warning,
    scores.policyRiskScore >= 0.28 ? "광고 정책상 오해 소지가 있는 표현을 확인해주세요." : "",
    privacyRegions.length ? "개인정보 가능 영역을 기본 가림 처리했습니다." : "",
    crop.confidence < 0.5 ? "자동 크롭 신뢰도가 낮아 원본에 가깝게 유지했습니다." : "",
    inferred.type === "not-review" ? "후기 이미지로 판단할 근거가 부족합니다." : "",
  ].filter(Boolean) as string[];
  const candidate: ReviewSourceCandidate = {
    id: `review-${contentHash.slice(0, 12)}`,
    imagePath: input.imagePath,
    originalUrl: input.originalUrl,
    width: prepared.width,
    height: prepared.height,
    sourceType: input.sourceType || (input.manuallyUploaded ? "upload" : "product-review"),
    sourceContext: input.sourceContext,
    reviewType: inferred.type,
    classificationConfidence: inferred.confidence,
    ocrText,
    ocrProvider: ocr.provider,
    ocrConfidence: averageConfidence(ocr.lines),
    keySentence,
    ...scores,
    textRegions: ocr.lines,
    photoRegions: [],
    privacyRegions,
    recommendedCrop: crop.crop,
    cropConfidence: crop.confidence,
    automaticCropAvailable: crop.confidence >= 0.5,
    contentHash,
    perceptualHash: pHash,
    warnings,
  };
  if (candidate.ocrProvider !== "unavailable") await saveReviewCandidateToCache(cacheKey, candidate);
  return candidate;
}

export async function analyzeReviewSourceCandidates(input: {
  candidates: ReviewRawCandidate[];
  productName?: string;
  productDescription?: string;
  collectLimit?: number;
  displayLimit?: number;
}) {
  const collectLimit = Math.max(1, Math.min(10, input.collectLimit || 10));
  const displayLimit = Math.max(1, Math.min(5, input.displayLimit || 5));
  const ranked = [...input.candidates]
    .map((candidate) => ({
      ...candidate,
      contextScore: reviewCandidateContextScore({
        url: candidate.url,
        alt: candidate.alt,
        context: candidate.sourceContext,
        width: candidate.width,
        height: candidate.height,
      }),
    }))
    .filter((candidate) => candidate.manuallyUploaded || candidate.contextScore >= 35)
    .sort((a, b) => b.contextScore - a.contextScore)
    .slice(0, collectLimit);

  const analyzed: ReviewSourceCandidate[] = [];
  for (const candidate of ranked) {
    try {
      analyzed.push(
        await analyzeReviewImage({
          imagePath: candidate.url,
          originalUrl: candidate.manuallyUploaded ? undefined : candidate.url,
          sourceType: candidate.sourceType,
          sourceContext: candidate.sourceContext,
          productName: input.productName,
          productDescription: input.productDescription,
          manuallyUploaded: candidate.manuallyUploaded,
        })
      );
    } catch {
      // A failed candidate must not fail product analysis or block other reviews.
    }
    if (analyzed.length >= displayLimit) break;
  }
  const deduped = dedupeReviewCandidates(analyzed)
    .filter((candidate) => candidate.reviewType !== "not-review" && candidate.productRelevanceScore >= 0.22)
    .slice(0, displayLimit);
  if (deduped[0]) {
    deduped[0].recommended = true;
    deduped[0].selected = true;
  }
  return deduped;
}
