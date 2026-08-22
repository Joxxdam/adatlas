import type { VideoConcept, VideoDuration, VideoGenerationStage } from "./types.ts";
import { segmentRange } from "./planningValidation.ts";
import { VideoPlanningGenerationError } from "./videoPlanningAiCore.ts";

const inFlight = new Set<string>();

export function videoPlanningGenerationKey(
  projectId: string,
  conceptId: string | undefined,
  action: string
) {
  return `${projectId}:${conceptId || "all"}:${action}`;
}

export async function withVideoPlanningGenerationLock<T>(input: {
  key: string;
  stage: VideoGenerationStage;
  run: () => Promise<T>;
}) {
  if (inFlight.has(input.key)) {
    throw new VideoPlanningGenerationError({
      stage: input.stage,
      code: "GENERATION_ALREADY_RUNNING",
      message:
        "같은 영상 기획 생성 작업이 이미 진행 중입니다. 잠시 후 저장된 결과를 다시 확인해 주세요.",
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
  return (
    concept.detailStatus === "ready" &&
    concept.cuts.length >= segmentRange(duration).min &&
    concept.validation?.valid === true
  );
}
