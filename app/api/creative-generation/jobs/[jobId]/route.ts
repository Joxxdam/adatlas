import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../../lib/creative-generation/jobStore.server";
import { activeDirectGenerationResultIds, cancelQueuedGenerationJob, enqueueGenerationJob, getManualGenerationQueueSnapshot, isGenerationJobRunnerActive, recoverGenerationJob } from "../../../../lib/creative-generation/jobRunner.server";
import { assertGenerationJobAccess, localAccessError, localAccessErrorStatus, verifyLocalGenerationAccess } from "../../../../lib/creative-generation/localGenerationAccess.server";
import { toGenerationJobSummary, toPublicGenerationError, toPublicGenerationJob } from "../../../../lib/creative-generation/publicJob.server";
import { cancelGenerationJob, hasOrphanedRunningResult, isServerRunnableGenerationJob, resumeGenerationJob } from "../../../../lib/creative-generation/jobRunnerPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const principal = await verifyLocalGenerationAccess(request);
    const { jobId } = await context.params;
    let job = await recoverGenerationJob(jobId);
    if (!job) return NextResponse.json({ ok: false, error: "작업을 찾지 못했습니다." }, { status: 404 });
    assertGenerationJobAccess(principal, job);
    const runnerWasActive = isGenerationJobRunnerActive(job.id);
    if (isServerRunnableGenerationJob(job) && ["pending", "running"].includes(job.status)) {
      const activeDirectResultIds = activeDirectGenerationResultIds(job.id);
      if (hasOrphanedRunningResult(job, runnerWasActive, activeDirectResultIds)) {
        job = await creativeGenerationJobStore.update(job.id, (current) =>
          resumeGenerationJob(current, false, new Date().toISOString(), false, activeDirectResultIds)
        );
      }
      enqueueGenerationJob(job.id, { priority: job.sourceType !== "auto-production" });
    }
    const runnerActive = isGenerationJobRunnerActive(job.id);
    const manualQueue = job.sourceType === "auto-production" ? undefined : (await getManualGenerationQueueSnapshot()).byJobId[job.id];
    if (new URL(request.url).searchParams.get("summary") === "1") {
      return NextResponse.json({
        ok: true,
        summary: toGenerationJobSummary(job, runnerActive, manualQueue),
      });
    }
    return NextResponse.json({ ok: true, job: toPublicGenerationJob(job), runnerActive, manualQueue });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "작업 조회 실패") }, { status: localAccessErrorStatus(error) || (localAccessError(error) ? 403 : 400) });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const principal = await verifyLocalGenerationAccess(request);
    const { jobId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { action?: "cancel" | "resume" };
    if (!body.action || !["cancel", "resume"].includes(body.action)) {
      return NextResponse.json({ ok: false, error: "cancel 또는 resume 액션이 필요합니다." }, { status: 400 });
    }
    const existing = await creativeGenerationJobStore.get(jobId);
    if (!existing) return NextResponse.json({ ok: false, error: "작업을 찾지 못했습니다." }, { status: 404 });
    assertGenerationJobAccess(principal, existing);
    if (body.action === "resume" && !isServerRunnableGenerationJob(existing)) {
      return NextResponse.json(
        { ok: false, error: "구버전 작업은 조회·다운로드만 가능합니다. 현재 상품을 다시 분석해 최신 제작 작업으로 시작해 주세요." },
        { status: 409 }
      );
    }
    const runnerWasActive = isGenerationJobRunnerActive(jobId);
    const job = await creativeGenerationJobStore.update(jobId, (current) => {
      if (body.action === "cancel") {
        return cancelGenerationJob(current);
      }
      return resumeGenerationJob(current, runnerWasActive, new Date().toISOString(), true);
    });
    if (body.action === "cancel") cancelQueuedGenerationJob(job.id);
    if (body.action === "resume") enqueueGenerationJob(job.id, { priority: job.sourceType !== "auto-production" });
    const manualQueue = job.sourceType === "auto-production" ? undefined : (await getManualGenerationQueueSnapshot()).byJobId[job.id];
    return NextResponse.json({
      ok: true,
      job: toPublicGenerationJob(job),
      runnerActive: isGenerationJobRunnerActive(job.id),
      manualQueue,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "작업 상태 변경 실패") }, { status: localAccessErrorStatus(error) || (localAccessError(error) ? 403 : 400) });
  }
}
