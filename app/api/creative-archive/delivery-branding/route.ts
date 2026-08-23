import { NextResponse } from "next/server";
import { applyCreativeArchiveBranding } from "../../../lib/creative-archive/branding.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../lib/creative-generation/localGenerationAccess.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    const body = (await request.json().catch(() => ({}))) as {
      entryIds?: unknown;
      logoId?: unknown;
      aiDisclosure?: unknown;
      clear?: unknown;
    };
    if (!Array.isArray(body.entryIds) || body.entryIds.length > 100) {
      return NextResponse.json({ ok: false, error: "후처리할 이미지 선택값이 올바르지 않습니다." }, { status: 400 });
    }
    const result = await applyCreativeArchiveBranding({
      entryIds: body.entryIds.map(String),
      logoId: String(body.logoId || "").trim() || undefined,
      aiDisclosure: body.aiDisclosure === true,
      clear: body.clear === true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "아카이브 이미지 후처리에 실패했습니다." }, { status: localAccessError(error) ? 403 : 400 });
  }
}
