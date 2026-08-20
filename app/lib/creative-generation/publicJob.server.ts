import "server-only";
import type { GenerationJob, GenerationJobSummary } from "./types";
import { executionResults } from "./jobRunnerPolicy";

const localPathPattern = /(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s"']+/g;
const secretPattern = /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/gi;

export function toPublicGenerationError(error: unknown, fallback: string) {
  return (error instanceof Error ? error.message : fallback)
    .replace(localPathPattern, "로컬 파일")
    .replace(secretPattern, "[비공개 인증정보]")
    .slice(0, 600);
}

export function toPublicGenerationJob(job: GenerationJob): GenerationJob {
  const publicJob = {
    ...job,
    codexThreadId: undefined,
    results: job.results.map((result) => ({
      ...result,
      nativeCreative: result.nativeCreative
        ? {
            ...result.nativeCreative,
            originalPath: undefined,
            revisionPaths: [],
            finalPath: undefined,
          }
        : undefined,
    })),
  };
  const serialized = JSON.stringify(publicJob).replace(localPathPattern, "로컬 파일").replace(secretPattern, "[비공개 인증정보]");
  return JSON.parse(serialized) as GenerationJob;
}

export function toGenerationJobSummary(job: GenerationJob, runnerActive: boolean): GenerationJobSummary {
  const publicJob = toPublicGenerationJob(job);
  const scopedResults = executionResults(publicJob);
  const completedStatuses = new Set(["success", "failed", "korean-review", "product-review", "approved", "excluded"]);
  const failedStatuses = new Set(["failed", "korean-review", "product-review"]);
  return {
    jobId: job.id,
    advertiserId: job.advertiserId,
    advertiserName: job.advertiserName,
    productId: job.productTruth.productId,
    productName: job.productTruth.product.productName,
    productUrl: job.productTruth.product.landingUrl,
    totalCount: scopedResults.length,
    completedCount: scopedResults.filter((result) => completedStatuses.has(result.status)).length,
    successCount: scopedResults.filter((result) => result.status === "success" || result.status === "approved").length,
    failedCount: scopedResults.filter((result) => failedStatuses.has(result.status)).length,
    currentHookCode: scopedResults.find((result) => result.status === "running")?.hookPlan.hookCode,
    status: job.status,
    runnerActive,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    completedResults: scopedResults.filter((result) => completedStatuses.has(result.status)),
    failedResults: scopedResults.filter((result) => failedStatuses.has(result.status)),
  };
}
