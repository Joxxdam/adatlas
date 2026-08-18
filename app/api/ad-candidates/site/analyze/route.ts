import { NextResponse } from "next/server";
import { analyzeDiscoveredSite } from "../../../../lib/site-candidates/service.server";
import {
  assertSiteAnalysisRateLimit,
  SiteAnalysisRateLimitError,
} from "../../../../lib/site-candidates/rateLimit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSiteAnalysisRateLimit(request, "analyze");
    const body = (await request.json()) as { discoveryId?: unknown };
    const discoveryId = String(body.discoveryId || "").trim();
    if (!/^site-discovery-[a-f0-9-]{36}$/i.test(discoveryId)) {
      return NextResponse.json(
        { ok: false, error: "유효한 사이트 탐색 결과가 필요합니다." },
        { status: 400 }
      );
    }
    const analysis = await analyzeDiscoveredSite(discoveryId);
    return NextResponse.json({ ok: true, analysis });
  } catch (error) {
    if (error instanceof SiteAnalysisRateLimitError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
      );
    }
    const message =
      error instanceof Error ? error.message : "상품 후보 분석에 실패했습니다.";
    const status = /만료|찾지 못했습니다/.test(message) ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
