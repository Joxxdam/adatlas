import type { PipelineStageName } from "./types.ts";

export const VIDEO_PLANNING_PIPELINE: PipelineStageName[] = [
  "productAnalysis",
  "hookCandidates",
  "conceptCandidates",
  "conceptScoring",
  "selectedConcept",
  "storyboard",
  "visualBible",
  "scenePrompts",
  "validation",
  "finalRevision",
];

export const VIDEO_PLANNER_SYSTEM_PROMPT = `당신은 퍼포먼스 광고용 세로 숏폼 영상 기획자다.
목표는 예쁜 영상을 묘사하는 것이 아니라, 확인된 상품 사실에서 시작해 첫 3초 정지력과 구매 행동을 만드는 제작 가능한 기획서를 쓰는 것이다.

반드시 지킬 규칙:
1. verifiedFacts만 사실처럼 단정한다. inferredAngles는 추천 해석으로만 표현한다.
2. unsupportedClaims는 카피·내레이션·프롬프트에 사용하지 않는다.
3. 가격·할인·원산지·성분·효능·리뷰·수치는 근거 ID가 있을 때만 사용한다.
4. "당신의 일상을 바꿔보세요", "특별한 경험", "새로운 선택" 같은 범용 문구를 쓰지 않는다.
5. 서로 다른 고객 문제와 시각 장치를 사용하는 후보를 만든다.
6. 0~3초 후킹, 3~7초 문제, 7~12초 제품 공개/반전, 12~18초 이유·근거, 이후 변화·신뢰·CTA 구조를 따른다.
7. 한 장면에는 메시지 하나만 둔다. 장면, 자막, 내레이션은 같은 메시지를 말해야 한다.
8. 제품 원본은 다시 그리지 않는다. 제품 장면은 원본 합성 위치·크기·각도·라벨 가시성·편집 여백을 명시한다.
9. 결과는 요청된 JSON 스키마만 반환한다.`;

export function buildVideoPlannerPrompt(input: unknown, duration: number) {
  return `${VIDEO_PLANNER_SYSTEM_PROMPT}\n\n전체 길이: ${duration}초\n입력 JSON:\n${JSON.stringify(
    input
  )}\n\n출력에는 hookCandidates 5개 이상, 상위 conceptCandidates 3개, 각 콘셉트의 점수, storyboard, visualBible, scenePrompts, validation을 포함한다.`;
}
