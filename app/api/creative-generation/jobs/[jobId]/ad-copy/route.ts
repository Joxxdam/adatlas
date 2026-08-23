import { NextResponse } from "next/server";
import { approveProductAdCopy, ensureProductAdCopy, excludeProductAdCopy } from "../../../../../lib/ad-copy/adCopyGenerator.server";
import { buildAdCopyCsv } from "../../../../../lib/ad-copy/adCopyValidator";
import { creativeGenerationJobStore } from "../../../../../lib/creative-generation/jobStore.server";
import { verifyLocalGenerationAccess, localAccessError } from "../../../../../lib/creative-generation/localGenerationAccess.server";
import { toPublicGenerationError, toPublicGenerationJob } from "../../../../../lib/creative-generation/publicJob.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function fileName(value: string) {
  return (
    value
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "ad-copy"
  );
}

function setup(job: NonNullable<Awaited<ReturnType<typeof creativeGenerationJobStore.get>>>) {
  const copy = job.adCopy;
  if (!copy?.primaryText || copy.status === "needs-review") throw new Error("검수를 통과한 광고문구가 없습니다.");
  return {
    productName: job.productTruth.product.productName,
    primaryText: copy.primaryText,
    adTitle: copy.adTitle || "",
    adName: copy.adName || "",
    utm: copy.utm || "",
    assetCode: copy.assetCode || "",
    hookId: copy.basedOnHookId,
  };
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    verifyLocalGenerationAccess(request);
    const { jobId } = await context.params;
    const job = await creativeGenerationJobStore.get(jobId);
    if (!job) return NextResponse.json({ ok: false, error: "작업을 찾지 못했습니다." }, { status: 404 });
    const format = new URL(request.url).searchParams.get("format");
    if (!format) return NextResponse.json({ ok: true, adCopy: toPublicGenerationJob(job).adCopy });
    const row = setup(job);
    const base = fileName(`${row.assetCode || row.productName}-meta-copy`);
    if (format === "txt") {
      const text = `${row.primaryText}\n\n광고 제목\n${row.adTitle}\n\n광고명\n${row.adName}\n\nUTM\n${row.utm}\n\n소재코드\n${row.assetCode}\n`;
      return new NextResponse(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.txt`)}` } });
    }
    if (format === "csv") {
      return new NextResponse(buildAdCopyCsv([row]), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.csv`)}` } });
    }
    if (format === "json") {
      return new NextResponse(`${JSON.stringify(row, null, 2)}\n`, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${base}.json`)}` } });
    }
    return NextResponse.json({ ok: false, error: "txt, csv 또는 json 형식만 지원합니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "광고문구를 불러오지 못했습니다.") }, { status: localAccessError(error) ? 403 : 409 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    verifyLocalGenerationAccess(request);
    const { jobId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { action?: "regenerate" | "approve" | "exclude"; reason?: string; performanceData?: Record<string, number> };
    let job;
    if (body.action === "regenerate") job = await ensureProductAdCopy(jobId, { force: true });
    else if (body.action === "approve") job = await approveProductAdCopy(jobId, { reason: body.reason, performanceData: body.performanceData });
    else if (body.action === "exclude") job = await excludeProductAdCopy(jobId);
    else return NextResponse.json({ ok: false, error: "regenerate, approve 또는 exclude 액션이 필요합니다." }, { status: 400 });
    return NextResponse.json({ ok: true, job: toPublicGenerationJob(job), adCopy: toPublicGenerationJob(job).adCopy });
  } catch (error) {
    return NextResponse.json({ ok: false, error: toPublicGenerationError(error, "광고문구 요청을 처리하지 못했습니다.") }, { status: localAccessError(error) ? 403 : 409 });
  }
}
