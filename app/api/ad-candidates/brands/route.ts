import { NextResponse } from "next/server";
import { BigQueryPublicError } from "../../../lib/bigquery/client.server";
import { listBigQueryAdvertisers } from "../../../lib/bigquery/candidateService.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await listBigQueryAdvertisers();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
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
