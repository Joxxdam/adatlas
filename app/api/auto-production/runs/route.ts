import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../lib/auto-production/access.server";
import { autoProductionRepository } from "../../../lib/auto-production/productionRepository.server";
import { syncAutoProductionRun } from "../../../lib/auto-production/productionRunner.server";
import { publicAutoProductionError, toPublicAutoProductionRun } from "../../../lib/auto-production/publicAutoProduction.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    verifyAutoProductionAccess(request);
    const url = new URL(request.url);
    const advertiserId = url.searchParams.get("advertiserId") || undefined;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const requestedFrom = url.searchParams.get("dateFrom") || "";
    const requestedTo = url.searchParams.get("dateTo") || "";
    const dateFrom = datePattern.test(requestedFrom) ? requestedFrom : undefined;
    const dateTo = datePattern.test(requestedTo) ? requestedTo : undefined;
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return NextResponse.json({ ok: false, error: "조회 시작일은 종료일보다 늦을 수 없습니다." }, { status: 400 });
    }
    const runs = await autoProductionRepository.list({
      advertiserId,
      dateFrom,
      dateTo,
      limit: Number(url.searchParams.get("limit") || 80),
    });
    const synced = [];
    for (const run of runs) {
      const copyPending = run.tasks.some((task) => task.generationJobId && task.results.some((result) => Boolean(result.imageUrl)) && (!task.adCopy || task.adCopy.status === "generating"));
      const packagePending = run.completedImages > 0 && run.packageStatus !== "ready";
      synced.push(["queued", "generating-creatives"].includes(run.status) || copyPending || packagePending ? await syncAutoProductionRun(run.id) : run);
    }
    return NextResponse.json({ ok: true, runs: synced.filter(Boolean).map((run) => toPublicAutoProductionRun(run!)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "자동 제작 결과를 불러오지 못했습니다.") }, { status: 403 });
  }
}
