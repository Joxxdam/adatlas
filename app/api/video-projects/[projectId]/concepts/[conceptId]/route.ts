import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../../../lib/video-collaboration/repository.server";
import {
  generateDetailedVideoScriptAi,
  regeneratePlanningSegmentAi,
} from "../../../../../lib/video-collaboration/videoPlanningGenerator.server";
import {
  VideoPlanningGenerationError,
  videoPlanningFailureHttpStatus,
} from "../../../../../lib/video-collaboration/videoPlanningAi.server";
import {
  hasReusableDetailedVideoPlan,
  videoPlanningGenerationKey,
  withVideoPlanningGenerationLock,
} from "../../../../../lib/video-collaboration/videoPlanningRequestGuards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; conceptId: string }> }
) {
  const { projectId, conceptId } = await context.params;
  const project = await videoProjectRepository.get(projectId);
  const concept = project?.concepts.find((item) => item.id === conceptId);
  if (!project || !concept) {
    return NextResponse.json(
      { ok: false, error: "영상 기획안을 찾지 못했습니다." },
      { status: 404 }
    );
  }
  return NextResponse.json({ ok: true, project, concept });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; conceptId: string }> }
) {
  const { projectId, conceptId } = await context.params;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "generate-detail" | "regenerate-detail" | "regenerate-caption" | "regenerate-scene";
      cutId?: string;
      actor?: string;
      feedback?: string;
    };
    const project = await videoProjectRepository.get(projectId);
    const concept = project?.concepts.find((item) => item.id === conceptId);
    if (!project || !concept) throw new Error("영상 기획안을 찾지 못했습니다.");
    const action = body.action || "generate-detail";
    if (
      action === "generate-detail" &&
      !body.feedback?.trim() &&
      hasReusableDetailedVideoPlan(concept, project.duration)
    ) {
      return NextResponse.json({ ok: true, project, concept, reused: true });
    }
    return await withVideoPlanningGenerationLock({
      key: videoPlanningGenerationKey(
        projectId,
        conceptId,
        body.cutId ? `${action}:${body.cutId}` : action
      ),
      stage: "detailed-script",
      run: async () => {
        let generated;
        if (action === "regenerate-caption" || action === "regenerate-scene") {
          if (!body.cutId) throw new Error("다시 생성할 구간을 확인해 주세요.");
          generated = await regeneratePlanningSegmentAi({
            analysis: project.productAnalysis,
            guideline: project.brandGuideline,
            concept,
            cutId: body.cutId,
            field: action === "regenerate-caption" ? "caption" : "sceneDescription",
            duration: project.duration,
          });
          const updated = await videoProjectRepository.saveScript(
            projectId,
            conceptId,
            generated,
            body.actor || project.marketerName,
            { createRevision: true }
          );
          return NextResponse.json({ ok: true, project: updated, concept: generated });
        }
        generated = await generateDetailedVideoScriptAi({
          analysis: project.productAnalysis,
          guideline: project.brandGuideline,
          concept,
          duration: project.duration,
          referenceAnalyses: project.referenceAnalyses,
          revisionFeedback: body.feedback,
        });
        const updated = await videoProjectRepository.saveGeneratedConcepts(projectId, [generated], {
          conceptId,
          actor: body.actor || project.marketerName,
        });
        return NextResponse.json({ ok: true, project: updated, concept: generated });
      },
    });
  } catch (error) {
    const failure =
      error instanceof VideoPlanningGenerationError
        ? error.failure
        : {
            stage: "detailed-script" as const,
            code: "DETAILED_SCRIPT_FAILED",
            message: error instanceof Error ? error.message : "상세 대본 생성에 실패했습니다.",
            retryable: true,
            attempts: 1,
            failedAt: new Date().toISOString(),
          };
    if (failure.code !== "GENERATION_ALREADY_RUNNING") {
      await videoProjectRepository
        .saveGenerationFailure(projectId, failure, { conceptId })
        .catch(() => undefined);
    }
    return NextResponse.json(
      { ok: false, error: failure.message, failure },
      { status: videoPlanningFailureHttpStatus(failure.code) }
    );
  }
}
