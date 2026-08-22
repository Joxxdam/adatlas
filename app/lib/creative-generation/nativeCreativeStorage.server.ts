import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { readCreativeRasterAsset } from "./assets.server.ts";
import type { CreativeImageAsset, GenerationJob } from "./types.ts";
import { buildNativeFinalCreativePrompt, NATIVE_FINAL_PROMPT_VERSION } from "./nativeCreativePrompt.ts";

type PromptBrandMemory = import("./codexRegistry.server.ts").AdvertiserBrandMemory;

const PUBLIC_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), "public");
const LEGACY_GENERATED_ROOT = path.join(PUBLIC_ROOT, "generated");
const GENERATED_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".data", "generated");
const SAFE = /^[a-zA-Z0-9가-힣._-]+$/;
export const MAX_FINAL_BYTES = 800 * 1024;
const TARGET_BYTES = 790 * 1024;

function segment(value: string) {
  if (!SAFE.test(value) || value === "." || value === "..") throw new Error("안전하지 않은 파일 경로입니다.");
  return value;
}
export function nativeJobDirectory(advertiserId: string, jobId: string) {
  return path.join(/* turbopackIgnore: true */ GENERATED_ROOT, segment(advertiserId), segment(jobId));
}
export function nativeHookDirectory(advertiserId: string, jobId: string, hookCode: string) {
  return path.join(/* turbopackIgnore: true */ nativeJobDirectory(advertiserId, jobId), segment(hookCode));
}
export function nativeResultImageUrl(jobId: string, resultId: string) {
  return `/api/creative-generation/jobs/${encodeURIComponent(jobId)}/results/${encodeURIComponent(resultId)}/image`;
}

export function selectNativeReferenceSources(job: GenerationJob): CreativeImageAsset[] {
  const rolePriority = new Map([
    ["primary-product", 700],
    ["front-package", 650],
    ["option", 560],
    ["size-reference", 530],
    ["usage", 500],
    ["worn", 500],
    ["cooked", 500],
    ["lifestyle", 460],
    ["texture", 420],
    ["ingredient", 380],
    ["product-detail", 350],
  ]);
  const profileSources: CreativeImageAsset[] = (job.productReferenceProfile?.referenceImages || [])
    .filter((image) => image.usableForGeneration && !image.duplicateOf && !image.watermarkRisk)
    // Text-heavy square/detail images are often finished ads or promotional
    // banners. Feeding them back into image generation causes the model to
    // reproduce old copy panels and embedded ad fragments. Product labels are
    // still available through the separately verified ProductTruth assets.
    .filter((image) => !image.hasText)
    .filter((image) => !/\/(?:processed-products|product-cutouts)\//i.test(image.url))
    .sort((left, right) => (rolePriority.get(right.role) || 0) + right.importance - (rolePriority.get(left.role) || 0) - left.importance)
    .map((image) => ({
      id: image.id,
      path: image.url,
      role: image.role === "lifestyle" || image.role === "usage" || image.role === "worn" || image.role === "cooked" ? "product-lifestyle" as const : image.role === "product-detail" || image.role === "texture" || image.role === "ingredient" ? "detail-image" as const : "product-packshot" as const,
      source: "product-page" as const,
      verified: true,
      reason: image.description,
      validationStatus: "confirmed" as const,
    }));
  const unique = [...profileSources, ...job.productTruth.imageAssets, ...job.productTruth.referenceImages]
    .filter((asset, index, all) => all.findIndex((item) => item.path === asset.path) === index);
  const originals = unique.filter(
    (asset) =>
      asset.role !== "product-cutout" &&
      !/\/(?:processed-products|product-cutouts)\//i.test(asset.path)
  );
  const productScore = (asset: CreativeImageAsset) => {
    if (asset.role === "product-packshot") return 500;
    if (asset.role === "product-lifestyle") return 420;
    if (asset.role === "detail-image") return 340;
    return 0;
  };
  const productSources = originals
    .filter((asset) => asset.role !== "ad-reference" && asset.verified)
    .sort((left, right) => productScore(right) - productScore(left));
  const primary = productSources[0];
  if (!primary) return [];
  const supporting = productSources
    .filter((asset) => asset.path !== primary.path)
    .sort((left, right) => {
      const roleBonus = (asset: CreativeImageAsset) => asset.role === "product-lifestyle" ? 30 : asset.role === "detail-image" ? 20 : 0;
      return productScore(right) + roleBonus(right) - productScore(left) - roleBonus(left);
    })
    .slice(0, 4);
  // Native AI generation receives only product-page evidence. Advertising
  // references are distilled into semantic grammar and are never attached as
  // pixels, so an old ad cannot become part of a new creative.
  return [primary, ...supporting].slice(0, 5);
}

export async function prepareNativeReferenceImages(job: GenerationJob) {
  const advertiserId = job.advertiserId || "unknown-advertiser";
  const directory = path.join(nativeJobDirectory(advertiserId, job.id), "references");
  await mkdir(directory, { recursive: true });
  const sources = selectNativeReferenceSources(job);
  if (!sources.length || sources[0].role === "ad-reference") {
    throw new Error("AI 제작에 사용할 검증된 원본 상품 이미지가 없습니다.");
  }
  const files: string[] = [];
  for (let index = 0; index < sources.length; index += 1) {
    const file = path.join(directory, `reference-${index + 1}.png`);
    // Always refresh the prepared file. Older jobs may have cached an ad
    // reference at the same numbered path before the product-only policy.
    const buffer = await readCreativeRasterAsset(sources[index].path);
    await writeFile(file, buffer);
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

export async function createNativeContactSheet(job: GenerationJob) {
  const entries = job.results
    .filter((result) => result.nativeCreative?.finalPath && ["success", "approved"].includes(result.status))
    .slice(0, 6);
  if (entries.length !== 6) throw new Error("그룹 검수에는 검증된 광고 6장이 필요합니다.");
  const tileSize = 400;
  const composites = await Promise.all(entries.map(async (result, index) => {
    const input = await sharp(result.nativeCreative!.finalPath!).resize(tileSize, tileSize, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
    return { input, left: (index % 3) * tileSize, top: Math.floor(index / 3) * tileSize };
  }));
  const directory = path.join(nativeJobDirectory(job.advertiserId || "unknown-advertiser", job.id), "qa");
  const file = path.join(directory, `group-contact-sheet-${Date.now()}.jpg`);
  await mkdir(directory, { recursive: true });
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#ffffff" } })
    .composite(composites)
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(file);
  return file;
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
      normalized: job.productTruth.normalized,
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
      referenceImages: result.nativeCreative?.referencePaths || [...job.productTruth.referenceImages, ...job.productTruth.imageAssets].map((asset) => asset.path),
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
  const expected = nativeJobDirectory(job.advertiserId || "unknown-advertiser", job.id);
  const legacyExpected = path.join(LEGACY_GENERATED_ROOT, segment(job.advertiserId || "unknown-advertiser"), segment(job.id));
  let file = result?.nativeCreative?.finalPath ? path.resolve(result.nativeCreative.finalPath) : "";
  if (file.startsWith(`${legacyExpected}${path.sep}`)) {
    const migrated = path.join(/* turbopackIgnore: true */ expected, path.relative(legacyExpected, file));
    if (existsSync(migrated)) file = migrated;
  }
  if (!file && result?.imagePath?.startsWith("/generated/")) {
    const legacy = path.resolve(PUBLIC_ROOT, result.imagePath.replace(/^\/+/, ""));
    const migrated = path.join(/* turbopackIgnore: true */ expected, path.relative(legacyExpected, legacy));
    file = existsSync(migrated) ? migrated : legacy;
  }
  if (!file) throw new Error("검증된 생성 결과가 없습니다.");
  if (file.startsWith(`${legacyExpected}${path.sep}`)) {
    throw new Error("공개 폴더의 이전 생성물을 비공개 저장소로 이전해야 합니다.");
  }
  if (!file.startsWith(`${expected}${path.sep}`)) throw new Error("결과 파일 경로가 작업 범위를 벗어났습니다.");
  return file;
}
