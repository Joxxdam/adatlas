import type { VideoConcept } from "./types.ts";

export const CURRENT_VIDEO_PLANNING_ENGINE_VERSION = "story-mechanism-v4" as const;

type CreativePremise = Pick<
  VideoConcept,
  | "distinctiveCharacter"
  | "conceptArchetype"
  | "socialWorld"
  | "storyTrigger"
  | "truthBridge"
  | "dramatizationBoundary"
>;

const GENERIC_CHARACTER = /^(?:일반\s*)?(?:사용자|소비자|고객|타깃|가족|부모|엄마|아빠|친구|직장인|주부|한\s*사람|상품)$/i;
const GENERIC_WORLD = /^(?:일반적인\s*)?(?:집|주방|욕실|식탁|회사|사무실|일상|생활\s*공간|사용\s*공간|매장)$/i;

function clean(value: unknown, max: number) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * 최신 영상기획의 핵심 계약입니다. 이 조건을 통과하지 못한 과거 요약은
 * 상세 대본 생성·부분 재생성·캐시 재사용 대상으로 취급하지 않습니다.
 */
export function currentVideoCreativePremiseIssue(concept: CreativePremise) {
  if (!concept.conceptArchetype)
    return "최신 4안 유형 정보가 없는 구버전 기획안입니다.";
  const character = clean(concept.distinctiveCharacter, 300);
  const world = clean(concept.socialWorld, 300);
  const trigger = clean(concept.storyTrigger, 400);
  const bridge = clean(concept.truthBridge, 400);
  const boundary = clean(concept.dramatizationBoundary, 400);
  if (character.length < 12 || GENERIC_CHARACTER.test(character))
    return "인물이 관계·직업·지역·습관 중 두 가지 이상으로 특정되지 않았습니다.";
  if (world.length < 12 || GENERIC_WORLD.test(world))
    return "시대·장소·사회적 배경이 한 장면으로 떠오를 만큼 구체적이지 않습니다.";
  if (trigger.length < 18)
    return "인물에게 실제로 벌어지는 중심 사건이 부족합니다.";
  if (bridge.length < 18)
    return "창작 사건과 검증된 상품 USP의 연결이 부족합니다.";
  if (
    boundary.length < 16 ||
    !/(?:(?:창작|상황극|세계관|가상).*(?:사실|근거|ProductTruth|검증)|(?:사실|근거|ProductTruth|검증).*(?:창작|상황극|세계관|가상))/i.test(
      boundary
    )
  )
    return "창작 설정과 상품 사실의 내부 경계가 명시되지 않았습니다.";
  if (
    /(알레르기|질병|치료|완치|의사\s*(?:남편|아내|친구|추천|보증)|실제\s*고객)/i.test(
      `${character} ${world} ${trigger} ${bridge}`
    )
  )
    return "창작 설정에 의료·전문가 보증 또는 실제 고객 사칭 위험이 있습니다.";
  return "";
}

export function isCurrentVideoPlanningConcept(concept: CreativePremise) {
  return currentVideoCreativePremiseIssue(concept) === "";
}
