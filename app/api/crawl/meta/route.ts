import { NextResponse } from "next/server";
import { crawlMetaAdLibrary } from "../../../lib/meta-crawler/crawlMetaAdLibrary";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const brandName = String(body.brandName ?? "").trim();
    const metaLibraryUrl = String(body.metaLibraryUrl ?? "").trim();
    const limit = body.limit ? Number(body.limit) : 20;

    const result = await crawlMetaAdLibrary({ brandName, metaLibraryUrl, limit });
    const items = result.ads
      .map((ad) => ({
        brandName: ad.brandName,
        imageUrl: ad.imageUrl || ad.videoThumbnailUrl || "",
        originalAdUrl: ad.adSnapshotUrl || ad.landingUrl || "",
        collectedAt: ad.crawledAt,
      }))
      .filter((item) => item.imageUrl);

    return NextResponse.json({
      success: true,
      brandName: result.brandName,
      count: items.length,
      items,
      warnings: result.warnings,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Meta Ad Library crawl failed.",
      },
      { status: 500 },
    );
  }
}
