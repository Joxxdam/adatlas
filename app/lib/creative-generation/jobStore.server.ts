import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GenerationJob, GenerationJobStatus } from "./types";
import { executionResults } from "./jobRunnerPolicy";

const jobsDirectory = path.join(process.cwd(), ".data", "creative-generation", "jobs");
const globalKey = Symbol.for("daywiz.creative-generation.job-store-locks");
const globalState = globalThis as typeof globalThis & {
  [globalKey]?: Map<string, Promise<unknown>>;
};
const jobLocks = globalState[globalKey] ?? new Map<string, Promise<unknown>>();
globalState[globalKey] = jobLocks;

function validJobId(jobId: string) {
  return /^creative-job-[a-z0-9-]{8,96}$/i.test(jobId);
}

function jobFile(jobId: string) {
  if (!validJobId(jobId)) throw new Error("올바르지 않은 광고 생성 작업 ID입니다.");
  return path.join(jobsDirectory, `${jobId}.json`);
}

async function writeJobFile(job: GenerationJob) {
  await fs.mkdir(jobsDirectory, { recursive: true });
  const target = jobFile(job.id);
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
  return job;
}

const successfulStatuses = new Set(["success", "approved"]);
const terminalStatuses = new Set([
  "success",
  "failed",
  "cancelled",
  "korean-review",
  "product-review",
  "quality-review",
  "group-review",
  "approved",
  "excluded",
]);

export function summarizeGenerationJobStatus(job: GenerationJob): GenerationJob {
  if (job.status === "cancelled") return job;
  const statuses = executionResults(job).map((result) => result.status);
  const successCount = statuses.filter((status) => successfulStatuses.has(status)).length;
  const running = statuses.some((status) => status === "running");
  const pending = statuses.some((status) => status === "pending");
  const allTerminal = statuses.length > 0 && statuses.every((status) => terminalStatuses.has(status));
  let status: GenerationJobStatus = job.status;

  if (successCount === statuses.length && statuses.length > 0) status = "completed";
  else if (running) status = "running";
  else if (pending) status = job.startedAt ? "running" : "pending";
  else if (allTerminal && successCount > 0) status = "partial";
  else if (allTerminal) status = "failed";

  const finished = status === "completed" || status === "failed" || status === "partial";
  const completedAt = finished ? job.completedAt || new Date().toISOString() : undefined;
  return {
    ...job,
    status,
    completedAt,
    timing: {
      ...job.timing,
      totalMs: completedAt
        ? new Date(completedAt).getTime() - new Date(job.createdAt).getTime()
        : undefined,
    },
  };
}

async function listJobFiles() {
  try {
    return (await fs.readdir(jobsDirectory))
      .filter((name) => /^creative-job-[a-z0-9-]{8,96}\.json$/i.test(name))
      .map((name) => path.join(jobsDirectory, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export const creativeGenerationJobStore = {
  async create(job: GenerationJob) {
    return writeJobFile(job);
  },

  async get(jobId: string): Promise<GenerationJob | null> {
    try {
      return JSON.parse(await fs.readFile(jobFile(jobId), "utf8")) as GenerationJob;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },

  async list(options: {
    limit?: number;
    statuses?: GenerationJobStatus[];
    advertiserId?: string;
    productId?: string;
  } = {}): Promise<GenerationJob[]> {
    const statusSet = options.statuses?.length ? new Set(options.statuses) : null;
    const jobs = await Promise.all(
      (await listJobFiles()).map(async (file) => {
        try {
          return JSON.parse(await fs.readFile(file, "utf8")) as GenerationJob;
        } catch {
          return null;
        }
      })
    );
    return jobs
      .filter((job): job is GenerationJob => Boolean(job))
      .filter((job) => !statusSet || statusSet.has(job.status))
      .filter((job) => !options.advertiserId || job.advertiserId === options.advertiserId)
      .filter((job) => !options.productId || job.productTruth.productId === options.productId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, Math.max(1, Math.min(100, options.limit || 20)));
  },

  async active(limit = 20) {
    return this.list({ statuses: ["pending", "running"], limit });
  },

  async recentFor(input: { advertiserId?: string; productId?: string; limit?: number }) {
    return this.list(input);
  },

  async update(jobId: string, mutate: (job: GenerationJob) => GenerationJob | Promise<GenerationJob>) {
    const previous = jobLocks.get(jobId) || Promise.resolve();
    const next = previous.then(async () => {
      const current = await this.get(jobId);
      if (!current) throw new Error("광고 생성 작업을 찾지 못했습니다.");
      const changed = summarizeGenerationJobStatus({
        ...(await mutate(current)),
        updatedAt: new Date().toISOString(),
      });
      return writeJobFile(changed);
    });
    jobLocks.set(jobId, next.catch(() => undefined));
    return next;
  },
};
