import { NextResponse } from "next/server";
import { BigQueryPublicError } from "../../lib/bigquery/client.server";
import { analyzeCategoryCandidates } from "../../lib/category-candidates/service.server";
import { assertInternalApiAccess, InternalApiAccessError } from "../../lib/internal-api/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertInternalApiAccess(request);
    const advertiserId = new URL(request.url).searchParams.get("advertiserId") || "";
    if (!advertiserId) return NextResponse.json({ ok: false, error: "광고주를 선택해 주세요." }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await analyzeCategoryCandidates(advertiserId)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof InternalApiAccessError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    const known = error instanceof BigQueryPublicError ? error : null;
    return NextResponse.json({ ok: false, error: known?.message || (error instanceof Error ? error.message : "카테고리 후보 분석에 실패했습니다.") }, { status: known?.status || 500 });
  }
}
