import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../../../../lib/video-collaboration/repository.server";
import { renderVideoPlanningPdf } from "../../../../../../lib/video-collaboration/videoPlanningPdf.server";
import { videoPlanningPdfFileName } from "../../../../../../lib/video-collaboration/videoPlanningPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; conceptId: string }> }
) {
  try {
    const { projectId, conceptId } = await context.params;
    const project = await videoProjectRepository.get(projectId);
    const concept = project?.concepts.find((item) => item.id === conceptId);
    if (!project || !concept) {
      return NextResponse.json(
        { ok: false, error: "영상 기획안을 찾지 못했습니다." },
        { status: 404 }
      );
    }
    if (!concept.cuts.length) {
      return NextResponse.json(
        { ok: false, error: "자막과 영상 장면안을 먼저 생성해 주세요." },
        { status: 409 }
      );
    }
    const pdf = await renderVideoPlanningPdf(project, concept);
    const fileName = videoPlanningPdfFileName(project, concept);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdf.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error(
      "[video-planning-pdf] render failed",
      error instanceof Error ? error.name : "UnknownError"
    );
    return NextResponse.json(
      { ok: false, error: "PDF 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 }
    );
  }
}
