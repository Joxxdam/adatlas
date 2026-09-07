import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../../lib/creative-generation/jobStore.server";
import { cancelQueuedGenerationJob, enqueueGenerationJob, getManualGenerationQueueSnapshot, isGenerationJobRunnerActive, recoverGenerationJob, recoverPersistedGenerationJobs } from "../../../../lib/creative-generation/jobRunner.server";
import { canAccessGenerationJob, localAccessError, localAccessErrorStatus, verifyLocalGenerationAccess } from "../../../../lib/creative-generation/localGenerationAccess.server";
import { toGenerationJobSummary, toPublicGenerationError } from "../../../../lib/creative-generation/publicJob.server";
import { hasOrphanedRunningResult, isServerRunnableGenerationJob, normalizeCreativeProductUrl, resumeGenerationJob } from "../../../../lib/creative-generation/jobRunnerPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await verifyLocalGenerationAccess(request);
    // 개별 사용자가 자신의 제작 화면을 먼저 열었다는 이유로 앞 순서를
    // 추월하지 않도록, 저장된 전체 작업을 접수 순서대로 먼저 복원합니다.
    await recoverPersistedGenerationJobs(200);
    const requestedProductUrl = normalizeCreativeProductUrl(new URL(request.url).searchParams.get("productUrl") || "");
    const candidates = (await creativeGenerationJobStore.active(requestedProductUrl || principal.kind === "cloudflare-access" ? 200 : 20)).filter((candidate) => {
      // 과거 단계형 작업은 조회·다운로드용으로만 남긴다. 먼저 실행 가능한
      // 기본 Codex 작업만 거른 뒤 최신 작업을 선택해야 구버전 작업이 새 작업을
      // 가리거나 같은 상품의 현재 작업을 잘못 취소하지 않는다.
      if (!isServerRunnableGenerationJob(candidate)) return false;
      if (!requestedProductUrl) return true;
      return candidate.sourceType !== "auto-production" && normalizeCreativeProductUrl(candidate.productTruth.product.landingUrl) === requestedProductUrl;
    });
    const visibleCandidates = candidates.filter((candidate) => canAccessGenerationJob(principal, candidate));
    const selectedCandidates = requestedProductUrl ? visibleCandidates.slice(0, 1) : visibleCandidates;
    if (requestedProductUrl && selectedCandidates[0]) {
      const superseded = await creativeGenerationJobStore.supersedeActiveForProduct(
        requestedProductUrl,
        selectedCandidates[0].id,
        "manual",
        principal.kind === "cloudflare-access" ? principal.subject : null
      );
      superseded.forEach((previous) => cancelQueuedGenerationJob(previous.id));
    }
    const preparedJobs = [];
    for (const candidate of selectedCandidates) {
      let job = await recoverGenerationJob(candidate.id);
      if (!job || !["pending", "running"].includes(job.status)) continue;
      const runnerWasActive = isGenerationJobRunnerActive(job.id);
      if (hasOrphanedRunningResult(job, runnerWasActive)) {
        job = await creativeGenerationJobStore.update(job.id, (current) => resumeGenerationJob(current, false));
      }
      // 이 상태 API는 전체 화면의 백그라운드 알림이 주기적으로 호출한다.
      // 개발 서버 HMR로 인메모리 러너만 교체된 경우, 영상기획 등 다른
      // 화면에 있어도 영속 작업을 새 러너에 자동 재등록한다.
      if (!isGenerationJobRunnerActive(job.id)) {
        enqueueGenerationJob(job.id, { priority: job.sourceType !== "auto-production" });
      }
      preparedJobs.push(job);
    }
    const queue = await getManualGenerationQueueSnapshot();
    const activeJobs = preparedJobs
      .map((job) => toGenerationJobSummary(job, isGenerationJobRunnerActive(job.id), queue.byJobId[job.id]))
      .sort((left, right) => {
        const leftOrder = left.manualQueue ? left.manualQueue.aheadCount : Number.MAX_SAFE_INTEGER;
        const rightOrder = right.manualQueue ? right.manualQueue.aheadCount : Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
      });
    return NextResponse.json({
      ok: true,
      activeJobs,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "활성 작업 조회 실패") }, { status: localAccessErrorStatus(error) || (localAccessError(error) ? 403 : 500) });
  }
}
