import { NextResponse } from "next/server";
import { verifyAutoProductionAccess } from "../../../lib/auto-production/access.server";
import { autoProductionAdvertiserRepository } from "../../../lib/auto-production/advertiserConfig.server";
import { publicAutoProductionError } from "../../../lib/auto-production/publicAutoProduction.server";
import type { AutoProductionAdvertiserConfig } from "../../../lib/auto-production/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    verifyAutoProductionAccess(request);
    const [advertisers, settings] = await Promise.all([autoProductionAdvertiserRepository.list(), autoProductionAdvertiserRepository.settings()]);
    return NextResponse.json({ ok: true, advertisers, settings }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "광고주 설정을 불러오지 못했습니다.") }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    verifyAutoProductionAccess(request, true);
    const body = (await request.json()) as Partial<AutoProductionAdvertiserConfig>;
    const advertiser = await autoProductionAdvertiserRepository.create({ ...body, advertiserName: String(body.advertiserName || "") });
    return NextResponse.json({ ok: true, advertiser }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "광고주 설정을 저장하지 못했습니다.") }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    verifyAutoProductionAccess(request, true);
    const body = (await request.json()) as { paused?: boolean; maxImagesPerDay?: number; globalConcurrency?: number };
    const settings = await autoProductionAdvertiserRepository.updateSettings(body);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return NextResponse.json({ ok: false, error: publicAutoProductionError(error, "전체 자동 제작 설정을 변경하지 못했습니다.") }, { status: 400 });
  }
}
