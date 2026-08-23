import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { resolveCreativeArchiveDeliveryFile } from "../../../../lib/creative-archive/branding.server";
import { MAX_FINAL_BYTES } from "../../../../lib/creative-generation/nativeCreativeStorage.server";
import { localAccessError, verifyLocalGenerationAccess } from "../../../../lib/creative-generation/localGenerationAccess.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ entryId: string }> }) {
  try {
    verifyLocalGenerationAccess(request);
    const { entryId } = await context.params;
    const file = await resolveCreativeArchiveDeliveryFile(entryId);
    const data = await readFile(file);
    const metadata = await sharp(data).metadata();
    if (metadata.format !== "jpeg" || metadata.width !== 1200 || metadata.height !== 1200 || data.length > MAX_FINAL_BYTES) {
      return NextResponse.json({ ok: false, error: "아카이브 이미지 규격 검증에 실패했습니다." }, { status: 422 });
    }
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new NextResponse(data, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(data.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${path.basename(file)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "아카이브 이미지를 불러오지 못했습니다." }, { status: localAccessError(error) ? 403 : 400 });
  }
}
