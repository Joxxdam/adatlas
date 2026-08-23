import { NextResponse } from "next/server";
import { OfficialCremaApiAdapter } from "../../../lib/crema-market/CremaMarketDataAdapter.server";
import { buildDevelopmentFixture } from "../../../lib/crema-market/fixture";
import { importAndAnalyzeCremaMarket, saveCremaConnectionError } from "../../../lib/crema-market/syncService.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    mode?: "crema_api" | "development_fixture";
    advertiserId?: string;
    advertiserName?: string;
    brandName?: string;
    domain?: string;
    periodDays?: 1 | 7 | 14 | 28;
  };
  const mode = body.mode || "crema_api";
  const advertiserId = String(body.advertiserId || (mode === "development_fixture" ? "dev-crema-market" : "")).trim();
  const advertiserName = String(body.advertiserName || (mode === "development_fixture" ? "개발용 크리마켓 예시 광고주" : "")).trim();
  if (!advertiserId || !advertiserName) return NextResponse.json({ ok: false, error: "광고주 ID와 이름을 입력해 주세요." }, { status: 400 });
  if (mode === "development_fixture" && process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "개발용 fixture는 프로덕션에서 사용할 수 없습니다." }, { status: 403 });
  }
  try {
    const payload = mode === "development_fixture" ? buildDevelopmentFixture() : await new OfficialCremaApiAdapter().collect({ advertiserId, advertiserName, brandName: body.brandName, domain: body.domain, periodDays: body.periodDays });
    const result = await importAndAnalyzeCremaMarket({ payload, provider: mode, periodDays: body.periodDays || 14 });
    return NextResponse.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "크리마 동기화에 실패했습니다.";
    await saveCremaConnectionError({ advertiserId, advertiserName, error: message }).catch(() => undefined);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
