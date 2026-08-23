import { NextRequest, NextResponse } from "next/server";
import { createMetaInsightsService } from "../../../lib/meta/insightsService.server";
import { metaRepository } from "../../../lib/meta/repository.server";
import type { PerformanceExperiment } from "../../../lib/meta/types";

export async function GET() {
  const store = await metaRepository.read();
  return NextResponse.json({
    ok: true,
    experiments: store.performance,
    registrations: store.registrations,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "connect") {
      const experiment = body.experiment as PerformanceExperiment;
      return NextResponse.json({
        ok: true,
        experiment: await metaRepository.upsertPerformance(experiment),
      });
    }
    if (action === "start" || action === "stop") {
      const store = await metaRepository.read();
      const experiment = store.performance.find((item) => item.id === String(body.experimentId));
      if (!experiment) throw new Error("성과 연결을 찾지 못했습니다.");
      const updated = {
        ...experiment,
        trackingEnabled: action === "start",
        trackingStatus: action === "start" ? ("collecting" as const) : experiment.trackingStatus === "archived" ? ("archived" as const) : ("draft" as const),
      };
      return NextResponse.json({
        ok: true,
        experiment: await metaRepository.upsertPerformance(updated),
      });
    }
    if (action === "refresh") {
      return NextResponse.json({
        ok: true,
        experiment: await createMetaInsightsService().refresh(String(body.experimentId || "")),
      });
    }
    return NextResponse.json({ ok: false, error: "지원하지 않는 성과 작업입니다." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "성과 작업 실패" }, { status: 400 });
  }
}
