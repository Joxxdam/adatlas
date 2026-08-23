import { NextResponse } from "next/server";

import { recommendBackgrounds } from "../../../lib/background-library/recommender";
import { readBackgroundLibrary, summarizeBackgroundLibrary } from "../../../lib/background-library/store";
import type { BackgroundRecommendationInput } from "../../../lib/background-library/types";

export const runtime = "nodejs";

export async function GET() {
  const items = await readBackgroundLibrary();
  return NextResponse.json({ ok: true, items, summary: summarizeBackgroundLibrary(items) });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<BackgroundRecommendationInput>;
    if (!body.product || !body.hook) {
      return NextResponse.json({ ok: false, error: "상품 정보와 선택한 후킹이 필요합니다." }, { status: 400 });
    }
    const items = await readBackgroundLibrary();
    const result = recommendBackgrounds(items, {
      product: body.product,
      hook: body.hook,
      limit: body.limit || 6,
      excludeIds: Array.isArray(body.excludeIds) ? body.excludeIds.slice(0, 72) : [],
      selectedIds: Array.isArray(body.selectedIds) ? body.selectedIds.slice(0, 24) : [],
      recommendationPage: Number.isFinite(body.recommendationPage) ? Number(body.recommendationPage) : 0,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      summary: summarizeBackgroundLibrary(items),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "배경 추천에 실패했습니다." }, { status: 500 });
  }
}
