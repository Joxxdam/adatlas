import { NextResponse } from "next/server";
import { getBigQueryConnectionStatus } from "../../../lib/bigquery/client.server";
import { assertInternalApiAccess, InternalApiAccessError } from "../../../lib/internal-api/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    assertInternalApiAccess(request);
  } catch (error) {
    const access = error instanceof InternalApiAccessError ? error : null;
    return NextResponse.json(
      { ok: false, error: access?.message || "내부 데이터 API 접근을 확인하지 못했습니다." },
      { status: access?.status || 401 }
    );
  }
  const status = await getBigQueryConnectionStatus();
  return NextResponse.json(
    { ok: status.connected, ...status, status },
    {
      status: status.connected ? 200 : 503,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
