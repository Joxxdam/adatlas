import type {
  VideoConcept,
  VideoDuration,
  VideoGenerationStage,
  VideoPipelineProgress,
} from "./types.ts";
import { segmentRange } from "./planningValidation.ts";
import { VideoPlanningGenerationError } from "./videoPlanningAiCore.ts";
import { isCurrentVideoPlanningConcept } from "./videoPlanningVersion.ts";

const inFlight = new Set<string>();

export function videoPlanningGenerationKey(projectId: string, conceptId: string | undefined, action: string) {
  return `${projectId}:${conceptId || "all"}:${action}`;
}

export async function withVideoPlanningGenerationLock<T>(input: { key: string; stage: VideoGenerationStage; run: () => Promise<T> }) {
  if (inFlight.has(input.key)) {
    throw new VideoPlanningGenerationError({
      stage: input.stage,
      code: "GENERATION_ALREADY_RUNNING",
      message: "같은 영상 기획 생성 작업이 이미 진행 중입니다. 잠시 후 저장된 결과를 다시 확인해 주세요.",
      retryable: true,
      attempts: 0,
      failedAt: new Date().toISOString(),
    });
  }
  inFlight.add(input.key);
  try {
    return await input.run();
  } finally {
    inFlight.delete(input.key);
  }
}

export function hasReusableDetailedVideoPlan(concept: VideoConcept, duration: VideoDuration) {
  return isCurrentVideoPlanningConcept(concept) && concept.detailStatus === "ready" && concept.cuts.length >= segmentRange(duration).min && concept.validation?.valid === true;
}

export function failVideoPlanningPipeline(
  progress: VideoPipelineProgress[],
  message: string,
  updatedAt = new Date().toISOString()
) {
  let failedStageFound = false;
  return progress.map((item): VideoPipelineProgress => {
    if (item.status === "running") {
      failedStageFound = true;
      return { ...item, status: "failed", message, updatedAt };
    }
    if (failedStageFound && item.status === "pending") {
      return {
        ...item,
        status: "warning",
        message: "이전 단계 실패로 중단",
        updatedAt,
      };
    }
    return item;
  });
}
