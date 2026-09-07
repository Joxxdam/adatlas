import { NextResponse } from "next/server";
import { applyDeliveryBrandingToJob } from "../../../../../lib/creative-generation/deliveryBrandingJob.server";
import { creativeGenerationJobStore } from "../../../../../lib/creative-generation/jobStore.server";
import { assertGenerationJobAccess, localAccessError, verifyLocalGenerationAccess } from "../../../../../lib/creative-generation/localGenerationAccess.server";
import { toPublicGenerationError, toPublicGenerationJob } from "../../../../../lib/creative-generation/publicJob.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrandingRequest = {
  logoId?: string;
  aiDisclosure?: boolean;
  clear?: boolean;
  resultIds?: string[];
};

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const principal = await verifyLocalGenerationAccess(request);
    const { jobId } = await context.params;
    const existing = await creativeGenerationJobStore.get(jobId);
    if (!existing) return NextResponse.json({ ok: false, error: "작업을 찾지 못했습니다." }, { status: 404 });
    assertGenerationJobAccess(principal, existing);
    const body = (await request.json().catch(() => ({}))) as BrandingRequest;
    const updated = await applyDeliveryBrandingToJob(jobId, body);
    return NextResponse.json({
      ok: true,
      appliedCount: updated.appliedCount,
      job: toPublicGenerationJob(updated.job),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "완성 이미지 후처리 실패") }, { status: localAccessError(error) ? 403 : 400 });
  }
}
