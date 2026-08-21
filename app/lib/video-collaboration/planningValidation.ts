import type {
  ProductAnalysisSnapshot,
  VideoConcept,
  VideoCut,
  VideoDuration,
} from "./types.ts";
import { containsRawSeoTitle } from "./productName.ts";

const ABSTRACT_SCENES = [
  /고객(?:이|의)?.*(?:문제|상황).*보여준다/i,
  /(?:제품|상품).*(?:USP|핵심|근거).*(?:클로즈업|제시|보여준다)/i,
  /사용\s*전후.*비교/i,
  /제품\s*전체.*CTA.*보여준다/i,
  /고객이\s*제품을\s*사용하는\s*장면/i,
];
const GENERIC_COPY = [
  /상품을 소개합니다/i,
  /여름철 필수템/i,
  /프리미엄 퀄리티/i,
  /특별한 경험/i,
  /놀라운 효과/i,
  /지금 만나보세요/i,
  /당신을 위한 선택/i,
  /일상에 활력을/i,
  /처음 보는 제품 자세히 보기/i,
  /확인된 포인트를 설명합니다/i,
];

export function segmentRange(duration: VideoDuration) {
  if (duration === 15) return { min: 15, max: 16, preferred: 15 };
  if (duration === 20) return { min: 15, max: 18, preferred: 16 };
  if (duration === 30) return { min: 18, max: 24, preferred: 20 };
  return { min: 20, max: 30, preferred: 24 };
}

export function assignPlanningTimeline<T extends { caption: string; narration?: string; sceneDescription: string }>(
  rows: T[],
  duration: VideoDuration
): Array<T & { startSecond: number; endSecond: number }> {
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
  return new Set(
    normalizedNumbers(
      [
        analysis.productName,
        analysis.price,
        analysis.originalPrice,
        analysis.discountInfo,
        analysis.promotion,
        analysis.volumeOrOption,
        analysis.countryOfOrigin,
        ...(analysis.verifiedNumbers || []),
        ...(analysis.verifiedFacts || []).map((fact) => fact.value),
        ...analysis.coreUsps,
        ...analysis.keyFeatures,
      ].join(" ")
    )
  );
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

function missingSceneSignals(cut: VideoCut) {
  const scene = cut.sceneDescription;
  const signals = {
    setting: /(?:식탁|주방|욕실|현관|거실|사무실|헬스장|야외|캠핑|침실|매장|팬|조리대|세면대|샤워실|샤워부스|도로|엘리베이터|테이블|선반|타일|바닥|문앞|창가|공간|프레임|화면|배경)/i.test(scene),
    subject: /(?:인물|사람|남성|여성|고객|직장인|운동인|사용자|가족|아이|손|얼굴|몸|제품|상품|용기|패키지|병|샤워젤|바디워시|고기|등심|식재료|그릇|접시)/i.test(scene),
    action: /(?:꺼내|열|붓|올리|놓|닦|씻|걷|앉|들|자르|굽|바르|누르|잡|돌리|문지르|헹구|먹|젓|담|가리키|비추|움직|흐르|떨어|퍼지|맺히|등장|사라|바뀌|확대|축소|당기|밀|흔들|멈추|맞추|비교|겹치|정렬|스치|보이|고정|쌓|채우|감싸|내려|올라|교차|분할|교체|닿|씹|집|펼치|확인|고개)/i.test(scene),
    reaction: /(?:표정|반응|웃|미소|찡그|놀라|끄덕|편안|상쾌|산뜻|만족|긴장|망설|안도|기대|불편|찝찝|시원|개운|윤기|거품|물방울|김|연기|수증기|색감|빛|반짝|강조|대비|익어|갈색|선명|촉촉|부드럽|뜨겁|차갑|냉기|땀|시선|눈빛|몸짓|손짓)/i.test(scene),
    firstFocus: /(?:먼저|첫|처음|시작|오프닝|가장 먼저|전면|중앙|클로즈업|화면을 채우|시선을 끌|눈에 들어|전경)/i.test(scene),
    transition: /(?:다음|전환|이어|컷|넘어|바뀌|밀며|당기며|줌|페이드|패닝|닫히|열리|끝나|연결|교차|분할|슬라이드|디졸브|매치컷|후경|밖으로|안으로|흐르며|남기며)/i.test(scene),
  };
  return Object.entries(signals).filter(([, present]) => !present).map(([key]) => key);
}

export type PlanningQualityCheck = { key: string; passed: boolean; message: string };

export function validateDetailedPlanning(
  concept: VideoConcept,
  analysis: ProductAnalysisSnapshot,
  duration: VideoDuration
) {
  const cuts = [...concept.cuts].sort((left, right) => left.startSecond - right.startSecond);
  const range = segmentRange(duration);
  const combined = cuts.map((cut) => `${cut.caption} ${cut.narration} ${cut.sceneDescription}`).join(" ");
  const audienceCopy = cuts.map((cut) => `${cut.caption} ${cut.narration}`).join(" ");
  const firstThree = cuts.filter((cut) => cut.startSecond < 3 && cut.endSecond <= 3);
  const allowed = allowedNumbers(analysis);
  const unknownNumbers = normalizedNumbers(audienceCopy).filter((value) => !allowed.has(value));
  const abstract = cuts.filter(
    (cut) => cut.sceneDescription.length < 75 || ABSTRACT_SCENES.some((pattern) => pattern.test(cut.sceneDescription))
  );
  const sceneSignalFailures = cuts
    .map((cut) => ({ cutNumber: cut.cutNumber, missing: missingSceneSignals(cut) }))
    .filter((item) => item.missing.length > 0);
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
      key: "visual-changes",
      passed: new Set(firstThree.map((cut) => cut.sceneDescription)).size >= 2,
      message: "첫 3초에 서로 다른 시각적 변화가 2개 이상 필요합니다.",
    },
    {
      key: "timeline",
      passed:
        cuts[0]?.startSecond === 0 &&
        cuts.at(-1)?.endSecond === duration &&
        cuts.every((cut, index) => index === 0 || cut.startSecond === cuts[index - 1].endSecond),
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
      passed: cuts.every((cut) => cut.caption.length > 0 && cut.caption.length <= 34) &&
        !GENERIC_COPY.some((pattern) => pattern.test(combined)),
      message: "자막은 짧은 구어체여야 하며 범용 광고 문구를 사용하지 않아야 합니다.",
    },
    {
      key: "scene-specificity",
      passed: abstract.length === 0 && sceneSignalFailures.length === 0,
      message: abstract.length || sceneSignalFailures.length
        ? `구체성이 부족한 구간: ${sceneSignalFailures.map((item) => `${item.cutNumber}번(${item.missing.join(", ")})`).join(" · ") || "추상 장면"}. 각 구간에 장소·주체·행동·반응·첫 시각 요소·다음 전환을 모두 명시해 주세요.`
        : "모든 장면에 장소·주체·행동·반응·첫 시각 요소·다음 전환이 구체적으로 포함되어 있습니다.",
    },
    {
      key: "unsupported-numbers",
      passed: unknownNumbers.length === 0,
      message: unknownNumbers.length
        ? `상품 근거에 없는 수치가 있습니다: ${[...new Set(unknownNumbers)].join(", ")}`
        : "근거 없는 수치가 없습니다.",
    },
    {
      key: "cta",
      passed: Boolean(concept.cta && cuts.at(-1)?.caption && combined.includes(concept.cta)),
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
  const fields = concepts.map((concept) => [
    concept.hookType,
    concept.customerProblem,
    concept.usp,
    concept.speaker,
    concept.creativeStyle,
    concept.narrativeStructure,
    concept.cta,
  ]);
  const pairSimilarities: number[] = [];
  for (let left = 0; left < fields.length; left += 1) {
    for (let right = left + 1; right < fields.length; right += 1) {
      const same = fields[left].filter((value, index) => value && value === fields[right][index]).length;
      pairSimilarities.push(same / fields[left].length);
    }
  }
  return {
    valid:
      concepts.length === 3 &&
      hookTypes.size === concepts.length &&
      pairSimilarities.every((score) => score < 0.45),
    similarities: pairSimilarities,
  };
}
