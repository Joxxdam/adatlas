import { NextResponse } from "next/server";
import { createAssetFromGenerationResult } from "../../../../../../../lib/creative-assets/fromGeneration.server";
import { toCreativeAssetSnapshot } from "../../../../../../../lib/creative-assets/types";
import { creativeGenerationJobStore } from "../../../../../../../lib/creative-generation/jobStore.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string; resultId: string }> }
) {
  try {
    const { jobId, resultId } = await context.params;
    const job = await creativeGenerationJobStore.get(jobId);
    if (!job) return NextResponse.json({ ok: false, error: "기존 생성 결과를 찾지 못했습니다." }, { status: 404 });
    const result = job.results.find((item) => item.id === resultId);
    if (!result) return NextResponse.json({ ok: false, error: "결과 항목을 찾지 못했습니다." }, { status: 404 });
    if (result.creativeAsset) return NextResponse.json({ ok: true, job, result, created: false });
    if (result.status !== "success" || !result.imagePath) {
      return NextResponse.json({ ok: false, error: "완료된 이미지에만 소재코드를 발급할 수 있습니다." }, { status: 409 });
    }
    const copy = result.renderPlan?.copy || {
      headline: result.hookPlan.headline,
      body: result.hookPlan.body,
      proof: result.hookPlan.proof,
      offer: result.hookPlan.offer,
    };
    const created = await createAssetFromGenerationResult({
      job,
      result,
      generatedImageUrl: result.imagePath,
      generationRequestKey: `creative-result-migration:${jobId}:${resultId}`,
      copy,
    });
    const updated = await creativeGenerationJobStore.update(jobId, (current) => ({
      ...current,
      results: current.results.map((item) =>
        item.id === resultId
          ? {
              ...item,
              downloadName: created.asset.fileName,
              creativeAsset: toCreativeAssetSnapshot(created.asset),
            }
          : item
      ),
    }));
    return NextResponse.json({
      ok: true,
      created: created.created,
      job: updated,
      result: updated.results.find((item) => item.id === resultId),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "소재코드 발급에 실패했습니다." },
      { status: 500 }
    );
  }
}
