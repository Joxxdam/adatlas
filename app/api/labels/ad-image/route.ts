import { NextResponse } from "next/server";
import { readAdImageLabels, upsertAdImageLabel } from "../../../lib/mvp/labelStore";
import { AdImageLabel } from "../../../lib/mvp/types";

export const runtime = "nodejs";

const emptyAnalysisDraft = {
  ocrText: "",
  category: "",
  hookType: "",
  appealPoint: "",
  targetEmotion: "",
  copyNuance: "",
  visualTone: "",
  layoutPattern: "",
  whyItWorks: "",
  recommendedUse: "",
  firstLineHook: "",
  copyStructure: "",
  toneOfVoice: "",
  trendElements: "",
  consumerInsight: "",
  purchaseTrigger: "",
  reusableCopyPattern: "",
  visualCopyRelation: "",
};

function normalizeAnalysisDraft(
  value: Partial<AdImageLabel["finalLabel"]> | undefined,
  category = ""
) {
  return {
    ...emptyAnalysisDraft,
    ...(value ?? {}),
    category: value?.category ?? category,
  };
}

export async function GET() {
  const labels = await readAdImageLabels();
  return NextResponse.json({
    ok: true,
    labels: labels.map((label) => ({
      ...label,
      aiDraft: normalizeAnalysisDraft(label.aiDraft, label.category),
      finalLabel: normalizeAnalysisDraft(label.finalLabel, label.category),
    })),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AdImageLabel>;

    if (!body.imageId || !body.aiDraft || !body.finalLabel) {
      return NextResponse.json(
        { ok: false, error: "imageId, aiDraft, finalLabel이 필요합니다." },
        { status: 400 }
      );
    }

    const label = await upsertAdImageLabel({
      imageId: body.imageId,
      category: body.category ?? body.finalLabel.category ?? "",
      brandName: body.brandName ?? "",
      sourcePlatform: body.sourcePlatform ?? "",
      localImagePath: body.localImagePath,
      aiDraft: normalizeAnalysisDraft(
        body.aiDraft,
        body.category ?? body.finalLabel.category ?? ""
      ),
      finalLabel: normalizeAnalysisDraft(
        body.finalLabel,
        body.category ?? body.finalLabel.category ?? ""
      ),
      labeledAt: new Date().toISOString(),
    });

    const labels = await readAdImageLabels();
    return NextResponse.json({ ok: true, label, labels });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "라벨 저장 실패" },
      { status: 500 }
    );
  }
}
