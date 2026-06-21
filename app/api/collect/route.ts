import { NextResponse } from "next/server";
import { collectReferences } from "../../lib/collectors";
import { saveCollectedReferences } from "../../lib/collectors/store";
import { CollectorSource } from "../../lib/collectors/types";

export const runtime = "nodejs";

const supportedSources: CollectorSource[] = ["meta", "tiktok", "pinterest"];

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const source = body.source as CollectorSource;
    const query = String(body.query ?? "").trim();
    const country = String(body.country ?? "KR").trim().toUpperCase();
    const fromDate = String(body.fromDate ?? "").trim();
    const toDate = String(body.toDate ?? "").trim();
    const limit = Number(body.limit ?? 25);

    if (!supportedSources.includes(source)) {
      return NextResponse.json({ error: "지원하지 않는 플랫폼입니다." }, { status: 400 });
    }
    if (!query || !fromDate || !toDate) {
      return NextResponse.json({ error: "검색 키워드와 게재 기간을 입력하세요." }, { status: 400 });
    }
    if (fromDate > toDate) {
      return NextResponse.json({ error: "게재 시작일은 종료일보다 늦을 수 없습니다." }, { status: 400 });
    }

    const items = await collectReferences({ source, query, country, fromDate, toDate, limit });
    const saved = await saveCollectedReferences(items);

    return NextResponse.json({
      ok: true,
      source,
      fetched: items.length,
      added: saved.added,
      total: saved.total,
      items,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "수집 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
