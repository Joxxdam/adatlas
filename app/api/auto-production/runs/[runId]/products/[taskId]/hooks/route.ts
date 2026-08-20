import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../../../../../lib/auto-production/access.server";
import { queueAutoProductionHooks } from "../../../../../../../lib/auto-production/productionRunner.server";
import { publicAutoProductionError } from "../../../../../../../lib/auto-production/publicAutoProduction.server";
import type { HookMessageCode } from "../../../../../../../lib/creative-generation/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string; taskId: string }> }) {
  try {
    verifyAutoProductionAccess(request, true);
    const { runId, taskId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { hookCodes?: HookMessageCode[]; all?: boolean };
    const job = await queueAutoProductionHooks(runId, taskId, body.all ? [] : body.hookCodes || []);
    return NextResponse.json({ ok: true, jobId: job.id }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "후킹 광고 제작을 시작하지 못했습니다.") }, { status: 400 });
  }
}
