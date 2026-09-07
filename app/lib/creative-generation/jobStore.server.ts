import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { GenerationJob, GenerationJobStatus } from "./types";
import { cancelGenerationJob, executionResults, normalizeCreativeProductUrl } from "./jobRunnerPolicy";
import { runtimeDataPath } from "../runtimeStorage.ts";

const jobsDirectory = runtimeDataPath("creative-generation", "jobs");
const globalKey = Symbol.for("daywiz.creative-generation.job-store-locks");
const activeIndexKey = Symbol.for("daywiz.creative-generation.active-job-index-v1");
const globalState = globalThis as typeof globalThis & {
  [globalKey]?: Map<string, Promise<unknown>>;
  [activeIndexKey]?: {
    checkedAt: number;
    jobs: GenerationJob[];
    pending?: Promise<GenerationJob[]>;
  };
};
const jobLocks = globalState[globalKey] ?? new Map<string, Promise<unknown>>();
globalState[globalKey] = jobLocks;
const activeIndex = globalState[activeIndexKey] ?? { checkedAt: 0, jobs: [] };
globalState[activeIndexKey] = activeIndex;

const ACTIVE_INDEX_TTL_MS = 1_000;
const ACTIVE_JOB_STATUSES = new Set<GenerationJobStatus>(["pending", "running"]);

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
  // 다음 상태 조회가 종료된 작업을 계속 반환하거나 새 작업을 놓치지 않게
  // 쓰기 직후 경량 active index만 무효화합니다.
  activeIndex.checkedAt = 0;
  return job;
}

const successfulStatuses = new Set(["success", "approved"]);
const terminalStatuses = new Set(["success", "failed", "cancelled", "korean-review", "product-review", "quality-review", "group-review", "approved", "excluded"]);

export function summarizeGenerationJobStatus(job: GenerationJob): GenerationJob {
  if (job.status === "cancelled") return job;
  const results = executionResults(job);
  const statuses = results.map((result) => result.status);
  const successCount = statuses.filter((status) => successfulStatuses.has(status)).length;
  const renderedCount = results.filter((result) => Boolean(result.imagePath || result.nativeCreative?.finalPath)).length;
  const running = statuses.some((status) => status === "running");
  const pending = statuses.some((status) => status === "pending");
  const allTerminal = statuses.length > 0 && statuses.every((status) => terminalStatuses.has(status));
  let status: GenerationJobStatus = job.status;

  if (successCount === statuses.length && statuses.length > 0) status = "completed";
  else if (running) status = "running";
  else if (pending) status = job.startedAt ? "running" : "pending";
  else if (allTerminal && (successCount > 0 || renderedCount > 0)) status = "partial";
  else if (allTerminal) status = "failed";

  const finished = status === "completed" || status === "failed" || status === "partial";
  const completedAt = finished ? job.completedAt || new Date().toISOString() : undefined;
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

async function listJobFiles() {
  try {
    return (await fs.readdir(jobsDirectory)).filter((name) => /^creative-job-[a-z0-9-]{8,96}\.json$/i.test(name)).map((name) => path.join(jobsDirectory, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function fileHasActiveTopLevelStatus(file: string) {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(file, "r");
    // JSON은 id/status로 시작해 저장됩니다. 전체 15MB 파일을 읽지 않고 헤더만
    // 확인하므로 전역 상태 표시의 2.5초 polling이 작업 이력 전체를 재파싱하지
    // 않습니다.
    const buffer = Buffer.allocUnsafe(2_048);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.toString("utf8", 0, bytesRead);
    const status = header.match(/^\s*\{[\s\S]{0,1024}?"status"\s*:\s*"([^"]+)"/u)?.[1] as GenerationJobStatus | undefined;
    return Boolean(status && ACTIVE_JOB_STATUSES.has(status));
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function readActiveJobsFromDisk() {
  const files = await listJobFiles();
  const activeFiles: string[] = [];
  // 한 번에 수백 개의 파일 핸들을 열지 않으면서도 헤더 확인은 병렬화합니다.
  for (let index = 0; index < files.length; index += 32) {
    const chunk = files.slice(index, index + 32);
    const matches = await Promise.all(chunk.map(fileHasActiveTopLevelStatus));
    chunk.forEach((file, chunkIndex) => {
      if (matches[chunkIndex]) activeFiles.push(file);
    });
  }
  const jobs = await Promise.all(activeFiles.map(async (file) => {
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as GenerationJob;
    } catch {
      return null;
    }
  }));
  return jobs
    .filter((job): job is GenerationJob => Boolean(job && ACTIVE_JOB_STATUSES.has(job.status)))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

async function cachedActiveJobs() {
  if (Date.now() - activeIndex.checkedAt < ACTIVE_INDEX_TTL_MS) return activeIndex.jobs;
  if (activeIndex.pending) return activeIndex.pending;
  const pending = readActiveJobsFromDisk();
  activeIndex.pending = pending;
  try {
    const jobs = await pending;
    activeIndex.jobs = jobs;
    activeIndex.checkedAt = Date.now();
    return jobs;
  } finally {
    if (activeIndex.pending === pending) activeIndex.pending = undefined;
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

  async list(
    options: {
      limit?: number;
      statuses?: GenerationJobStatus[];
      advertiserId?: string;
      productId?: string;
    } = {}
  ): Promise<GenerationJob[]> {
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
      .slice(0, Math.max(1, Math.min(500, options.limit || 20)));
  },

  async active(limit = 20) {
    return (await cachedActiveJobs()).slice(0, Math.max(1, Math.min(500, limit)));
  },

  async recentFor(input: { advertiserId?: string; productId?: string; limit?: number }) {
    return this.list(input);
  },

  async supersedeActiveForProduct(
    productUrl: string,
    exceptJobId?: string,
    sourceType?: GenerationJob["sourceType"],
    requesterSubject?: string | null
  ) {
    const normalizedUrl = normalizeCreativeProductUrl(productUrl);
    if (!normalizedUrl) return [] as GenerationJob[];
    const candidates = (await this.active(200)).filter(
      (job) =>
        job.id !== exceptJobId
        && (!sourceType || job.sourceType === sourceType)
        && (
          requesterSubject === undefined
          || (requesterSubject === null ? !job.requestedBy : job.requestedBy?.subject === requesterSubject)
        )
        && normalizeCreativeProductUrl(job.productTruth.product.landingUrl) === normalizedUrl
    );
    return Promise.all(
      candidates.map((candidate) =>
        this.update(candidate.id, (current) => {
          const cancelled = cancelGenerationJob(current);
          return {
            ...cancelled,
            recoveryLog: [
              ...(cancelled.recoveryLog || []),
              {
                at: new Date().toISOString(),
                message: "같은 상품의 새 후킹 광고 작업으로 교체",
                resultIds: cancelled.results.filter((result) => result.status === "cancelled").map((result) => result.id),
              },
            ].slice(-20),
          };
        })
      )
    );
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
    jobLocks.set(
      jobId,
      next.catch(() => undefined)
    );
    return next;
  },
};
