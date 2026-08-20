import "server-only";
import { access, copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type AdvertiserThreadRecord = { advertiserId: string; advertiserName: string; domain: string; threadId?: string; turnCount?: number; updatedAt: string };
type Registry = { version: 1; advertisers: Record<string, AdvertiserThreadRecord> };
export type GoldenReference = {
  id: string;
  advertiserId: string;
  category: string;
  productId: string;
  imagePath: string;
  mainHook: string;
  subCopy: string;
  visualArchetype: string;
  approvedAt: string;
  approvalReason: string;
  performanceData?: Record<string, number>;
  reusableStyleTraits: string[];
};
export type AdvertiserBrandMemory = { advertiserId: string; approvedDirections: string[]; rejectedDirections: string[]; feedback: string[]; goldenReferences: GoldenReference[]; updatedAt: string };

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
  const memory = await safeJson<Partial<AdvertiserBrandMemory>>(memoryPath(advertiserId), {});
  return {
    advertiserId,
    approvedDirections: Array.isArray(memory.approvedDirections) ? memory.approvedDirections : [],
    rejectedDirections: Array.isArray(memory.rejectedDirections) ? memory.rejectedDirections : [],
    feedback: Array.isArray(memory.feedback) ? memory.feedback : [],
    goldenReferences: Array.isArray(memory.goldenReferences) ? memory.goldenReferences : [],
    updatedAt: memory.updatedAt || new Date(0).toISOString(),
  } satisfies AdvertiserBrandMemory;
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

export async function saveBrandMemory(advertiserId: string, value: Pick<AdvertiserBrandMemory, "approvedDirections" | "rejectedDirections" | "feedback"> & Partial<Pick<AdvertiserBrandMemory, "goldenReferences">>) {
  return serial(memoryPath(advertiserId), async () => {
    const clean = (items: string[], limit: number) => [...new Set(items.map((item) => item.trim().slice(0, 500)).filter(Boolean))].slice(-limit);
    const memory: AdvertiserBrandMemory = {
      advertiserId,
      approvedDirections: clean(value.approvedDirections, 30),
      rejectedDirections: clean(value.rejectedDirections, 30),
      feedback: clean(value.feedback, 50),
      goldenReferences: (value.goldenReferences || []).slice(-40),
      updatedAt: new Date().toISOString(),
    };
    await atomicJson(memoryPath(advertiserId), memory);
    return memory;
  });
}

function safeSegment(value: string) {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(value) || value === "." || value === "..") {
    throw new Error("올바르지 않은 광고주 또는 골든 레퍼런스 ID입니다.");
  }
  return value;
}

function goldenRoot(advertiserId: string) {
  return path.join(root(), "golden-references", safeSegment(advertiserId));
}

export async function saveGoldenReference(input: Omit<GoldenReference, "id" | "advertiserId" | "imagePath" | "approvedAt"> & { advertiserId: string; sourceImagePath: string }) {
  return serial(memoryPath(input.advertiserId), async () => {
    const source = path.resolve(input.sourceImagePath);
    const allowedRoot = path.resolve(process.cwd(), ".data", "generated", safeSegment(input.advertiserId));
    if (!source.startsWith(`${allowedRoot}${path.sep}`)) throw new Error("검증된 비공개 생성 결과만 골든 레퍼런스로 등록할 수 있습니다.");
    await access(source);
    const id = `golden-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const directory = goldenRoot(input.advertiserId);
    await mkdir(directory, { recursive: true });
    const imagePath = path.join(directory, `${id}.jpg`);
    await copyFile(source, imagePath);
    const reference: GoldenReference = {
      id,
      advertiserId: input.advertiserId,
      category: input.category.trim().slice(0, 80),
      productId: input.productId.trim().slice(0, 160),
      imagePath,
      mainHook: input.mainHook.trim().slice(0, 100),
      subCopy: input.subCopy.trim().slice(0, 180),
      visualArchetype: input.visualArchetype.trim().slice(0, 100),
      approvedAt: new Date().toISOString(),
      approvalReason: input.approvalReason.trim().slice(0, 500) || "사용자 골든 레퍼런스 등록",
      performanceData: input.performanceData,
      reusableStyleTraits: [...new Set(input.reusableStyleTraits.map((item) => item.trim()).filter(Boolean))].slice(0, 20),
    };
    const memory = await readBrandMemory(input.advertiserId);
    memory.goldenReferences = [...memory.goldenReferences.filter((item) => item.id !== reference.id), reference].slice(-40);
    memory.approvedDirections = [...new Set([...memory.approvedDirections, `${reference.visualArchetype}: ${reference.reusableStyleTraits.join(" · ")}`])].slice(-30);
    memory.updatedAt = reference.approvedAt;
    await atomicJson(memoryPath(input.advertiserId), memory);
    return reference;
  });
}

export function selectGoldenReferences(memory: AdvertiserBrandMemory, input: { category: string; productId: string; limit?: number }) {
  const score = (reference: GoldenReference) => {
    const performance = reference.performanceData ? Math.max(...Object.values(reference.performanceData), 0) : 0;
    return (reference.category === input.category ? 1000 : 0) + (reference.productId === input.productId ? 200 : 0) + Math.min(150, performance);
  };
  return [...memory.goldenReferences]
    .sort((left, right) => score(right) - score(left) || new Date(right.approvedAt).getTime() - new Date(left.approvedAt).getTime())
    .slice(0, Math.max(0, Math.min(3, input.limit || 2)));
}

export async function deleteBrandMemory(advertiserId: string) {
  return serial(memoryPath(advertiserId), async () => {
    try { await unlink(memoryPath(advertiserId)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
}
