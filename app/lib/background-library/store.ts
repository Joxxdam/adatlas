import { promises as fs } from "node:fs";
import path from "node:path";

import {
  backgroundCategories,
  type BackgroundCategory,
  type BackgroundLibraryItem,
  type BackgroundLibrarySummary,
} from "./types";

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
      backgroundCategories.includes(item.category) &&
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

export function summarizeBackgroundLibrary(items: BackgroundLibraryItem[]): BackgroundLibrarySummary {
  const counts = Object.fromEntries(
    backgroundCategories.map((category) => [category, 0])
  ) as Record<BackgroundCategory, number>;
  items.forEach((item) => {
    counts[item.category] += 1;
  });
  return { total: items.length, counts };
}

export function resolvePublicBackgroundFile(file: string) {
  return publicFilePath(file);
}
