import { NextResponse } from "next/server";
import { POST as extractProduct } from "../../extract/product/route";
import { adaptExtractedProductToVideoSnapshot } from "../../../lib/video-collaboration/analysisAdapter";
import { enrichVideoProductAnalysis } from "../../../lib/video-collaboration/analysisEnricher.server";
import {
  sanitizeVideoPlanningErrorMessage,
  VideoPlanningGenerationError,
  videoPlanningFailureHttpStatus,
} from "../../../lib/video-collaboration/videoPlanningAi.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { productUrl?: string };
    const productUrl = String(body.productUrl || "").trim();
    if (!productUrl) {
      return NextResponse.json({ ok: false, error: "상품 URL을 입력해 주세요." }, { status: 400 });
    }
    const extractionResponse = await extractProduct(
      new Request(request.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productUrl }),
      })
    );
    const payload = await extractionResponse.json();
    if (!extractionResponse.ok) {
      return NextResponse.json(
        { ok: false, error: payload.error || "상품 분석에 실패했습니다." },
        { status: extractionResponse.status }
      );
    }
    const snapshot = await enrichVideoProductAnalysis(
      adaptExtractedProductToVideoSnapshot(payload, productUrl)
    );
    return NextResponse.json({
      ok: true,
      snapshot,
      extracted: payload.productInfo,
    });
  } catch (error) {
    if (error instanceof VideoPlanningGenerationError) {
      return NextResponse.json(
        { ok: false, error: error.failure.message, failure: error.failure },
        { status: videoPlanningFailureHttpStatus(error.failure.code) }
      );
    }
    return NextResponse.json(
      { ok: false, error: sanitizeVideoPlanningErrorMessage(error) || "상품 분석 실패" },
      { status: 500 }
    );
  }
}
