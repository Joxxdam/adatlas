import { NextResponse } from "next/server";
import { collectImagesForBrands } from "../../../lib/mvp/imageCollector";
import { mergeImages, readBrands } from "../../../lib/mvp/store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const limitPerBrand = Math.min(Number(body.limitPerBrand ?? 20), 20);
    const brandLimit = Number(body.brandLimit ?? 100);
    const brands = (await readBrands()).filter((brand) => brand.enabled).slice(0, brandLimit);
    const result = await collectImagesForBrands(brands, limitPerBrand);
    const saved = await mergeImages(result.images);

    return NextResponse.json({
      ok: true,
      status: result.status,
      added: saved.added,
      totalImages: saved.total,
      images: result.images,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "이미지 수집 실패" },
      { status: 500 },
    );
  }
}
