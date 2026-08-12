import { NextResponse } from "next/server";
import { creativeAssetRepository } from "../../lib/creative-assets/repository.server";
import type { CreateCreativeAssetInput, CreativeAssetStatus } from "../../lib/creative-assets/types";
import { creativeAssetStatuses } from "../../lib/creative-assets/types";
import { cremaMarketRepository } from "../../lib/crema-market/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const status = params.get("status") || undefined;
    const assets = await creativeAssetRepository.list({
      query: params.get("query") || undefined,
      assetCode: params.get("assetCode") || undefined,
      brand: params.get("brand") || undefined,
      product: params.get("product") || undefined,
      hook: params.get("hook") || undefined,
      dateFrom: params.get("dateFrom") || undefined,
      dateTo: params.get("dateTo") || undefined,
      status: creativeAssetStatuses.includes(status as CreativeAssetStatus)
        ? (status as CreativeAssetStatus)
        : undefined,
      limit: Number(params.get("limit") || 100),
    });
    return NextResponse.json({ ok: true, assets });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "소재 기록을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<CreateCreativeAssetInput>;
    if (!String(body.generatedImageUrl || "").trim()) {
      return NextResponse.json({ ok: false, error: "생성된 이미지 경로가 필요합니다." }, { status: 400 });
    }
    const result = await creativeAssetRepository.create(body as CreateCreativeAssetInput);
    if (body.opportunityId) {
      await cremaMarketRepository.updateOpportunity(body.opportunityId, { status: "creative_generated" }).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "소재 저장에 실패했습니다." },
      { status: 500 }
    );
  }
}
