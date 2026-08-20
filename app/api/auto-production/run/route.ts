import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../lib/auto-production/access.server";
import { publicAutoProductionError, toPublicAutoProductionRun } from "../../../lib/auto-production/publicAutoProduction.server";
import { runAutoProductionNow } from "../../../lib/auto-production/scheduler.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    verifyAutoProductionAccess(request, true);
    const body = (await request.json().catch(() => ({}))) as { advertiserId?: string; trigger?: "manual" | "cli"; force?: boolean };
    const trigger = body.trigger || "manual";
    const results = await runAutoProductionNow({ advertiserId: body.advertiserId, trigger, force: trigger === "manual" ? true : Boolean(body.force) });
    return NextResponse.json({ ok: true, results: results.map((item) => ({ created: item.created, run: item.run ? toPublicAutoProductionRun(item.run) : null })) }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "자동 제작 실행에 실패했습니다.") }, { status: 400 });
  }
}
