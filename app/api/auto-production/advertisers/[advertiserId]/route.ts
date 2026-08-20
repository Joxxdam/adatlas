import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../../lib/auto-production/access.server";
import { autoProductionAdvertiserRepository } from "../../../../lib/auto-production/advertiserConfig.server";
import { publicAutoProductionError } from "../../../../lib/auto-production/publicAutoProduction.server";
import type { AutoProductionAdvertiserConfig } from "../../../../lib/auto-production/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ advertiserId: string }> }) {
  try {
    verifyAutoProductionAccess(request, true);
    const { advertiserId } = await context.params;
    const body = (await request.json()) as Partial<AutoProductionAdvertiserConfig>;
    const advertiser = await autoProductionAdvertiserRepository.update(advertiserId, body);
    return NextResponse.json({ ok: true, advertiser });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "광고주 설정을 변경하지 못했습니다.") }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ advertiserId: string }> }) {
  try {
    verifyAutoProductionAccess(request, true);
    const { advertiserId } = await context.params;
    const removed = await autoProductionAdvertiserRepository.remove(advertiserId);
    return NextResponse.json({ ok: removed });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "광고주 설정을 삭제하지 못했습니다.") }, { status: 400 });
  }
}
