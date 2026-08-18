import "server-only";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type AdvertiserThreadRecord = { advertiserId: string; advertiserName: string; domain: string; threadId?: string; turnCount?: number; updatedAt: string };
type Registry = { version: 1; advertisers: Record<string, AdvertiserThreadRecord> };
export type AdvertiserBrandMemory = { advertiserId: string; approvedDirections: string[]; rejectedDirections: string[]; feedback: string[]; updatedAt: string };

const locks = new Map<string, Promise<void>>();
const root = () => path.join(process.cwd(), ".data", "codex");
const registryPath = () => path.join(root(), "advertisers.json");

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function safeJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      try { await rename(file, `${file}.corrupt-${Date.now()}`); } catch {}
    }
    return fallback;
  }
}

async function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  locks.set(key, queued);
  await previous;
  try { return await task(); } finally { release(); if (locks.get(key) === queued) locks.delete(key); }
}

export async function getAdvertiserThread(advertiserId: string) {
  const data = await safeJson<Registry>(registryPath(), { version: 1, advertisers: {} });
  return data.advertisers[advertiserId];
}

export async function saveAdvertiserThread(record: Omit<AdvertiserThreadRecord, "updatedAt">) {
  return serial(registryPath(), async () => {
    const data = await safeJson<Registry>(registryPath(), { version: 1, advertisers: {} });
    const saved = { ...record, updatedAt: new Date().toISOString() };
    data.advertisers[record.advertiserId] = saved;
    await atomicJson(registryPath(), data);
    return saved;
  });
}

export async function resetAdvertiserThread(advertiserId: string) {
  const current = await getAdvertiserThread(advertiserId);
  if (!current) return undefined;
  return saveAdvertiserThread({ ...current, threadId: undefined });
}

function memoryPath(id: string) { return path.join(root(), "brands", `${id}.json`); }
export async function readBrandMemory(advertiserId: string) {
  return safeJson<AdvertiserBrandMemory>(memoryPath(advertiserId), { advertiserId, approvedDirections: [], rejectedDirections: [], feedback: [], updatedAt: new Date(0).toISOString() });
}
export async function updateBrandMemory(advertiserId: string, change: { kind: "approve" | "reject" | "feedback"; value: string }) {
  return serial(memoryPath(advertiserId), async () => {
    const memory = await readBrandMemory(advertiserId);
    const value = change.value.trim().slice(0, 500);
    if (change.kind === "approve" && value) memory.approvedDirections = [...new Set([...memory.approvedDirections, value])].slice(-30);
    if (change.kind === "reject" && value) memory.rejectedDirections = [...new Set([...memory.rejectedDirections, value])].slice(-30);
    if (change.kind === "feedback" && value) memory.feedback = [...memory.feedback, value].slice(-50);
    memory.updatedAt = new Date().toISOString();
    await atomicJson(memoryPath(advertiserId), memory);
    return memory;
  });
}

export async function saveBrandMemory(advertiserId: string, value: Pick<AdvertiserBrandMemory, "approvedDirections" | "rejectedDirections" | "feedback">) {
  return serial(memoryPath(advertiserId), async () => {
    const clean = (items: string[], limit: number) => [...new Set(items.map((item) => item.trim().slice(0, 500)).filter(Boolean))].slice(-limit);
    const memory: AdvertiserBrandMemory = {
      advertiserId,
      approvedDirections: clean(value.approvedDirections, 30),
      rejectedDirections: clean(value.rejectedDirections, 30),
      feedback: clean(value.feedback, 50),
      updatedAt: new Date().toISOString(),
    };
    await atomicJson(memoryPath(advertiserId), memory);
    return memory;
  });
}

export async function deleteBrandMemory(advertiserId: string) {
  return serial(memoryPath(advertiserId), async () => {
    try { await unlink(memoryPath(advertiserId)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
}
