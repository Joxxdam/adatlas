import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../../lib/video-collaboration/repository.server";
import {
  analyzeVideoReferencesAi,
  generateVideoConceptSummariesAi,
  generateVideoHookCandidatesAi,
} from "../../../../lib/video-collaboration/videoPlanningGenerator.server";
import { VideoPlanningGenerationError } from "../../../../lib/video-collaboration/videoPlanningAi.server";
import type { VideoPipelineProgress } from "../../../../lib/video-collaboration/types";

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
    const progress: VideoPipelineProgress[] = [
      { stage: "productAnalysis", status: "complete", message: "상품 사실 분석 완료", updatedAt: new Date().toISOString() },
      { stage: "hookCandidates", status: "running", message: "참고자료와 고객 상황을 분석하는 중", updatedAt: new Date().toISOString() },
      { stage: "conceptCandidates", status: "pending", message: "4개 콘셉트 구성 대기", updatedAt: new Date().toISOString() },
      { stage: "validation", status: "pending", message: "품질검사 대기", updatedAt: new Date().toISOString() },
    ];
    await videoProjectRepository.updatePipelineProgress(projectId, progress);
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
    progress[1] = { stage: "hookCandidates", status: "complete", message: "후킹과 사건 후보 발굴 완료", updatedAt: new Date().toISOString() };
    progress[2] = { stage: "conceptCandidates", status: "running", message: "서로 다른 4개 콘셉트를 한 개씩 생성하는 중", updatedAt: new Date().toISOString() };
    await videoProjectRepository.updatePipelineProgress(projectId, progress);
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
      planningMode: project.planningMode,
      requiredContent: project.requiredContent,
      excludedContent: project.excludedContent,
    });
    progress[2] = { stage: "conceptCandidates", status: "complete", message: "4개 콘셉트 생성 완료", updatedAt: new Date().toISOString() };
    progress[3] = { stage: "validation", status: "complete", message: "차별성·사실 근거 품질검사 완료", updatedAt: new Date().toISOString() };
    if (conceptId) {
      const previous = project.concepts.find((concept) => concept.id === conceptId);
      if (!previous) throw new Error("다시 생성할 기획안을 찾지 못했습니다.");
      const replacement = generated.find((concept) => concept.conceptArchetype === previous.conceptArchetype) ||
        generated.find((concept) => concept.hookType === previous.hookType) ||
        generated.find((concept) => !project.concepts.some((item) =>
          item.id !== previous.id && item.hookType === concept.hookType
        )) || generated[0];
      const updated = await videoProjectRepository.saveConceptSummaries(projectId, [replacement], {
        actor: body.actor,
        hookCandidates: hooks,
        referenceAnalyses,
        replaceConceptId: conceptId,
      });
      await videoProjectRepository.updatePipelineProgress(projectId, progress);
      return NextResponse.json({ ok: true, project: updated, concepts: [replacement] });
    }
    const updated = await videoProjectRepository.saveConceptSummaries(projectId, generated, {
      actor: body.actor,
      hookCandidates: hooks,
      referenceAnalyses,
    });
    await videoProjectRepository.updatePipelineProgress(projectId, progress);
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
