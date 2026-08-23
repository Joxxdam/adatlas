import { NextResponse } from "next/server";
import { deleteCreativeArchiveEntries, listCreativeArchiveEntries } from "../../lib/creative-archive/service.server";
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

export async function DELETE(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    const body = (await request.json().catch(() => ({}))) as { entryIds?: unknown };
    if (!Array.isArray(body.entryIds) || body.entryIds.length > 500) {
      return NextResponse.json({ ok: false, error: "삭제할 이미지 선택값이 올바르지 않습니다." }, { status: 400 });
    }
    const result = await deleteCreativeArchiveEntries(body.entryIds.map(String));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "선택한 이미지 콘텐츠를 삭제하지 못했습니다." }, { status: localAccessError(error) ? 403 : 400 });
  }
}
