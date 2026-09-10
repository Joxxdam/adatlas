import { NextResponse } from "next/server";
import { createNativeGenerationJob } from "../../../lib/creative-generation/createNativeGenerationJob.server";
import type { CreateGenerationJobInput } from "../../../lib/creative-generation/types";
import { localAccessError, localAccessErrorStatus, requestOwnerForAccess, verifyLocalGenerationAccess } from "../../../lib/creative-generation/localGenerationAccess.server";
import { toPublicGenerationError, toPublicGenerationJob } from "../../../lib/creative-generation/publicJob.server";
import { createManualGenerationQueueMetadata, getManualGenerationQueueSnapshot, isGenerationJobRunnerActive } from "../../../lib/creative-generation/jobRunner.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** 스토리형 버튼만 호출하는 전용 작업 생성 경로입니다. */
export async function POST(request: Request) {
  try {
    const principal = await verifyLocalGenerationAccess(request);
    const body = (await request.json().catch(() => ({}))) as CreateGenerationJobInput;
    if (body.product?.analysisMode !== "site" || body.codexDirectTest?.serviceCreativeMode !== "story") {
      return NextResponse.json(
        { ok: false, error: "사이트 분석의 스토리형 광고 제작 버튼에서만 시작할 수 있습니다." },
        { status: 400 }
      );
    }
    const job = await createNativeGenerationJob(body, {
      sourceType: "manual",
      manualQueue: createManualGenerationQueueMetadata(),
      requestedBy: requestOwnerForAccess(principal),
      serviceStorySequential: true,
    });
    const queue = await getManualGenerationQueueSnapshot();
    return NextResponse.json(
      {
        ok: true,
        job: toPublicGenerationJob(job),
        runnerActive: isGenerationJobRunnerActive(job.id),
        manualQueue: queue.byJobId[job.id],
      },
      { status: 202 }
    );
  } catch (error) {
    const message = toPublicGenerationError(error, "스토리형 광고 생성 작업 계획에 실패했습니다.");
    const userInputError = /먼저 상품정보|실제 상품 이미지|사이트 시각 자료|스토리형/.test(message);
    const configurationError = /AI 광고 콘텐츠 생성 설정|Codex|로그인|사용할 수 없습니다/.test(message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: localAccessErrorStatus(error) || (localAccessError(error) ? 403 : configurationError ? 503 : userInputError ? 400 : 500) }
    );
  }
}
