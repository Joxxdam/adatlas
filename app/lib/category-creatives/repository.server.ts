import "server-only";

import { promises as fs } from "fs";
import path from "path";
import type { CategoryCreativeJob, CategoryCreativeSource } from "./types";

const root = path.join(process.cwd(), ".data", "category-creatives");
const sourceRoot = path.join(root, "sources");
const jobRoot = path.join(root, "jobs");
const sourceIndexPath = path.join(root, "sources.json");

async function ensure() {
  await fs.mkdir(sourceRoot, { recursive: true });
  await fs.mkdir(jobRoot, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await ensure();
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temporary, filePath);
}

export async function listCategoryCreativeSources(filter?: { advertiserId?: string; categoryId?: string }) {
  const sources = await readJson<CategoryCreativeSource[]>(sourceIndexPath, []);
  return sources.filter((source) => (!filter?.advertiserId || source.advertiserId === filter.advertiserId) && (!filter?.categoryId || source.categoryId === filter.categoryId));
}

export async function saveCategoryCreativeSource(source: CategoryCreativeSource, buffer: Buffer) {
  await ensure();
  await fs.writeFile(path.join(sourceRoot, source.fileName), buffer);
  const sources = await listCategoryCreativeSources();
  await writeJson(sourceIndexPath, [source, ...sources.filter((item) => item.id !== source.id)]);
  return source;
}

export async function getCategoryCreativeSource(id: string) {
  return (await listCategoryCreativeSources()).find((source) => source.id === id) || null;
}

export async function readCategoryCreativeSourceFile(source: CategoryCreativeSource) {
  return fs.readFile(path.join(sourceRoot, path.basename(source.fileName)));
}

export async function deleteCategoryCreativeSource(id: string) {
  const sources = await listCategoryCreativeSources();
  const target = sources.find((source) => source.id === id);
  if (!target) return false;
  await fs.unlink(path.join(sourceRoot, path.basename(target.fileName))).catch(() => undefined);
  await writeJson(sourceIndexPath, sources.filter((source) => source.id !== id));
  return true;
}

export function categoryCreativeJobDirectory(id: string) {
  return path.join(jobRoot, path.basename(id));
}

export async function saveCategoryCreativeJob(job: CategoryCreativeJob) {
  const directory = categoryCreativeJobDirectory(job.id);
  await fs.mkdir(directory, { recursive: true });
  await writeJson(path.join(directory, "job.json"), job);
  return job;
}

export async function getCategoryCreativeJob(id: string) {
  return readJson<CategoryCreativeJob | null>(path.join(categoryCreativeJobDirectory(id), "job.json"), null);
}

export async function listCategoryCreativeJobs() {
  await ensure();
  const entries = await fs.readdir(jobRoot, { withFileTypes: true });
  const jobs = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => getCategoryCreativeJob(entry.name)));
  return jobs.filter((job): job is CategoryCreativeJob => Boolean(job)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteCategoryCreativeJob(id: string) {
  const normalizedId = String(id || "").trim();
  if (!normalizedId || normalizedId === "." || normalizedId === ".." || path.basename(normalizedId) !== normalizedId) return false;

  const job = await getCategoryCreativeJob(normalizedId);
  if (!job) return false;

  const directory = categoryCreativeJobDirectory(normalizedId);
  const relativeDirectory = path.relative(jobRoot, directory);
  if (!relativeDirectory || relativeDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDirectory)) {
    throw new Error("삭제할 카테고리 이미지 작업 경로가 올바르지 않습니다.");
  }

  await fs.rm(directory, { recursive: true, force: true });
  return true;
}

export async function readCategoryCreativeJobAsset(jobId: string, fileName: string) {
  return fs.readFile(path.join(categoryCreativeJobDirectory(jobId), path.basename(fileName)));
}
