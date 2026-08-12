import { NextResponse } from "next/server";
import { hookExperimentRepository } from "../../../lib/hook-experiments/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const insights = await hookExperimentRepository.listInsights({
      advertiserId: params.get("advertiserId") || undefined,
      productId: params.get("productId") || undefined,
      objective: params.get("objective") || undefined,
    });
    return NextResponse.json({ ok: true, insights });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "학습 인사이트 조회 실패" },
      { status: 500 }
    );
  }
}
