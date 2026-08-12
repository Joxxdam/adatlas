import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import JSZip from "jszip";
import sharp from "sharp";

import {
  analyzeCatalogImage,
  catalogContentHash,
  detectCatalogImageSignature,
  perceptualHashDistance,
} from "./catalogImageAnalysis.server.ts";
import {
  readBackgroundCatalogManifest,
  readBackgroundCollectionConfigs,
  writeBackgroundCatalogManifest,
} from "./catalogStore.server.ts";
import type {
  BackgroundCatalogItem,
  BackgroundLicense,
  CatalogSourceType,
} from "./catalogTypes.ts";
import { backgroundStorage } from "./storage.ts";

const maxImageBytes = 50 * 1024 * 1024;
const maxZipBytes = 250 * 1024 * 1024;
const maxZipFiles = 2_500;
const maxZipExpandedBytes = 2 * 1024 * 1024 * 1024;
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

export type CatalogImportSource = {
  name: string;
  buffer: Buffer;
  license?: Partial<BackgroundLicense> & { manuallyReviewed?: boolean };
  matchedQuery?: string;
  providerPhotoId?: string;
  originalUrl?: string;
};

export type CatalogImportResult = {
  dryRun: boolean;
  collectionId: string;
  categoryId: string;
  discovered: number;
  approved: number;
  review: number;
  rejected: number;
  exactDuplicates: number;
  similarDuplicates: number;
  reusedAcrossCollections: number;
  writtenBytes: number;
  items: BackgroundCatalogItem[];
  failures: Array<{ name: string; reason: string }>;
  jobId: string;
};

function safeArchiveName(name: string) {
  const raw = String(name || "").replace(/\\/g, "/");
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[a-z]:\//i.test(raw)) return false;
  const parts = raw.split("/");
  return !parts.some((part) => part === ".." || part === ".");
}

function normalizeSourceName(name: string) {
  return path.basename(String(name || "image")).replace(/[^a-zA-Z0-9가-힣._-]+/g, "-").slice(0, 120);
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const value = line[index];
    if (value === '"' && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (value === '"') quoted = !quoted;
    else if (value === "," && !quoted) { values.push(current.trim()); current = ""; }
    else current += value;
  }
  values.push(current.trim());
  return values;
}

function sidecarRows(buffer: Buffer, extension: string) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  if (extension === ".json") {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>).map(([fileName, value]) => ({
        fileName,
        ...(value && typeof value === "object" ? (value as Record<string, unknown>) : {}),
      }));
    }
    return [];
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => Object.fromEntries(headers.map((header, index) => [header, parseCsvLine(line)[index] || ""])));
}

function normalizeLicense(
  value: Partial<BackgroundLicense> & { manuallyReviewed?: boolean } | undefined,
  sourceType: CatalogSourceType
) {
  const now = new Date().toISOString();
  const commercial = value?.commercialUseAllowed === true || String(value?.commercialUseAllowed) === "true";
  const evidenceComplete = Boolean(value?.proofPath && value?.licenseType && value?.licenseUrl);
  const explicitlyVerified = value?.licenseStatus === "verified" && commercial && evidenceComplete;
  return {
    sourceType,
    sourceName: String(value?.sourceName || (sourceType === "pexels" ? "Pexels" : "로컬 가져오기")),
    sourcePageUrl: String(value?.sourcePageUrl || ""),
    creatorName: String(value?.creatorName || ""),
    creatorUrl: String(value?.creatorUrl || ""),
    licenseType: String(value?.licenseType || ""),
    licenseUrl: String(value?.licenseUrl || ""),
    proofPath: String(value?.proofPath || ""),
    commercialUseAllowed: value?.commercialUseAllowed == null ? null : commercial,
    attributionRequired: value?.attributionRequired === true || String(value?.attributionRequired) === "true",
    attributionText: String(value?.attributionText || ""),
    acquiredAt: String(value?.acquiredAt || now),
    licenseCheckedAt: explicitlyVerified ? String(value?.licenseCheckedAt || now) : "",
    licenseStatus: explicitlyVerified ? "verified" as const : "unverified" as const,
    manuallyReviewed: value?.manuallyReviewed === true || String(value?.manuallyReviewed) === "true",
  };
}

function sourceDerivedFlags(category: string) {
  return {
    foodPresence: /grill|dining|meal|barbecue|cooking|market|produce|orchard|farm|table/.test(category) ? "yes" as const : "unknown" as const,
    waterPresence: /water|shower|bathroom|spa/.test(category) ? "yes" as const : "unknown" as const,
    vegetationPresence: /forest|mint|herbs|citrus|farm|orchard|field|greenhouse|floral|outdoor/.test(category) ? "yes" as const : "unknown" as const,
    firePresence: /fire|smoke|grill|barbecue/.test(category) ? "yes" as const : "unknown" as const,
    indoorOutdoor: /forest|camping|farm|orchard|field|picnic|street|floral|outdoor/.test(category)
      ? "outdoor" as const
      : /restaurant|home|kitchen|bathroom|interior|studio|office|hotel|spa|cafe/.test(category)
        ? "indoor" as const
        : "unknown" as const,
  };
}

function qualityRank(item: BackgroundCatalogItem) {
  return item.originalWidth * item.originalHeight / 1_000_000 +
    (item.licenseStatus === "verified" ? 15 : 0) +
    item.squareCropScore * 5 + item.productPlacementSpace * 5 + item.adCompositionScore * 8;
}

export async function extractCatalogZip(buffer: Buffer) {
  if (!buffer.length || buffer.length > maxZipBytes) throw new Error("ZIP 파일은 250MB 이하만 지원합니다.");
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: true, createFolders: false });
  const entries = Object.values(archive.files).filter((entry) => !entry.dir);
  if (entries.length > maxZipFiles) throw new Error(`ZIP 파일 수는 ${maxZipFiles}개를 넘을 수 없습니다.`);
  let totalExpanded = 0;
  const sidecars = new Map<string, Record<string, unknown>>();
  for (const entry of entries) {
    const originalName = (entry as unknown as { unsafeOriginalName?: string }).unsafeOriginalName || entry.name;
    if (!safeArchiveName(originalName) || !safeArchiveName(entry.name)) throw new Error("ZIP 내부에 허용되지 않은 경로가 있습니다.");
    const sizes = (entry as unknown as { _data?: { uncompressedSize?: number; compressedSize?: number } })._data;
    const expanded = Number(sizes?.uncompressedSize || 0);
    const compressed = Number(sizes?.compressedSize || 1);
    if (expanded > maxImageBytes && !/\.(json|csv)$/i.test(entry.name)) throw new Error(`${entry.name}: 파일 크기 제한을 초과합니다.`);
    if (expanded > 10 * 1024 * 1024 && expanded / Math.max(1, compressed) > 150) throw new Error(`${entry.name}: 비정상적인 압축 비율입니다.`);
    totalExpanded += expanded;
    if (totalExpanded > maxZipExpandedBytes) throw new Error("ZIP 압축 해제 총용량 제한을 초과합니다.");
  }
  for (const entry of entries.filter((candidate) => /\.(json|csv)$/i.test(candidate.name))) {
    const rows = sidecarRows(await entry.async("nodebuffer"), path.extname(entry.name).toLowerCase());
    rows.forEach((row) => {
      const fileName = normalizeSourceName(String(row.fileName || row.filename || row.file || ""));
      if (fileName) sidecars.set(fileName, row);
    });
  }
  const sources: CatalogImportSource[] = [];
  for (const entry of entries) {
    const extension = path.extname(entry.name).toLowerCase();
    if (!allowedExtensions.has(extension)) continue;
    const name = normalizeSourceName(entry.name);
    const image = await entry.async("nodebuffer");
    if (image.length > maxImageBytes) throw new Error(`${entry.name}: 파일 크기 제한을 초과합니다.`);
    sources.push({ name, buffer: image, license: sidecars.get(name) as CatalogImportSource["license"] });
  }
  return sources;
}

export async function collectLocalCatalogSources(inputPath: string) {
  const resolved = path.resolve(inputPath);
  const stats = await fs.stat(resolved);
  if (stats.isFile() && path.extname(resolved).toLowerCase() === ".zip") {
    return extractCatalogZip(await fs.readFile(resolved));
  }
  if (!stats.isDirectory()) throw new Error("가져올 폴더 또는 ZIP 파일을 찾을 수 없습니다.");
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  const sidecars = new Map<string, Record<string, unknown>>();
  for (const entry of entries.filter((candidate) => candidate.isFile() && /\.(json|csv)$/i.test(candidate.name))) {
    const extension = path.extname(entry.name).toLowerCase();
    sidecarRows(await fs.readFile(path.join(resolved, entry.name)), extension).forEach((row) => {
      const fileName = normalizeSourceName(String(row.fileName || row.filename || row.file || ""));
      if (fileName) sidecars.set(fileName, row);
    });
  }
  const sources: CatalogImportSource[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !allowedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    const file = path.join(resolved, entry.name);
    const fileStats = await fs.stat(file);
    if (fileStats.size > maxImageBytes) throw new Error(`${entry.name}: 파일 크기 제한을 초과합니다.`);
    const name = normalizeSourceName(entry.name);
    sources.push({ name, buffer: await fs.readFile(file), license: sidecars.get(name) as CatalogImportSource["license"] });
  }
  return sources;
}

export async function importBackgroundSources(input: {
  collectionId: string;
  categoryId: string;
  sources: CatalogImportSource[];
  sourceType?: CatalogSourceType;
  dryRun?: boolean;
  generated?: { prompt: string; negativePrompt: string; seed: number; workflowHash: string; upscaled: boolean };
}) {
  const configs = await readBackgroundCollectionConfigs();
  const config = configs.find((item) => item.id === input.collectionId);
  if (!config) throw new Error("등록된 컬렉션이 아닙니다.");
  if (!Object.prototype.hasOwnProperty.call(config.categories, input.categoryId)) throw new Error("등록된 세부 카테고리가 아닙니다.");
  if (!input.sources.length) throw new Error("가져올 이미지가 없습니다.");
  if (input.sources.length > maxZipFiles) throw new Error("한 작업에서 처리할 수 있는 이미지 수를 초과했습니다.");
  const manifest = await readBackgroundCatalogManifest();
  const sourceType = input.sourceType || "local-import";
  const jobId = `${sourceType}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const result: CatalogImportResult = {
    dryRun: Boolean(input.dryRun), collectionId: input.collectionId, categoryId: input.categoryId,
    discovered: input.sources.length, approved: 0, review: 0, rejected: 0,
    exactDuplicates: 0, similarDuplicates: 0, reusedAcrossCollections: 0, writtenBytes: 0,
    items: [], failures: [], jobId,
  };
  const nextItems = [...manifest.items];

  for (const source of input.sources) {
    const safeName = normalizeSourceName(source.name);
    try {
      if (!detectCatalogImageSignature(source.buffer)) throw new Error("signature-invalid");
      const analysis = await analyzeCatalogImage(source.buffer);
      const contentHash = catalogContentHash(source.buffer);
      const exact = nextItems.find((item) => item.contentHash === contentHash || (source.providerPhotoId && item.provider === "pexels" && item.providerPhotoId === source.providerPhotoId));
      if (exact) {
        result.exactDuplicates += 1;
        if (!exact.collectionIds.includes(input.collectionId)) {
          exact.collectionIds.push(input.collectionId);
          exact.updatedAt = new Date().toISOString();
          result.reusedAcrossCollections += 1;
        }
        continue;
      }
      const license = normalizeLicense(source.license, sourceType);
      const now = new Date().toISOString();
      const id = `bg-${input.collectionId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const rejectionReasons: string[] = [];
      const warnings: string[] = [];
      const generatedCanUpscale = sourceType === "local-generation" && Math.min(analysis.width, analysis.height) >= 1024;
      if (Math.min(analysis.width, analysis.height) < config.minimumResolution && !generatedCanUpscale) rejectionReasons.push("low-resolution");
      if (analysis.squareCropScore < 0.55) rejectionReasons.push("unsafe-square-crop");
      if (analysis.clutterLevel > 0.88) rejectionReasons.push("excessive-clutter");
      if (license.licenseStatus !== "verified") warnings.push("license-unverified");
      warnings.push("text-logo-face-review-pending");
      const flags = sourceDerivedFlags(input.categoryId);
      const generatedAt = sourceType === "local-generation" ? now : "";
      const item: BackgroundCatalogItem = {
        id, sourceType, provider: sourceType === "pexels" ? "pexels" : sourceType === "local-generation" ? "comfyui" : "local",
        providerPhotoId: String(source.providerPhotoId || ""), collectionIds: [input.collectionId], primaryCategory: input.categoryId,
        secondaryCategories: [], matchedQuery: String(source.matchedQuery || ""), generationPrompt: input.generated?.prompt || "",
        negativePrompt: input.generated?.negativePrompt || "", generationSeed: input.generated?.seed ?? null,
        generationWorkflowHash: input.generated?.workflowHash || "", generatedUpscaled: generatedCanUpscale && Boolean(input.generated?.upscaled),
        originalWidth: analysis.width, originalHeight: analysis.height, localWidth: 0, localHeight: 0,
        originalUrl: String(source.originalUrl || ""), sourcePageUrl: license.sourcePageUrl, creatorName: license.creatorName,
        creatorUrl: license.creatorUrl, dominantColor: analysis.dominantColor, secondaryColors: analysis.secondaryColors,
        downloadedAt: sourceType === "pexels" ? now : "", generatedAt, licenseType: license.licenseType,
        licenseUrl: license.licenseUrl, licenseCheckedAt: license.licenseCheckedAt, licenseStatus: license.licenseStatus,
        commercialUseAllowed: license.commercialUseAllowed, attributionRequired: license.attributionRequired,
        attributionText: license.attributionText, proofPath: license.proofPath, filePath: "", thumbnailPath: "", originalPath: "",
        contentHash, perceptualHash: analysis.perceptualHash, format: "webp", fileSize: 0,
        status: rejectionReasons.length ? "rejected" : license.manuallyReviewed && license.licenseStatus === "verified" ? "approved" : "review",
        rejectionReasons, warnings, analysisStatus: license.manuallyReviewed ? "manually-reviewed" : "heuristic",
        analysisConfidence: license.manuallyReviewed ? 0.95 : 0.7,
        analysisEvidence: ["sharp:64x64-local-analysis", `source-derived:${input.collectionId}/${input.categoryId}`],
        sceneType: input.categoryId, indoorOutdoor: flags.indoorOutdoor, peoplePresence: "unknown", faceVisibility: "unknown",
        endorsementRisk: "pending", logoRisk: "pending", textRisk: "pending", foodPresence: flags.foodPresence,
        waterPresence: flags.waterPresence, vegetationPresence: flags.vegetationPresence, firePresence: flags.firePresence,
        productPlacementSpace: analysis.productPlacementSpace, negativeSpaceDirection: analysis.negativeSpaceDirection,
        focalPoint: analysis.focalPoint, cropSafety: analysis.cropSafety, clutterLevel: analysis.clutterLevel,
        backgroundSuitabilityScore: analysis.backgroundSuitabilityScore, adCompositionScore: analysis.adCompositionScore,
        recommendedProductPosition: analysis.recommendedProductPosition, recommendedCopyPosition: analysis.recommendedCopyPosition,
        overlayReadability: analysis.overlayReadability, needsDarkOverlay: analysis.needsDarkOverlay,
        needsLightOverlay: analysis.needsLightOverlay, squareCropScore: analysis.squareCropScore,
        brightness: analysis.brightness, saturation: analysis.saturation, contrast: analysis.contrast,
        entropy: analysis.entropy, edgeDensity: analysis.edgeDensity, moodTags: config.preferredMoods.slice(0, 5),
        favorite: false, createdAt: now, updatedAt: now,
      };
      const similar = nextItems.find((existing) =>
        existing.status !== "rejected" && perceptualHashDistance(existing.perceptualHash, item.perceptualHash) <= 5
      );
      if (similar) {
        result.similarDuplicates += 1;
        if (qualityRank(similar) >= qualityRank(item)) {
          result.rejected += 1;
          result.failures.push({ name: safeName, reason: `similar-duplicate:${similar.id}` });
          continue;
        }
        similar.status = "inactive";
        similar.rejectionReasons = [...similar.rejectionReasons, `duplicate-replaced-by:${item.id}`];
      }
      if (item.status !== "rejected") {
        const extension = analysis.format === "jpeg" ? "jpg" : analysis.format;
        item.originalPath = `originals/${id}.${extension}`;
        item.filePath = `processed/${id}.webp`;
        item.thumbnailPath = `thumbnails/${id}.webp`;
        const processed = await sharp(source.buffer)
          .rotate().resize(1600, 1600, { fit: "cover", position: "attention", withoutEnlargement: sourceType !== "local-generation" })
          .webp({ quality: 84, effort: 5 }).toBuffer();
        const thumbnail = await sharp(processed).resize(320, 320, { fit: "cover" }).webp({ quality: 78, effort: 4 }).toBuffer();
        const decoded = await sharp(processed, { failOn: "error" }).metadata();
        const thumbDecoded = await sharp(thumbnail, { failOn: "error" }).metadata();
        if (decoded.width !== 1600 || decoded.height !== 1600 || thumbDecoded.width !== 320 || thumbDecoded.height !== 320) {
          throw new Error("post-conversion-decode-failed");
        }
        item.localWidth = 1600;
        item.localHeight = 1600;
        item.fileSize = processed.length;
        result.writtenBytes += processed.length + thumbnail.length + source.buffer.length;
        if (!input.dryRun) {
          await Promise.all([
            backgroundStorage.write(item.originalPath, source.buffer),
            backgroundStorage.write(item.filePath, processed),
            backgroundStorage.write(item.thumbnailPath, thumbnail),
          ]);
        }
      }
      if (item.status === "approved") result.approved += 1;
      else if (item.status === "review") result.review += 1;
      else result.rejected += 1;
      nextItems.push(item);
      result.items.push(item);
    } catch (error) {
      result.rejected += 1;
      result.failures.push({ name: safeName, reason: error instanceof Error ? error.message : "decode-failed" });
    }
  }

  if (!input.dryRun) {
    await writeBackgroundCatalogManifest({ ...manifest, items: nextItems });
    await backgroundStorage.write(`jobs/${jobId}.json`, `${JSON.stringify({ ...result, items: result.items.map((item) => item.id) }, null, 2)}\n`);
  }
  return result;
}
