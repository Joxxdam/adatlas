import { NextResponse } from "next/server";
import { autoFillCategoryCreativeSources } from "../../../../lib/category-creatives/autoSource.server";
import { assertInternalApiAccess, InternalApiAccessError } from "../../../../lib/internal-api/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertInternalApiAccess(request);
    const body = (await request.json()) as {
      advertiserId?: string;
      advertiserName?: string;
      categoryId?: string;
    };
    const advertiserId = String(body.advertiserId || "").trim();
    const advertiserName = String(body.advertiserName || "").trim();
    const categoryId = String(body.categoryId || "").trim();
    if (!advertiserId || !categoryId) {
      return NextResponse.json({ ok: false, error: "광고주와 카테고리를 선택해 주세요." }, { status: 400 });
    }

    const result = await autoFillCategoryCreativeSources({ advertiserId, advertiserName, categoryId });
    return NextResponse.json({
      ok: true,
      ...result,
      selectedSourceIds: result.selectedSources.map((source) => source.id),
    });
  } catch (error) {
    if (error instanceof InternalApiAccessError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "카테고리 상품을 자동으로 준비하지 못했습니다." },
      { status: 500 },
    );
  }
}
