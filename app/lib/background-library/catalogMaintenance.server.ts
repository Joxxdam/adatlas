import sharp from "sharp";

import { perceptualHashDistance } from "./catalogImageAnalysis.server.ts";
import { readBackgroundCatalogManifest, summarizeBackgroundCatalog, writeBackgroundCatalogManifest } from "./catalogStore.server.ts";
import type { BackgroundCatalogItem } from "./catalogTypes.ts";
import { backgroundStorage } from "./storage.ts";

function rank(item: BackgroundCatalogItem) {
  return (item.originalWidth * item.originalHeight) / 1_000_000 + (item.licenseStatus === "verified" ? 20 : 0) + item.squareCropScore * 6 + item.productPlacementSpace * 6 + item.adCompositionScore * 10;
}

export async function validateBackgroundCatalog() {
  const manifest = await readBackgroundCatalogManifest();
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Map<string, string>();
  for (const item of manifest.items) {
    if (seenIds.has(item.id)) errors.push(`${item.id}: duplicate-id`);
    seenIds.add(item.id);
    if (seenHashes.has(item.contentHash)) errors.push(`${item.id}: duplicate-content:${seenHashes.get(item.contentHash)}`);
    else if (item.contentHash) seenHashes.set(item.contentHash, item.id);
    if (item.status === "approved" && item.licenseStatus !== "verified") errors.push(`${item.id}: approved-without-verified-license`);
    if (["approved", "review", "inactive"].includes(item.status)) {
      const [processed, thumbnail] = await Promise.all([backgroundStorage.exists(item.filePath), backgroundStorage.exists(item.thumbnailPath)]);
      if (!processed) errors.push(`${item.id}: processed-missing`);
      if (!thumbnail) warnings.push(`${item.id}: thumbnail-missing`);
      if (processed) {
        try {
          const metadata = await sharp(await backgroundStorage.read(item.filePath), { failOn: "error" }).metadata();
          if (metadata.format !== "webp" || metadata.width !== 1600 || metadata.height !== 1600) errors.push(`${item.id}: processed-spec-invalid`);
        } catch {
          errors.push(`${item.id}: processed-decode-failed`);
        }
      }
      if (thumbnail) {
        try {
          const metadata = await sharp(await backgroundStorage.read(item.thumbnailPath), { failOn: "error" }).metadata();
          if (metadata.format !== "webp" || metadata.width !== 320 || metadata.height !== 320) errors.push(`${item.id}: thumbnail-spec-invalid`);
        } catch {
          errors.push(`${item.id}: thumbnail-decode-failed`);
        }
      }
    }
    if (item.analysisStatus === "heuristic" && [item.textRisk, item.logoRisk, item.faceVisibility].some((value) => value === "pending")) {
      warnings.push(`${item.id}: manual-risk-review-pending`);
    }
  }
  return { valid: errors.length === 0, checkedAt: new Date().toISOString(), total: manifest.items.length, errors, warnings };
}

export async function dedupeBackgroundCatalog(options: { dryRun?: boolean } = {}) {
  const manifest = await readBackgroundCatalogManifest();
  const active = manifest.items.filter((item) => item.status !== "rejected" && item.status !== "inactive");
  const exact: Array<{ keep: string; inactive: string }> = [];
  const similar: Array<{ keep: string; inactive: string; distance: number }> = [];
  for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) {
    const left = active[leftIndex];
    if (left.status === "inactive") continue;
    for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const right = active[rightIndex];
      if (right.status === "inactive") continue;
      const isExact = Boolean(left.contentHash && left.contentHash === right.contentHash);
      const distance = perceptualHashDistance(left.perceptualHash, right.perceptualHash);
      if (!isExact && distance > 5) continue;
      const keep = rank(left) >= rank(right) ? left : right;
      const inactive = keep === left ? right : left;
      inactive.status = "inactive";
      inactive.rejectionReasons = [...inactive.rejectionReasons, `${isExact ? "duplicate" : "similar-duplicate"}:${keep.id}`];
      if (isExact) exact.push({ keep: keep.id, inactive: inactive.id });
      else similar.push({ keep: keep.id, inactive: inactive.id, distance });
    }
  }
  if (!options.dryRun) await writeBackgroundCatalogManifest(manifest);
  return { dryRun: Boolean(options.dryRun), exact, similar, changed: exact.length + similar.length };
}

export async function regenerateCatalogThumbnails(options: { dryRun?: boolean } = {}) {
  const manifest = await readBackgroundCatalogManifest();
  let generated = 0;
  const failures: Array<{ id: string; reason: string }> = [];
  for (const item of manifest.items.filter((value) => ["approved", "review", "inactive"].includes(value.status))) {
    if (await backgroundStorage.exists(item.thumbnailPath)) continue;
    try {
      const thumbnail = await sharp(await backgroundStorage.read(item.filePath))
        .resize(320, 320, { fit: "cover" })
        .webp({ quality: 78 })
        .toBuffer();
      await sharp(thumbnail, { failOn: "error" }).metadata();
      if (!options.dryRun) await backgroundStorage.write(item.thumbnailPath, thumbnail);
      generated += 1;
    } catch (error) {
      failures.push({ id: item.id, reason: error instanceof Error ? error.message : "thumbnail-failed" });
    }
  }
  return { dryRun: Boolean(options.dryRun), generated, failures };
}

export async function optimizeCatalogFromOriginals(options: { dryRun?: boolean } = {}) {
  const manifest = await readBackgroundCatalogManifest();
  let optimized = 0;
  const failures: Array<{ id: string; reason: string }> = [];
  for (const item of manifest.items.filter((value) => value.originalPath && value.status !== "rejected")) {
    if (await backgroundStorage.exists(item.filePath)) continue;
    try {
      const processed = await sharp(await backgroundStorage.read(item.originalPath))
        .rotate()
        .resize(1600, 1600, { fit: "cover", position: "attention" })
        .webp({ quality: 84 })
        .toBuffer();
      const metadata = await sharp(processed, { failOn: "error" }).metadata();
      if (metadata.width !== 1600 || metadata.height !== 1600) throw new Error("optimized-size-invalid");
      if (!options.dryRun) await backgroundStorage.write(item.filePath, processed);
      item.fileSize = processed.length;
      item.localWidth = 1600;
      item.localHeight = 1600;
      optimized += 1;
    } catch (error) {
      failures.push({ id: item.id, reason: error instanceof Error ? error.message : "optimize-failed" });
    }
  }
  if (!options.dryRun && optimized) await writeBackgroundCatalogManifest(manifest);
  return { dryRun: Boolean(options.dryRun), optimized, failures };
}

export async function rebuildBackgroundCatalogManifest(options: { dryRun?: boolean } = {}) {
  const manifest = await readBackgroundCatalogManifest();
  manifest.items = manifest.items.filter((item) => item && /^bg-[a-z0-9-]+$/.test(item.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!options.dryRun) await writeBackgroundCatalogManifest(manifest);
  return { dryRun: Boolean(options.dryRun), total: manifest.items.length };
}

export async function catalogReviewQueue() {
  const manifest = await readBackgroundCatalogManifest();
  return manifest.items
    .filter((item) => item.status === "review" || item.licenseStatus !== "verified")
    .map((item) => ({
      id: item.id,
      collectionIds: item.collectionIds,
      category: item.primaryCategory,
      licenseStatus: item.licenseStatus,
      status: item.status,
      warnings: item.warnings,
      previewUrl: `/api/background-library/assets/${item.id}?size=processed`,
    }));
}

export async function createCatalogContactSheet(options: { limit?: number; dryRun?: boolean } = {}) {
  const manifest = await readBackgroundCatalogManifest();
  const items = manifest.items.filter((item) => item.status === "approved").slice(0, Math.max(1, Math.min(100, options.limit || 36)));
  if (!items.length) return { dryRun: Boolean(options.dryRun), generated: false, itemCount: 0, path: "" };
  const cells = await Promise.all(
    items.map(async (item) =>
      sharp(await backgroundStorage.read(item.thumbnailPath))
        .resize(240, 240)
        .toBuffer()
    )
  );
  const columns = 6;
  const rows = Math.ceil(cells.length / columns);
  const canvas = sharp({ create: { width: columns * 240, height: rows * 240, channels: 3, background: "#f4f4f4" } });
  const buffer = await canvas
    .composite(cells.map((input, index) => ({ input, left: (index % columns) * 240, top: Math.floor(index / columns) * 240 })))
    .webp({ quality: 82 })
    .toBuffer();
  const key = `review/contact-sheet-${Date.now()}.webp`;
  if (!options.dryRun) await backgroundStorage.write(key, buffer);
  return { dryRun: Boolean(options.dryRun), generated: true, itemCount: items.length, path: key, bytes: buffer.length };
}

export async function backgroundCatalogStatus() {
  const manifest = await readBackgroundCatalogManifest();
  return summarizeBackgroundCatalog(manifest.items);
}
