import { NextResponse } from "next/server";
import { storeAnalysisRepository } from "../../../lib/store-analysis/storeAnalysisRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ analysisId: string }> }) {
  try {
    const { analysisId } = await context.params;
    const result = await storeAnalysisRepository.getById(analysisId);
    if (!result) {
      return NextResponse.json({ ok: false, error: "분석 결과를 찾지 못했습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "분석 결과 조회 실패" }, { status: 400 });
  }
}
