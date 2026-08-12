import { NextResponse } from "next/server";
import { ObjectiveHookLearningService } from "../../../../lib/hook-experiments/learning";
import { HookValidationService } from "../../../../lib/hook-experiments/performance";
import {
  CreativePerformanceMatchingService,
  PerformanceImportService,
} from "../../../../lib/hook-experiments/performanceImport.server";
import { hookExperimentRepository } from "../../../../lib/hook-experiments/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function analyze(experimentId: string) {
  const snapshot = await hookExperimentRepository.get(experimentId);
  if (!snapshot) throw new Error("실험을 찾지 못했습니다.");
  const analysis = HookValidationService.analyze(snapshot);
  await hookExperimentRepository.saveAnalysis(analysis);
  const store = await hookExperimentRepository.readAll();
  const insights = ObjectiveHookLearningService.build(store);
  await hookExperimentRepository.replaceInsights(insights);
  return { analysis, snapshot: await hookExperimentRepository.get(experimentId), insights };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ experimentId: string }> }
) {
  try {
    const { experimentId } = await context.params;
    const snapshot = await hookExperimentRepository.get(experimentId);
    if (!snapshot)
      return NextResponse.json({ ok: false, error: "실험을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, experiment: snapshot });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "성과 조회 실패" },
      { status: 400 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ experimentId: string }> }
) {
  try {
    const { experimentId } = await context.params;
    const snapshot = await hookExperimentRepository.get(experimentId);
    if (!snapshot)
      return NextResponse.json({ ok: false, error: "실험을 찾지 못했습니다." }, { status: 404 });
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { ok: false, error: "Meta 보고서 CSV 또는 XLSX 파일이 필요합니다." },
        { status: 400 }
      );
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: "보고서 파일은 20MB 이하여야 합니다." },
        { status: 413 }
      );
    }
    const rows = PerformanceImportService.parse(
      Buffer.from(await file.arrayBuffer()),
      file.name,
      snapshot.experiment.objective
    );
    if (!rows.length)
      return NextResponse.json(
        { ok: false, error: "보고서에서 읽을 수 있는 행이 없습니다." },
        { status: 400 }
      );
    const records = await CreativePerformanceMatchingService.match({
      experiment: snapshot.experiment,
      experimentAssets: snapshot.experimentAssets,
      rows,
    });
    await hookExperimentRepository.savePerformance(experimentId, records);
    const result = await analyze(experimentId);
    return NextResponse.json({
      ok: true,
      ...result,
      matching: {
        total: records.length,
        matched: records.filter((record) => record.matchStatus === "matched").length,
        unresolved: records.filter((record) => record.matchStatus !== "matched").length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "성과 보고서 처리 실패" },
      { status: 500 }
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
      recordId?: string;
      experimentAssetId?: string;
    };
    const snapshot = await hookExperimentRepository.get(experimentId);
    const relation = snapshot?.experimentAssets.find(
      (item) => item.id === body.experimentAssetId && item.assetId && item.assetCode
    );
    if (!snapshot || !body.recordId || !relation?.assetId || !relation.assetCode) {
      return NextResponse.json(
        { ok: false, error: "보고서 행과 연결할 실험 소재를 선택해 주세요." },
        { status: 400 }
      );
    }
    await hookExperimentRepository.updatePerformanceMatch({
      experimentId,
      recordId: body.recordId,
      assetId: relation.assetId,
      assetCode: relation.assetCode,
      hookGroupId: relation.hookGroupId,
    });
    return NextResponse.json({ ok: true, ...(await analyze(experimentId)) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "수동 연결 실패" },
      { status: 400 }
    );
  }
}
