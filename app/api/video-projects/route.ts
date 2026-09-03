import { NextResponse } from "next/server";
import { videoProjectRepository, validateCreateVideoProjectInput } from "../../lib/video-collaboration/repository.server";
import type { CreateVideoProjectInput } from "../../lib/video-collaboration/types";
import { recommendAutomaticVideoDuration } from "../../lib/video-collaboration/videoPlanningBlueprints";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ ok: true, projects: await videoProjectRepository.list() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "프로젝트 목록 조회 실패" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Partial<CreateVideoProjectInput>;
    const normalizedBody = {
      ...body,
      duration:
        body.durationMode === "auto" && body.productAnalysis
          ? recommendAutomaticVideoDuration({
              analysis: body.productAnalysis,
              hasVideoReference: (body.referenceAssets || []).some((asset) => asset.mimeType.startsWith("video/")),
            })
          : body.duration,
    };
    validateCreateVideoProjectInput(normalizedBody);
    const project = await videoProjectRepository.create(normalizedBody as CreateVideoProjectInput);
    return NextResponse.json({ ok: true, project }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "프로젝트 생성 실패" }, { status: 400 });
  }
}
