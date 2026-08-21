import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../../lib/video-collaboration/repository.server";
import {
  analyzeVideoReferencesAi,
  generateVideoConceptSummariesAi,
  generateVideoHookCandidatesAi,
} from "../../../../lib/video-collaboration/videoPlanningGenerator.server";
import { VideoPlanningGenerationError } from "../../../../lib/video-collaboration/videoPlanningAi.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  let conceptId: string | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      conceptId?: string;
      actor?: string;
    };
    conceptId = body.conceptId;
    const project = await videoProjectRepository.get(projectId);
    if (!project) throw new Error("영상 프로젝트를 찾지 못했습니다.");
    if (!["script_pending", "script_review", "concept_selected"].includes(project.status)) {
      throw new Error("기획 중이거나 기획안 검토 단계에서만 다시 생성할 수 있습니다.");
    }
    const referenceAnalyses = project.referenceAssets.length && !project.referenceAnalyses?.length
      ? await analyzeVideoReferencesAi(project.referenceAssets)
      : project.referenceAnalyses || [];
    const hooks = project.hookCandidates && project.hookCandidates.length >= 7
      ? project.hookCandidates
      : await generateVideoHookCandidatesAi(
          project.productAnalysis,
          project.brandGuideline,
          referenceAnalyses
        );
    const generated = await generateVideoConceptSummariesAi({
      advertiserName: project.advertiserName,
      analysis: project.productAnalysis,
      guideline: project.brandGuideline,
      duration: project.duration,
      objective: project.objective,
      hooks,
      existingConcepts: project.concepts,
      referenceAnalyses,
      conceptFormat: project.conceptFormat,
    });
    if (conceptId) {
      const previous = project.concepts.find((concept) => concept.id === conceptId);
      if (!previous) throw new Error("다시 생성할 기획안을 찾지 못했습니다.");
      const replacement = generated.find((concept) => concept.hookType === previous.hookType) ||
        generated.find((concept) => !project.concepts.some((item) =>
          item.id !== previous.id && item.hookType === concept.hookType
        )) || generated[0];
      const updated = await videoProjectRepository.saveConceptSummaries(projectId, [replacement], {
        actor: body.actor,
        hookCandidates: hooks,
        referenceAnalyses,
        replaceConceptId: conceptId,
      });
      return NextResponse.json({ ok: true, project: updated, concepts: [replacement] });
    }
    const updated = await videoProjectRepository.saveConceptSummaries(projectId, generated, {
      actor: body.actor,
      hookCandidates: hooks,
      referenceAnalyses,
    });
    return NextResponse.json({ ok: true, project: updated, concepts: generated });
  } catch (error) {
    const failure = error instanceof VideoPlanningGenerationError
      ? error.failure
      : {
          stage: "concept-summaries" as const,
          code: "CONCEPT_SUMMARY_FAILED",
          message: error instanceof Error ? error.message : "AI 영상 기획 생성에 실패했습니다.",
          retryable: true,
          attempts: 1,
          failedAt: new Date().toISOString(),
        };
    await videoProjectRepository.saveGenerationFailure(projectId, failure, { conceptId }).catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: failure.message, failure },
      { status: failure.code === "AI_NOT_AUTHENTICATED" ? 503 : 422 }
    );
  }
}
