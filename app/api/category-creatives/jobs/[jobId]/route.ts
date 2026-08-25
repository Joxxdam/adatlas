import { NextResponse } from "next/server";
import { deleteCategoryCreativeJob, getCategoryCreativeJob } from "../../../../lib/category-creatives/repository.server";
import { updateCategoryCreativeCopy } from "../../../../lib/category-creatives/service.server";
import { assertInternalApiAccess, InternalApiAccessError } from "../../../../lib/internal-api/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = await getCategoryCreativeJob(jobId);
  return job ? NextResponse.json({ ok: true, job }) : NextResponse.json({ ok: false, error: "결과를 찾지 못했습니다." }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const body = await request.json();
    const job = await updateCategoryCreativeCopy(jobId, { headline: String(body.headline || ""), subheadline: String(body.subheadline || ""), cta: String(body.cta || "") });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "문구 수정에 실패했습니다." }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    assertInternalApiAccess(request);
    const { jobId } = await context.params;
    const deleted = await deleteCategoryCreativeJob(jobId);
    if (!deleted) {
      return NextResponse.json({ ok: false, error: "삭제할 카테고리 이미지 작업을 찾지 못했습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deletedJobId: jobId });
  } catch (error) {
    if (error instanceof InternalApiAccessError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "카테고리 이미지 삭제에 실패했습니다." }, { status: 500 });
  }
}
