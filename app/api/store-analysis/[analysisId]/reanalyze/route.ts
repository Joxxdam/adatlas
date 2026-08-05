import { NextResponse } from "next/server";
import { storeAnalysisRepository } from "../../../../lib/store-analysis/storeAnalysisRepository";
import { storeAnalysisService } from "../../../../lib/store-analysis/storeAnalysisService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ analysisId: string }> }
) {
  try {
    const { analysisId } = await context.params;
    const previous = await storeAnalysisRepository.getById(analysisId);
    if (!previous) {
      return NextResponse.json(
        { ok: false, error: "기존 분석 결과를 찾지 못했습니다." },
        { status: 404 }
      );
    }
    const result = await storeAnalysisService.analyze(previous.options);
    return NextResponse.json({ ok: true, analysisId: result.analysisId, status: "completed" });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "재분석 실패" },
      { status: 500 }
    );
  }
}
