import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../../lib/creative-generation/jobStore.server";
import { enqueueGenerationJob, isGenerationJobRunnerActive, recoverGenerationJob } from "../../../../lib/creative-generation/jobRunner.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../../lib/creative-generation/localGenerationAccess.server";
import { toPublicGenerationError, toPublicGenerationJob } from "../../../../lib/creative-generation/publicJob.server";
import { cancelGenerationJob, hasOrphanedRunningResult, isServerRunnableGenerationJob, resumeGenerationJob } from "../../../../lib/creative-generation/jobRunnerPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    verifyLocalGenerationAccess(request);
    const { jobId } = await context.params;
    let job = await recoverGenerationJob(jobId);
    if (!job) return NextResponse.json({ ok: false, error: "작업을 찾지 못했습니다." }, { status: 404 });
    const runnerWasActive = isGenerationJobRunnerActive(job.id);
    if (isServerRunnableGenerationJob(job) && ["pending", "running"].includes(job.status)) {
      if (hasOrphanedRunningResult(job, runnerWasActive)) {
        job = await creativeGenerationJobStore.update(job.id, (current) =>
          resumeGenerationJob(current, false)
        );
      }
      enqueueGenerationJob(job.id);
    }
    return NextResponse.json({ ok: true, job: toPublicGenerationJob(job), runnerActive: isGenerationJobRunnerActive(job.id) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "작업 조회 실패") }, { status: localAccessError(error) ? 403 : 400 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    verifyLocalGenerationAccess(request);
    const { jobId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { action?: "cancel" | "resume" };
    if (!body.action || !["cancel", "resume"].includes(body.action)) {
      return NextResponse.json({ ok: false, error: "cancel 또는 resume 액션이 필요합니다." }, { status: 400 });
    }
    const runnerWasActive = isGenerationJobRunnerActive(jobId);
    const job = await creativeGenerationJobStore.update(jobId, (current) => {
      if (body.action === "cancel") {
        return cancelGenerationJob(current);
      }
      return resumeGenerationJob(current, runnerWasActive);
    });
    if (body.action === "resume") enqueueGenerationJob(job.id);
    return NextResponse.json({ ok: true, job: toPublicGenerationJob(job), runnerActive: isGenerationJobRunnerActive(job.id) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "작업 상태 변경 실패") }, { status: localAccessError(error) ? 403 : 400 });
  }
}
