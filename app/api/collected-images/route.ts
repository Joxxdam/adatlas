import { NextResponse } from "next/server";
import { readCollectedAdImages, updateCollectedAdImage } from "../../lib/mvp/collectedImageStore";
import { CollectedAdImage } from "../../lib/mvp/types";

export const runtime = "nodejs";

export async function GET() {
  const images = await readCollectedAdImages();
  return NextResponse.json({ ok: true, images });
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as Partial<CollectedAdImage> & { id?: string };

    if (!body.id) {
      return NextResponse.json({ ok: false, error: "id가 필요합니다." }, { status: 400 });
    }

    const image = await updateCollectedAdImage({
      id: body.id,
      brandName: body.brandName,
      category: body.category,
      hookType: body.hookType,
      appealPoint: body.appealPoint,
      sourcePlatform: body.sourcePlatform,
      originalAdUrl: body.originalAdUrl,
    });
    const images = await readCollectedAdImages();

    return NextResponse.json({ ok: true, image, images });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "이미지 메타데이터 저장 실패" },
      { status: 500 }
    );
  }
}
