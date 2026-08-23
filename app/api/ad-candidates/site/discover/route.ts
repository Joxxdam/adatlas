import { NextResponse } from "next/server";
import { StoreAnalysisNetworkError } from "../../../../lib/store-analysis/urlSafety";
import { discoverSiteCandidates } from "../../../../lib/site-candidates/crawler.server";
import { cacheSiteDiscovery } from "../../../../lib/site-candidates/service.server";
import { siteCandidateCache } from "../../../../lib/site-candidates/cache.server";
import { assertSiteAnalysisRateLimit, SiteAnalysisRateLimitError } from "../../../../lib/site-candidates/rateLimit.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusForError(error: unknown) {
  if (!(error instanceof StoreAnalysisNetworkError)) return 500;
  if (error.code === "TIMEOUT") return 408;
  if (error.code === "ACCESS_BLOCKED") return 403;
  if (error.code === "REQUEST_FAILED" || error.code === "DNS_FAILED") return 502;
  return 400;
}

export async function POST(request: Request) {
  try {
    assertSiteAnalysisRateLimit(request, "discover");
    const body = (await request.json()) as { url?: unknown };
    const url = String(body.url || "").trim();
    if (!url || url.length > 2_048) {
      return NextResponse.json({ ok: false, error: "분석할 업체·카테고리·기획전 또는 상품 URL을 입력해주세요." }, { status: 400 });
    }
    const cached = siteCandidateCache.getDiscoveryByUrl(url);
    const discovery = cached || cacheSiteDiscovery(await discoverSiteCandidates(url));
    return NextResponse.json({ ok: true, discovery, cacheStatus: cached ? "hit" : "miss" });
  } catch (error) {
    if (error instanceof SiteAnalysisRateLimitError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    }
    const message = error instanceof Error ? error.message : "사이트 URL을 확인하지 못했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: statusForError(error) });
  }
}
