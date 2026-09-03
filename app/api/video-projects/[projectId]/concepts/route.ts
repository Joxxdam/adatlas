import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../../lib/video-collaboration/repository.server";
import { analyzeVideoReferencesAi, generateVideoConceptSummariesAi, generateVideoHookCandidatesAi, VideoConceptPartialGenerationError } from "../../../../lib/video-collaboration/videoPlanningGenerator.server";
import { VideoPlanningGenerationError, videoPlanningFailureHttpStatus } from "../../../../lib/video-collaboration/videoPlanningAi.server";
import {
  failVideoPlanningPipeline,
  videoPlanningGenerationKey,
  withVideoPlanningGenerationLock,
} from "../../../../lib/video-collaboration/videoPlanningRequestGuards";
import { VIDEO_CONCEPT_ARCHETYPES, type VideoConcept, type VideoConceptArchetype, type VideoPipelineProgress } from "../../../../lib/video-collaboration/types";
import { inferVideoParodyGenre } from "../../../../lib/video-collaboration/videoParodyGenres";
import {
  CURRENT_VIDEO_PLANNING_ENGINE_VERSION,
  isCurrentVideoPlanningConcept,
} from "../../../../lib/video-collaboration/videoPlanningVersion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  let conceptId: string | undefined;
  let requestedArchetype: VideoConceptArchetype | undefined;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      conceptId?: string;
      archetype?: VideoConceptArchetype;
      actor?: string;
    };
    conceptId = body.conceptId;
    const project = await videoProjectRepository.get(projectId);
    if (!project) throw new Error("영상 프로젝트를 찾지 못했습니다.");
    if (!["script_pending", "script_review", "concept_selected"].includes(project.status)) {
      throw new Error("기획 중이거나 기획안 검토 단계에서만 다시 생성할 수 있습니다.");
    }
    const previousConcept = conceptId ? project.concepts.find((concept) => concept.id === conceptId) : undefined;
    if (conceptId && !previousConcept) throw new Error("다시 생성할 기획안을 찾지 못했습니다.");
    if (body.archetype && !VIDEO_CONCEPT_ARCHETYPES.includes(body.archetype)) {
      throw new Error("다시 생성할 영상 콘셉트 유형을 확인해 주세요.");
    }
    requestedArchetype = previousConcept?.conceptArchetype || body.archetype;
    if (previousConcept && !isCurrentVideoPlanningConcept(previousConcept)) {
      throw new Error("구버전 기획안은 개별 재생성할 수 없습니다. 최신 기획안 4안을 전체 다시 생성해 주세요.");
    }
    return await withVideoPlanningGenerationLock({
      key: videoPlanningGenerationKey(projectId, conceptId || requestedArchetype, requestedArchetype ? "regenerate-concept" : "generate-concepts"),
      stage: "concept-summaries",
      run: async () => {
        const progress: VideoPipelineProgress[] = [
          {
            stage: "productAnalysis",
            status: "complete",
            message: "상품 사실 분석 완료",
            updatedAt: new Date().toISOString(),
          },
          {
            stage: "hookCandidates",
            status: "running",
            message: "참고자료와 고객 상황을 분석하는 중",
            updatedAt: new Date().toISOString(),
          },
          {
            stage: "conceptCandidates",
            status: "pending",
            message: "4개 콘셉트 구성 대기",
            updatedAt: new Date().toISOString(),
          },
          {
            stage: "validation",
            status: "pending",
            message: "품질검사 대기",
            updatedAt: new Date().toISOString(),
          },
        ];
        await videoProjectRepository.beginConceptSlotGeneration(
          projectId,
          requestedArchetype ? [requestedArchetype] : [...VIDEO_CONCEPT_ARCHETYPES]
        );
        await videoProjectRepository.updatePipelineProgress(projectId, progress);
        const referenceAnalyses = project.referenceAssets.length && !project.referenceAnalyses?.length ? await analyzeVideoReferencesAi(project.referenceAssets) : project.referenceAnalyses || [];
        const usesCurrentEngine =
          project.videoPlanningEngineVersion === CURRENT_VIDEO_PLANNING_ENGINE_VERSION;
        const hooks =
          usesCurrentEngine && project.hookCandidates && project.hookCandidates.length >= 7
            ? project.hookCandidates
            : await generateVideoHookCandidatesAi(
                project.productAnalysis,
                project.brandGuideline,
                referenceAnalyses
              );
        // Keep completed expensive analysis even if the following concept batch fails.
        // A retry can then resume from concept generation instead of calling the API again.
        await videoProjectRepository.savePlanningIntermediates(projectId, {
          hookCandidates: hooks,
          referenceAnalyses,
        });
        progress[1] = {
          stage: "hookCandidates",
          status: "complete",
          message: "후킹과 사건 후보 발굴 완료",
          updatedAt: new Date().toISOString(),
        };
        progress[2] = {
          stage: "conceptCandidates",
          status: "running",
          message: requestedArchetype ? "선택한 콘셉트만 다시 생성하는 중" : "서로 다른 4개 콘셉트를 유형별로 생성하는 중",
          updatedAt: new Date().toISOString(),
        };
        await videoProjectRepository.updatePipelineProgress(projectId, progress);
        const storedRecentParodyGenres = await videoProjectRepository.recentParodyGenres({
          excludeProjectId: project.id,
          advertiserName: project.advertiserName,
          limit: 5,
        });
        const currentParodyGenre = project.concepts
          .filter((concept) => concept.conceptArchetype === "parody")
          .map((concept) => inferVideoParodyGenre(concept))
          .find((genre) => Boolean(genre));
        const recentParodyGenres = [
          ...(currentParodyGenre ? [currentParodyGenre] : []),
          ...storedRecentParodyGenres,
        ];
        let generated: VideoConcept[];
        try {
          generated = await generateVideoConceptSummariesAi({
            advertiserName: project.advertiserName,
            analysis: project.productAnalysis,
            guideline: project.brandGuideline,
            duration: project.duration,
            objective: project.objective,
            hooks,
            existingConcepts: usesCurrentEngine
              ? project.concepts.filter(isCurrentVideoPlanningConcept)
              : [],
            referenceAnalyses,
            conceptFormat: project.conceptFormat,
            requiredContent: project.requiredContent,
            excludedContent: project.excludedContent,
            requestedArchetype,
            recentParodyGenres,
            selectionSeed: project.id,
            onConceptProgress: requestedArchetype
              ? undefined
              : async ({ concepts, unresolvedArchetypes }) => {
                  await videoProjectRepository.saveConceptSlotProgress(projectId, concepts, {
                    actor: body.actor,
                    unresolvedArchetypes,
                    hookCandidates: hooks,
                    referenceAnalyses,
                  });
                },
          });
        } catch (error) {
          if (!(error instanceof VideoConceptPartialGenerationError)) throw error;
          progress[2] = {
            stage: "conceptCandidates",
            status: "warning",
            message: `${error.partialConcepts.length}개 콘셉트 우선 저장 · 실패 유형만 재생성 가능`,
            updatedAt: new Date().toISOString(),
          };
          progress[3] = {
            stage: "validation",
            status: "warning",
            message: "통과한 콘셉트 보존 · 일부 유형 확인 필요",
            updatedAt: new Date().toISOString(),
          };
          const updated = await videoProjectRepository.saveConceptSlotProgress(
            projectId,
            error.partialConcepts,
            {
              actor: body.actor,
              failedArchetypes: error.failedArchetypes,
              failure: error.failure,
              hookCandidates: hooks,
              referenceAnalyses,
            }
          );
          await videoProjectRepository.updatePipelineProgress(projectId, progress);
          const completed = await videoProjectRepository.get(projectId);
          return NextResponse.json({
            ok: true,
            partial: true,
            project: completed || updated,
            concepts: error.partialConcepts,
            failure: error.failure,
          });
        }
        progress[2] = {
          stage: "conceptCandidates",
          status: "complete",
          message: requestedArchetype ? "선택한 콘셉트 생성 완료" : "4개 콘셉트 생성 완료",
          updatedAt: new Date().toISOString(),
        };
        progress[3] = {
          stage: "validation",
          status: "complete",
          message: requestedArchetype
            ? "선택한 콘셉트의 구체성·사실 근거 품질검사 완료"
            : "차별성·사실 근거 품질검사 완료",
          updatedAt: new Date().toISOString(),
        };
        if (requestedArchetype) {
          const replacement = generated.find((concept) => concept.conceptArchetype === requestedArchetype) || generated[0];
          const updated = await videoProjectRepository.saveConceptSlotProgress(projectId, [replacement], {
            actor: body.actor,
            hookCandidates: hooks,
            referenceAnalyses,
          });
          await videoProjectRepository.updatePipelineProgress(projectId, progress);
          const completed = await videoProjectRepository.get(projectId);
          return NextResponse.json({ ok: true, project: completed || updated, concepts: [replacement] });
        }
        const updated = await videoProjectRepository.saveConceptSlotProgress(projectId, generated, {
          actor: body.actor,
          hookCandidates: hooks,
          referenceAnalyses,
          completeSet: true,
        });
        await videoProjectRepository.updatePipelineProgress(projectId, progress);
        const completed = await videoProjectRepository.get(projectId);
        return NextResponse.json({ ok: true, project: completed || updated, concepts: generated });
      },
    });
  } catch (error) {
    const failure =
      error instanceof VideoPlanningGenerationError
        ? error.failure
        : {
            stage: "concept-summaries" as const,
            code: "CONCEPT_SUMMARY_FAILED",
            message: error instanceof Error ? error.message : "AI 영상 기획 생성에 실패했습니다.",
            retryable: true,
            attempts: 1,
            failedAt: new Date().toISOString(),
          };
    if (failure.code !== "GENERATION_ALREADY_RUNNING") {
      const latest = await videoProjectRepository.get(projectId).catch(() => undefined);
      if (latest?.pipelineProgress?.length) {
        await videoProjectRepository
          .updatePipelineProgress(
            projectId,
            failVideoPlanningPipeline(latest.pipelineProgress, failure.message, failure.failedAt)
          )
          .catch(() => undefined);
      }
      if (conceptId) {
        await videoProjectRepository.saveGenerationFailure(projectId, failure, { conceptId }).catch(() => undefined);
      } else {
        const failedArchetypes = requestedArchetype
          ? [requestedArchetype]
          : VIDEO_CONCEPT_ARCHETYPES.filter(
              (archetype) =>
                latest?.conceptSlots?.find((slot) => slot.archetype === archetype)?.status !== "ready"
            );
        await videoProjectRepository
          .saveConceptSlotProgress(projectId, [], { failedArchetypes, failure })
          .catch(() => undefined);
      }
    }
    return NextResponse.json({ ok: false, error: failure.message, failure }, { status: videoPlanningFailureHttpStatus(failure.code) });
  }
}
