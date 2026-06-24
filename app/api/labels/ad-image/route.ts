import { NextResponse } from "next/server";
import { readAdImageLabels, upsertAdImageLabel } from "../../../lib/mvp/labelStore";
import { AdImageLabel } from "../../../lib/mvp/types";

export const runtime = "nodejs";

export async function GET() {
  const labels = await readAdImageLabels();
  return NextResponse.json({ ok: true, labels });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AdImageLabel>;

    if (!body.imageId || !body.aiDraft || !body.finalLabel) {
      return NextResponse.json({ ok: false, error: "imageId, aiDraft, finalLabel이 필요합니다." }, { status: 400 });
    }

    const label = await upsertAdImageLabel({
      imageId: body.imageId,
      category: body.category ?? body.finalLabel.category ?? "",
      brandName: body.brandName ?? "",
      sourcePlatform: body.sourcePlatform ?? "",
      localImagePath: body.localImagePath,
      aiDraft: body.aiDraft,
      finalLabel: {
        ...body.finalLabel,
        category: body.finalLabel.category ?? body.category ?? "",
      },
      labeledAt: new Date().toISOString(),
    });

    const labels = await readAdImageLabels();
    return NextResponse.json({ ok: true, label, labels });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "라벨 저장 실패" },
      { status: 500 },
    );
  }
}
