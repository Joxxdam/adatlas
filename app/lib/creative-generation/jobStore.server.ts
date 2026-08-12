import { promises as fs } from "node:fs";
import path from "node:path";
import type { GenerationJob } from "./types";

const jobsDirectory = path.join(process.cwd(), "data", "creative-generation-jobs");
const jobLocks = new Map<string, Promise<unknown>>();

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

function summarizeJobStatus(job: GenerationJob): GenerationJob {
  if (job.status === "cancelled") return job;
  const statuses = job.results.map((result) => result.status);
  const successCount = statuses.filter((status) => status === "success").length;
  const failedCount = statuses.filter((status) => status === "failed").length;
  const running = statuses.some((status) => status === "running");
  const pending = statuses.some((status) => status === "pending");
  let status = job.status;
  if (successCount === statuses.length) status = "completed";
  else if (running) status = "running";
  else if (successCount > 0) status = "partial";
  else if (failedCount === statuses.length) status = "failed";
  else if (pending) status = job.startedAt ? "running" : "pending";
  const completedAt = ["completed", "failed"].includes(status)
    ? job.completedAt || new Date().toISOString()
    : undefined;
  return {
    ...job,
    status,
    completedAt,
    timing: {
      ...job.timing,
      totalMs: completedAt ? new Date(completedAt).getTime() - new Date(job.createdAt).getTime() : undefined,
    },
  };
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

  async update(jobId: string, mutate: (job: GenerationJob) => GenerationJob | Promise<GenerationJob>) {
    const previous = jobLocks.get(jobId) || Promise.resolve();
    const next = previous.then(async () => {
      const current = await this.get(jobId);
      if (!current) throw new Error("광고 생성 작업을 찾지 못했습니다.");
      const changed = summarizeJobStatus({
        ...(await mutate(current)),
        updatedAt: new Date().toISOString(),
      });
      return writeJobFile(changed);
    });
    jobLocks.set(jobId, next.catch(() => undefined));
    return next;
  },
};
