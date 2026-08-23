import { NextResponse } from "next/server";
import { storeAnalysisService } from "../../../lib/store-analysis/storeAnalysisService";
import { StoreAnalysisNetworkError } from "../../../lib/store-analysis/urlSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await storeAnalysisService.analyze(body);
    return NextResponse.json({
      ok: true,
      analysisId: result.analysisId,
      status: "completed",
      stats: result.stats,
      warnings: result.warnings,
    });
  } catch (error) {
    const networkError = error instanceof StoreAnalysisNetworkError ? error : null;
    const status = networkError ? (["INVALID_URL", "UNSAFE_URL"].includes(networkError.code) ? 400 : networkError.code === "ACCESS_BLOCKED" ? 403 : 502) : 500;
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        error: error instanceof Error ? error.message : "업체 분석 중 오류가 발생했습니다.",
        code: networkError?.code,
      },
      { status }
    );
  }
}
