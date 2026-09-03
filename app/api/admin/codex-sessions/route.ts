import { NextResponse } from "next/server";
import { cleanupExpiredCodexImageSessions, getCodexImageSessionRetentionStatus } from "../../../lib/creative-generation/codexImageSessionRetention.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../lib/creative-generation/localGenerationAccess.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseOptions = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    return NextResponse.json({ ok: true, status: await getCodexImageSessionRetentionStatus() }, responseOptions);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Codex 세션 정리 상태를 확인하지 못했습니다." },
      { status: localAccessError(error) ? 403 : 500, ...responseOptions }
    );
  }
}

export async function POST(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    const cleanup = await cleanupExpiredCodexImageSessions();
    return NextResponse.json({ ok: true, cleanup, status: await getCodexImageSessionRetentionStatus() }, responseOptions);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Codex 세션을 정리하지 못했습니다." },
      { status: localAccessError(error) ? 403 : 500, ...responseOptions }
    );
  }
}
