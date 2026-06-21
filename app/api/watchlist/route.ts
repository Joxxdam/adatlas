import { NextResponse } from "next/server";
import { readContentAnalyses, readWatchlist } from "../../lib/watchlist/store";

export const runtime = "nodejs";

export async function GET() {
  const [watchlist, analyses] = await Promise.all([readWatchlist(), readContentAnalyses()]);
  return NextResponse.json({
    brands: watchlist.length,
    enabled: watchlist.filter((brand) => brand.enabled).length,
    analyses: analyses.length,
    latest: analyses.slice(0, 12),
  });
}
