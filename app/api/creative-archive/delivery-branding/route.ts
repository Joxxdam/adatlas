import { NextResponse } from "next/server";
import { assertCreativeArchiveEntriesAccess, filterCreativeArchiveEntriesForAccess } from "../../../lib/creative-archive/access.server";
import { applyCreativeArchiveBranding } from "../../../lib/creative-archive/branding.server";
import { listCreativeArchiveEntries } from "../../../lib/creative-archive/service.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../lib/creative-generation/localGenerationAccess.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const principal = await verifyLocalGenerationAccess(request);
    const body = (await request.json().catch(() => ({}))) as {
      entryIds?: unknown;
      logoId?: unknown;
      aiDisclosure?: unknown;
      clear?: unknown;
    };
    if (!Array.isArray(body.entryIds) || body.entryIds.length > 100) {
      return NextResponse.json({ ok: false, error: "후처리할 이미지 선택값이 올바르지 않습니다." }, { status: 400 });
    }
    const entryIds = body.entryIds.map(String);
    await assertCreativeArchiveEntriesAccess(principal, await listCreativeArchiveEntries(), entryIds);
    const result = await applyCreativeArchiveBranding({
      entryIds,
      logoId: String(body.logoId || "").trim() || undefined,
      aiDisclosure: body.aiDisclosure === true,
      clear: body.clear === true,
    });
    const entries = await filterCreativeArchiveEntriesForAccess(principal, result.entries);
    return NextResponse.json({ ok: true, ...result, entries });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "아카이브 이미지 후처리에 실패했습니다." }, { status: localAccessError(error) ? 403 : 400 });
  }
}
