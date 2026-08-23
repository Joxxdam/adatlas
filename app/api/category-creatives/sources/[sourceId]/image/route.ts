import { NextResponse } from "next/server";
import { getCategoryCreativeSource, readCategoryCreativeSourceFile } from "../../../../../lib/category-creatives/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await context.params;
  const source = await getCategoryCreativeSource(sourceId);
  if (!source) return NextResponse.json({ ok: false, error: "이미지를 찾지 못했습니다." }, { status: 404 });
  return new NextResponse(new Uint8Array(await readCategoryCreativeSourceFile(source)), { headers: { "Content-Type": source.mimeType, "Cache-Control": "private, max-age=3600" } });
}
