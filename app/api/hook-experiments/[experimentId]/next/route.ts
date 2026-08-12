import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../../lib/creative-generation/jobStore.server";
import {
  buildExperimentPlan,
  buildGenerationJobForExperiment,
} from "../../../../lib/hook-experiments/generation";
import { NextExperimentService } from "../../../../lib/hook-experiments/learning";
import { hookExperimentRepository } from "../../../../lib/hook-experiments/repository.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  _request: Request,
  context: { params: Promise<{ experimentId: string }> }
) {
  try {
    const { experimentId } = await context.params;
    const current = await hookExperimentRepository.get(experimentId);
    if (!current?.analysis)
      return NextResponse.json(
        { ok: false, error: "먼저 성과 보고서를 분석해 주세요." },
        { status: 409 }
      );
    const next = NextExperimentService.nextStage(current.experiment, current.analysis);
    const plan = buildExperimentPlan({
      advertiserId: current.experiment.advertiserId,
      advertiserName: current.experiment.advertiserName,
      brandId: current.experiment.brandId,
      brandName: current.experiment.brandName,
      categoryId: current.experiment.categoryId,
      productId: current.experiment.productId,
      originalHostProductNo: current.experiment.originalHostProductNo,
      product: current.experiment.product,
      objective: current.experiment.objective,
      stage: next.stage,
      parentExperimentId: current.experiment.id,
      selectedHookCodes: next.selectedHookCodes,
      variantsPerHook: next.variantsPerHook,
      useControl: false,
      ruleConfig: current.experiment.ruleConfig,
      metaTestPlan: current.experiment.metaTestPlan,
    });
    if (await hookExperimentRepository.findByCode(plan.experiment.experimentCode)) {
      return NextResponse.json(
        { ok: false, error: "다음 단계 실험이 이미 존재합니다." },
        { status: 409 }
      );
    }
    const job = await buildGenerationJobForExperiment(plan);
    await creativeGenerationJobStore.create(job);
    const saved = await hookExperimentRepository.createPlan(plan, job.id);
    return NextResponse.json({ ok: true, experiment: saved, job }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "다음 실험 생성 실패" },
      { status: 400 }
    );
  }
}
