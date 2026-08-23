import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../../lib/auto-production/access.server";
import { autoProductionRepository } from "../../../../lib/auto-production/productionRepository.server";
import { cancelAutoProductionRun, syncAutoProductionRun } from "../../../../lib/auto-production/productionRunner.server";
import { publicAutoProductionError, toPublicAutoProductionRun } from "../../../../lib/auto-production/publicAutoProduction.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    verifyAutoProductionAccess(request);
    const { runId } = await context.params;
    const run = (await syncAutoProductionRun(runId)) || (await autoProductionRepository.get(runId));
    if (!run) return NextResponse.json({ ok: false, error: "자동 제작 실행 기록을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, run: toPublicAutoProductionRun(run) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "자동 제작 결과를 불러오지 못했습니다.") }, { status: 403 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    verifyAutoProductionAccess(request, true);
    const { runId } = await context.params;
    const body = (await request.json()) as { action?: "cancel" };
    if (body.action !== "cancel") return NextResponse.json({ ok: false, error: "cancel 액션이 필요합니다." }, { status: 400 });
    const run = await cancelAutoProductionRun(runId);
    return NextResponse.json({ ok: true, run: toPublicAutoProductionRun(run) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "자동 제작 실행을 취소하지 못했습니다.") }, { status: 400 });
  }
}
