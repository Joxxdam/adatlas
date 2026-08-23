import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AutoProductionRun, AutoProductionRunStatus } from "./types";
import { normalizeAutoProductionTaskIds } from "./taskIdentity";

const runtimeDirectory = path.join(process.cwd(), "data", "auto-production", "runtime");
const runsDirectory = path.join(runtimeDirectory, "runs");
const indexFile = path.join(runtimeDirectory, "run-index.json");
const globalKey = Symbol.for("daywiz.auto-production.run-locks");
const state = globalThis as typeof globalThis & { [globalKey]?: Map<string, Promise<unknown>> };
const locks = state[globalKey] ?? new Map<string, Promise<unknown>>();
state[globalKey] = locks;

function safeRunId(value: string) {
  if (!/^auto-run-[a-z0-9-]{8,100}$/i.test(value)) throw new Error("올바르지 않은 자동 제작 실행 ID입니다.");
  return value;
}

function runFile(runId: string) {
  return path.join(runsDirectory, `${safeRunId(runId)}.json`);
}

async function atomicWrite(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

async function readIndex(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(indexFile, "utf8")) as Record<string, string>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function serialized<T>(key: string, work: () => Promise<T>) {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.then(work, work);
  locks.set(key, next.catch(() => undefined));
  try {
    return await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}

export const autoProductionRepository = {
  async createUnique(run: AutoProductionRun) {
    return serialized(`run-key:${run.runKey}`, async () => {
      const index = await readIndex();
      const existingId = index[run.runKey];
      if (existingId) return { run: await this.get(existingId), created: false };
      await atomicWrite(runFile(run.id), run);
      index[run.runKey] = run.id;
      await atomicWrite(indexFile, index);
      return { run, created: true };
    });
  },
  async get(runId: string): Promise<AutoProductionRun | null> {
    try {
      return normalizeAutoProductionTaskIds(
        JSON.parse(await fs.readFile(runFile(runId), "utf8")) as AutoProductionRun
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  async list(options: { limit?: number; statuses?: AutoProductionRunStatus[]; advertiserId?: string; businessDate?: string; dateFrom?: string; dateTo?: string } = {}) {
    try {
      const status = options.statuses?.length ? new Set(options.statuses) : null;
      const files = (await fs.readdir(runsDirectory)).filter((file) => /^auto-run-.*\.json$/i.test(file));
      const runs = await Promise.all(files.map(async (file) => {
        try {
          return normalizeAutoProductionTaskIds(
            JSON.parse(await fs.readFile(path.join(runsDirectory, file), "utf8")) as AutoProductionRun
          );
        } catch {
          return null;
        }
      }));
      return runs
        .filter((run): run is AutoProductionRun => Boolean(run))
        .filter((run) => !status || status.has(run.status))
        .filter((run) => !options.advertiserId || run.advertiserId === options.advertiserId)
        .filter((run) => !options.businessDate || run.businessDate === options.businessDate)
        .filter((run) => !options.dateFrom || run.businessDate >= options.dateFrom)
        .filter((run) => !options.dateTo || run.businessDate <= options.dateTo)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, Math.max(1, Math.min(200, options.limit || 40)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  },
  async update(runId: string, mutate: (run: AutoProductionRun) => AutoProductionRun | Promise<AutoProductionRun>) {
    return serialized(`run:${runId}`, async () => {
      const current = await this.get(runId);
      if (!current) throw new Error("자동 제작 실행 기록을 찾지 못했습니다.");
      const changed = { ...(await mutate(current)), updatedAt: new Date().toISOString() };
      await atomicWrite(runFile(runId), changed);
      return changed;
    });
  },
  async runKeysForDate(businessDate: string) {
    return new Set((await this.list({ businessDate, limit: 200 })).map((run) => run.runKey));
  },
  async completedImageCount(businessDate: string) {
    return (await this.list({ businessDate, limit: 200 })).reduce((sum, run) => sum + run.completedImages, 0);
  },
  async reservedImageCount(businessDate: string) {
    return (await this.list({ businessDate, limit: 200 }))
      .filter((run) => !["cancelled", "skipped"].includes(run.status))
      .reduce((sum, run) => sum + (run.automaticExpectedImages ?? run.expectedImages), 0);
  },
};
