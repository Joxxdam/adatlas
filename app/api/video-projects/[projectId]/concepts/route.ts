import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../../lib/video-collaboration/repository.server";
import { generateVideoConcepts } from "../../../../lib/video-collaboration/scriptGenerator";
import {
  analyzeReferenceAssets,
  buildProductLockedAsset,
  buildVideoHookCandidates,
  pipelineProgress,
} from "../../../../lib/video-collaboration/planningPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      conceptId?: string;
      cutId?: string;
      mode?: "all" | "hooks-only" | "selected-scene";
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
    let concepts = await generateVideoConcepts({
      advertiserName: project.advertiserName,
      analysis: project.productAnalysis,
      guideline: project.brandGuideline,
      duration: project.duration,
      objective: project.objective,
      hookTypes: body.conceptId ? [existing[0].hookType] : undefined,
      existingConcepts: existing,
      creativeStyle: project.creativeStyle,
      productLockedAsset: project.productLockedAsset,
    });
    if (body.mode === "hooks-only") {
      concepts = concepts.map((concept) => {
        const previous = project.concepts.find((item) => item.id === concept.id);
        if (!previous) return concept;
        return {
          ...concept,
          cuts: previous.cuts.map((cut, index) =>
            index === 0 ? { ...cut, caption: concept.openingHook, narration: concept.openingHook } : cut
          ),
          fullScript: previous.fullScript,
        };
      });
    }
    if (body.mode === "selected-scene") {
      if (!body.conceptId || !body.cutId) throw new Error("다시 생성할 장면을 확인해 주세요.");
      const previousConcept = project.concepts.find((item) => item.id === body.conceptId);
      const generated = concepts[0];
      const cutIndex = previousConcept?.cuts.findIndex((cut) => cut.id === body.cutId) ?? -1;
      if (!previousConcept || cutIndex < 0 || !generated.cuts[cutIndex])
        throw new Error("다시 생성할 장면을 찾지 못했습니다.");
      concepts = [
        {
          ...previousConcept,
          cuts: previousConcept.cuts.map((cut, index) =>
            index === cutIndex
              ? {
                  ...generated.cuts[index],
                  id: cut.id,
                  startSecond: cut.startSecond,
                  endSecond: cut.endSecond,
                  referenceImages: cut.referenceImages,
                  productionMemo: cut.productionMemo,
                }
              : cut
          ),
          revision: previousConcept.revision + 1,
          updatedAt: new Date().toISOString(),
        },
      ];
    }
    const hookCandidates = buildVideoHookCandidates(project.productAnalysis);
    const productLockedAsset = buildProductLockedAsset(project.productOriginalAsset);
    const referenceAnalyses = analyzeReferenceAssets(project.referenceAssets);
    const hasWarnings = concepts.some((concept) => !concept.validation?.valid);
    const updated = await videoProjectRepository.saveGeneratedConcepts(projectId, concepts, {
      conceptId: body.mode === "hooks-only" ? undefined : body.conceptId,
      actor: body.actor,
      hookCandidates,
      productLockedAsset,
      referenceAnalyses,
      pipelineProgress: pipelineProgress(hasWarnings ? "warning" : "complete"),
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
