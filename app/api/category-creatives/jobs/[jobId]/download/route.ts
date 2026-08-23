import JSZip from "jszip";
import { NextResponse } from "next/server";
import { getCategoryCreativeJob, readCategoryCreativeJobAsset } from "../../../../../lib/category-creatives/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;
  const job = await getCategoryCreativeJob(jobId);
  if (!job?.outputs) return NextResponse.json({ ok: false, error: "다운로드할 결과가 없습니다." }, { status: 404 });
  const zip = new JSZip();
  zip.file(`${job.categoryName}-1200x1200.jpg`, await readCategoryCreativeJobAsset(jobId, job.outputs.square.fileName));
  zip.file(`${job.categoryName}-1080x1920.jpg`, await readCategoryCreativeJobAsset(jobId, job.outputs.vertical.fileName));
  zip.file("metadata.json", JSON.stringify(job, null, 2));
  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return new NextResponse(new Uint8Array(buffer), { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="category-creative-${jobId}.zip"` } });
}
