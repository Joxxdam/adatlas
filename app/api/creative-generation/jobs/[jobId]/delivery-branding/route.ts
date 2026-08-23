import { NextResponse } from "next/server";
import { applyDeliveryBrandingToJob } from "../../../../../lib/creative-generation/deliveryBrandingJob.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../../../lib/creative-generation/localGenerationAccess.server";
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
    verifyLocalGenerationAccess(request);
    const { jobId } = await context.params;
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
