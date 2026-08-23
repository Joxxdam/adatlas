import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../../lib/creative-generation/jobStore.server";
import { cancelQueuedGenerationJob, enqueueGenerationJob, isGenerationJobRunnerActive, recoverGenerationJob } from "../../../../lib/creative-generation/jobRunner.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../../lib/creative-generation/localGenerationAccess.server";
import { toGenerationJobSummary, toPublicGenerationError } from "../../../../lib/creative-generation/publicJob.server";
import { hasOrphanedRunningResult, isServerRunnableGenerationJob, normalizeCreativeProductUrl, resumeGenerationJob } from "../../../../lib/creative-generation/jobRunnerPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    const requestedProductUrl = normalizeCreativeProductUrl(new URL(request.url).searchParams.get("productUrl") || "");
    const candidates = (await creativeGenerationJobStore.active(requestedProductUrl ? 200 : 20)).filter((candidate) => {
      if (!requestedProductUrl) return true;
      return candidate.sourceType !== "auto-production" && normalizeCreativeProductUrl(candidate.productTruth.product.landingUrl) === requestedProductUrl;
    });
    const selectedCandidates = requestedProductUrl ? candidates.slice(0, 1) : candidates;
    if (requestedProductUrl && selectedCandidates[0]) {
      const superseded = await creativeGenerationJobStore.supersedeActiveForProduct(requestedProductUrl, selectedCandidates[0].id, "manual");
      superseded.forEach((previous) => cancelQueuedGenerationJob(previous.id));
    }
    const activeJobs = [];
    for (const candidate of selectedCandidates) {
      if (!isServerRunnableGenerationJob(candidate)) continue;
      let job = await recoverGenerationJob(candidate.id);
      if (!job || !["pending", "running"].includes(job.status)) continue;
      const runnerWasActive = isGenerationJobRunnerActive(job.id);
      if (hasOrphanedRunningResult(job, runnerWasActive)) {
        job = await creativeGenerationJobStore.update(job.id, (current) => resumeGenerationJob(current, false));
      }
      if (requestedProductUrl) enqueueGenerationJob(job.id, { priority: true });
      activeJobs.push(toGenerationJobSummary(job, isGenerationJobRunnerActive(job.id)));
    }
    return NextResponse.json({
      ok: true,
      activeJobs,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "활성 작업 조회 실패") }, { status: localAccessError(error) ? 403 : 500 });
  }
}
