import { NextResponse } from "next/server";
import { buildProductCreationHandoff } from "../../../../../lib/store-analysis/productCreationAdapter";
import { storeAnalysisRepository } from "../../../../../lib/store-analysis/storeAnalysisRepository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ analysisId: string; productId: string }> }) {
  try {
    const { analysisId, productId } = await context.params;
    const result = await storeAnalysisRepository.getById(analysisId);
    if (!result) {
      return NextResponse.json({ ok: false, error: "분석 결과를 찾지 못했습니다." }, { status: 404 });
    }
    const angle = new URL(request.url).searchParams.get("angle") || undefined;
    const product = result.products.find((item) => item.product.id === productId);
    const handoff = buildProductCreationHandoff({
      result,
      productId,
      angleIdOrType: angle,
    });
    if (!product || !handoff) {
      return NextResponse.json({ ok: false, error: "분석 상품을 찾지 못했습니다." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, product, handoff });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "상품 분석 결과 조회 실패" }, { status: 400 });
  }
}
