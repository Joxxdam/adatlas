import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../lib/auto-production/access.server";
import { publicAutoProductionError } from "../../../lib/auto-production/publicAutoProduction.server";
import { cleanupExpiredCodexImageSessions, getCodexImageSessionRetentionStatus } from "../../../lib/creative-generation/codexImageSessionRetention.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseOptions = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: Request) {
  try {
    verifyAutoProductionAccess(request);
    return NextResponse.json({ ok: true, status: await getCodexImageSessionRetentionStatus() }, responseOptions);
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "Codex 저장공간 정리 상태를 확인하지 못했습니다.") }, { status: 403, ...responseOptions });
  }
}

export async function POST(request: Request) {
  try {
    verifyAutoProductionAccess(request, true);
    const cleanup = await cleanupExpiredCodexImageSessions();
    return NextResponse.json({ ok: true, cleanup, status: await getCodexImageSessionRetentionStatus() }, responseOptions);
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "Codex 저장공간을 정리하지 못했습니다.") }, { status: 403, ...responseOptions });
  }
}
