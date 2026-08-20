import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApprovedAdCopyMemory, ProductAdCopy } from "./types";

type Store = { version: 1; records: ProductAdCopy[] };
const storeFile = () => path.join(process.cwd(), ".data", "ad-copy", "records.json");
const lockKey = Symbol.for("daywiz.ad-copy.repository-lock");
const state = globalThis as typeof globalThis & { [lockKey]?: Promise<void> };

async function readStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(storeFile(), "utf8")) as Partial<Store>;
    return { version: 1, records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { version: 1, records: [] };
  }
}

async function writeStore(store: Store) {
  const file = storeFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function serial<T>(work: () => Promise<T>) {
  const previous = state[lockKey] || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  state[lockKey] = previous.then(() => current);
  await previous;
  try { return await work(); } finally { release(); }
}

export const adCopyRepository = {
  async save(record: ProductAdCopy) {
    return serial(async () => {
      const store = await readStore();
      store.records = [...store.records.filter((item) => item.id !== record.id && item.jobId !== record.jobId), record].slice(-500);
      await writeStore(store);
      return record;
    });
  },

  async getByJob(jobId: string) {
    return (await readStore()).records.find((item) => item.jobId === jobId);
  },

  async approvedForAdvertiser(advertiserId: string, limit = 12): Promise<ApprovedAdCopyMemory[]> {
    return (await readStore()).records
      .filter((item) => item.advertiserId === advertiserId && item.status === "approved" && item.primaryText)
      .sort((left, right) => new Date(right.approvedAt || right.updatedAt).getTime() - new Date(left.approvedAt || left.updatedAt).getTime())
      .slice(0, Math.max(1, Math.min(30, limit)));
  },

  async approve(jobId: string, input: { reason?: string; performanceData?: Record<string, number> } = {}) {
    return serial(async () => {
      const store = await readStore();
      const index = store.records.findIndex((item) => item.jobId === jobId);
      if (index < 0 || !store.records[index].primaryText) throw new Error("승인할 광고문구가 없습니다.");
      const now = new Date().toISOString();
      store.records[index] = {
        ...store.records[index],
        status: "approved",
        approvedAt: now,
        approvalReason: String(input.reason || "사용자가 Meta 기본 문구를 승인").trim().slice(0, 500),
        performanceData: input.performanceData,
        updatedAt: now,
      };
      await writeStore(store);
      return store.records[index];
    });
  },
};
