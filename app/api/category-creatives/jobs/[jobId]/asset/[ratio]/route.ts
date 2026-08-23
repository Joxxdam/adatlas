import { NextResponse } from "next/server";
import { getCategoryCreativeJob, readCategoryCreativeJobAsset } from "../../../../../../lib/category-creatives/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string; ratio: string }> }) {
  const { jobId, ratio } = await context.params;
  const job = await getCategoryCreativeJob(jobId);
  if (!job?.outputs || (ratio !== "square" && ratio !== "vertical")) return NextResponse.json({ ok: false, error: "이미지를 찾지 못했습니다." }, { status: 404 });
  const output = job.outputs[ratio];
  const bytes = await readCategoryCreativeJobAsset(jobId, output.fileName);
  return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "Content-Disposition": `inline; filename="${jobId}-${ratio}.jpg"`, "Cache-Control": "private, no-store" } });
}
