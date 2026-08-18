import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readCreativeRasterAsset } from "./assets.server.ts";
import type { GenerationJob } from "./types.ts";
import { buildNativeFinalCreativePrompt, NATIVE_FINAL_PROMPT_VERSION } from "./nativeCreativePrompt.ts";

type PromptBrandMemory = {
  advertiserId: string;
  approvedDirections: string[];
  rejectedDirections: string[];
  feedback: string[];
  updatedAt: string;
};

const PUBLIC_ROOT = path.resolve(process.cwd(), "public");
const GENERATED_ROOT = path.join(PUBLIC_ROOT, "generated");
const SAFE = /^[a-zA-Z0-9가-힣._-]+$/;
export const MAX_FINAL_BYTES = 800 * 1024;
const TARGET_BYTES = 790 * 1024;

function segment(value: string) {
  if (!SAFE.test(value) || value === "." || value === "..") throw new Error("안전하지 않은 파일 경로입니다.");
  return value;
}
export function nativeJobDirectory(advertiserId: string, jobId: string) {
  return path.join(GENERATED_ROOT, segment(advertiserId), segment(jobId));
}
export function nativeHookDirectory(advertiserId: string, jobId: string, hookCode: string) {
  return path.join(nativeJobDirectory(advertiserId, jobId), segment(hookCode));
}
export function publicPathFor(file: string) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(`${PUBLIC_ROOT}${path.sep}`)) throw new Error("public 외부 결과는 노출할 수 없습니다.");
  return `/${path.relative(PUBLIC_ROOT, resolved).split(path.sep).join("/")}`;
}

export async function prepareNativeReferenceImages(job: GenerationJob) {
  const advertiserId = job.advertiserId || "unknown-advertiser";
  const directory = path.join(nativeJobDirectory(advertiserId, job.id), "references");
  await mkdir(directory, { recursive: true });
  const sources = [...job.productTruth.referenceImages, ...job.productTruth.imageAssets]
    .filter((asset, index, all) => all.findIndex((item) => item.path === asset.path) === index)
    .slice(0, 4);
  const files: string[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const file = path.join(directory, `reference-${index + 1}.png`);
    try {
      await access(file);
    } catch {
      const buffer = await readCreativeRasterAsset(sources[index].path);
      await writeFile(file, buffer);
    }
    files.push(file);
  }
  if (!files.length) throw new Error("AI 제작에 사용할 실제 상품 참조 이미지가 없습니다.");
  return files;
}

export async function optimizeNativeFinalImage(inputFile: string, outputFile: string) {
  const source = await readFile(inputFile);
  await mkdir(path.dirname(outputFile), { recursive: true });
  let final: Buffer | undefined;
  let selectedQuality = 65;
  for (const quality of [90, 88, 85, 82, 78, 74, 70, 65]) {
    const candidate = await sharp(source)
      .rotate()
      .resize(1200, 1200, { fit: "cover", position: "centre" })
      .toColorspace("srgb")
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, progressive: true, mozjpeg: true, chromaSubsampling: "4:2:0" })
      .toBuffer();
    final = candidate;
    selectedQuality = quality;
    if (candidate.length <= TARGET_BYTES) break;
  }
  if (!final || final.length > MAX_FINAL_BYTES) throw new Error("최종 광고를 800KB 이하로 안전하게 압축하지 못했습니다.");
  const metadata = await sharp(final).metadata();
  if (metadata.format !== "jpeg" || metadata.width !== 1200 || metadata.height !== 1200) throw new Error("최종 파일 규격 검증에 실패했습니다.");
  const temporary = `${outputFile}.${process.pid}.tmp`;
  await writeFile(temporary, final);
  await rename(temporary, outputFile);
  return { file: outputFile, bytes: final.length, width: 1200 as const, height: 1200 as const, format: "jpeg" as const, quality: selectedQuality, colorSpace: "srgb" as const };
}

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function writeNativeJobArtifacts(job: GenerationJob, brandMemory?: PromptBrandMemory) {
  const directory = nativeJobDirectory(job.advertiserId || "unknown-advertiser", job.id);
  await Promise.all([
    atomicJson(path.join(directory, "product-analysis.json"), {
      productId: job.productTruth.productId,
      product: job.productTruth.product,
      facts: job.productTruth.facts,
      verifiedClaims: job.productTruth.verifiedClaims,
      unverifiedClaims: job.productTruth.unverifiedClaims,
      referenceImages: [...job.productTruth.referenceImages, ...job.productTruth.imageAssets],
    }),
    atomicJson(path.join(directory, "hook-hypotheses.json"), job.results.map((result) => ({
      hookId: result.hookPlan.hookCode,
      hypothesisId: result.hookPlan.creativeBrief?.hypothesisId || result.hookPlan.id,
      hypothesis: result.hookPlan.hypothesis,
      mainHook: result.hookPlan.headline,
      subCopy: result.hookPlan.body,
      selectionReason: result.hookPlan.selectionReason,
      factIds: result.hookPlan.factIds,
    }))),
    atomicJson(path.join(directory, "diversity-matrix.json"), job.visualDiversityMatrix || []),
    ...job.results.flatMap((result) => {
      const hookDirectory = nativeHookDirectory(job.advertiserId || "unknown-advertiser", job.id, result.hookPlan.hookCode);
      const files: Promise<void>[] = [
        atomicJson(path.join(hookDirectory, "creative-brief.json"), result.hookPlan.creativeBrief || null),
        atomicJson(path.join(hookDirectory, "generation-prompt.json"), {
          promptVersion: NATIVE_FINAL_PROMPT_VERSION,
          prompt: buildNativeFinalCreativePrompt(job, result, "final-output.png", undefined, brandMemory),
        }),
      ];
      if (result.nativeCreative?.validation) files.push(atomicJson(path.join(hookDirectory, "validation.json"), result.nativeCreative.validation));
      return files;
    }),
  ]);
}

export async function writeNativeManifest(job: GenerationJob, brandMemory?: PromptBrandMemory) {
  await writeNativeJobArtifacts(job, brandMemory);
  const file = path.join(nativeJobDirectory(job.advertiserId || "unknown-advertiser", job.id), "manifest.json");
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({
    version: "native-creative-manifest-v1",
    jobId: job.id,
    advertiserId: job.advertiserId,
    advertiserName: job.advertiserName,
    engine: job.engine,
    paidApiUsed: job.paidApiUsed,
    codexThreadId: job.codexThreadId,
    productId: job.productTruth.productId,
    productUrl: job.productTruth.product.landingUrl,
    productName: job.productTruth.product.productName,
    generatedAt: job.createdAt,
    visualDiversityMatrix: job.visualDiversityMatrix,
    results: job.results.map((result) => ({
      id: result.id,
      hookId: result.hookPlan.hookCode,
      creativeCode: result.creativeAsset?.assetCode,
      mainHook: result.hookPlan.headline,
      subCopy: result.hookPlan.body,
      visualConcept: job.visualDiversityMatrix?.find((entry) => entry.hookCode === result.hookPlan.hookCode),
      referenceImages: [...job.productTruth.referenceImages, ...job.productTruth.imageAssets].map((asset) => asset.path),
      generationEngine: result.nativeCreative?.engine || job.engine,
      revisionCount: result.nativeCreative?.revisionCount || 0,
      koreanTextVerified: (result.nativeCreative?.validation?.koreanTextAccuracy || 0) >= 95,
      productIdentityVerified: (result.nativeCreative?.validation?.productIdentity || 0) >= 80,
      hookAlignmentVerified: (result.nativeCreative?.validation?.hookAlignment || 0) >= 80,
      width: result.nativeCreative?.export?.width,
      height: result.nativeCreative?.export?.height,
      fileSizeBytes: result.nativeCreative?.export?.fileSizeBytes,
      jpegQuality: result.nativeCreative?.export?.jpegQuality,
      colorSpace: result.nativeCreative?.export?.colorSpace,
      finalImagePath: result.imagePath,
      scores: result.nativeCreative?.validation,
      status: result.status,
      failureReasons: result.nativeCreative?.validation?.failures || (result.error ? [result.error] : []),
      nativeCreative: result.nativeCreative,
      creativeAsset: result.creativeAsset,
    })),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

export function resolveValidatedNativeDownload(job: GenerationJob, resultId: string) {
  const result = job.results.find((item) => item.id === resultId);
  if (!result?.imagePath || !result.imagePath.startsWith("/generated/")) throw new Error("검증된 생성 결과가 없습니다.");
  const file = path.resolve(PUBLIC_ROOT, result.imagePath.replace(/^\/+/, ""));
  const expected = nativeJobDirectory(job.advertiserId || "unknown-advertiser", job.id);
  if (!file.startsWith(`${expected}${path.sep}`)) throw new Error("결과 파일 경로가 작업 범위를 벗어났습니다.");
  return file;
}
