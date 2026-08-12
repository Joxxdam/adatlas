import { NextResponse } from "next/server";
import { creativeGenerationJobStore } from "../../../../lib/creative-generation/jobStore.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const job = await creativeGenerationJobStore.get(jobId);
    if (!job) return NextResponse.json({ ok: false, error: "작업을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "작업 조회 실패" }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { action?: "cancel" | "resume" };
    if (!body.action || !["cancel", "resume"].includes(body.action)) {
      return NextResponse.json({ ok: false, error: "cancel 또는 resume 액션이 필요합니다." }, { status: 400 });
    }
    const job = await creativeGenerationJobStore.update(jobId, (current) => {
      if (body.action === "cancel") {
        return {
          ...current,
          status: "cancelled",
          cancelledAt: new Date().toISOString(),
          results: current.results.map((result) =>
            result.status === "pending" || result.status === "running"
              ? { ...result, status: "cancelled" }
              : result
          ),
        };
      }
      return {
        ...current,
        status: "running",
        cancelledAt: undefined,
        completedAt: undefined,
        startedAt: current.startedAt || new Date().toISOString(),
        results: current.results.map((result) =>
          result.status === "cancelled" || result.status === "failed"
            ? { ...result, status: "pending", error: undefined }
            : result
        ),
      };
    });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "작업 상태 변경 실패" }, { status: 400 });
  }
}
