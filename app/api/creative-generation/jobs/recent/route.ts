import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../../lib/creative-generation/jobStore.server";
import { isGenerationJobRunnerActive } from "../../../../lib/creative-generation/jobRunner.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../../lib/creative-generation/localGenerationAccess.server";
import { toGenerationJobSummary, toPublicGenerationError } from "../../../../lib/creative-generation/publicJob.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    const url = new URL(request.url);
    const advertiserId = url.searchParams.get("advertiserId") || undefined;
    const productId = url.searchParams.get("productId") || undefined;
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 10)));
    const jobs = await creativeGenerationJobStore.recentFor({ advertiserId, productId, limit });
    return NextResponse.json({
      ok: true,
      jobs: jobs.map((job) => toGenerationJobSummary(job, isGenerationJobRunnerActive(job.id))),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "최근 작업 조회 실패") }, { status: localAccessError(error) ? 403 : 500 });
  }
}
