import { NextResponse } from "next/server";
import { deleteCreativeArchiveEntries, listCreativeArchiveEntries } from "../../lib/creative-archive/service.server";
import { assertCreativeArchiveEntriesAccess, filterCreativeArchiveEntriesForAccess } from "../../lib/creative-archive/access.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../lib/creative-generation/localGenerationAccess.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const principal = await verifyLocalGenerationAccess(request);
    const url = new URL(request.url);
    const paginated = url.searchParams.has("limit") || url.searchParams.has("offset");
    const entries = await filterCreativeArchiveEntriesForAccess(principal, await listCreativeArchiveEntries());
    if (paginated) {
      const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
      const limit = Math.max(1, Math.min(100, Math.floor(Number(url.searchParams.get("limit")) || 48)));
      const pageEntries = entries.slice(offset, offset + limit);
      return NextResponse.json({
        ok: true,
        entries: pageEntries,
        total: entries.length,
        offset,
        limit,
        hasMore: offset + pageEntries.length < entries.length,
        generatedAt: new Date().toISOString(),
      });
    }
    return NextResponse.json({ ok: true, entries, total: entries.length, offset: 0, limit: entries.length, hasMore: false, generatedAt: new Date().toISOString() });
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
    const principal = await verifyLocalGenerationAccess(request);
    const body = (await request.json().catch(() => ({}))) as { entryIds?: unknown };
    if (!Array.isArray(body.entryIds) || body.entryIds.length > 500) {
      return NextResponse.json({ ok: false, error: "삭제할 이미지 선택값이 올바르지 않습니다." }, { status: 400 });
    }
    const entryIds = body.entryIds.map(String);
    await assertCreativeArchiveEntriesAccess(principal, await listCreativeArchiveEntries(), entryIds);
    const result = await deleteCreativeArchiveEntries(entryIds);
    const entries = await filterCreativeArchiveEntriesForAccess(principal, result.entries);
    return NextResponse.json({ ok: true, ...result, entries });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "선택한 이미지 콘텐츠를 삭제하지 못했습니다." }, { status: localAccessError(error) ? 403 : 400 });
  }
}
