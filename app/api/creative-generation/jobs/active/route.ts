import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../../lib/creative-generation/jobStore.server";
import { enqueueGenerationJob, isGenerationJobRunnerActive, recoverGenerationJob } from "../../../../lib/creative-generation/jobRunner.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../../lib/creative-generation/localGenerationAccess.server";
import { toGenerationJobSummary, toPublicGenerationError } from "../../../../lib/creative-generation/publicJob.server";
import { isServerRunnableGenerationJob } from "../../../../lib/creative-generation/jobRunnerPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    const candidates = await creativeGenerationJobStore.active(20);
    const activeJobs = [];
    for (const candidate of candidates) {
      if (!isServerRunnableGenerationJob(candidate)) continue;
      const job = await recoverGenerationJob(candidate.id);
      if (!job || !["pending", "running"].includes(job.status)) continue;
      const orphanedRunning = job.results.some((result) => result.status === "running") && !isGenerationJobRunnerActive(job.id);
      if (!orphanedRunning) enqueueGenerationJob(job.id);
      activeJobs.push(toGenerationJobSummary(job, isGenerationJobRunnerActive(job.id)));
    }
    return NextResponse.json({
      ok: true,
      activeJobs,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: toPublicGenerationError(error, "활성 작업 조회 실패") },
      { status: localAccessError(error) ? 403 : 500 }
    );
  }
}
