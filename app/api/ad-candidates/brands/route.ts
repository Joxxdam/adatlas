import { NextResponse } from "next/server";
import { BigQueryPublicError } from "../../../lib/bigquery/client.server";
import { listBigQueryAdvertisers } from "../../../lib/bigquery/candidateService.server";
import { assertInternalApiAccess, InternalApiAccessError } from "../../../lib/internal-api/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertInternalApiAccess(request);
    const result = await listBigQueryAdvertisers();
    return NextResponse.json(
      { ok: true, ...result },
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
        error: known?.message || "BigQuery 광고주 목록을 불러오지 못했습니다.",
      },
      { status: known?.status || 500 }
    );
  }
}
