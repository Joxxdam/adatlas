import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../lib/creative-generation/jobStore.server";
import { buildExperimentPlan, buildGenerationJobForExperiment } from "../../lib/hook-experiments/generation";
import { hookExperimentRepository } from "../../lib/hook-experiments/repository.server";
import { experimentObjectives, experimentStages, type CreateExperimentInput } from "../../lib/hook-experiments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    return NextResponse.json({ ok: true, experiments: await hookExperimentRepository.list() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "실험 목록 조회 실패" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<CreateExperimentInput>;
    if (!body.product?.productName?.trim()) {
      return NextResponse.json({ ok: false, error: "실험할 상품명이 필요합니다." }, { status: 400 });
    }
    if (!body.originalHostProductNo?.trim()) {
      return NextResponse.json({ ok: false, error: "원본 호스팅사 상품번호가 필요합니다." }, { status: 400 });
    }
    if (!body.objective || !experimentObjectives.includes(body.objective)) {
      return NextResponse.json({ ok: false, error: "실제 Meta 테스트 목표를 선택해 주세요." }, { status: 400 });
    }
    if (body.stage && !experimentStages.includes(body.stage)) {
      return NextResponse.json({ ok: false, error: "올바르지 않은 실험 단계입니다." }, { status: 400 });
    }
    const plan = buildExperimentPlan(body as CreateExperimentInput);
    if (await hookExperimentRepository.findByCode(plan.experiment.experimentCode)) {
      return NextResponse.json({ ok: false, error: "같은 상품·목표·회차의 실험이 이미 존재합니다." }, { status: 409 });
    }
    const job = await buildGenerationJobForExperiment(plan);
    await creativeGenerationJobStore.create(job);
    const saved = await hookExperimentRepository.createPlan(plan, job.id);
    return NextResponse.json({ ok: true, experiment: saved, job }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "후킹 실험 생성 실패";
    return NextResponse.json({ ok: false, error: message }, { status: /이미 존재/.test(message) ? 409 : 500 });
  }
}
