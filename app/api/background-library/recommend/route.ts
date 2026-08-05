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
      limit: body.limit || 3,
    });
    return NextResponse.json({
      ok: true,
      ...result,
      summary: summarizeBackgroundLibrary(items),
      aiGenerationAvailable: Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY),
      preferredAiProvider: process.env.OPENAI_API_KEY ? "openai" : process.env.GEMINI_API_KEY ? "gemini" : null,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "배경 추천에 실패했습니다." },
      { status: 500 }
    );
  }
}
