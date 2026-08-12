import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";

export type StorageObjectInfo = { key: string; size: number; updatedAt: string };

export interface BackgroundStorageAdapter {
  read(key: string): Promise<Buffer>;
  write(key: string, value: Buffer | string): Promise<void>;
  exists(key: string): Promise<boolean>;
  stat(key: string): Promise<StorageObjectInfo | null>;
  list(prefix: string): Promise<StorageObjectInfo[]>;
  createReadStream(key: string): Readable;
  resolveForLocalProcessing?(key: string): string;
}

export const backgroundStorageRoot = path.resolve(process.cwd(), "background-library");
const safeKeyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/;

export function normalizeStorageKey(key: string) {
  const raw = String(key || "");
  if (/^(?:\/|\\|[a-z]:[\\/])/i.test(raw)) throw new Error("절대 저장 경로는 사용할 수 없습니다.");
  const normalized = raw.replace(/\\/g, "/");
  if (!normalized || !safeKeyPattern.test(normalized)) throw new Error("안전하지 않은 저장 키입니다.");
  const resolved = path.resolve(backgroundStorageRoot, normalized);
  if (!resolved.startsWith(`${backgroundStorageRoot}${path.sep}`)) {
    throw new Error("저장소 경로를 벗어날 수 없습니다.");
  }
  return { key: normalized, resolved };
}

async function walk(directory: string, prefix: string, output: StorageObjectInfo[]) {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const key = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) await walk(fullPath, key, output);
    if (entry.isFile()) {
      const stats = await fs.stat(fullPath);
      output.push({ key, size: stats.size, updatedAt: stats.mtime.toISOString() });
    }
  }
}

export class LocalBackgroundStorage implements BackgroundStorageAdapter {
  async read(key: string) {
    return fs.readFile(normalizeStorageKey(key).resolved);
  }

  async write(key: string, value: Buffer | string) {
    const target = normalizeStorageKey(key).resolved;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, value);
    await fs.rename(temporary, target);
  }

  async exists(key: string) {
    try {
      return (await fs.stat(normalizeStorageKey(key).resolved)).isFile();
    } catch {
      return false;
    }
  }

  async stat(key: string) {
    try {
      const normalized = normalizeStorageKey(key);
      const stats = await fs.stat(normalized.resolved);
      return stats.isFile()
        ? { key: normalized.key, size: stats.size, updatedAt: stats.mtime.toISOString() }
        : null;
    } catch {
      return null;
    }
  }

  async list(prefix: string) {
    const normalizedPrefix = String(prefix || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!normalizedPrefix) throw new Error("목록 prefix가 필요합니다.");
    const directory = normalizeStorageKey(`${normalizedPrefix}/.keep`).resolved.replace(/\/\.keep$/, "");
    const output: StorageObjectInfo[] = [];
    await walk(directory, normalizedPrefix, output);
    return output.sort((a, b) => a.key.localeCompare(b.key));
  }

  createReadStream(key: string) {
    return createReadStream(normalizeStorageKey(key).resolved);
  }

  resolveForLocalProcessing(key: string) {
    return normalizeStorageKey(key).resolved;
  }
}

export const backgroundStorage: BackgroundStorageAdapter = new LocalBackgroundStorage();
