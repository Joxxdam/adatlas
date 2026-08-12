import { promises as fs } from "node:fs";
import path from "node:path";

import {
  audienceAgeGroups,
  backgroundAssetTypes,
  backgroundCategories,
  type AudienceAgeGroup,
  type BackgroundAssetType,
  type BackgroundCategory,
  type BackgroundLibraryItem,
  type BackgroundLibrarySummary,
} from "./types.ts";

const metadataPath = path.join(process.cwd(), "data", "background-library.json");
const publicRoot = path.join(process.cwd(), "public");

function publicFilePath(file: string) {
  const normalized = `/${String(file || "").replace(/^\/+/, "")}`;
  const resolved = path.resolve(publicRoot, `.${normalized}`);
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) return "";
  return resolved;
}

async function fileExists(file: string) {
  const resolved = publicFilePath(file);
  if (!resolved) return false;
  try {
    const stats = await fs.stat(resolved);
    return stats.isFile() && stats.size > 0;
  } catch {
    return false;
  }
}

export async function readBackgroundLibrary(options: { includeDisabled?: boolean } = {}) {
  let parsed: BackgroundLibraryItem[] = [];
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    const value = JSON.parse(raw) as unknown;
    parsed = Array.isArray(value) ? (value as BackgroundLibraryItem[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const candidates = parsed.filter(
    (item) =>
      item &&
      typeof item.id === "string" &&
      typeof item.file === "string" &&
      typeof item.category === "string" &&
      /^[a-z0-9-]+$/.test(item.category) &&
      (options.includeDisabled || item.enabled !== false)
  );
  const existence = await Promise.all(candidates.map((item) => fileExists(item.file)));
  return candidates.filter((_, index) => existence[index]);
}

export async function appendBackgroundLibraryItem(item: BackgroundLibraryItem) {
  let current: BackgroundLibraryItem[] = [];
  try {
    const value = JSON.parse(await fs.readFile(metadataPath, "utf8")) as unknown;
    current = Array.isArray(value) ? (value as BackgroundLibraryItem[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const next = [...current.filter((existing) => existing.id !== item.id), item];
  const temporaryPath = `${metadataPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, metadataPath);
  return item;
}

export async function updateBackgroundLibraryItem(
  id: string,
  changes: Partial<BackgroundLibraryItem>
) {
  const current = await readBackgroundLibrary({ includeDisabled: true });
  const index = current.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const protectedFields = { id: current[index].id, file: current[index].file };
  const nextItem: BackgroundLibraryItem = {
    ...current[index],
    ...changes,
    ...protectedFields,
  };
  const next = current.map((item, itemIndex) => (itemIndex === index ? nextItem : item));
  await writeBackgroundLibrary(next);
  return nextItem;
}

export async function deleteBackgroundLibraryItem(id: string) {
  const current = await readBackgroundLibrary({ includeDisabled: true });
  const target = current.find((item) => item.id === id);
  if (!target) return null;
  await writeBackgroundLibrary(current.filter((item) => item.id !== id));
  return target;
}

export async function writeBackgroundLibrary(items: BackgroundLibraryItem[]) {
  const temporaryPath = `${metadataPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(items, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, metadataPath);
}

export function summarizeBackgroundLibrary(
  items: BackgroundLibraryItem[]
): BackgroundLibrarySummary {
  const counts = Object.fromEntries(
    backgroundCategories.map((category) => [category, 0])
  ) as Record<BackgroundCategory, number>;
  items.forEach((item) => {
    if (backgroundCategories.includes(item.category)) counts[item.category] += 1;
  });
  const ageCounts = Object.fromEntries(
    audienceAgeGroups.map((ageGroup) => [ageGroup, 0])
  ) as Record<AudienceAgeGroup, number>;
  const assetTypeCounts = Object.fromEntries(
    backgroundAssetTypes.map((assetType) => [assetType, 0])
  ) as Record<BackgroundAssetType, number>;
  const people = items.filter((item) => item.includesPerson);
  items.forEach((item) => {
    assetTypeCounts[item.assetType] += 1;
    (item.ageGroups || []).forEach((ageGroup) => {
      ageCounts[ageGroup] += 1;
    });
  });
  return {
    total: items.length,
    totalBytes: items.reduce((total, item) => total + Number(item.fileSize || 0), 0),
    counts,
    assetTypeCounts,
    peopleTotal: people.length,
    ageCounts,
  };
}

export function resolvePublicBackgroundFile(file: string) {
  return publicFilePath(file);
}
