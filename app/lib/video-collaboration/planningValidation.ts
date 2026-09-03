import type { ProductAnalysisSnapshot, VideoConcept, VideoCut, VideoDuration } from "./types.ts";
import { containsRawSeoTitle } from "./productName.ts";
import { getVideoParodyGenre, matchesVideoParodyGenre } from "./videoParodyGenres.ts";

const ABSTRACT_SCENES = [/고객(?:이|의)?.*(?:문제|상황).*보여준다/i, /(?:제품|상품).*(?:USP|핵심|근거).*(?:클로즈업|제시|보여준다)/i, /사용\s*전후.*비교/i, /제품\s*전체.*CTA.*보여준다/i, /고객이\s*제품을\s*사용하는\s*장면/i];
const GENERIC_COPY = [/상품을 소개합니다/i, /여름철 필수템/i, /프리미엄 퀄리티/i, /특별한 경험/i, /놀라운 효과/i, /지금 만나보세요/i, /당신을 위한 선택/i, /일상에 활력을/i, /처음 보는 제품 자세히 보기/i, /확인된 포인트를 설명합니다/i];
const EVIDENCE_AUDIT_COPY = [
  /상세페이지(?:의|에서)?\s*(?:구성|가격|할인|수치|중량|용량|정보)?\s*(?:표기|기재)(?:는|가|를|로|상|되어|됐)/i,
  /상세페이지(?:에서)?\s*확인(?:된|되는|한)\s*(?:구성|가격|할인|수치|중량|용량|정보|표기|내용)/i,
  /(?:구성|가격|할인|수치|중량|용량)\s*표기(?:예요|에요|입니다|로|가|는)/i,
  /(?:확인된|확인되는|기재된)\s*(?:표기|수치|정보|내용|조건)/i,
  /(?:표기|기재)(?:상|로는|에는|가|는)?\s*(?:보입니다|확인됩니다|되어\s*있습니다)/i,
  /(?:확인된|검증된)\s*(?:혜택|가격|할인|구성|배송)(?:은|는|이|가)?/i,
  /확인\s*결과(?:로|는|가|입니다)?/i,
  /근거(?:상|에\s*따르면)/i,
];
const INTERNAL_SPEAKER_LABEL_COPY = /(?:담당자|진행자|제작자)\s*[:：]/i;
const FAMILY_SCRIPT_LABEL_COPY = /(?:^|\s)(?:아버지|아빠|어머니|엄마|딸|아들|남편|아내|배우자|친구|언니|오빠|누나|형|동생)\s*[:：]/i;
const WORKPLACE_SCRIPT_LABEL_COPY = /(?:^|\s)(?:팀장|사장|대표|직원|대리|과장|부장|매니저)\s*[:：]/i;
const INTERNAL_PLANNING_COPY = [
  /정보\s*부족/i,
  /확인부터(?:요|해|하자)?/i,
  /(?:상품|제품|가격|혜택)\s*(?:검증|근거\s*확인)/i,
  ...EVIDENCE_AUDIT_COPY,
  /(?:도장|태블릿)\s*(?:화면|항목|정보)?|표\s*(?:화면|항목|정보|자료|카드)/i,
  /\b(?:USP|CTA|B-?ROLL)\b/i,
];
const STAGE_DIRECTION_COPY = [
  /^(?:한\s*사람(?:씩)?|인물(?:이|은)|손(?:이|은)|카메라(?:가|는)|화면(?:에|이|은)).*(?:집습니다|보여줍니다|비춥니다|등장합니다|전환됩니다|확대됩니다|놓습니다|있습니다)$/i,
  /(?:가림|가격|정보)\s*카드.*(?:있어요|보여요|나옵니다|등장합니다)$/i,
  /화면으로\s*(?:먼저\s*)?(?:보이|확인)/i,
  /(?:장면|화면|표면\s*색).*(?:바뀜|보임|전환|확대)$/i,
  /(?:링크|구매처).*(?:여기에서|여기서)\s*(?:공개|열기)/i,
  /(?:연출|예시|참고)\s*이미지/i,
];
const AWKWARD_AUDIENCE_COPY = [
  /(?:고르는|갈리는|찾는|준비하는)\s*집들/i,
  /(?:누구의|어떤)\s*(?:불편|반응|구매\s*이유)/i,
  /가격\s*조건(?:에|과|,)?\s*할인\s*조건(?:으로)?$/i,
  /상품\s*구성는/i,
];
const DELIVERY_AUDIENCE_COPY = [
  /(?:무료\s*)?배송(?:비|료|조건|지|지역|일정|기간|안내|가능|불가|추가|제외|문의)?/i,
  /(?:제주|도서\s*산간|산간\s*지역).*(?:추가|비용|요금|배송)/i,
  /(?:택배|착불)\s*(?:비|비용|요금|안내)/i,
];
const CTA_ACTION = /(?:확인(?:해|하세요|하기|해요)|살펴(?:봐|보세요|보기)|비교(?:해|하세요|하기)|구매(?:해|하세요|하기)|주문(?:해|하세요|하기)|예약(?:해|하세요|하기)|신청(?:해|하세요|하기)|담아(?:봐|보세요)|눌러(?:봐|보세요)|챙겨(?:가|가세요|두세요)|쟁여(?:둬|두세요)|선택(?:해|하세요|하기)|만나(?:봐|보세요)|끓여(?:봐|보세요)|먹어(?:봐|보세요)|맛(?:봐|보세요)|써(?:봐|보세요)|사용해(?:봐|보세요))/i;
const OPENING_RHYTHM_MARKERS = ["잠깐", "진짜", "설마", "왜", "여러분", "형님들"];
const OPENING_STRENGTH = /[?!]|왜|설마|잠깐|진짜|누가|또|처음|비밀|공개|혼나|냄새|가격|말이 돼|보세요|봐요|멈춰|고르지 마|열자마자|한입|밥|먹|굽|지글|윤기|육즙/i;

function containsDeliveryDetail(value: unknown) {
  return DELIVERY_AUDIENCE_COPY.some((pattern) => pattern.test(String(value || "")));
}

function visibleCaptionLength(value: string) {
  return value.replace(/\s/g, "").length;
}

function captionDuration(cut: VideoCut) {
  return Math.max(0.1, cut.endSecond - cut.startSecond);
}

export function captionCharactersPerSecond(cut: VideoCut) {
  return visibleCaptionLength(cut.caption) / captionDuration(cut);
}

function captionReadingLimit(cut: VideoCut, isFinal: boolean) {
  if (cut.startSecond < 3) return 11;
  if (isFinal) return 10;
  return 10.5;
}

export function detailedCaptionReadingIssues(cuts: VideoCut[]) {
  const finalId = [...cuts].sort((left, right) => left.startSecond - right.startSecond).at(-1)?.id;
  return cuts
    .map((cut) => {
      const speed = captionCharactersPerSecond(cut);
      const limit = captionReadingLimit(cut, cut.id === finalId);
      return { cutNumber: cut.cutNumber, speed, limit };
    })
    .filter((item) => item.speed > item.limit + 0.01);
}

function openingCuts(concept: VideoConcept) {
  return [...concept.cuts]
    .sort((left, right) => left.startSecond - right.startSecond)
    .filter((cut) => cut.startSecond < 3 && cut.endSecond <= 3)
    .slice(0, 2);
}

export function hasStrongDetailedPlanningOpening(concept: VideoConcept) {
  return !concept.conceptArchetype || openingCuts(concept).some((cut) => OPENING_STRENGTH.test(`${cut.caption} ${cut.narration}`));
}

/**
 * 유효한 오프닝 자막을 특정 단어가 없다는 이유만으로 전체 폐기하지 않습니다.
 * AI가 질문·명령의 문장부호만 빠뜨린 경우 읽기 여유가 가장 큰 첫 3초 구간에
 * 최소한의 강조 부호를 복원하고 나머지 대본은 그대로 보존합니다.
 */
export function repairDetailedPlanningOpeningHook(concept: VideoConcept) {
  if (hasStrongDetailedPlanningOpening(concept)) return concept;
  const candidates = openingCuts(concept)
    .map((cut) => ({
      cut,
      headroom: Math.floor(captionDuration(cut) * captionReadingLimit(cut, false)) - visibleCaptionLength(cut.caption),
    }))
    .sort((left, right) => right.headroom - left.headroom);
  const target = candidates.find((candidate) => candidate.headroom >= 1)?.cut;
  if (!target?.caption.trim()) return concept;
  const caption = `${target.caption.trim().replace(/[.。]+$/u, "")}!`;
  const cuts = concept.cuts.map((cut) => (cut.id === target.id ? { ...cut, caption } : cut));
  return {
    ...concept,
    cuts,
    fullScript: cuts
      .map((cut) => normalizePlanningCopy(cut.narration) || normalizePlanningCopy(cut.caption))
      .filter(Boolean)
      .join(" "),
  };
}

function hasDetailedCaptionDensity(concept: VideoConcept, cuts: VideoCut[]) {
  // Legacy/template plans were authored under the old compact-caption rule.
  // Apply the richer density contract only to the new four-concept AI path.
  if (!concept.conceptArchetype) return cuts.every((cut) => cut.caption.length > 0 && cut.caption.length <= 46);
  const finalCut = cuts.at(-1);
  const lengthsAreValid = cuts.every((cut) => {
    const length = visibleCaptionLength(cut.caption);
    if (cut.caption.length > 46) return false;
    if (cut.id === finalCut?.id) return length >= 4;
    return length >= (cut.startSecond < 3 ? 4 : 5);
  });
  return lengthsAreValid;
}

export function segmentRange(duration: VideoDuration) {
  // 30초 이상은 성과형 숏폼의 정보 밀도를 유지하되, 각 컷을 단순 자막
  // 카드가 아닌 실제 사건·대사·제품 반응이 있는 장면으로 구성합니다.
  if (duration === 15) return { min: 15, max: 17, preferred: 15 };
  if (duration === 20) return { min: 15, max: 17, preferred: 15 };
  if (duration === 30) return { min: 15, max: 17, preferred: 15 };
  if (duration === 45) return { min: 18, max: 23, preferred: 20 };
  return { min: 22, max: 28, preferred: 24 };
}

export function hasVerifiedVideoBenefit(analysis: ProductAnalysisSnapshot) {
  const saleFacts = [analysis.discountInfo, analysis.promotion, analysis.originalPrice, analysis.minimumOrderQuantity];
  return Boolean(
    saleFacts.some((value) => String(value || "").trim() && !containsDeliveryDetail(value)) ||
      (analysis.composition || []).some((value) => !containsDeliveryDetail(value)) ||
      (analysis.verifiedFacts || []).some((fact) => !containsDeliveryDetail(`${fact.label} ${fact.value}`) && /가격|할인|혜택|증정|구성|쿠폰/i.test(`${fact.label} ${fact.value}`))
  );
}

function commercialPlanningFacts(analysis: ProductAnalysisSnapshot) {
  return [
    { value: analysis.price, replacement: "가격 조건" },
    { value: analysis.originalPrice, replacement: "기존 가격 조건" },
    { value: analysis.discountInfo, replacement: "할인 조건" },
    { value: analysis.promotion, replacement: "예약 조건" },
    { value: analysis.volumeOrOption, replacement: "상품 구성" },
    ...(analysis.composition || []).map((value) => ({ value, replacement: "상품 구성" })),
  ]
    .map((item) => ({ ...item, value: String(item.value || "").trim() }))
    .filter((item) => item.value && !containsDeliveryDetail(item.value));
}

function containsExactCommercialFact(value: string, facts: ReturnType<typeof commercialPlanningFacts>) {
  const normalized = value.replace(/\s+/g, "").toLowerCase();
  return facts.some((fact) => {
    const token = fact.value.replace(/\s+/g, "").toLowerCase();
    return token.length >= 2 && normalized.includes(token);
  });
}

function replaceExactCommercialFacts(value: string, facts: ReturnType<typeof commercialPlanningFacts>) {
  let next = value;
  for (const fact of facts.sort((left, right) => right.value.length - left.value.length)) {
    const escaped = Array.from(fact.value.replace(/\s+/g, ""))
      .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*");
    next = next.replace(new RegExp(escaped, "giu"), fact.replacement);
  }
  return next
    .replace(/상품\s*구성는/g, "상품 구성은")
    .replace(/(?:지금\s*)?상품\s*구성은\s*가격\s*조건\s*,?\s*할인\s*조건으로\s*볼\s*수\s*있습니다[.]?/g, "상품 구성과 가격·할인 조건을 함께 확인해보세요.")
    .replace(/^가격\s*조건(?:에|과|,)?\s*할인\s*조건[.]?$/g, "가격·할인 조건을 확인해요")
    .replace(/가격(?:은|이|도)?\s*(?:기존\s*)?가격\s*조건(?:입니다|이에요|예요)?/g, "가격 조건도 확인해보세요")
    .replace(/(?:기존\s*)?가격\s*조건(?:으로|에)?\s*(?:만나는|구매하는)?\s*구성/g, "가격 조건도 확인해요")
    .replace(/(?:가격\s*조건\s*){2,}/g, "가격 조건 ")
    .replace(/(?:기존\s*가격\s*조건\s*){2,}/g, "기존 가격 조건 ")
    .replace(/(?:할인\s*조건\s*){2,}/g, "할인 조건 ")
    .replace(/(?:상품\s*구성\s*){2,}/g, "상품 구성 ")
    .replace(/할인\s*조건\s*,\s*/g, "할인 조건과 ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** 가격·할인·구성을 15개 자막의 중심 사건처럼 연속 나열하지 않게 정리합니다. */
export function repairDetailedPlanningCommercialRestraint(concept: VideoConcept, analysis: ProductAnalysisSnapshot) {
  if (!concept.conceptArchetype) return concept;
  const facts = commercialPlanningFacts(analysis);
  if (!facts.length) return concept;
  const ordered = [...concept.cuts].sort((left, right) => left.startSecond - right.startSecond);
  const commercial = ordered.filter((cut) => containsExactCommercialFact(`${cut.caption} ${cut.narration}`, facts));
  const consecutive = commercial.some((cut, index) => index > 0 && cut.cutNumber === commercial[index - 1].cutNumber + 1);
  if (commercial.length <= 2 && !consecutive) return concept;

  const keepIds = new Set<string>();
  const finalCut = ordered.at(-1);
  if (finalCut && commercial.some((cut) => cut.id === finalCut.id)) keepIds.add(finalCut.id);
  for (const cut of commercial) {
    if (keepIds.size >= 2) break;
    const conflicts = commercial.some((kept) => keepIds.has(kept.id) && Math.abs(kept.cutNumber - cut.cutNumber) <= 1);
    if (!conflicts) keepIds.add(cut.id);
  }
  if (!keepIds.size && commercial[0]) keepIds.add(commercial[0].id);

  const commercialIds = new Set(commercial.map((cut) => cut.id));
  const cuts = concept.cuts.map((cut) =>
    commercialIds.has(cut.id) && !keepIds.has(cut.id)
      ? {
          ...cut,
          caption: replaceExactCommercialFacts(cut.caption, facts),
          narration: replaceExactCommercialFacts(cut.narration, facts),
        }
      : cut
  );
  return {
    ...concept,
    cuts,
    fullScript: cuts
      .map((cut) => normalizePlanningCopy(cut.narration) || normalizePlanningCopy(cut.caption))
      .filter(Boolean)
      .join(" "),
  };
}

export function assignPlanningTimeline<T extends { caption: string; narration?: string; sceneDescription: string }>(rows: T[], duration: VideoDuration): Array<T & { startSecond: number; endSecond: number }> {
  if (rows.length < 3) throw new Error("영상 대본을 구성할 구간이 부족합니다.");
  const openingCount = 2;
  const bodyCount = Math.max(0, rows.length - openingCount - 1);
  const ctaDuration = duration >= 45 ? 3 : duration >= 30 ? 2.4 : duration >= 20 ? 2 : 1.5;
  const bodyDuration = Math.max(0, duration - 3 - ctaDuration);
  let previous = 0;
  return rows.map((row, index) => {
    const startSecond = previous;
    let endSecond: number;
    if (index === 0) endSecond = 1.2;
    else if (index === 1) endSecond = 3;
    else if (index === rows.length - 1) endSecond = duration;
    else endSecond = Number((3 + (bodyDuration * (index - openingCount + 1)) / Math.max(1, bodyCount)).toFixed(2));
    previous = endSecond;
    return { ...row, startSecond, endSecond };
  });
}

type PlanningNumberOccurrence = { value: string; index: number; raw: string };

function planningNumberOccurrences(value: string): PlanningNumberOccurrence[] {
  return [...value.matchAll(/\d[\d,.]*/g)].map((match) => ({
    value: String(match[0] || "").replace(/[,.]/g, ""),
    index: match.index || 0,
    raw: String(match[0] || ""),
  }));
}

function normalizedNumbers(value: string) {
  return planningNumberOccurrences(value).map((item) => item.value);
}

/**
 * 블라인드 테스트의 `1번 국물`, `2개의 냄비`, `친구 2명`처럼 촬영 사건을
 * 구분하는 숫자는 상품의 가격·용량·구성 주장이 아니다. 숫자만 떼어 ProductTruth와
 * 대조하면 이런 장면 번호까지 근거 없는 수치로 오인하므로, 매우 제한된 촬영·선택
 * 문맥만 예외로 분리한다. `2개입`, `2팩`, `2+1` 같은 판매 구성은 예외가 아니다.
 */
function isNarrativePlanningNumber(source: string, occurrence: PlanningNumberOccurrence) {
  if (!/^[12]$/.test(occurrence.value)) return false;
  const before = source.slice(Math.max(0, occurrence.index - 18), occurrence.index);
  const after = source.slice(occurrence.index + occurrence.raw.length, occurrence.index + occurrence.raw.length + 24);
  const context = `${before}#${after}`;
  return (
    /#\s*(?:번(?:째)?\s*(?:국물|맛|냄비|그릇|접시|후보|선택|쪽|팀|사람)?|명(?:의)?\s*(?:친구|사람|인물|출연자)|(?:개(?:의)?|가지)\s*(?:국물|맛|냄비|그릇|접시|후보|선택지)|사람|팀|후보|선택지|냄비|그릇|접시|쪽)/u.test(context) ||
    /(?:친구|사람|인물|출연자|후보|냄비|그릇|접시)\s*#\s*(?:명)?/u.test(context) ||
    /(?:A|B)\s*(?:와|랑|대|vs\.?)?\s*#\s*(?:번|쪽|팀)?/iu.test(context)
  );
}

function hasInternalPlanningAudienceCopy(cut: VideoCut) {
  return (
    INTERNAL_SPEAKER_LABEL_COPY.test(cut.caption) ||
    INTERNAL_PLANNING_COPY.some((pattern) => pattern.test(`${cut.caption} ${cut.narration}`))
  );
}

function unsupportedAudienceNumbers(value: string, allowed: Set<string>) {
  return planningNumberOccurrences(value)
    .filter((occurrence) => !allowed.has(occurrence.value) && !isNarrativePlanningNumber(value, occurrence))
    .map((occurrence) => occurrence.value);
}

function hasProductClaimNumber(value: string) {
  return planningNumberOccurrences(value).some((occurrence) => !isNarrativePlanningNumber(value, occurrence));
}

function allowedNumbers(analysis: ProductAnalysisSnapshot) {
  return new Set(normalizedNumbers([analysis.productName, analysis.price, analysis.originalPrice, analysis.discountInfo, analysis.promotion, analysis.volumeOrOption, analysis.countryOfOrigin, ...(analysis.verifiedNumbers || []), ...(analysis.verifiedFacts || []).map((fact) => fact.value), ...analysis.coreUsps, ...analysis.keyFeatures].join(" ")));
}

function repeatedPhrases(cuts: VideoCut[]) {
  const counts = new Map<string, number>();
  for (const cut of cuts) {
    const key = cut.caption.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
    if (key.length < 5) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

export type SceneProductionSignal = "setting" | "subject" | "action" | "reaction" | "firstFocus" | "transition";

export function missingSceneSignals(cut: VideoCut): SceneProductionSignal[] {
  const scene = cut.sceneDescription;
  const signals = {
    setting: /(?:식탁|주방|욕실|현관|거실|사무실|헬스장|야외|캠핑|침실|매장|팬|조리대|세면대|샤워실|샤워부스|도로|엘리베이터|테이블|선반|타일|바닥|문앞|창가|공간|프레임|화면|배경)/i.test(scene),
    subject: /(?:인물|사람|남성|여성|고객|직장인|운동인|사용자|가족|아이|손|얼굴|몸|제품|상품|용기|패키지|병|샤워젤|바디워시|고기|등심|식재료|그릇|접시)/i.test(scene),
    action: /(?:꺼내|열|붓|올리|놓|닦|씻|걷|앉|들|자르|굽|바르|누르|잡|돌리|문지르|헹구|먹|젓|담|가리키|비추|움직|흐르|떨어|퍼지|맺히|등장|사라|바뀌|확대|축소|당기|밀|흔들|멈추|맞추|비교|겹치|정렬|스치|보이|고정|쌓|채우|감싸|내려|올라|교차|분할|교체|닿|씹|집|펼치|확인|고개)/i.test(scene),
    reaction: /(?:표정|반응|웃|미소|찡그|놀라|끄덕|편안|상쾌|산뜻|만족|긴장|망설|안도|기대|불편|찝찝|시원|개운|윤기|거품|물방울|김|연기|수증기|색감|빛|반짝|강조|대비|익어|갈색|선명|촉촉|부드럽|뜨겁|차갑|냉기|땀|시선|눈빛|몸짓|손짓)/i.test(scene),
    firstFocus: /(?:먼저|첫|처음|시작|오프닝|가장 먼저|전면|중앙|클로즈업|화면을 채우|시선을 끌|눈에 들어|전경)/i.test(scene),
    transition: /(?:다음|전환|이어|컷|넘어|바뀌|밀며|당기며|줌|페이드|패닝|닫히|열리|끝나|연결|교차|분할|슬라이드|디졸브|매치컷|후경|밖으로|안으로|흐르며|남기며)/i.test(scene),
  };
  return Object.entries(signals)
    .filter(([, present]) => !present)
    .map(([key]) => key as SceneProductionSignal);
}

function sceneSetting(analysis: ProductAnalysisSnapshot) {
  const category = `${analysis.category} ${analysis.productType || ""} ${analysis.productName}`;
  if (/육류|축산|고기|식품|먹거리|과일|채소|농산|수산|음료/i.test(category)) {
    return "밝은 주방 조리대와 식탁";
  }
  if (/뷰티|바디|샤워|화장|세정|생활/i.test(category)) {
    return "자연광이 드는 욕실 세면대 앞";
  }
  if (/패션|의류|신발|가방|주얼리/i.test(category)) {
    return "전신 거울과 상품 선반이 있는 밝은 실내";
  }
  return "자연광이 드는 제품 촬영 테이블";
}

function normalizePlanningCopy(value: string | undefined) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasReadableKoreanSpacing(value: string) {
  const normalized = normalizePlanningCopy(value);
  const visible = normalized.replace(/[^0-9a-z가-힣]/gi, "");
  if (visible.length < 8 || /\s/.test(normalized)) return true;
  // 가격·용량처럼 하나의 짧은 값 자체가 자막인 경우는 붙여 쓸 수 있다.
  if (/^\d[\d,.]*(?:%|원|kg|g|mg|ml|l|개|팩|세트|박스)?[?!.;~]*$/i.test(normalized)) return true;
  return false;
}

function isIncompleteAudienceCaption(value: string) {
  const normalized = normalizePlanningCopy(value).replace(/[?!.;~]+$/g, "");
  return /(?:될\s*수|할\s*수|하면|인데|이고|이며|해서|하며|라서|라고|라는|처럼|보다|위해|대한|관한|볼\s*건|할\s*건|것은|점은|이유는|답은)$/i.test(normalized);
}

function isIntentionalCaptionChain(cuts: VideoCut[], index: number) {
  const current = cuts[index];
  if (!current || !isIncompleteAudienceCaption(current.caption)) return false;
  let combined = normalizePlanningCopy(current.caption);
  // 연결어로 끝난 자막은 바로 다음 화면에서만 완결되어야 한다. 여러 화면을
  // 건너뛰어 우연히 완결되는 것처럼 보이면 서로 무관한 문구도 통과할 수 있다.
  for (let offset = 1; offset <= 1; offset += 1) {
    const next = cuts[index + offset];
    if (!next) break;
    combined = `${combined} ${normalizePlanningCopy(next.caption)}`.trim();
    const compactCombined = combined.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
    const spokenContext = `${normalizePlanningCopy(current.narration)} ${normalizePlanningCopy(next.narration)}`
      .replace(/[^0-9a-z가-힣]/gi, "")
      .toLowerCase();
    if (
      !isIncompleteAudienceCaption(combined) &&
      visibleCaptionLength(combined) >= 8 &&
      compactCombined.length >= 6 &&
      spokenContext.includes(compactCombined)
    ) return true;
  }
  return false;
}

function captionCompletionCandidate(cut: VideoCut, narration: string) {
  const normalized = normalizePlanningCopy(narration)
    .replace(/^(?:[가-힣A-Z]{1,12})\s*[:：]\s*/u, "")
    .trim();
  if (!normalized || isIncompleteAudienceCaption(normalized)) return "";
  const maxVisible = Math.max(5, Math.min(46, Math.floor(captionDuration(cut) * captionReadingLimit(cut, false))));
  const candidates = [
    normalized,
    ...normalized.split(/(?<=[?!.])\s+|[,，]\s*/u).map((item) => item.trim()),
  ].filter(Boolean);
  return (
    candidates.find((candidate) => {
      const length = visibleCaptionLength(candidate);
      return length >= (cut.startSecond < 3 ? 4 : 5) && length <= maxVisible && !isIncompleteAudienceCaption(candidate);
    }) || ""
  );
}

function minimallyCompleteCaption(value: string) {
  const normalized = normalizePlanningCopy(value).replace(/[?!.;~]+$/g, "");
  const replacements: Array<[RegExp, string]> = [
    [/될\s*수$/i, "될 수 있을까요?"],
    [/할\s*수$/i, "할 수 있을까요?"],
    [/하면$/i, "하면 어떨까요?"],
    [/인데$/i, "인데요?"],
    [/이고$/i, "이고요."],
    [/이며$/i, "이에요."],
    [/해서$/i, "해서 골랐어요."],
    [/하며$/i, "하면서 달라져요."],
    [/라서$/i, "라서 골랐어요."],
    [/라고$/i, "라고 하더라고요."],
    [/라는$/i, "라는 점이에요."],
    [/처럼$/i, "처럼 보여요."],
    [/보다$/i, "보다 더 궁금해져요."],
    [/위해$/i, "위해 준비했어요."],
    [/대한$/i, "대한 답이에요."],
    [/관한$/i, "관한 이야기예요."],
    [/볼\s*건$/i, "볼 건 이거예요."],
    [/할\s*건$/i, "할 건 이거예요."],
    [/것은$/i, "것은 이거예요."],
    [/점은$/i, "점은 바로 이거예요."],
    [/이유는$/i, "이유는 바로 이거예요."],
    [/답은$/i, "답은 바로 이거예요."],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(normalized)) return normalized.replace(pattern, replacement);
  }
  return value;
}

function audienceCaptionKey(value: string) {
  return value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
}

function repairRepeatedAudienceCaptions(cuts: VideoCut[]) {
  const ordered = [...cuts].sort((left, right) => left.startSecond - right.startSecond);
  const finalId = ordered.at(-1)?.id;
  const groups = new Map<string, VideoCut[]>();
  for (const cut of ordered) {
    const key = audienceCaptionKey(cut.caption);
    if (key.length < 5) continue;
    groups.set(key, [...(groups.get(key) || []), cut]);
  }
  const used = new Set(ordered.map((cut) => audienceCaptionKey(cut.caption)));
  const replacements = new Map<string, string>();
  for (const duplicateCuts of [...groups.values()].filter((items) => items.length > 1)) {
    const keepId = duplicateCuts.some((cut) => cut.id === finalId) ? finalId : duplicateCuts[0].id;
    for (const cut of duplicateCuts) {
      if (cut.id === keepId) continue;
      const candidate = captionCompletionCandidate(cut, cut.narration);
      const key = audienceCaptionKey(candidate);
      if (
        !candidate ||
        key.length < 5 ||
        used.has(key) ||
        GENERIC_COPY.some((pattern) => pattern.test(candidate)) ||
        INTERNAL_PLANNING_COPY.some((pattern) => pattern.test(candidate)) ||
        isIncompleteAudienceCaption(candidate)
      ) {
        continue;
      }
      used.add(key);
      replacements.set(cut.id, candidate);
    }
  }
  if (!replacements.size) return cuts;
  return cuts.map((cut) => (replacements.has(cut.id) ? { ...cut, caption: replacements.get(cut.id)! } : cut));
}

function naturalizePlanningCta(value: string) {
  return normalizePlanningCopy(value)
    .replace(/^(?:확인된|검증된)\s*(?:혜택|할인)(?:은|는|이|가)?\s*(\d[\d,.]*%)\s*/i, "$1 할인, ")
    .replace(/^(?:확인된|검증된)\s*(?:가격|구성|배송)(?:은|는|이|가)?\s*/i, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackPlanningCta(concept: VideoConcept) {
  if (concept.objective === "retargeting") return "상품 정보를 다시 확인하세요";
  if (concept.objective === "usp") return "제품의 차이를 상세페이지에서 확인하세요";
  if (concept.objective === "review-ugc") return "후기와 상품 정보를 함께 확인하세요";
  if (concept.objective === "new-customer-hook") return "상품 정보를 상세페이지에서 확인하세요";
  if (concept.objective === "benefit") return "확인된 혜택 조건을 살펴보세요";
  if (concept.objective === "new-product") return "신상품 정보를 상세페이지에서 확인하세요";
  if (concept.objective === "interest") return "상품의 확인된 정보를 더 살펴보세요";
  return "구매 조건을 상세페이지에서 확인하세요";
}

/** 자막 최대 길이 안에서 CTA를 단어 중간이 잘리지 않도록 줄인다. */
export function compactPlanningCta(value: string, fallback: string, maxLength = 34) {
  const safeLimit = Math.max(12, Math.min(34, Math.floor(maxLength)));
  const fallbackCopy = normalizePlanningCopy(fallback) || "상품 정보를 지금 확인하세요";
  let normalized = naturalizePlanningCta(value) || fallbackCopy;
  if (visibleCaptionLength(normalized) <= safeLimit && CTA_ACTION.test(normalized)) return normalized;
  const matchedAction = normalized.match(/(?:지금\s*)?(?:직접\s*)?(?:확인(?:해\s*보세요|해보세요|하세요)|살펴보세요|비교하세요|구매하세요|주문하세요|예약하세요|신청하세요|눌러보세요|챙겨두세요|쟁여두세요|선택하세요|만나보세요|끓여보세요|먹어보세요|맛보세요|써보세요|사용해보세요)[.!?]*$/i)?.[0];
  const action = normalizePlanningCopy(matchedAction) || "지금 확인하세요";
  const subject = normalizePlanningCopy(matchedAction ? normalized.slice(0, -matchedAction.length) : normalized).replace(/[,.·/|\-]+$/g, "").trim();
  const subjectLimit = Math.max(0, safeLimit - visibleCaptionLength(action));
  let compactSubject = "";
  for (const word of subject.split(" ").filter(Boolean)) {
    const candidate = compactSubject ? `${compactSubject} ${word}` : word;
    if (visibleCaptionLength(candidate) > subjectLimit) break;
    compactSubject = candidate;
  }
  normalized = compactSubject ? `${compactSubject} ${action}` : action;
  if (visibleCaptionLength(normalized) <= safeLimit) return normalized;
  return CTA_ACTION.test(fallbackCopy) && visibleCaptionLength(fallbackCopy) <= safeLimit ? fallbackCopy : "지금 확인하세요";
}

export function hasFinalPlanningCta(concept: VideoConcept) {
  const cta = normalizePlanningCopy(concept.cta);
  const finalCaption = normalizePlanningCopy([...concept.cuts].sort((left, right) => left.startSecond - right.startSecond).at(-1)?.caption);
  return Boolean(cta && finalCaption && finalCaption.includes(cta));
}

/**
 * AI가 마지막 자막에 CTA를 누락하거나 너무 긴 CTA를 반환한 경우 전체 대본을 다시
 * 생성하지 않고 마지막 구간만 결정적으로 보완한다. CTA와 마지막 자막을 같은 값으로
 * 맞춰 한 화면 한 문장 원칙과 34자 제한을 함께 지킨다.
 */
export function repairDetailedPlanningCta(concept: VideoConcept) {
  if (!concept.cuts.length) return concept;
  const finalCut = [...concept.cuts].sort((left, right) => left.startSecond - right.startSecond).at(-1);
  if (!finalCut) return concept;
  const readableLimit = Math.max(12, Math.floor(captionDuration(finalCut) * 10));
  const cta = compactPlanningCta(concept.cta, fallbackPlanningCta(concept), readableLimit);
  const alreadyValid = normalizePlanningCopy(concept.cta) === cta && normalizePlanningCopy(finalCut.caption).includes(cta) && visibleCaptionLength(finalCut.caption) <= readableLimit;
  if (alreadyValid) return concept;
  const cuts = concept.cuts.map((cut) => (cut.id === finalCut.id ? { ...cut, caption: cta } : cut));
  const fullScript = cuts
    .map((cut) => normalizePlanningCopy(cut.narration) || normalizePlanningCopy(cut.caption))
    .filter(Boolean)
    .join(" ");
  return {
    ...concept,
    cta,
    cuts,
    fullScript,
  };
}

function naturalizeEvidenceAuditCaption(value: string, isOpening: boolean) {
  const normalized = normalizePlanningCopy(value);
  if (!EVIDENCE_AUDIT_COPY.some((pattern) => pattern.test(normalized))) return normalized;

  const core = normalized
    .replace(/상세페이지(?:의|에서)?\s*(?:구성|가격|할인|수치|중량|용량|정보)?\s*(?:표기|기재)(?:는|가|를|로|상|되어|됐)?/gi, " ")
    .replace(/상세페이지(?:에서)?\s*확인(?:된|되는|한)\s*(?:구성|가격|할인|수치|중량|용량|정보|표기|내용)?/gi, " ")
    .replace(/(?:구성|가격|할인|수치|중량|용량)\s*표기(?:예요|에요|입니다|로|가|는)?/gi, (match) => match.replace(/\s*표기.*$/i, ""))
    .replace(/(?:확인된|확인되는|기재된)\s*(?:표기|수치|정보|내용|조건)/gi, " ")
    .replace(/(?:확인된|검증된)\s*(?:혜택|가격|할인|구성|배송)(?:은|는|이|가)?/gi, " ")
    .replace(/(?:표기|기재)(?:상|로는|에는|가|는)?\s*(?:보입니다|확인됩니다|되어\s*있습니다)/gi, " ")
    .replace(/확인\s*결과(?:로|는|가|입니다)?/gi, " ")
    .replace(/근거(?:상|에\s*따르면)/gi, " ")
    .replace(/(?:로\s*)?(?:보입니다|확인됩니다|기재됩니다)[.!?]*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[,.;:!?\s]+|[,.;:\s]+$/g, "")
    .trim();

  if (!core) return isOpening ? "잠깐만요.. 이 조건 실화인가요?" : "이 조건.. 그냥 지나치기 어렵죠?";
  const candidates = isOpening
    ? [`${core}.. 이거 실화인가요?`, `${core}..?`, core]
    : [`${core}.. 이건 그냥 지나치기 어렵죠?`, `${core}.. 이거 꽤 놀랍죠?`, `${core}..?`, core];
  const limit = isOpening ? 24 : 46;
  return candidates.find((candidate) => candidate.length <= limit) || core.slice(0, limit);
}

/**
 * ProductTruth와 상세페이지 출처는 사실 검증에만 사용한다. AI가 그 검수 과정을
 * 소비자용 자막으로 옮긴 경우, 확인된 사실 자체는 남기고 시청자에게 직접 말하는
 * 문장으로 바꾼다.
 */
export function repairDetailedPlanningAudienceCopy(concept: VideoConcept) {
  let changed = false;
  let cuts = concept.cuts.map((cut, index) => {
    let caption = naturalizeEvidenceAuditCaption(cut.caption, cut.startSecond < 3);
    const narration = naturalizeEvidenceAuditCaption(cut.narration, cut.startSecond < 3);
    if (isIncompleteAudienceCaption(caption) && !isIntentionalCaptionChain(concept.cuts, index)) {
      const fromNarration = captionCompletionCandidate(cut, narration);
      const completed = fromNarration || minimallyCompleteCaption(caption);
      const readableLimit = Math.max(5, Math.min(46, Math.floor(captionDuration(cut) * captionReadingLimit(cut, false))));
      if (visibleCaptionLength(completed) <= readableLimit && !isIncompleteAudienceCaption(completed)) {
        caption = completed;
      }
    }
    if (caption === cut.caption && narration === cut.narration) return cut;
    changed = true;
    return { ...cut, caption, narration };
  });
  const deduplicated = repairRepeatedAudienceCaptions(cuts);
  if (deduplicated !== cuts) {
    cuts = deduplicated;
    changed = true;
  }
  if (!changed) return concept;
  return {
    ...concept,
    cuts,
    fullScript: cuts.map((cut) => cut.narration || cut.caption).join(" "),
  };
}

/**
 * AI가 작성한 장면의 의미와 순서는 유지하면서 촬영 지시에 꼭 필요한 누락 신호만
 * 결정적으로 보완한다. 장면 신호 한두 개 누락 때문에 20개 대본 전체를 다시 생성하는
 * 느린 경로를 피하고, 제품 전용 B-roll처럼 사람이 없는 컷도 관찰 가능한 시각 반응으로
 * 명확하게 표현하기 위한 서버 측 정규화 단계다.
 */
export function repairDetailedPlanningSceneDescriptions(concept: VideoConcept, analysis: ProductAnalysisSnapshot) {
  let changed = false;
  const cuts = concept.cuts.map((cut) => {
    const missing = missingSceneSignals(cut);
    const additions: string[] = [];
    if (missing.includes("setting")) {
      additions.push(`장소는 ${sceneSetting(analysis)}다.`);
    }
    if (missing.includes("subject")) {
      additions.push("화면의 주체는 제품 패키지와 제품을 다루는 손이다.");
    }
    if (missing.includes("action")) {
      additions.push("손이 제품을 들어 화면 중앙에 놓고 정면 라벨을 카메라에 비춘다.");
    }
    // Reaction, first focus and transitions are creative choices. Requiring the
    // same sentence in every cut produced repetitive, checklist-like scene plans.
    if (!additions.length && cut.sceneDescription.length >= 75) return cut;
    if (cut.sceneDescription.length < 75 && !additions.length) {
      additions.push(`장소는 ${sceneSetting(analysis)}다. 화면의 주체는 제품과 이를 다루는 손이며, 손이 제품을 들어 정면 라벨을 카메라에 비춘다.`);
    }
    changed = true;
    return {
      ...cut,
      sceneDescription: `${cut.sceneDescription.trim()} ${additions.join(" ")}`.trim().slice(0, 950),
    };
  });
  return changed ? { ...concept, cuts } : concept;
}

export type PlanningQualityCheck = { key: string; passed: boolean; message: string };

export function validateDetailedPlanning(concept: VideoConcept, analysis: ProductAnalysisSnapshot, duration: VideoDuration) {
  const cuts = [...concept.cuts].sort((left, right) => left.startSecond - right.startSecond);
  const range = segmentRange(duration);
  const combined = cuts.map((cut) => `${cut.caption} ${cut.narration} ${cut.sceneDescription}`).join(" ");
  const audienceCopy = cuts.map((cut) => `${cut.caption} ${cut.narration}`).join(" ");
  const firstThree = cuts.filter((cut) => cut.startSecond < 3 && cut.endSecond <= 3);
  const allowed = allowedNumbers(analysis);
  const unknownNumbers = unsupportedAudienceNumbers(audienceCopy, allowed);
  const requiredSceneSignals: SceneProductionSignal[] = ["setting", "subject", "action"];
  const sceneSignalFailures = cuts
    .map((cut) => ({ cutNumber: cut.cutNumber, missing: missingSceneSignals(cut).filter((signal) => requiredSceneSignals.includes(signal)) }))
    .filter((item) => item.missing.length > 0);
  const abstract = cuts.filter((cut) => cut.sceneDescription.length < 75 || (ABSTRACT_SCENES.some((pattern) => pattern.test(cut.sceneDescription)) && missingSceneSignals(cut).length >= 2));
  const readingIssues = concept.conceptArchetype ? detailedCaptionReadingIssues(cuts) : [];
  const spacingFailures = concept.conceptArchetype ? cuts.filter((cut) => !hasReadableKoreanSpacing(cut.caption)) : [];
  const incompleteCaptions = concept.conceptArchetype
    ? cuts.filter((cut, index) => isIncompleteAudienceCaption(cut.caption) && !isIntentionalCaptionChain(cuts, index))
    : [];
  const captionDensityFailures = concept.conceptArchetype
    ? cuts.filter((cut) => {
        const finalCut = cuts.at(-1);
        const length = visibleCaptionLength(cut.caption);
        if (cut.caption.length > 46) return true;
        if (cut.id === finalCut?.id) return length < 4;
        return length < (cut.startSecond < 3 ? 4 : 5);
      })
    : [];
  const genericCopyCuts = concept.conceptArchetype
    ? cuts.filter((cut) => GENERIC_COPY.some((pattern) => pattern.test(`${cut.caption} ${cut.narration}`)))
    : [];
  const internalPlanningCuts = concept.conceptArchetype
    ? cuts.filter((cut) => hasInternalPlanningAudienceCopy(cut))
    : [];
  const stageDirectionCuts = concept.conceptArchetype ? cuts.filter((cut) => [...STAGE_DIRECTION_COPY, ...AWKWARD_AUDIENCE_COPY].some((pattern) => pattern.test(cut.caption))) : [];
  const deliveryCopyCuts = concept.conceptArchetype ? cuts.filter((cut) => DELIVERY_AUDIENCE_COPY.some((pattern) => pattern.test(`${cut.caption} ${cut.narration}`))) : [];
  const openingMarkerRepeats = OPENING_RHYTHM_MARKERS.filter((marker) => firstThree.filter((cut) => cut.caption.includes(marker)).length > 1);
  const commercialTokens = commercialPlanningFacts(analysis)
    .map((item) => item.value.replace(/\s+/g, "").toLowerCase())
    .filter((value) => value.length >= 2);
  const commercialCuts = cuts.filter((cut) => {
    const copy = `${cut.caption} ${cut.narration}`.replace(/\s+/g, "").toLowerCase();
    return commercialTokens.some((token) => copy.includes(token));
  });
  const consecutiveCommercialCuts = commercialCuts.some((cut, index) => index > 0 && cut.cutNumber === commercialCuts[index - 1].cutNumber + 1);
  const spokenBodyCuts = cuts.slice(0, -1).filter((cut) => normalizePlanningCopy(cut.narration).length >= 8);
  const familyDialogueCuts = cuts.filter((cut) => FAMILY_SCRIPT_LABEL_COPY.test(cut.narration));
  const workplaceDialogueCuts = cuts.filter((cut) => WORKPLACE_SCRIPT_LABEL_COPY.test(cut.narration));
  const minimumSpokenCuts = Math.ceil(Math.max(1, cuts.length - 1) * 0.5);
  const isFood = /식품|육류|축산|고기|한우|음료|간식|베이커리|과일|수산/i.test(analysis.category);
  const foodDesireCuts = cuts.filter((cut) => /굽|팬|지글|수증기|육즙|윤기|결이|잘리|한입|밥|젓가락|씹|바삭|촉촉|먹고|먹는|입맛|향이/i.test(`${cut.caption} ${cut.narration} ${cut.sceneDescription}`));
  const selfIntroductionCopy = firstThree.map((cut) => `${cut.caption} ${cut.narration}`).join(" ");
  const selfIntroductionBody = cuts.slice(0, Math.max(3, Math.ceil(cuts.length / 2))).map((cut) => `${cut.caption} ${cut.narration}`).join(" ");
  const numericClaimSceneFailures = cuts.filter((cut) => {
    const spoken = `${cut.caption} ${cut.narration}`;
    if (!hasProductClaimNumber(spoken)) return false;
    return !/(?:상품|제품|원료|패키지|라벨|숫자|가격|구성|용량|중량|매크로|클로즈업|카드|자막)/i.test(cut.sceneDescription);
  });
  const checks: PlanningQualityCheck[] = [
    {
      key: "segment-count",
      passed: cuts.length >= range.min && cuts.length <= range.max,
      message: `${duration}초 영상은 ${range.min}~${range.max}개 구간이어야 합니다. 현재 ${cuts.length}개입니다.`,
    },
    {
      key: "first-three-seconds",
      passed: firstThree.length >= 2 && firstThree.length <= 3,
      message: `첫 3초에는 2~3개 구간이 필요합니다. 현재 ${firstThree.length}개입니다.`,
    },
    {
      key: "opening-strength",
      passed: hasStrongDetailedPlanningOpening(concept),
      message: "첫 1~2개 자막에는 질문·갈등·의외성·감각 반응 중 하나가 필요합니다.",
    },
    {
      key: "product-self-introduction-structure",
      passed:
        concept.hookType !== "product-self-introduction" ||
        (/나\s+.{1,32}(?:인데|이야|예요|입니다)[!?]?/u.test(selfIntroductionCopy) &&
          /(?:그냥|흔한|뻔한|알았|아니고|아니야|아니거든)/u.test(selfIntroductionBody)),
      message:
        "상품 자기소개형은 첫 3초의 ‘나 [상품]인데!’와 초반의 흔한 오해 부정이 함께 있어야 합니다.",
    },
    {
      key: "visual-changes",
      passed: new Set(firstThree.map((cut) => cut.sceneDescription)).size >= 2,
      message: "첫 3초에 서로 다른 시각적 변화가 2개 이상 필요합니다.",
    },
    {
      key: "parody-genre-lock",
      passed:
        concept.conceptArchetype !== "parody" ||
        Boolean(
          concept.parodyGenre &&
            matchesVideoParodyGenre(combined, concept.parodyGenre)
        ),
      message:
        concept.conceptArchetype === "parody" && concept.parodyGenre
          ? `창작 인물·상황극형은 선택된 '${getVideoParodyGenre(concept.parodyGenre)?.label || concept.parodyGenre}' 장르의 인물·사건·화면 흐름을 상세 대본 끝까지 유지해야 합니다.`
          : "창작 인물·상황극형은 자동 선택된 세부 장르를 상세 대본 끝까지 유지해야 합니다.",
    },
    {
      key: "timeline",
      passed: cuts[0]?.startSecond === 0 && cuts.at(-1)?.endSecond === duration && cuts.every((cut, index) => index === 0 || cut.startSecond === cuts[index - 1].endSecond),
      message: "구간 시간은 비거나 겹치지 않고 전체 영상 길이와 일치해야 합니다.",
    },
    {
      key: "seo-title",
      passed: !containsRawSeoTitle(combined, analysis.rawTitle, analysis.productName),
      message: "정제 전 SEO 제목 전체가 대본에 포함되면 안 됩니다.",
    },
    {
      key: "copy-repetition",
      passed: repeatedPhrases(cuts).length === 0,
      message: "같은 자막 문장을 반복하지 않아야 합니다.",
    },
    {
      key: "opening-copy-repetition",
      passed: !concept.conceptArchetype || openingMarkerRepeats.length === 0,
      message: openingMarkerRepeats.length ? `첫 3초에 같은 후킹 표현을 반복했습니다: ${openingMarkerRepeats.join(", ")}.` : "첫 3초의 후킹 표현이 반복되지 않습니다.",
    },
    {
      key: "product-repetition",
      passed: !analysis.productName || combined.split(analysis.productName).length - 1 <= 3,
      message: "상품명을 3회보다 많이 반복하지 않아야 합니다.",
    },
    {
      key: "natural-copy",
      passed:
        hasDetailedCaptionDensity(concept, cuts) &&
        genericCopyCuts.length === 0 &&
        internalPlanningCuts.length === 0,
      message:
        captionDensityFailures.length || genericCopyCuts.length || internalPlanningCuts.length
          ? `시청자용 자막 품질을 수정해 주세요.${captionDensityFailures.length ? ` 분량이 너무 짧거나 긴 자막: ${captionDensityFailures.map((cut) => `${cut.cutNumber}번`).join(", ")}.` : ""}${genericCopyCuts.length ? ` 범용 광고 문구가 들어간 구간: ${genericCopyCuts.map((cut) => `${cut.cutNumber}번`).join(", ")}.` : ""}${internalPlanningCuts.length ? ` 내부 기획·검수 표현이 들어간 구간: ${internalPlanningCuts.map((cut) => `${cut.cutNumber}번`).join(", ")}.` : ""}`
          : "자막은 시청자에게 직접 말하는 충분한 구어체이며 내부 기획 용어와 범용 광고 문구가 없습니다.",
    },
    {
      key: "caption-readability",
      passed: readingIssues.length === 0,
      message: readingIssues.length ? `읽기 속도가 빠른 자막: ${readingIssues.map((item) => `${item.cutNumber}번 ${item.speed.toFixed(1)}자/초`).join(" · ")}. 자막을 줄이거나 노출 시간을 늘려 주세요.` : "모든 자막이 노출 시간 안에 읽을 수 있는 길이입니다.",
    },
    {
      key: "caption-spacing",
      passed: spacingFailures.length === 0,
      message: spacingFailures.length ? `띄어쓰기가 없어 읽기 어려운 자막: ${spacingFailures.map((cut) => `${cut.cutNumber}번`).join(", ")}. 숫자·단위를 제외한 한국어 문장은 자연스럽게 띄어 써 주세요.` : "한국어 자막의 띄어쓰기가 자연스럽습니다.",
    },
    {
      key: "sentence-completion",
      passed: incompleteCaptions.length === 0,
      message: incompleteCaptions.length ? `문장이 중간에 끊긴 자막: ${incompleteCaptions.map((cut) => `${cut.cutNumber}번`).join(", ")}. 연결 표현은 바로 다음 자막까지 읽었을 때 같은 내레이션 안에서 한 화자의 말로 완결되게 써 주세요.` : "모든 자막이 단독 또는 의도적인 연속 자막 안에서 의미가 완결됩니다.",
    },
    {
      key: "audience-value-copy",
      passed: stageDirectionCuts.length === 0,
      message: stageDirectionCuts.length ? `광고 문구 대신 촬영 지시·부자연스러운 표현이 들어간 자막: ${stageDirectionCuts.map((cut) => `${cut.cutNumber}번`).join(", ")}. 구매 이유·증거·반응 문장으로 바꿔 주세요.` : "자막이 촬영 지시가 아니라 시청자용 광고 문장으로 작성되었습니다.",
    },
    {
      key: "delivery-copy",
      passed: deliveryCopyCuts.length === 0,
      message: deliveryCopyCuts.length ? `영상의 목적과 무관한 배송·배송비 안내가 들어간 자막: ${deliveryCopyCuts.map((cut) => `${cut.cutNumber}번`).join(", ")}. 배송 정보는 자막과 내레이션에서 완전히 제외해 주세요.` : "자막과 내레이션에 배송·배송비 안내가 없습니다.",
    },
    {
      key: "spoken-story",
      passed: !concept.conceptArchetype || spokenBodyCuts.length >= minimumSpokenCuts,
      message: `자막 나열이 아니라 실제로 들을 수 있는 대사·내레이션이 최소 ${minimumSpokenCuts}개 구간에 필요합니다. 현재 ${spokenBodyCuts.length}개입니다.`,
    },
    {
      key: "audience-narrator",
      passed:
        !concept.conceptArchetype ||
        (familyDialogueCuts.length === 0 && workplaceDialogueCuts.length <= 2),
      message:
        familyDialogueCuts.length || workplaceDialogueCuts.length > 2
          ? `등장인물끼리 주고받는 드라마 대본이 많습니다. 가족·친구 화자 라벨은 제거하고 한 명의 주 화자가 시청자에게 경험을 전달하게 바꿔 주세요.${workplaceDialogueCuts.length > 2 ? " 팀장·사장·직원 문답도 1~2회만 남겨 주세요." : ""}`
          : "한 명의 주 화자가 시청자에게 경험과 상품 정보를 자연스럽게 전달합니다.",
    },
    {
      key: "commercial-restraint",
      passed: !concept.conceptArchetype || commercialCuts.length <= 2 && !consecutiveCommercialCuts,
      message: commercialCuts.length > 2 || consecutiveCommercialCuts ? `가격·할인·구성 정보가 ${commercialCuts.map((cut) => `${cut.cutNumber}번`).join(", ")} 자막에 반복됩니다. 마지막 CTA와 서로 붙지 않은 핵심 근거 한 곳만 정확한 수치를 남기고, 나머지는 욕구·사용 이유·반응 장면으로 바꾸세요.` : "가격·할인·구성은 중심 사건을 방해하지 않는 보조 근거로 제한되었습니다.",
    },
    {
      key: "food-desire-context",
      passed: !concept.conceptArchetype || !isFood || foodDesireCuts.length >= 2,
      message: "식품 영상은 막연히 맛있다고 말하지 말고 조리 변화·질감·한입 이후의 생활 반응처럼 보이는 맛의 이유를 두 장면 이상 연결해야 합니다.",
    },
    {
      key: "scene-specificity",
      passed: abstract.length === 0 && sceneSignalFailures.length === 0,
      message: abstract.length || sceneSignalFailures.length ? `구체성이 부족한 구간: ${sceneSignalFailures.map((item) => `${item.cutNumber}번(${item.missing.join(", ")})`).join(" · ") || "추상 장면"}. 각 구간에 장소·주체·이야기를 바꾸는 행동을 구체적으로 명시해 주세요.` : "모든 장면에 장소·주체·실행 가능한 행동이 구체적으로 포함되어 있습니다.",
    },
    {
      key: "claim-scene-alignment",
      passed: numericClaimSceneFailures.length === 0,
      message: numericClaimSceneFailures.length
        ? `숫자·가격·구성 주장을 화면 근거로 확인할 수 없는 구간: ${numericClaimSceneFailures.map((cut) => `${cut.cutNumber}번`).join(", ")}. 해당 상품·원료·구성·가격을 같은 장면에 명시해 주세요.`
        : "숫자·가격·구성 주장이 같은 구간의 상품 근거 장면과 연결되어 있습니다.",
    },
    {
      key: "unsupported-numbers",
      passed: unknownNumbers.length === 0,
      message: unknownNumbers.length ? `상품 근거에 없는 수치가 있습니다: ${[...new Set(unknownNumbers)].join(", ")}` : "근거 없는 수치가 없습니다.",
    },
    {
      key: "policy-safety",
      passed: !concept.conceptArchetype || !/(치료|완치|질병을? 예방|무조건 낫|의사가 보증|실제 고객 인터뷰)/i.test(audienceCopy),
      message: "가상의 의사 가족 추천은 허용하지만 의학적 효능·치료·보증이나 실제 고객 사칭은 사용할 수 없습니다.",
    },
    {
      key: "cta",
      passed: hasFinalPlanningCta(concept),
      message: "앞의 구매 이유와 연결되는 CTA가 마지막 구간에 필요합니다.",
    },
    {
      key: "cta-action",
      passed: !concept.conceptArchetype || CTA_ACTION.test(normalizePlanningCopy(concept.cta)),
      message: "마지막 CTA에는 확인·구매·예약처럼 시청자가 바로 실행할 행동 동사가 필요합니다.",
    },
  ];
  return {
    valid: checks.every((check) => check.passed),
    score: Math.round((checks.filter((check) => check.passed).length / checks.length) * 100),
    revised: Boolean(concept.validation?.revised),
    checks,
  };
}

export function validateConceptDiversity(concepts: VideoConcept[]) {
  const hookTypes = new Set(concepts.map((concept) => concept.hookType));
  const fields = concepts.map((concept) => [concept.hookType, concept.openingHook, concept.centralIncident, concept.distinctiveCharacter, concept.socialWorld, concept.storyTrigger, concept.truthBridge, concept.customerProblem, concept.usp, concept.speakerPointOfView || concept.speaker, concept.recommendedVisualStyle || concept.creativeStyle, concept.narrativeStructure, concept.cta]);
  const pairSimilarities: number[] = [];
  for (let left = 0; left < fields.length; left += 1) {
    for (let right = left + 1; right < fields.length; right += 1) {
      const same = fields[left].filter((value, index) => value && value === fields[right][index]).length;
      pairSimilarities.push(same / fields[left].length);
    }
  }
  const archetypes = new Set<string>(concepts.map((concept) => concept.conceptArchetype).filter((value): value is NonNullable<typeof value> => Boolean(value)));
  const requiredArchetypes = new Set(["parody", "real-review", "usp-focus", "secret-benefit"]);
  const isFourConceptPlanning = concepts.length === 4 || archetypes.size > 0;
  const hasAllArchetypes = [...requiredArchetypes].every((item) => archetypes.has(item));
  return {
    valid: isFourConceptPlanning ? concepts.length === 4 && hasAllArchetypes && pairSimilarities.every((score) => score < 0.45) : concepts.length === 3 && hookTypes.size === concepts.length && pairSimilarities.every((score) => score < 0.45),
    similarities: pairSimilarities,
  };
}
