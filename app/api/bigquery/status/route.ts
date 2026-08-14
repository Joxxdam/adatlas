import { NextResponse } from "next/server";
import { getBigQueryConnectionStatus } from "../../../lib/bigquery/client.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getBigQueryConnectionStatus();
  return NextResponse.json(
    { ok: status.connected, ...status, status },
    {
      status: status.connected ? 200 : 503,
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}
