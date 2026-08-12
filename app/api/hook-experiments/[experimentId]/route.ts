import { NextResponse } from "next/server";
import { creativeAssetRepository } from "../../../lib/creative-assets/repository.server";
import { hookExperimentRepository } from "../../../lib/hook-experiments/repository.server";
import type { CreativeExperiment, ExperimentAsset } from "../../../lib/hook-experiments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ experimentId: string }> }
) {
  try {
    const { experimentId } = await context.params;
    const experiment = await hookExperimentRepository.get(experimentId);
    if (!experiment)
      return NextResponse.json({ ok: false, error: "실험을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, experiment });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "실험 조회 실패" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ experimentId: string }> }
) {
  try {
    const { experimentId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: "update-registration" | "update-experiment" | "link-asset";
      experimentAssetId?: string;
      assetCode?: string;
      changes?: Partial<ExperimentAsset> & Partial<CreativeExperiment>;
    };
    if (body.action === "update-registration" && body.experimentAssetId) {
      const relation = await hookExperimentRepository.updateAssetRegistration(
        experimentId,
        body.experimentAssetId,
        {
          hostingRegistrationStatus: body.changes?.hostingRegistrationStatus,
          registeredHostProductNo: body.changes?.registeredHostProductNo,
          cremaCollectionStatus: body.changes?.cremaCollectionStatus,
          catalogProductId: body.changes?.catalogProductId,
          productMatchStatus: body.changes?.productMatchStatus,
          notes: body.changes?.notes,
        }
      );
      return NextResponse.json({ ok: true, relation });
    }
    if (body.action === "update-experiment") {
      const current = await hookExperimentRepository.get(experimentId);
      if (!current)
        return NextResponse.json({ ok: false, error: "실험을 찾지 못했습니다." }, { status: 404 });
      const experiment = await hookExperimentRepository.updateExperiment(experimentId, {
        status: body.changes?.status,
        metaTestPlan: body.changes?.metaTestPlan
          ? {
              ...current.experiment.metaTestPlan,
              ...body.changes.metaTestPlan,
              campaignObjective: current.experiment.objective,
            }
          : undefined,
        startDate: body.changes?.startDate,
        endDate: body.changes?.endDate,
      });
      return NextResponse.json({ ok: true, experiment });
    }
    if (body.action === "link-asset" && body.experimentAssetId && body.assetCode) {
      const asset = await creativeAssetRepository.getByCode(body.assetCode);
      if (!asset)
        return NextResponse.json(
          { ok: false, error: "연결할 소재코드를 찾지 못했습니다." },
          { status: 404 }
        );
      const snapshot = await hookExperimentRepository.get(experimentId);
      const slot = snapshot?.experimentAssets.find((item) => item.id === body.experimentAssetId);
      if (!slot)
        return NextResponse.json(
          { ok: false, error: "연결할 실험 슬롯을 찾지 못했습니다." },
          { status: 404 }
        );
      if (asset.hookCode !== slot.hookCode) {
        return NextResponse.json(
          { ok: false, error: `후킹 코드가 다릅니다. ${slot.hookCode} 소재만 연결할 수 있습니다.` },
          { status: 409 }
        );
      }
      const relation = await hookExperimentRepository.linkExistingAsset({
        experimentId,
        experimentAssetId: slot.id,
        assetId: asset.id,
        assetCode: asset.assetCode,
      });
      return NextResponse.json({ ok: true, relation });
    }
    return NextResponse.json(
      { ok: false, error: "지원하지 않는 수정 요청입니다." },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "실험 수정 실패" },
      { status: 400 }
    );
  }
}
