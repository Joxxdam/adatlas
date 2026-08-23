import { NextResponse } from "next/server";
import { creativeAssetRepository } from "../../../lib/creative-assets/repository.server";
import { creativeAssetStatuses, type CreativeAssetStatus } from "../../../lib/creative-assets/types";
import { creativeContentNoteRepository } from "../../../lib/creative-content-notes/repository.server";
import type { CreativeContentNoteScope } from "../../../lib/creative-content-notes/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scopeKey(value: string, fallback: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9가-힣]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || fallback
  );
}

export async function GET(_request: Request, context: { params: Promise<{ assetCode: string }> }) {
  try {
    const { assetCode } = await context.params;
    const asset = await creativeAssetRepository.getByCode(assetCode);
    if (!asset) return NextResponse.json({ ok: false, error: "소재를 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, asset });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "소재 조회에 실패했습니다." }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ assetCode: string }> }) {
  try {
    const { assetCode } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      status?: CreativeAssetStatus;
      feedback?: {
        sentiment?: "positive" | "negative";
        content?: string;
        scope?: CreativeContentNoteScope;
        promotionId?: string;
      };
    };
    if (body.feedback?.sentiment) {
      const asset = await creativeAssetRepository.getByCode(assetCode);
      if (!asset) return NextResponse.json({ ok: false, error: "소재를 찾지 못했습니다." }, { status: 404 });
      const positive = body.feedback.sentiment === "positive";
      const scope = body.feedback.scope || "product";
      const advertiserId = asset.advertiserId || asset.brandId;
      const scopeId = scope === "advertiser" ? advertiserId : scope === "category" ? scopeKey(asset.category, "category") : scope === "promotion" ? String(body.feedback.promotionId || "").trim() : asset.productId;
      if (!scopeId) return NextResponse.json({ ok: false, error: "프로모션 범위에는 프로모션 ID가 필요합니다." }, { status: 400 });
      const note = await creativeContentNoteRepository.create({
        advertiserId,
        scope,
        scopeId,
        type: positive ? "PREFERRED_HOOK" : "AVOIDED_HOOK",
        title: `${asset.assetCode} 소재 피드백`,
        // Keep the machine-readable hook key as the default value. The planner
        // can then apply this feedback deterministically on the next job.
        content: String(body.feedback.content || asset.hookType).slice(0, 1000),
        required: false,
        // AVOIDED_HOOK controls hypothesis selection; it is not a prohibited
        // copy phrase and therefore must not enter the final-copy word filter.
        prohibited: false,
        active: true,
        startsAt: null,
        endsAt: null,
        source: "feedback",
      });
      return NextResponse.json({ ok: true, asset, contentNote: note });
    }
    if (!body.status || !creativeAssetStatuses.includes(body.status)) {
      return NextResponse.json({ ok: false, error: "올바른 소재 상태가 필요합니다." }, { status: 400 });
    }
    const asset = await creativeAssetRepository.updateStatus(assetCode, body.status);
    return NextResponse.json({ ok: true, asset });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "소재 상태 변경에 실패했습니다." }, { status: 400 });
  }
}
