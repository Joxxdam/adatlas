import { NextResponse } from "next/server";
import { crawlWatchlist } from "../../../lib/watchlist/crawler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limit = body.limit ? Number(body.limit) : 100;
    const priority = body.priority ? String(body.priority) : undefined;
    const result = await crawlWatchlist({ limit, priority });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "워치리스트 크롤링 실패" },
      { status: 500 },
    );
  }
}
