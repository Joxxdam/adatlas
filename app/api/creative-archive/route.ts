import { NextResponse } from "next/server";
import { listCreativeArchiveEntries } from "../../lib/creative-archive/service.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../lib/creative-generation/localGenerationAccess.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    const entries = await listCreativeArchiveEntries();
    return NextResponse.json({ ok: true, entries, generatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "이미지 콘텐츠 아카이브를 불러오지 못했습니다.",
      },
      { status: localAccessError(error) ? 403 : 500 }
    );
  }
}
