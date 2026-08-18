import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { creativeGenerationJobStore } from "../../../../../../../lib/creative-generation/jobStore.server";
import { resolveValidatedNativeDownload, MAX_FINAL_BYTES } from "../../../../../../../lib/creative-generation/nativeCreativeStorage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ jobId: string; resultId: string }> }) {
  try {
    const { jobId, resultId } = await context.params;
    const job = await creativeGenerationJobStore.get(jobId);
    if (!job) return NextResponse.json({ ok: false, error: "작업을 찾지 못했습니다." }, { status: 404 });
    const result = job.results.find((item) => item.id === resultId);
    if (!result || !["success","approved"].includes(result.status)) return NextResponse.json({ ok: false, error: "검수를 통과한 광고만 다운로드할 수 있습니다." }, { status: 409 });
    const file = resolveValidatedNativeDownload(job, resultId);
    const data = await readFile(file);
    const metadata = await sharp(data).metadata();
    if (metadata.format !== "jpeg" || metadata.width !== 1200 || metadata.height !== 1200 || data.length > MAX_FINAL_BYTES) return NextResponse.json({ ok: false, error: "내보내기 규격 검증에 실패했습니다." }, { status: 422 });
    return new NextResponse(data, { headers: { "Content-Type": "image/jpeg", "Content-Length": String(data.length), "Content-Disposition": `attachment; filename="${path.basename(result.downloadName || file).replace(/[^a-zA-Z0-9._-]/g, "-")}"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "다운로드 실패" }, { status: 400 }); }
}
