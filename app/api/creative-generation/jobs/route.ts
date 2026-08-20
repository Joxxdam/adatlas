import { NextResponse } from "next/server";
import { createNativeGenerationJob } from "../../../lib/creative-generation/createNativeGenerationJob.server";
import type { CreateGenerationJobInput } from "../../../lib/creative-generation/types";
import { localAccessError, verifyLocalGenerationAccess } from "../../../lib/creative-generation/localGenerationAccess.server";
import { toPublicGenerationError, toPublicGenerationJob } from "../../../lib/creative-generation/publicJob.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    const body = (await request.json().catch(() => ({}))) as CreateGenerationJobInput;
    const job = await createNativeGenerationJob(body);
    return NextResponse.json({ ok: true, job: toPublicGenerationJob(job) }, { status: 202 });
  } catch (error) {
    const message = toPublicGenerationError(error, "광고 생성 작업 계획에 실패했습니다.");
    const userInputError = /먼저 상품정보|실제 상품 이미지|상품 합성|누끼|제품 단독 이미지|후킹 가설/.test(message);
    const configurationError = /AI 광고 콘텐츠 생성 설정|Codex|로그인|사용할 수 없습니다/.test(message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: localAccessError(error) ? 403 : configurationError ? 503 : userInputError ? 400 : 500 }
    );
  }
}
