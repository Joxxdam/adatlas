import { promises as fs } from "node:fs";
import path from "node:path";

import type { BackgroundCatalogFilters, BackgroundCatalogItem, BackgroundCatalogManifest, BackgroundCatalogSummary, BackgroundCollectionConfig } from "./catalogTypes.ts";
import { backgroundStorage } from "./storage.ts";
import type { BackgroundCategory, BackgroundLibraryItem, BackgroundSourceType } from "./types.ts";

const configPath = path.join(process.cwd(), "background-library", "config", "collections.json");
const manifestKey = "manifests/library.json";
const emptyManifest = (): BackgroundCatalogManifest => ({
  version: 1,
  updatedAt: new Date(0).toISOString(),
  items: [],
});

function safeId(value: unknown) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

export async function readBackgroundCollectionConfigs() {
  const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as BackgroundCollectionConfig[];
  if (!Array.isArray(parsed)) throw new Error("배경 컬렉션 설정 형식이 잘못되었습니다.");
  for (const config of parsed) {
    if (!safeId(config.id) || !config.displayName || !config.enabled) continue;
    const total = Object.values(config.categories || {}).reduce((sum, count) => sum + Number(count || 0), 0);
    if (total !== config.targetCount) {
      throw new Error(`${config.id} 카테고리 목표 합계가 ${config.targetCount}개가 아닙니다.`);
    }
    if ((config.generationPromptParts?.promptFamilies || []).length < 12) {
      throw new Error(`${config.id} prompt family는 12개 이상이어야 합니다.`);
    }
  }
  return parsed.filter((config) => config.enabled);
}

export async function readBackgroundCatalogManifest() {
  try {
    const parsed = JSON.parse((await backgroundStorage.read(manifestKey)).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as BackgroundCatalogManifest).items)) {
      return emptyManifest();
    }
    return parsed as BackgroundCatalogManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyManifest();
    return emptyManifest();
  }
}

export async function writeBackgroundCatalogManifest(manifest: BackgroundCatalogManifest) {
  const normalized: BackgroundCatalogManifest = {
    version: Math.max(1, Number(manifest.version || 1)),
    updatedAt: new Date().toISOString(),
    items: manifest.items,
  };
  await backgroundStorage.write(manifestKey, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function upsertBackgroundCatalogItems(incoming: BackgroundCatalogItem[], options: { dryRun?: boolean } = {}) {
  const current = await readBackgroundCatalogManifest();
  const byId = new Map(current.items.map((item) => [item.id, item]));
  incoming.forEach((item) => byId.set(item.id, item));
  const next = { ...current, items: [...byId.values()] };
  return options.dryRun ? next : writeBackgroundCatalogManifest(next);
}

export async function updateBackgroundCatalogItem(id: string, changes: Partial<Pick<BackgroundCatalogItem, "status" | "primaryCategory" | "secondaryCategories" | "favorite" | "moodTags" | "analysisStatus" | "analysisConfidence" | "textRisk" | "logoRisk" | "endorsementRisk">>) {
  const manifest = await readBackgroundCatalogManifest();
  const index = manifest.items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  manifest.items[index] = {
    ...manifest.items[index],
    ...changes,
    id: manifest.items[index].id,
    updatedAt: new Date().toISOString(),
  };
  await writeBackgroundCatalogManifest(manifest);
  return manifest.items[index];
}

export function productionReady(item: BackgroundCatalogItem) {
  return item.status === "approved" && item.licenseStatus === "verified";
}

export async function summarizeBackgroundCatalog(items?: BackgroundCatalogItem[]) {
  const [configs, manifest] = await Promise.all([readBackgroundCollectionConfigs(), items ? Promise.resolve(null) : readBackgroundCatalogManifest()]);
  const all = items || manifest?.items || [];
  const summary: BackgroundCatalogSummary = {
    total: all.length,
    approved: all.filter((item) => item.status === "approved").length,
    productionReady: all.filter(productionReady).length,
    unverified: all.filter((item) => item.licenseStatus === "unverified").length,
    rejected: all.filter((item) => item.status === "rejected").length,
    inactive: all.filter((item) => item.status === "inactive").length,
    duplicateRemoved: all.filter((item) => item.rejectionReasons.includes("duplicate")).length,
    lowResolutionRejected: all.filter((item) => item.rejectionReasons.includes("low-resolution")).length,
    brokenRejected: all.filter((item) => item.rejectionReasons.includes("decode-failed")).length,
    riskReviewCount: all.filter((item) => [item.textRisk, item.logoRisk, item.endorsementRisk].some((risk) => risk === "high" || risk === "pending")).length,
    totalBytes: all.reduce((sum, item) => sum + Number(item.fileSize || 0), 0),
    thumbnailMissing: 0,
    collections: configs.map((config) => {
      const collectionItems = all.filter((item) => item.collectionIds.includes(config.id));
      const approvedCount = collectionItems.filter((item) => item.status === "approved").length;
      return {
        id: config.id,
        displayName: config.displayName,
        targetCount: config.targetCount,
        approvedCount,
        productionReadyCount: collectionItems.filter(productionReady).length,
        missingCount: Math.max(0, config.targetCount - approvedCount),
        categories: Object.entries(config.categories).map(([id, targetCount]) => {
          const count = collectionItems.filter((item) => item.primaryCategory === id && item.status === "approved").length;
          return { id, targetCount, approvedCount: count, missingCount: Math.max(0, targetCount - count) };
        }),
      };
    }),
  };
  summary.thumbnailMissing = (await Promise.all(all.filter((item) => item.status === "approved").map((item) => backgroundStorage.exists(item.thumbnailPath)))).filter((exists) => !exists).length;
  return summary;
}

function brightnessBucket(value: number) {
  return value >= 0.67 ? "bright" : value <= 0.35 ? "dark" : "medium";
}

function deterministicShuffleScore(id: string, page: number) {
  let value = page + 17;
  for (let index = 0; index < id.length; index += 1) value = (value * 31 + id.charCodeAt(index)) % 1_000_003;
  return value;
}

export function filterBackgroundCatalog(items: BackgroundCatalogItem[], filters: BackgroundCatalogFilters) {
  const search = String(filters.search || "")
    .trim()
    .toLowerCase();
  const filtered = items.filter((item) => {
    if (filters.collectionId && !item.collectionIds.includes(filters.collectionId)) return false;
    if (filters.category && item.primaryCategory !== filters.category) return false;
    if (filters.scene && item.sceneType !== filters.scene) return false;
    if (filters.mood && !item.moodTags.includes(filters.mood)) return false;
    if (filters.color && ![item.dominantColor, ...item.secondaryColors].some((color) => color.includes(filters.color!))) return false;
    if (filters.brightness && brightnessBucket(item.brightness) !== filters.brightness) return false;
    if (filters.people === "none" && item.peoplePresence !== "none") return false;
    if (filters.people === "included" && item.peoplePresence === "none") return false;
    if (filters.negativeSpace && item.negativeSpaceDirection !== filters.negativeSpace) return false;
    if (filters.indoorOutdoor && item.indoorOutdoor !== filters.indoorOutdoor) return false;
    if (filters.licenseStatus && item.licenseStatus !== filters.licenseStatus) return false;
    if (filters.sourceType && item.sourceType !== filters.sourceType) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.favorite && !item.favorite) return false;
    if (search && ![item.primaryCategory, item.sceneType, item.matchedQuery, ...item.moodTags, ...item.collectionIds].join(" ").toLowerCase().includes(search)) return false;
    return true;
  });
  const sort = filters.sort || "latest";
  return filtered.sort((a, b) => {
    if (sort === "recommended") return b.adCompositionScore - a.adCompositionScore;
    if (sort === "shuffle") return deterministicShuffleScore(a.id, filters.page || 1) - deterministicShuffleScore(b.id, filters.page || 1);
    return b.createdAt.localeCompare(a.createdAt);
  });
}

function collectionCategory(collectionIds: string[]): BackgroundCategory {
  const first = collectionIds[0] || "";
  if (first === "korean-beef-scenes") return "meat";
  if (first === "fresh-bodycare-scenes") return "beauty";
  if (first === "farm-produce-scenes") return "agriculture";
  if (first === "womens-fashion-scenes") return "fashion";
  return "promotion";
}

export function catalogAssetUrl(id: string, size: "processed" | "thumbnail" = "processed") {
  return `/api/background-library/assets/${encodeURIComponent(id)}?size=${size}`;
}

export function catalogItemToLegacy(item: BackgroundCatalogItem): BackgroundLibraryItem {
  const sourceType: BackgroundSourceType = item.sourceType === "pexels" ? "stock_photo" : item.sourceType === "local-generation" ? "ai_generated" : "user_uploaded";
  const includesPerson = item.peoplePresence === "background" || item.peoplePresence === "prominent";
  return {
    id: item.id,
    file: catalogAssetUrl(item.id),
    enabled: productionReady(item),
    category: collectionCategory(item.collectionIds),
    subcategories: [item.primaryCategory, ...item.secondaryCategories],
    industries: item.collectionIds,
    assetType: item.sourceType === "local-generation" ? "ai_generated" : includesPerson ? "people_photo" : "lifestyle_photo",
    hookTypes: ["situation", "sensory", "premium", "freshness"],
    ageGroups: includesPerson ? ["twenties", "thirties"] : ["no_people"],
    peopleType: includesPerson ? ["woman", "man"] : ["no_people"],
    peopleCount: includesPerson ? 1 : 0,
    includesPerson,
    personPosition: includesPerson ? "center" : "none",
    personGaze: includesPerson ? "away" : "none",
    personEmotion: "",
    personAction: "",
    scene: item.sceneType || item.primaryCategory,
    mood: item.moodTags,
    elements: [item.primaryCategory, item.indoorOutdoor],
    colors: [item.dominantColor, ...item.secondaryColors],
    productPosition: item.recommendedProductPosition,
    textSafeArea: item.recommendedCopyPosition,
    focalArea: `${item.focalPoint.x.toFixed(2)},${item.focalPoint.y.toFixed(2)}`,
    brightness: brightnessBucket(item.brightness),
    contrast: item.contrast >= 0.55 ? "high" : item.contrast <= 0.25 ? "low" : "medium",
    orientation: "square",
    recommendedLayouts: item.collectionIds.includes("womens-fashion-scenes") ? ["fashion-lookbook"] : ["product-grounded"],
    sourceType,
    sourceName: item.sourceType === "pexels" ? "Pexels" : item.provider,
    sourcePageUrl: item.sourcePageUrl,
    originalImageUrl: item.originalUrl,
    licenseUrl: item.licenseUrl,
    authorName: item.creatorName,
    downloadedAt: item.downloadedAt,
    generationModel: item.sourceType === "local-generation" ? "local ComfyUI" : undefined,
    generationPrompt: item.generationPrompt || undefined,
    generatedAt: item.generatedAt || undefined,
    reviewed: item.analysisStatus === "manually-reviewed",
    width: item.localWidth,
    height: item.localHeight,
    fileSize: item.fileSize,
    hash: item.contentHash,
    perceptualHash: item.perceptualHash,
  };
}

export async function readProductionCatalogAsLegacy() {
  const manifest = await readBackgroundCatalogManifest();
  return manifest.items.filter(productionReady).map(catalogItemToLegacy);
}

export async function findBackgroundCatalogItem(id: string) {
  const manifest = await readBackgroundCatalogManifest();
  return manifest.items.find((item) => item.id === id) || null;
}

export async function readCatalogAssetFromUrl(value: string) {
  const match = String(value || "").match(/^\/api\/background-library\/assets\/(bg-[a-z0-9-]+)(?:\?.*)?$/);
  if (!match) return null;
  const item = await findBackgroundCatalogItem(match[1]);
  if (!item || item.status === "rejected" || !item.filePath) return null;
  return backgroundStorage.read(item.filePath);
}
