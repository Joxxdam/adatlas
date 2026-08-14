import { NextResponse } from "next/server";
import { selectSiteCandidate } from "../../../../lib/site-candidates/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      analysisId?: unknown;
      candidateId?: unknown;
    };
    const analysisId = String(body.analysisId || "").trim();
    const candidateId = String(body.candidateId || "").trim();
    if (!/^site-analysis-[a-f0-9-]{36}$/i.test(analysisId) || !candidateId.startsWith("site-candidate-")) {
      return NextResponse.json(
        { ok: false, error: "선택할 사이트 광고 후보 정보가 올바르지 않습니다." },
        { status: 400 }
      );
    }
    const selection = selectSiteCandidate(analysisId, candidateId);
    return NextResponse.json({
      ok: true,
      selectionId: selection.selectionId,
      nextUrl: `/create-product?siteCandidateId=${encodeURIComponent(selection.selectionId)}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "광고 후보를 선택하지 못했습니다.";
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
}
