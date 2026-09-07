import { NextResponse } from "next/server";
import { ensureArchiveEntryAdCopy } from "../../../../lib/ad-copy/adCopyGenerator.server";
import { adCopyRepository } from "../../../../lib/ad-copy/adCopyRepository.server";
import { assertCreativeArchiveEntryAccess } from "../../../../lib/creative-archive/access.server";
import { getCreativeArchiveEntry } from "../../../../lib/creative-archive/service.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../../lib/creative-generation/localGenerationAccess.server";
import { toPublicGenerationError } from "../../../../lib/creative-generation/publicJob.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function validEntryId(value: string) {
  return /^(?:asset|result):[A-Za-z0-9:_-]{8,240}$/.test(value);
}

export async function GET(request: Request, context: { params: Promise<{ entryId: string }> }) {
  try {
    const principal = await verifyLocalGenerationAccess(request);
    const { entryId } = await context.params;
    if (!validEntryId(entryId)) return NextResponse.json({ ok: false, error: "올바르지 않은 아카이브 항목입니다." }, { status: 400 });
    const entry = await getCreativeArchiveEntry(entryId);
    if (!entry) return NextResponse.json({ ok: false, error: "아카이브에서 해당 이미지 콘텐츠를 찾지 못했습니다." }, { status: 404 });
    await assertCreativeArchiveEntryAccess(principal, entry);
    return NextResponse.json({ ok: true, adCopy: await adCopyRepository.getByArchiveEntry(entryId) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "광고 문구와 제목을 불러오지 못했습니다.") }, { status: localAccessError(error) ? 403 : 409 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ entryId: string }> }) {
  try {
    const principal = await verifyLocalGenerationAccess(request);
    const { entryId } = await context.params;
    if (!validEntryId(entryId)) return NextResponse.json({ ok: false, error: "올바르지 않은 아카이브 항목입니다." }, { status: 400 });
    const entry = await getCreativeArchiveEntry(entryId);
    if (!entry) return NextResponse.json({ ok: false, error: "아카이브에서 해당 이미지 콘텐츠를 찾지 못했습니다." }, { status: 404 });
    await assertCreativeArchiveEntryAccess(principal, entry);
    const body = (await request.json().catch(() => ({}))) as { action?: "generate" | "regenerate" };
    if (body.action !== "generate" && body.action !== "regenerate") {
      return NextResponse.json({ ok: false, error: "generate 또는 regenerate 액션이 필요합니다." }, { status: 400 });
    }
    const adCopy = await ensureArchiveEntryAdCopy(entryId, { force: body.action === "regenerate" });
    return NextResponse.json({ ok: true, adCopy });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "광고 문구와 제목을 생성하지 못했습니다.") }, { status: localAccessError(error) ? 403 : 409 });
  }
}
