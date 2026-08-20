import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../lib/auto-production/access.server";
import { autoProductionAdvertiserRepository } from "../../../lib/auto-production/advertiserConfig.server";
import { previewAutoProduction } from "../../../lib/auto-production/productionRunner.server";
import { publicAutoProductionError, toPublicAutoProductionPreview } from "../../../lib/auto-production/publicAutoProduction.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    verifyAutoProductionAccess(request, true);
    const body = (await request.json().catch(() => ({}))) as { advertiserId?: string };
    const configs = (await autoProductionAdvertiserRepository.list()).filter((config) => config.enabled && (!body.advertiserId || config.advertiserId === body.advertiserId));
    const previews = [];
    for (const config of configs) previews.push(await previewAutoProduction(config));
    return NextResponse.json({ ok: true, previews: previews.map(toPublicAutoProductionPreview) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "자동 제작 후보 미리보기에 실패했습니다.") }, { status: 400 });
  }
}
