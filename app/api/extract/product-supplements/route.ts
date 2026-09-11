import { NextResponse } from "next/server";
import { analyzeProductSupplementFiles } from "../../../lib/mvp/productSupplementAnalysis.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    const uploads = await Promise.all(
      files.map(async (file) => ({
        name: file.name.slice(0, 180),
        type: file.type,
        size: file.size,
        buffer: Buffer.from(await file.arrayBuffer()),
      }))
    );
    const analysis = await analyzeProductSupplementFiles({ files: uploads });
    return NextResponse.json({ ok: true, analysis });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "첨부자료 분석에 실패했습니다." },
      { status: 400 }
    );
  }
}
