import type { ReferenceAdaptedCopyPlan } from "./types";

type CopyPlanLike = Pick<
  ReferenceAdaptedCopyPlan,
  "referenceRawLines" | "adaptedLines" | "copySlots" | "headline" | "subCopy" | "proof" | "offer" | "cta"
>;

const HUMAN_SUBJECT = /^(?:[“"']?)(?:남편|아내|엄마|아빠|부모님|가족|친구|아이|고객|손님|직장인|주부|사람|동료)(?:이|가|은|는)(?:\s|먼저|더)/u;
const NON_HUMAN_SUBJECT = /^(?:[“"']?)(?:추석|설날|명절|시즌|가격|할인|특가|혜택|구성|상품|제품|포장|용량|중량|메뉴)(?:이|가|은|는)(?:\s|먼저|더)/u;
const HUMAN_ACTION = /(?:사자고|먹자고|해달라고|달라고|졸라|말하|추천하|원하|부탁하|찾아|고르자고|좋아하|싫어하)/u;
const INCOMPLETE_ENDING = /(?:할\s*수|될\s*수|하면|인데|이고|이며|해서|하며|라서|라고|라는|처럼|보다|위해|대한|관한)\s*[.!?~]*$/u;
const VAGUE_HOLIDAY_CONTEXT = /(?:추석|설날|명절)\s*(?:메뉴|음식)\s*(?:이|가|은|는)?\s*없더니/u;

function cleanLine(value: string | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * 사실·숫자 검수로는 잡히지 않는 명백한 한국어 비문을 결정적으로 탐지한다.
 * 최종 자연스러움 판단은 AI critic이 담당하고, 이 검사는 critic 점수가 잘못
 * 높게 나와도 주어 역할 붕괴·미완성 연결어 같은 치명 오류가 통과하지 않게 한다.
 */
export function findReferenceCopyNaturalnessErrors(plan: CopyPlanLike) {
  const errors: string[] = [];
  const sourceLines = plan.referenceRawLines || plan.copySlots?.map((slot) => slot.sourceText) || [];
  const targetLines = plan.adaptedLines || plan.copySlots?.map((slot) => slot.targetText) || [];

  targetLines.forEach((rawTarget, index) => {
    const target = cleanLine(rawTarget);
    const source = cleanLine(sourceLines[index]);
    if (!target) return;
    if (INCOMPLETE_ENDING.test(target)) {
      errors.push(`${index + 1}번째 문구가 연결어에서 끝나 의미가 완결되지 않았습니다.`);
    }
    if (/간편해결/u.test(target)) {
      errors.push(`${index + 1}번째 문구의 '간편해결'을 자연스러운 문장으로 고쳐야 합니다.`);
    }
    if (/[，,]\s*$/u.test(target) && !/[，,]\s*$/u.test(source)) {
      errors.push(`${index + 1}번째 문구가 쉼표로 끝나 문장이 미완성입니다.`);
    }
    if (HUMAN_SUBJECT.test(source) && HUMAN_ACTION.test(source) && NON_HUMAN_SUBJECT.test(target) && HUMAN_ACTION.test(target)) {
      errors.push(`${index + 1}번째 문구에서 사람 주어를 계절·상품 명사로 단순 치환해 의미가 어색합니다.`);
    }
    if (VAGUE_HOLIDAY_CONTEXT.test(target)) {
      errors.push(`${index + 1}번째 문구의 명절 상황과 주체가 불분명합니다. 소비자가 실제로 묻거나 말하는 완결된 상황 문장으로 다시 써야 합니다.`);
    }
  });

  const slotHeadlineLines = plan.copySlots?.filter((slot) => slot.role === "headline").map((slot) => cleanLine(slot.targetText)).filter(Boolean) || [];
  const headlineLines = slotHeadlineLines.length ? slotHeadlineLines : [cleanLine(plan.headline)].filter(Boolean);
  const joinedHeadline = headlineLines.join(" ");
  if (/(?:특별\s*)?구성에\s+.+(?:대용량|구성)으로\s+(?:드셔|준비|구매|만나)/u.test(joinedHeadline)) {
    errors.push("헤드라인의 조사 연결이 부자연스럽습니다. 레퍼런스 의도만 유지하고 현재 상품 문법으로 다시 써야 합니다.");
  }
  if (VAGUE_HOLIDAY_CONTEXT.test(cleanLine(plan.headline))) {
    errors.push("헤드라인의 주체와 상황이 생략되어 소비자가 뜻을 바로 이해하기 어렵습니다.");
  }

  return [...new Set(errors)];
}
