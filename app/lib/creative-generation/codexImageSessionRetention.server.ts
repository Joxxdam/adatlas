import "server-only";
import { homedir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, rename, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";

const RETENTION_DAYS = 2;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DISK_SUMMARY_CACHE_MS = 5 * 60 * 1000;
const MAX_HISTORY_RECORDS = 5_000;
const THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const execFileAsync = promisify(execFile);

export type CodexImageSessionPurpose = "image-generation" | "group-validation";
type SessionState = "active" | "closed" | "deleted" | "missing" | "error";

type CodexImageSessionRecord = {
  threadId: string;
  jobId: string;
  resultId: string;
  purpose: CodexImageSessionPurpose;
  createdAt: string;
  lastUsedAt: string;
  closedAt?: string;
  state: SessionState;
  deletedAt?: string;
  bytes?: number;
  error?: string;
};

type CodexImageSessionRegistry = {
  version: 1;
  retentionDays: number;
  trackingStartedAt: string;
  sessions: Record<string, CodexImageSessionRecord>;
  lastCleanupAt?: string;
  lastCleanupError?: string;
  lastCleanupDeletedCount: number;
  lastCleanupReclaimedBytes: number;
  totalDeletedCount: number;
  totalReclaimedBytes: number;
};

export type CodexImageSessionRetentionStatus = {
  retentionDays: number;
  trackingStartedAt: string;
  trackedCount: number;
  activeCount: number;
  closedCount: number;
  dueCount: number;
  deletedCount: number;
  missingCount: number;
  errorCount: number;
  trackedDiskBytes: number;
  codexSessionFileCount: number;
  codexSessionDiskBytes: number;
  lastCleanupAt?: string;
  lastCleanupDeletedCount: number;
  lastCleanupReclaimedBytes: number;
  totalReclaimedBytes: number;
  lastCleanupError?: string;
  coverage: "tracked-after-installation";
};

type CleanupOptions = {
  now?: Date;
};

type SessionResultIdentity = {
  jobId: string;
  resultId: string;
};

type DiskSummary = {
  at: number;
  fileCount: number;
  bytes: number;
  filesByThreadId: Map<string, string>;
};

const registryFile = () => path.join(process.cwd(), ".data", "codex", "image-session-retention.json");
const codexSessionRoot = () => path.join(process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex"), "sessions");
const activeThreadIds = (() => {
  const key = Symbol.for("daywiz.codex-image-active-session-ids-v1");
  const holder = globalThis as typeof globalThis & { [key: symbol]: Set<string> | undefined };
  if (!holder[key]) holder[key] = new Set<string>();
  return holder[key];
})();
const schedulerState = (() => {
  const key = Symbol.for("daywiz.codex-image-session-cleanup-scheduler-v1");
  const holder = globalThis as typeof globalThis & { [key: symbol]: { started: boolean } | undefined };
  if (!holder[key]) holder[key] = { started: false };
  return holder[key];
})();

let registryQueue = Promise.resolve();
let diskSummaryCache: DiskSummary | undefined;

function emptyRegistry(now = new Date()): CodexImageSessionRegistry {
  return {
    version: 1,
    retentionDays: RETENTION_DAYS,
    trackingStartedAt: now.toISOString(),
    sessions: {},
    lastCleanupDeletedCount: 0,
    lastCleanupReclaimedBytes: 0,
    totalDeletedCount: 0,
    totalReclaimedBytes: 0,
  };
}

function validThreadId(threadId: string) {
  return THREAD_ID_PATTERN.test(threadId);
}

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function readRegistry(): Promise<CodexImageSessionRegistry> {
  try {
    const parsed = JSON.parse(await readFile(registryFile(), "utf8")) as Partial<CodexImageSessionRegistry>;
    if (parsed.version !== 1 || !parsed.sessions || typeof parsed.sessions !== "object") return emptyRegistry();
    return {
      ...emptyRegistry(),
      ...parsed,
      retentionDays: RETENTION_DAYS,
      sessions: parsed.sessions,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rename(registryFile(), `${registryFile()}.corrupt-${Date.now()}`).catch(() => undefined);
    }
    return emptyRegistry();
  }
}

async function serialRegistry<T>(task: () => Promise<T>): Promise<T> {
  const previous = registryQueue;
  let release!: () => void;
  registryQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function listSessionFiles(directory: string, output: string[]) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await listSessionFiles(file, output);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) output.push(file);
    })
  );
}

function threadIdFromSessionFile(file: string) {
  const match = path.basename(file).match(/-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1];
}

async function diskSummary(force = false): Promise<DiskSummary> {
  if (!force && diskSummaryCache && Date.now() - diskSummaryCache.at < DISK_SUMMARY_CACHE_MS) return diskSummaryCache;
  const files: string[] = [];
  await listSessionFiles(codexSessionRoot(), files);
  let bytes = 0;
  let fileCount = 0;
  const filesByThreadId = new Map<string, string>();
  await Promise.all(
    files.map(async (file) => {
      try {
        const info = await stat(file);
        if (!info.isFile()) return;
        bytes += info.size;
        fileCount += 1;
        const threadId = threadIdFromSessionFile(file);
        if (threadId) filesByThreadId.set(threadId, file);
      } catch {
        // A session can disappear between directory enumeration and stat.
      }
    })
  );
  diskSummaryCache = { at: Date.now(), fileCount, bytes, filesByThreadId };
  return diskSummaryCache;
}

async function exactSafeSessionFile(threadId: string, summary?: DiskSummary) {
  if (!validThreadId(threadId)) return undefined;
  const root = await realpath(codexSessionRoot()).catch(() => undefined);
  if (!root) return undefined;
  const candidate = (summary || (await diskSummary())).filesByThreadId.get(threadId);
  if (!candidate || !path.basename(candidate).endsWith(`-${threadId}.jsonl`)) return undefined;
  const info = await lstat(candidate).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink()) return undefined;
  const resolved = await realpath(candidate).catch(() => undefined);
  if (!resolved || !resolved.startsWith(`${root}${path.sep}`)) return undefined;
  return resolved;
}

function referenceTime(record: CodexImageSessionRecord) {
  return new Date(record.closedAt || record.lastUsedAt || record.createdAt).getTime();
}

function isDue(record: CodexImageSessionRecord, nowMs: number) {
  if (["deleted", "missing"].includes(record.state) || activeThreadIds.has(record.threadId)) return false;
  const timestamp = referenceTime(record);
  return Number.isFinite(timestamp) && nowMs - timestamp >= RETENTION_MS;
}

async function deleteTrackedSessionFile(record: CodexImageSessionRecord, summary: DiskSummary, now: Date) {
  const file = await exactSafeSessionFile(record.threadId, summary);
  if (!file) {
    return {
      record: { ...record, state: "missing" as const, deletedAt: now.toISOString(), error: undefined },
      deleted: false,
      reclaimedBytes: 0,
    };
  }
  const info = await stat(file);
  await execFileAsync(resolveCodexLocalExecutable() || "codex", ["delete", "--force", record.threadId], {
    cwd: process.cwd(),
    env: codexLocalEnvironment() as NodeJS.ProcessEnv,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  const remaining = await lstat(file).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : Promise.reject(error)));
  if (remaining) throw new Error("Codex 삭제 명령 뒤에도 세션 파일이 남아 있습니다.");
  summary.filesByThreadId.delete(record.threadId);
  summary.fileCount = Math.max(0, summary.fileCount - 1);
  summary.bytes = Math.max(0, summary.bytes - info.size);
  return {
    record: { ...record, state: "deleted" as const, bytes: info.size, deletedAt: now.toISOString(), error: undefined },
    deleted: true,
    reclaimedBytes: info.size,
  };
}

function compactHistory(registry: CodexImageSessionRegistry) {
  const records = Object.values(registry.sessions);
  if (records.length <= MAX_HISTORY_RECORDS) return;
  const keep = records
    .sort((left, right) => new Date(right.lastUsedAt).getTime() - new Date(left.lastUsedAt).getTime())
    .slice(0, MAX_HISTORY_RECORDS);
  registry.sessions = Object.fromEntries(keep.map((record) => [record.threadId, record]));
}

export async function trackCodexImageSession(input: { threadId?: string; jobId: string; resultId: string; purpose: CodexImageSessionPurpose }) {
  const threadId = input.threadId?.trim();
  if (!threadId || !validThreadId(threadId)) return;
  activeThreadIds.add(threadId);
  await serialRegistry(async () => {
    const registry = await readRegistry();
    const now = new Date().toISOString();
    const previous = registry.sessions[threadId];
    registry.sessions[threadId] = {
      threadId,
      jobId: input.jobId.slice(0, 180),
      resultId: input.resultId.slice(0, 180),
      purpose: input.purpose,
      createdAt: previous?.createdAt || now,
      lastUsedAt: now,
      state: "active",
    };
    compactHistory(registry);
    await atomicJson(registryFile(), registry);
  });
}

export async function closeCodexImageSession(threadId?: string) {
  const normalized = threadId?.trim();
  if (!normalized || !validThreadId(normalized)) return;
  activeThreadIds.delete(normalized);
  await serialRegistry(async () => {
    const registry = await readRegistry();
    const record = registry.sessions[normalized];
    if (!record) return;
    const now = new Date().toISOString();
    registry.sessions[normalized] = { ...record, lastUsedAt: now, closedAt: now, state: "closed", error: undefined };
    await atomicJson(registryFile(), registry);
  });
}

export async function cleanupExpiredCodexImageSessions(options: CleanupOptions = {}) {
  return serialRegistry(async () => {
    const registry = await readRegistry();
    const now = options.now || new Date();
    const nowMs = now.getTime();
    let deletedCount = 0;
    let reclaimedBytes = 0;
    let lastError = "";
    const summary = await diskSummary(true);

    for (const record of Object.values(registry.sessions)) {
      if (!isDue(record, nowMs)) continue;
      try {
        const deletion = await deleteTrackedSessionFile(record, summary, now);
        registry.sessions[record.threadId] = deletion.record;
        if (deletion.deleted) deletedCount += 1;
        reclaimedBytes += deletion.reclaimedBytes;
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 300) : "세션 파일 정리 실패";
        lastError = message;
        registry.sessions[record.threadId] = { ...record, state: "error", error: message };
      }
    }

    summary.at = Date.now();
    diskSummaryCache = summary;
    registry.lastCleanupAt = now.toISOString();
    registry.lastCleanupDeletedCount = deletedCount;
    registry.lastCleanupReclaimedBytes = reclaimedBytes;
    registry.totalDeletedCount += deletedCount;
    registry.totalReclaimedBytes += reclaimedBytes;
    registry.lastCleanupError = lastError || undefined;
    compactHistory(registry);
    await atomicJson(registryFile(), registry);
    return { deletedCount, reclaimedBytes, error: registry.lastCleanupError };
  });
}

export async function deleteClosedCodexImageSessionsForResults(identities: SessionResultIdentity[]) {
  const keys = new Set(
    identities
      .map(({ jobId, resultId }) => `${String(jobId || "").trim()}\u0000${String(resultId || "").trim()}`)
      .filter((key) => key !== "\u0000")
      .slice(0, 1_000)
  );
  if (!keys.size) return { deletedCount: 0, reclaimedBytes: 0, skippedActiveCount: 0, errorCount: 0 };

  return serialRegistry(async () => {
    const registry = await readRegistry();
    const summary = await diskSummary(true);
    const now = new Date();
    let deletedCount = 0;
    let reclaimedBytes = 0;
    let skippedActiveCount = 0;
    let errorCount = 0;

    for (const record of Object.values(registry.sessions)) {
      if (!keys.has(`${record.jobId}\u0000${record.resultId}`) || ["deleted", "missing"].includes(record.state)) continue;
      if (record.state === "active" || activeThreadIds.has(record.threadId)) {
        skippedActiveCount += 1;
        continue;
      }
      try {
        const deletion = await deleteTrackedSessionFile(record, summary, now);
        registry.sessions[record.threadId] = deletion.record;
        if (deletion.deleted) deletedCount += 1;
        reclaimedBytes += deletion.reclaimedBytes;
      } catch (error) {
        errorCount += 1;
        registry.sessions[record.threadId] = {
          ...record,
          state: "error",
          error: error instanceof Error ? error.message.slice(0, 300) : "세션 파일 정리 실패",
        };
      }
    }

    summary.at = Date.now();
    diskSummaryCache = summary;
    registry.totalDeletedCount += deletedCount;
    registry.totalReclaimedBytes += reclaimedBytes;
    compactHistory(registry);
    await atomicJson(registryFile(), registry);
    return { deletedCount, reclaimedBytes, skippedActiveCount, errorCount };
  });
}

export async function getCodexImageSessionRetentionStatus(): Promise<CodexImageSessionRetentionStatus> {
  const [registry, summary] = await Promise.all([readRegistry(), diskSummary()]);
  const nowMs = Date.now();
  const records = Object.values(registry.sessions);
  let trackedDiskBytes = 0;
  for (const record of records) {
    if (["deleted", "missing"].includes(record.state)) continue;
    const file = summary.filesByThreadId.get(record.threadId);
    if (file) trackedDiskBytes += (await stat(file).catch(() => undefined))?.size || 0;
  }
  return {
    retentionDays: RETENTION_DAYS,
    trackingStartedAt: registry.trackingStartedAt,
    trackedCount: records.filter((record) => !["deleted", "missing"].includes(record.state)).length,
    activeCount: records.filter((record) => record.state === "active" && activeThreadIds.has(record.threadId)).length,
    closedCount: records.filter((record) => record.state === "closed" || (record.state === "active" && !activeThreadIds.has(record.threadId))).length,
    dueCount: records.filter((record) => isDue(record, nowMs)).length,
    deletedCount: registry.totalDeletedCount,
    missingCount: records.filter((record) => record.state === "missing").length,
    errorCount: records.filter((record) => record.state === "error").length,
    trackedDiskBytes,
    codexSessionFileCount: summary.fileCount,
    codexSessionDiskBytes: summary.bytes,
    lastCleanupAt: registry.lastCleanupAt,
    lastCleanupDeletedCount: registry.lastCleanupDeletedCount,
    lastCleanupReclaimedBytes: registry.lastCleanupReclaimedBytes,
    totalReclaimedBytes: registry.totalReclaimedBytes,
    lastCleanupError: registry.lastCleanupError,
    coverage: "tracked-after-installation",
  };
}

export function ensureCodexImageSessionCleanupScheduler() {
  if (schedulerState.started) return;
  schedulerState.started = true;
  const initial = setTimeout(() => void cleanupExpiredCodexImageSessions().catch(() => undefined), 60_000);
  initial.unref?.();
  const interval = setInterval(() => void cleanupExpiredCodexImageSessions().catch(() => undefined), CLEANUP_INTERVAL_MS);
  interval.unref?.();
}
