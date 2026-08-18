import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../../lib/video-collaboration/repository.server";
import { generateVideoConcepts } from "../../../../lib/video-collaboration/scriptGenerator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      conceptId?: string;
      actor?: string;
    };
    const project = await videoProjectRepository.get(projectId);
    if (!project) throw new Error("영상 프로젝트를 찾지 못했습니다.");
    if (!["script_pending", "script_review"].includes(project.status)) {
      throw new Error("대본 생성 또는 검토 단계에서만 기획안을 생성할 수 있습니다.");
    }
    const existing = body.conceptId
      ? project.concepts.filter((concept) => concept.id === body.conceptId)
      : project.concepts;
    if (body.conceptId && !existing.length)
      throw new Error("다시 생성할 기획안을 찾지 못했습니다.");
    const concepts = await generateVideoConcepts({
      advertiserName: project.advertiserName,
      analysis: project.productAnalysis,
      guideline: project.brandGuideline,
      duration: project.duration,
      objective: project.objective,
      hookTypes: body.conceptId ? [existing[0].hookType] : undefined,
      existingConcepts: existing,
    });
    const updated = await videoProjectRepository.saveGeneratedConcepts(projectId, concepts, {
      conceptId: body.conceptId,
      actor: body.actor,
    });
    return NextResponse.json({ ok: true, project: updated, concepts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "영상 기획안 생성 실패";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("찾지 못") ? 404 : 400 }
    );
  }
}
