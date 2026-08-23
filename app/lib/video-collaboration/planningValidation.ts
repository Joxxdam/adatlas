import type { ProductAnalysisSnapshot, VideoConcept, VideoCut, VideoDuration } from "./types.ts";
import { containsRawSeoTitle } from "./productName.ts";

const ABSTRACT_SCENES = [/고객(?:이|의)?.*(?:문제|상황).*보여준다/i, /(?:제품|상품).*(?:USP|핵심|근거).*(?:클로즈업|제시|보여준다)/i, /사용\s*전후.*비교/i, /제품\s*전체.*CTA.*보여준다/i, /고객이\s*제품을\s*사용하는\s*장면/i];
const GENERIC_COPY = [/상품을 소개합니다/i, /여름철 필수템/i, /프리미엄 퀄리티/i, /특별한 경험/i, /놀라운 효과/i, /지금 만나보세요/i, /당신을 위한 선택/i, /일상에 활력을/i, /처음 보는 제품 자세히 보기/i, /확인된 포인트를 설명합니다/i];

export function segmentRange(duration: VideoDuration) {
  if (duration === 15) return { min: 15, max: 16, preferred: 15 };
  if (duration === 20) return { min: 15, max: 18, preferred: 16 };
  if (duration === 30) return { min: 18, max: 24, preferred: 20 };
  if (duration === 45) return { min: 22, max: 30, preferred: 24 };
  return { min: 22, max: 34, preferred: 26 };
}

export function hasVerifiedVideoBenefit(analysis: ProductAnalysisSnapshot) {
  return Boolean(analysis.discountInfo || analysis.promotion || analysis.originalPrice || analysis.minimumOrderQuantity || analysis.shippingConditions?.length || analysis.composition?.length || (analysis.verifiedFacts || []).some((fact) => /가격|할인|혜택|배송|증정|구성|쿠폰/i.test(`${fact.label} ${fact.value}`)));
}

export function assignPlanningTimeline<T extends { caption: string; narration?: string; sceneDescription: string }>(rows: T[], duration: VideoDuration): Array<T & { startSecond: number; endSecond: number }> {
  if (rows.length < 3) throw new Error("첫 3초를 구성할 대본 구간이 부족합니다.");
  const remainingCount = rows.length - 3;
  let previous = 0;
  return rows.map((row, index) => {
    const startSecond = previous;
    let endSecond: number;
    if (index < 3) endSecond = index + 1;
    else if (index === rows.length - 1) endSecond = duration;
    else endSecond = Number((3 + ((duration - 3) * (index - 2)) / remainingCount).toFixed(2));
    previous = endSecond;
    return { ...row, startSecond, endSecond };
  });
}

function normalizedNumbers(value: string) {
  return (value.match(/\d[\d,.]*/g) || []).map((item) => item.replace(/[,.]/g, ""));
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

function observableReaction(analysis: ProductAnalysisSnapshot) {
  const category = `${analysis.category} ${analysis.productType || ""} ${analysis.productName}`;
  if (/육류|축산|고기/i.test(category)) {
    return "반응은 원물 표면의 윤기와 익어가는 색감이 선명해지는 변화로 보여주고, 인물이 있으면 만족한 표정과 고개 끄덕임을 함께 잡는다.";
  }
  if (/식품|먹거리|과일|채소|농산|수산|음료/i.test(category)) {
    return "반응은 원물이나 내용물의 촉촉한 질감과 색감이 선명해지는 변화로 보여주고, 인물이 있으면 만족한 표정과 고개 끄덕임을 함께 잡는다.";
  }
  if (/뷰티|바디|샤워|화장|세정|생활/i.test(category)) {
    return "반응은 제품을 사용한 부위의 질감과 색감, 물방울이나 거품이 선명해지는 변화로 보여주고, 인물이 있으면 상쾌한 표정과 고개 끄덕임을 함께 잡는다.";
  }
  if (/패션|의류|신발|가방|주얼리/i.test(category)) {
    return "반응은 움직임에 따라 핏과 소재의 실루엣이 선명해지는 변화로 보여주고, 인물이 거울을 보며 만족한 표정으로 고개를 끄덕이는 모습을 잡는다.";
  }
  return "반응은 제품의 질감과 색감이 선명해지는 변화로 보여주고, 인물이 있으면 만족한 표정과 고개 끄덕임을 함께 잡는다.";
}

function compactTransitionCaption(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 24) || "다음 행동";
}

function normalizePlanningCopy(value: string | undefined) {
  return String(value || "")
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
export function compactPlanningCta(value: string, fallback: string) {
  const normalized = normalizePlanningCopy(value) || normalizePlanningCopy(fallback);
  if (normalized.length <= 34) return normalized;
  const words = normalized.split(" ");
  let result = "";
  for (const word of words) {
    const candidate = result ? `${result} ${word}` : word;
    if (candidate.length > 34) break;
    result = candidate;
  }
  return result || normalized.slice(0, 34);
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
  const cta = compactPlanningCta(concept.cta, fallbackPlanningCta(concept));
  const finalCut = [...concept.cuts].sort((left, right) => left.startSecond - right.startSecond).at(-1);
  if (!finalCut) return concept;
  const alreadyValid = normalizePlanningCopy(concept.cta) === cta && normalizePlanningCopy(finalCut.caption).includes(cta) && finalCut.caption.length <= 34;
  if (alreadyValid) return concept;
  const cuts = concept.cuts.map((cut) => (cut.id === finalCut.id ? { ...cut, caption: cta } : cut));
  const fullScript = normalizePlanningCopy(concept.fullScript);
  return {
    ...concept,
    cta,
    cuts,
    fullScript: fullScript.includes(cta) ? fullScript : `${fullScript} ${cta}`.trim(),
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
  const cuts = concept.cuts.map((cut, index) => {
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
    if (missing.includes("reaction")) {
      additions.push(observableReaction(analysis));
    }
    if (missing.includes("firstFocus")) {
      additions.push("첫 화면에는 제품 패키지 또는 핵심 행동이 중앙 클로즈업으로 가장 먼저 보인다.");
    }
    if (missing.includes("transition")) {
      const nextCaption = compactTransitionCaption(concept.cuts[index + 1]?.caption || "마지막 제품 화면");
      additions.push(`동작이 끝나면 다음 구간의 '${nextCaption}' 화면으로 매치컷 전환한다.`);
    }
    if (!additions.length && cut.sceneDescription.length >= 75) return cut;
    if (cut.sceneDescription.length < 75 && !additions.length) {
      additions.push(`첫 화면은 ${sceneSetting(analysis)} 중앙의 제품 패키지 클로즈업으로 시작하고, 손이 제품을 들어 정면 라벨을 비춘다.`, observableReaction(analysis), "동작이 끝나면 다음 구간 화면으로 매치컷 전환한다.");
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
  const unknownNumbers = normalizedNumbers(audienceCopy).filter((value) => !allowed.has(value));
  const sceneSignalFailures = cuts.map((cut) => ({ cutNumber: cut.cutNumber, missing: missingSceneSignals(cut) })).filter((item) => item.missing.length > 0);
  const abstract = cuts.filter((cut) => cut.sceneDescription.length < 75 || (ABSTRACT_SCENES.some((pattern) => pattern.test(cut.sceneDescription)) && missingSceneSignals(cut).length >= 2));
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
      passed: !concept.conceptArchetype || firstThree.slice(0, 2).some((cut) => /[?!]|왜|설마|잠깐|진짜|누가|또|처음|비밀|공개|혼나|냄새|가격|말이 돼/i.test(`${cut.caption} ${cut.narration}`)),
      message: "첫 1~2개 자막에는 질문·갈등·의외성·감각 반응 중 하나가 필요합니다.",
    },
    {
      key: "visual-changes",
      passed: new Set(firstThree.map((cut) => cut.sceneDescription)).size >= 2,
      message: "첫 3초에 서로 다른 시각적 변화가 2개 이상 필요합니다.",
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
      key: "product-repetition",
      passed: !analysis.productName || combined.split(analysis.productName).length - 1 <= 3,
      message: "상품명을 3회보다 많이 반복하지 않아야 합니다.",
    },
    {
      key: "natural-copy",
      passed: cuts.every((cut) => cut.caption.length > 0 && cut.caption.length <= 34) && !GENERIC_COPY.some((pattern) => pattern.test(combined)),
      message: "자막은 짧은 구어체여야 하며 범용 광고 문구를 사용하지 않아야 합니다.",
    },
    {
      key: "scene-specificity",
      passed: abstract.length === 0 && sceneSignalFailures.length === 0,
      message: abstract.length || sceneSignalFailures.length ? `구체성이 부족한 구간: ${sceneSignalFailures.map((item) => `${item.cutNumber}번(${item.missing.join(", ")})`).join(" · ") || "추상 장면"}. 각 구간에 장소·주체·행동·반응·첫 시각 요소·다음 전환을 모두 명시해 주세요.` : "모든 장면에 장소·주체·행동·반응·첫 시각 요소·다음 전환이 구체적으로 포함되어 있습니다.",
    },
    {
      key: "unsupported-numbers",
      passed: unknownNumbers.length === 0,
      message: unknownNumbers.length ? `상품 근거에 없는 수치가 있습니다: ${[...new Set(unknownNumbers)].join(", ")}` : "근거 없는 수치가 없습니다.",
    },
    {
      key: "policy-safety",
      passed: !concept.conceptArchetype || !/(치료|완치|질병을? 예방|무조건 낫|의사가 보증|실제 고객 인터뷰)/i.test(audienceCopy),
      message: "근거 없는 의학적 효능이나 실제 고객을 사칭하는 표현은 사용할 수 없습니다.",
    },
    {
      key: "cta",
      passed: hasFinalPlanningCta(concept),
      message: "앞의 구매 이유와 연결되는 CTA가 마지막 구간에 필요합니다.",
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
  const fields = concepts.map((concept) => [concept.hookType, concept.openingHook, concept.centralIncident, concept.customerProblem, concept.usp, concept.speakerPointOfView || concept.speaker, concept.recommendedVisualStyle || concept.creativeStyle, concept.narrativeStructure, concept.cta]);
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
