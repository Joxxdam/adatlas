import { NextResponse } from "next/server";
import { cremaMarketRepository } from "../../lib/crema-market/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const advertiserId = new URL(request.url).searchParams.get("advertiserId")?.trim();
    if (advertiserId) {
      const dataset = await cremaMarketRepository.get(advertiserId);
      if (!dataset) return NextResponse.json({ ok: false, error: "저장된 크리마켓 데이터가 없습니다." }, { status: 404 });
      return NextResponse.json({ ok: true, dataset });
    }
    const datasets = await cremaMarketRepository.list();
    return NextResponse.json({
      ok: true,
      configured: Boolean(process.env.CREMA_APP_ID && process.env.CREMA_SECRET),
      advertisers: datasets.map((dataset) => ({
        ...dataset.advertiser,
        productCount: dataset.products.length,
        opportunityCount: dataset.opportunities.filter((item) => item.status === "recommended").length,
        latestAnalysisRun: dataset.analysisRuns.at(-1) || null,
        latestQualityReport: dataset.qualityReports.at(-1) || null,
      })),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "크리마켓 데이터를 불러오지 못했습니다." }, { status: 500 });
  }
}
