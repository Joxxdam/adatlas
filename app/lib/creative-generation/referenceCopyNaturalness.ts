import type { ReferenceAdaptedCopyPlan } from "./types";

type CopyPlanLike = Pick<
  ReferenceAdaptedCopyPlan,
  "referenceRawLines" | "adaptedLines" | "copySlots" | "headline" | "subCopy" | "proof" | "offer" | "cta"
>;

const HUMAN_SUBJECT = /^(?:[“"']?)(?:남편|아내|엄마|아빠|부모님|가족|친구|아이|고객|손님|직장인|주부|사람|동료)(?:이|가|은|는)(?:\s|먼저|더)/u;
const NON_HUMAN_SUBJECT = /^(?:[“"']?)(?:추석|설날|명절|시즌|가격|할인|특가|혜택|구성|상품|제품|포장|용량|중량|메뉴)(?:이|가|은|는)(?:\s|먼저|더)/u;
const HUMAN_ACTION = /(?:사자고|먹자고|해달라고|달라고|졸라|말하|추천하|원하|부탁하|찾아|고르자고|좋아하|싫어하)/u;
const INCOMPLETE_ENDING = /(?:할\s*수|될\s*수|하면|인데|이고|이며|해서|하며|라서|라고|라는|처럼|보다|위해|대한|관한|어울리|선호하|소개되|정리되|표현되|뜻하|필요하|사용하|함유하|느껴지|기대되|추천하)\s*[.!?~]*$/u;
const VAGUE_HOLIDAY_CONTEXT = /(?:추석|설날|명절)\s*(?:메뉴|음식)\s*(?:이|가|은|는)?\s*없더니/u;
const RESEARCH_REPORT_ENDING = /(?:소개|정리|표현|평가|해석)됨|(?:광고|샤워|피부|보습|프루티)?\s*콘셉트로\s*활용|어울리는\s*방향/u;
const CORRUPTED_RESEARCH_WORD = /(?:소거됨|소거된|소거한|소거되는)/u;
const AMBIGUOUS_STANDALONE_REACTION = /^(?:향|맛|느낌|사용감|보습|상쾌함)\s*그대로(?:네요|예요|입니다|다)[.!?~]*$/u;
const SINGLE_VOLUME_AS_COMPOSITION = /^총\s*\d[\d,.]*\s*(?:ml|mL|l|L|g|kg)\s*구성[.!?~]*$/u;
const RESEARCH_STYLE_HEADLINE = /(?:뉘앙스가\s*섞인|선호하는\s*(?:사람|분)|열을\s*가하지\s*않고|어울리는\s*방향)/u;
const ORPHANED_FACT_FRAGMENT = /^(?:기로|기|으로|로)\s*[,，]?\s*(?:직접\s*)?(?:느껴|만나|경험|확인)(?:보세요|해보세요|하세요|해요)?[.!?~]*$/u;
const PLANNING_ROLE_PERSONA = /수라간\s*감별관|상품\s*큐레이터|욕실\s*집사|까다로운\s*구매자|구매\s*담당|선택\s*담당|저녁밥\s*총무|메뉴\s*총무|간식\s*담당|메이크업\s*담당|조선시대\s*수라간|중세\s*유럽의\s*욕실|백화점\s*첫\s*개장|흑백영화\s*촬영장/u;
const PRODUCT_FIRST_PERSON = /(?:^|[.!?~]\s*)(?:난|나는|내가|저는|제가)\s*[,，]?\s*(?:숙성|한우|갈비|안심|등심|고기|상품|제품|샤워젤|바디워시|크림|세럼|간식|전병|떡볶이)/u;

function cleanLine(value: string | undefined) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hasUnbalancedDelimiters(value: string) {
  const pairs: Array<[string, string]> = [["[", "]"], ["(", ")"], ["{", "}"]];
  return pairs.some(([open, close]) => value.split(open).length - 1 !== value.split(close).length - 1);
}

/** ProductTruth 원문은 보존하고 조사 보고서 말투만 소비자용 작성 힌트로 정리한다. */
export function consumerFacingFactHint(value: string) {
  let hint = cleanLine(value);
  hint = hint
    .replace(/체감\s*온도\s*([^\s]+)로\s*소개된\s*/u, "체감 온도 $1의 ")
    .replace(/사용하는\s*셈으로\s*소개됨[.!?~]*$/u, "사용하는 셈")
    .replace(/(.+?)\s*이미지를\s*(.+?)\s*콘셉트로\s*활용[.!?~]*$/u, "$1 이미지로 $2")
    .replace(/(.+?)을\s*(.+?)\s*샤워\s*성분으로\s*소개[.!?~]*$/u, "$1을 담아 $2")
    .trim();
  const coldPressed = hint.match(/^(.+?)(?:을|를)\s*열을\s*가하지\s*않고\s*눌러\s*얻는\s*냉압착\s*방식으로\s*(?:소개|정리)됨[.!?~]*$/u);
  if (coldPressed?.[1]) return `열을 가하지 않고 눌러 얻은 ${coldPressed[1].trim()}`;
  hint = hint
    .replace(/사람에게\s*어울리는\s*방향[.!?~]*$/u, "분")
    .replace(/(순간|상황|때)에\s*어울리는\s*방향[.!?~]*$/u, "$1")
    .replace(/(?:으로|라고)\s*(?:소개|정리|표현|평가|해석)됨[.!?~]*$/u, "")
    .replace(/(?:이라고|라고)\s*(?:정리|소개)됨[.!?~]*$/u, "")
    .replace(/\s*어울리는\s*방향[.!?~]*$/u, "")
    .replace(/\s+/g, " ")
    .trim();
  return hint.replace(/^(.+?)을\s*깨우거나\s*(.+?)이\s*필요한\s*순간$/u, "$1이나 $2");
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
    if (hasUnbalancedDelimiters(target)) {
      errors.push(`${index + 1}번째 문구의 괄호가 열리거나 닫히지 않았습니다.`);
    }
    if (INCOMPLETE_ENDING.test(target)) {
      errors.push(`${index + 1}번째 문구가 연결어에서 끝나 의미가 완결되지 않았습니다.`);
    }
    if (CORRUPTED_RESEARCH_WORD.test(target)) errors.push(`${index + 1}번째 문구에 상품 조사 원문을 잘못 변형한 단어가 포함됐습니다.`);
    if (RESEARCH_REPORT_ENDING.test(target)) errors.push(`${index + 1}번째 문구가 조사 보고서 서술형으로 끝납니다. 소비자에게 직접 말하는 광고 문장으로 바꿔야 합니다.`);
    if (ORPHANED_FACT_FRAGMENT.test(target)) errors.push(`${index + 1}번째 문구가 상품 사실의 조사·어미만 남은 문장 조각입니다.`);
    if (PLANNING_ROLE_PERSONA.test(target)) errors.push(`${index + 1}번째 문구에 소비자가 이해할 필요 없는 직업·세계관형 기획 인물이 포함됐습니다.`);
    if (PRODUCT_FIRST_PERSON.test(target)) errors.push(`${index + 1}번째 문구가 상품을 사람처럼 말하게 하는 부자연스러운 1인칭 문장입니다.`);
    if (AMBIGUOUS_STANDALONE_REACTION.test(target)) errors.push(`${index + 1}번째 문구의 '그대로'가 무엇을 가리키는지 알 수 없습니다.`);
    if (SINGLE_VOLUME_AS_COMPOSITION.test(target)) errors.push(`${index + 1}번째 문구가 단일 용량을 세트 구성처럼 표현했습니다. 용량은 작은 근거로만 사용해야 합니다.`);
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
  if (hasUnbalancedDelimiters(joinedHeadline)) errors.push("헤드라인의 괄호가 완결되지 않았습니다.");
  if (/(?:특별\s*)?구성에\s+.+(?:대용량|구성)으로\s+(?:드셔|준비|구매|만나)/u.test(joinedHeadline)) {
    errors.push("헤드라인의 조사 연결이 부자연스럽습니다. 레퍼런스 의도만 유지하고 현재 상품 문법으로 다시 써야 합니다.");
  }
  if (VAGUE_HOLIDAY_CONTEXT.test(cleanLine(plan.headline))) {
    errors.push("헤드라인의 주체와 상황이 생략되어 소비자가 뜻을 바로 이해하기 어렵습니다.");
  }
  if (RESEARCH_STYLE_HEADLINE.test(cleanLine(plan.headline)) && !/[?!]|찾는\s*분|말고|보다\s*더/u.test(cleanLine(plan.headline))) {
    errors.push("헤드라인이 소비자 후킹이 아니라 상세 조사 문장을 그대로 옮긴 형태입니다.");
  }

  const nonOfferCopy = (plan.copySlots || [])
    .filter((slot) => slot.role !== "offer" && slot.sourceType !== "source-brand" && slot.replacePolicy !== "remove")
    .map((slot) => cleanLine(slot.targetText))
    .filter(Boolean);
  if (nonOfferCopy.some((line) => /^(?:정가|판매가|할인가|기존가|가격)?\s*[:：]?\s*\d[\d,.]*\s*원\s*[!,.~]*$/u.test(line))) {
    errors.push("가격만 있는 문구는 헤드라인·보조·근거 슬롯에 사용할 수 없습니다.");
  }
  const renderedCopy = [plan.headline, plan.subCopy, plan.proof, plan.offer, plan.cta].filter(Boolean).join(" ");
  const priceTokens = renderedCopy.match(/\d[\d,.]*\s*원/gu) || [];
  const repeatedPrice = priceTokens.find((token, index, values) => values.indexOf(token) !== index);
  if (repeatedPrice) errors.push(`같은 가격(${repeatedPrice.replace(/\s+/g, "")})이 한 소재 안에서 반복됩니다.`);

  return [...new Set(errors)];
}
