import { NextResponse } from "next/server";
import { createCreativeArchiveProductZip } from "../../../lib/creative-archive/productZip.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../lib/creative-generation/localGenerationAccess.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeDownloadFileName(value: string) {
  return encodeURIComponent(value).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export async function POST(request: Request) {
  try {
    verifyLocalGenerationAccess(request);
    const body = (await request.json().catch(() => ({}))) as { entryIds?: unknown };
    if (!Array.isArray(body.entryIds) || body.entryIds.some((id) => typeof id !== "string")) {
      return NextResponse.json({ ok: false, error: "상품 ZIP 이미지 선택값이 올바르지 않습니다." }, { status: 400 });
    }
    const archive = await createCreativeArchiveProductZip(body.entryIds);
    const encodedFileName = encodeDownloadFileName(archive.fileName);
    return new NextResponse(new Uint8Array(archive.buffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(archive.buffer.length),
        "Content-Disposition": `attachment; filename="daywiz-product-archive.zip"; filename*=UTF-8''${encodedFileName}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-AdAtlas-Archive-Filename": encodedFileName,
        "X-AdAtlas-Included-Count": String(archive.includedCount),
        "X-AdAtlas-Failed-Count": String(archive.failedCount),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "상품 ZIP을 만들지 못했습니다." },
      { status: localAccessError(error) ? 403 : 400 }
    );
  }
}
