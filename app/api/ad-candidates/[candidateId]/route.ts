import { NextResponse } from "next/server";
import { BigQueryPublicError } from "../../../lib/bigquery/client.server";
import { getBigQueryCandidate } from "../../../lib/bigquery/candidateService.server";
import { assertInternalApiAccess, InternalApiAccessError } from "../../../lib/internal-api/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ candidateId: string }> }
) {
  try {
    assertInternalApiAccess(request);
    const { candidateId } = await context.params;
    const candidate = await getBigQueryCandidate(candidateId);
    if (!candidate) {
      return NextResponse.json({ ok: false, error: "광고 후보를 찾지 못했습니다." }, { status: 404 });
    }
    return NextResponse.json(
      { ok: true, candidate },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    if (error instanceof InternalApiAccessError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    const known = error instanceof BigQueryPublicError ? error : null;
    return NextResponse.json(
      {
        ok: false,
        errorCode: known?.code || "query-failed",
        error: known?.message || "광고 후보 상세를 불러오지 못했습니다.",
      },
      { status: known?.status || 500 }
    );
  }
}
