import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";
import { creativeAssetRepository } from "../creative-assets/repository.server";
import { creativeGenerationJobStore } from "../creative-generation/jobStore.server";
import { deleteClosedCodexImageSessionsForResults } from "../creative-generation/codexImageSessionRetention.server";
import { buildCreativeArchiveEntries } from "./archive";
import { creativeArchiveMetadataRepository } from "./metadataRepository.server";
import type { CreativeArchiveEntry } from "./types";

const archiveIndexVersion = "creative-archive-index-v1";
const archiveDirectory = path.join(process.cwd(), ".data", "creative-archive");
const archiveIndexPath = path.join(archiveDirectory, "index.json");
const sourcePaths = [
  path.join(process.cwd(), ".data", "creative-generation", "jobs"),
  path.join(process.cwd(), "data", "creative-assets", "assets.json"),
  path.join(archiveDirectory, "metadata.json"),
];

type CreativeArchiveIndex = {
  version: typeof archiveIndexVersion;
  sourceSignature: string;
  generatedAt: string;
  entries: CreativeArchiveEntry[];
};

type CreativeArchiveCache = {
  sourceSignature?: string;
  entries?: CreativeArchiveEntry[];
  pending?: Promise<CreativeArchiveEntry[]>;
};

const cacheKey = Symbol.for("adatlas.creative-archive-index-cache-v1");
const archiveGlobal = globalThis as typeof globalThis & { [cacheKey]?: CreativeArchiveCache };
const archiveCache = archiveGlobal[cacheKey] || {};
archiveGlobal[cacheKey] = archiveCache;

async function sourceSignature() {
  const values = await Promise.all(
    sourcePaths.map(async (file) => {
      try {
        const info = await fs.stat(file);
        return `${file}:${info.mtimeMs}:${info.size}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return `${file}:missing`;
        throw error;
      }
    })
  );
  return values.join("|");
}

async function readStoredIndex(signature: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(archiveIndexPath, "utf8")) as Partial<CreativeArchiveIndex>;
    if (parsed.version !== archiveIndexVersion || parsed.sourceSignature !== signature || !Array.isArray(parsed.entries)) return null;
    return parsed.entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeStoredIndex(index: CreativeArchiveIndex) {
  await fs.mkdir(archiveDirectory, { recursive: true });
  const temporary = `${archiveIndexPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(index)}\n`, "utf8");
  await fs.rename(temporary, archiveIndexPath);
}

async function rebuildArchiveIndex(initialSignature: string) {
  let signature = initialSignature;
  let entries: CreativeArchiveEntry[] = [];
  // A generation result can finish while the archive is being indexed. Rebuild
  // once when that happens so a mixed snapshot is never kept as the fresh index.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [assets, jobs, metadata] = await Promise.all([
      creativeAssetRepository.list({ limit: 500 }),
      creativeGenerationJobStore.list({ limit: 500 }),
      creativeArchiveMetadataRepository.list(),
    ]);
    entries = buildCreativeArchiveEntries({ assets, jobs, metadata });
    const latestSignature = await sourceSignature();
    signature = latestSignature;
    if (latestSignature === initialSignature || attempt === 1) break;
    initialSignature = latestSignature;
  }
  await writeStoredIndex({
    version: archiveIndexVersion,
    sourceSignature: signature,
    generatedAt: new Date().toISOString(),
    entries,
  });
  archiveCache.sourceSignature = signature;
  archiveCache.entries = entries;
  return entries;
}

export async function listCreativeArchiveEntries() {
  const signature = await sourceSignature();
  if (archiveCache.sourceSignature === signature && archiveCache.entries) return archiveCache.entries;
  if (archiveCache.pending) return archiveCache.pending;

  const pending = (async () => {
    const stored = await readStoredIndex(signature);
    if (stored) {
      archiveCache.sourceSignature = signature;
      archiveCache.entries = stored;
      return stored;
    }
    return rebuildArchiveIndex(signature);
  })();
  archiveCache.pending = pending;
  try {
    return await pending;
  } finally {
    if (archiveCache.pending === pending) archiveCache.pending = undefined;
  }
}

export async function listCreativeArchivePage(input: { offset?: number; limit?: number } = {}) {
  const entries = await listCreativeArchiveEntries();
  const offset = Math.max(0, Math.floor(Number(input.offset) || 0));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(input.limit) || 48)));
  const pageEntries = entries.slice(offset, offset + limit);
  return {
    entries: pageEntries,
    total: entries.length,
    offset,
    limit,
    hasMore: offset + pageEntries.length < entries.length,
  };
}

export async function updateCreativeArchiveEntry(entryId: string, input: { savedAsReference?: boolean; tags?: string[]; note?: string }) {
  const exists = (await listCreativeArchiveEntries()).some((entry) => entry.id === entryId);
  if (!exists) throw new Error("아카이브에서 해당 이미지 콘텐츠를 찾지 못했습니다.");
  await creativeArchiveMetadataRepository.update(entryId, input);
  return (await listCreativeArchiveEntries()).find((entry) => entry.id === entryId) || null;
}

export async function deleteCreativeArchiveEntries(entryIds: string[]) {
  const requested = Array.from(new Set(entryIds.map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 500);
  if (!requested.length) throw new Error("삭제할 이미지 콘텐츠를 선택해 주세요.");
  const current = await listCreativeArchiveEntries();
  const available = new Set(current.map((entry) => entry.id));
  const deletedIds = requested.filter((id) => available.has(id));
  if (!deletedIds.length) throw new Error("삭제할 아카이브 이미지 콘텐츠를 찾지 못했습니다.");
  const deletedEntries = current.filter((entry) => deletedIds.includes(entry.id));
  await creativeArchiveMetadataRepository.hide(deletedIds);
  const sessionCleanup = await deleteClosedCodexImageSessionsForResults(
    deletedEntries.flatMap((entry) => (entry.jobId && entry.resultId ? [{ jobId: entry.jobId, resultId: entry.resultId }] : []))
  ).catch(() => ({ deletedCount: 0, reclaimedBytes: 0, skippedActiveCount: 0, errorCount: 1 }));
  return { deletedIds, sessionCleanup, entries: await listCreativeArchiveEntries() };
}
