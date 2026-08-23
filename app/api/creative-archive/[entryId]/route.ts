import { NextResponse } from "next/server";
import { deleteCreativeArchiveEntries, updateCreativeArchiveEntry } from "../../../lib/creative-archive/service.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../lib/creative-generation/localGenerationAccess.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validEntryId(value: string) {
  return /^(?:asset|result):[A-Za-z0-9:_-]{8,240}$/.test(value);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ entryId: string }> }
) {
  try {
    verifyLocalGenerationAccess(request);
    const { entryId } = await context.params;
    if (!validEntryId(entryId)) {
      return NextResponse.json({ ok: false, error: "올바르지 않은 아카이브 항목입니다." }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      savedAsReference?: boolean;
      tags?: unknown;
      note?: unknown;
    };
    if (body.tags !== undefined && !Array.isArray(body.tags)) {
      return NextResponse.json({ ok: false, error: "태그 형식이 올바르지 않습니다." }, { status: 400 });
    }
    const entry = await updateCreativeArchiveEntry(entryId, {
      savedAsReference: body.savedAsReference,
      tags: body.tags as string[] | undefined,
      note: body.note === undefined ? undefined : String(body.note),
    });
    return NextResponse.json({ ok: true, entry });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "아카이브 정보를 저장하지 못했습니다.",
      },
      { status: localAccessError(error) ? 403 : 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ entryId: string }> }
) {
  try {
    verifyLocalGenerationAccess(request);
    const { entryId } = await context.params;
    if (!validEntryId(entryId)) {
      return NextResponse.json({ ok: false, error: "올바르지 않은 아카이브 항목입니다." }, { status: 400 });
    }
    const result = await deleteCreativeArchiveEntries([entryId]);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "이미지 콘텐츠를 삭제하지 못했습니다." },
      { status: localAccessError(error) ? 403 : 400 }
    );
  }
}
