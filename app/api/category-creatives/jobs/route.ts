import { NextResponse } from "next/server";
import { createCategoryCreative } from "../../../lib/category-creatives/service.server";
import { listCategoryCreativeJobs } from "../../../lib/category-creatives/repository.server";
import { categoryCreativeStyles } from "../../../lib/category-creatives/types";
import { assertInternalApiAccess, InternalApiAccessError } from "../../../lib/internal-api/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertInternalApiAccess(request);
    return NextResponse.json({ ok: true, jobs: await listCategoryCreativeJobs() });
  } catch (error) {
    if (error instanceof InternalApiAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: "카테고리 이미지 내역을 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    assertInternalApiAccess(request);
    const body = await request.json();
    const style = categoryCreativeStyles.includes(body.style) ? body.style : "auto";
    const job = await createCategoryCreative({ ...body, style });
    return NextResponse.json({ ok: job.status === "completed", job }, { status: job.status === "completed" ? 201 : 500 });
  } catch (error) {
    if (error instanceof InternalApiAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "카테고리 이미지 제작에 실패했습니다." }, { status: 400 });
  }
}
