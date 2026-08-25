import type {
  ProductAnalysisSnapshot,
  VideoConcept,
  VideoParodyGenre,
} from "./types.ts";

export type VideoParodyGenreOption = {
  id: VideoParodyGenre;
  label: string;
  direction: string;
  signals: RegExp;
  categoryAffinity: Array<"meat" | "food" | "beauty" | "general">;
  benefitAffinity?: boolean;
};

export const VIDEO_PARODY_GENRE_OPTIONS: VideoParodyGenreOption[] = [
  {
    id: "price-negotiation",
    label: "가격 협상·흥정",
    direction: "구매자와 판매자가 확인된 가격·구성을 두고 밀고 당기며 상품 근거로 합의한다.",
    signals: /협상|흥정|깎아|판매자|구매자|조건을?\s*(?:맞추|제시)|딜\b/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
    benefitAffinity: true,
  },
  {
    id: "audition-interview",
    label: "오디션·면접",
    direction: "상품 또는 사용자가 지원자가 되어 질문과 과제를 통과하고 선택 이유를 보여준다.",
    signals: /오디션|면접|지원자|합격|불합격|심사위원|자기소개/i,
    categoryAffinity: ["beauty", "food", "general"],
  },
  {
    id: "news-report",
    label: "뉴스 속보·현장 취재",
    direction: "기자와 현장 화자가 상품 관련 사건을 짧게 취재하고 관찰 가능한 장면으로 답한다.",
    signals: /뉴스|속보|기자|현장\s*(?:취재|연결)|제보|앵커|특보/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
  {
    id: "quiz-show",
    label: "퀴즈쇼·선택 게임",
    direction: "상품 사실을 선택지와 정답 공개로 풀고, 시청자가 함께 맞히는 리듬으로 전개한다.",
    signals: /퀴즈|정답|오답|선택지|몇\s*번|문제입니다|찬스/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
  {
    id: "blind-test",
    label: "블라인드 테스트",
    direction: "브랜드나 조건을 가린 채 맛·질감·사용감 같은 관찰 가능한 차이를 먼저 체험하고 정체를 공개한다.",
    signals: /블라인드|눈을\s*가리|가리고|정체\s*공개|비교\s*(?:시식|사용)|맞혀/i,
    categoryAffinity: ["meat", "food", "beauty"],
  },
  {
    id: "competition-judging",
    label: "대결·심사",
    direction: "두 선택이나 사용법이 짧은 대결을 벌이고 명확한 심사 기준으로 상품의 강점을 보여준다.",
    signals: /대결|승부|결승|경연|심사\s*(?:기준|평)|우승|도전자/i,
    categoryAffinity: ["meat", "food", "beauty"],
  },
  {
    id: "family-office-sitcom",
    label: "가족·직장 시트콤",
    direction: "가족이나 동료 사이의 현실적인 오해·부탁·눈치 싸움에 상품이 해결 장치로 등장한다.",
    signals: /시트콤|가족|부부|엄마|아빠|동료|상사|회사|사무실|회의실/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
  {
    id: "mystery-investigation",
    label: "탐정·미스터리",
    direction: "상품 차이의 단서를 하나씩 추적하고 마지막에 핵심 USP나 사용 이유를 밝혀낸다.",
    signals: /탐정|추리|단서|용의자|미스터리|수사|사건의\s*범인/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
  {
    id: "live-auction",
    label: "경매·라이브 판매",
    direction: "진행자가 확인된 구성과 가격을 순서대로 공개하고 입찰·낙찰 리듬으로 긴장감을 만든다.",
    signals: /경매|낙찰|입찰|호가|라이브\s*(?:판매|방송)|마감합니다/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
    benefitAffinity: true,
  },
  {
    id: "courtroom",
    label: "법정·청문회",
    direction: "서로 다른 주장을 심리하고 상품 근거를 확인해 결론을 내리되 다른 프로젝트에서 반복 사용하지 않는다.",
    signals: /법정|재판|판결|판사|변호사|검사|청문회|이의\s*있|증거를?\s*제출/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
];

function productCategory(analysis: ProductAnalysisSnapshot) {
  const text = `${analysis.productName} ${analysis.category} ${analysis.productType || ""}`.toLowerCase();
  if (/(고기|육우|한우|소고기|돼지|닭|갈비|등심|정육|육류)/u.test(text)) return "meat" as const;
  if (/(샤워|바디|워시|세럼|크림|화장|뷰티|클렌|향수)/u.test(text)) return "beauty" as const;
  if (/(식품|과일|채소|음료|간식|사과|농산|원물|먹|맛)/u.test(text)) return "food" as const;
  return "general" as const;
}

function hasBenefit(analysis: ProductAnalysisSnapshot) {
  return Boolean(
    analysis.price ||
      analysis.discountInfo ||
      analysis.originalPrice ||
      analysis.promotion ||
      analysis.composition?.length ||
      analysis.shippingConditions?.length
  );
}

function hasSensoryOrUseEvidence(analysis: ProductAnalysisSnapshot) {
  return /(맛|식감|향|질감|마블링|육즙|거품|사용감|발림|촉감|색감|조리|루틴)/u.test(
    [analysis.productName, ...analysis.coreUsps, ...analysis.keyFeatures].join(" ")
  );
}

function stableTieBreak(seed: string, id: string) {
  let hash = 0;
  for (const character of `${seed}:${id}`) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash % 1000) / 1000;
}

export function getVideoParodyGenre(id?: VideoParodyGenre) {
  return VIDEO_PARODY_GENRE_OPTIONS.find((option) => option.id === id);
}

export function inferVideoParodyGenre(value: VideoConcept | string): VideoParodyGenre | undefined {
  if (typeof value !== "string" && value.parodyGenre) return value.parodyGenre;
  const text =
    typeof value === "string"
      ? value
      : [
          value.title,
          value.openingHook,
          value.centralIncident,
          value.narrativeSummary,
          value.narrativeStructure,
          value.speaker,
          value.speakerPointOfView,
          value.recommendedVisualStyle,
          value.fullScript,
          ...value.cuts.map((cut) => `${cut.caption} ${cut.sceneDescription}`),
        ].join(" ");
  // 법정은 과거 데이터에서 가장 강하게 반복된 장르라 다른 일반 단어보다 먼저 판별한다.
  const courtroom = getVideoParodyGenre("courtroom");
  if (courtroom?.signals.test(text)) return "courtroom";
  return VIDEO_PARODY_GENRE_OPTIONS.find((option) => option.id !== "courtroom" && option.signals.test(text))?.id;
}

export function selectVideoParodyGenre(input: {
  analysis: ProductAnalysisSnapshot;
  recentGenres?: VideoParodyGenre[];
  seed?: string;
}) {
  const category = productCategory(input.analysis);
  const recent = (input.recentGenres || []).slice(0, 5);
  const ranked = VIDEO_PARODY_GENRE_OPTIONS.map((option) => {
    const recentIndex = recent.indexOf(option.id);
    const affinity = option.categoryAffinity.includes(category) ? 8 : option.categoryAffinity.includes("general") ? 4 : 0;
    const benefit = option.benefitAffinity && hasBenefit(input.analysis) ? 2 : 0;
    const sensory =
      hasSensoryOrUseEvidence(input.analysis) &&
      ["blind-test", "competition-judging"].includes(option.id)
        ? 4
        : 0;
    const repeatPenalty = recentIndex < 0 ? 0 : 30 - recentIndex * 4;
    // 법정은 선택 가능하지만, 다른 적합 장르가 있으면 기본적으로 뒤에 둔다.
    const courtroomPenalty = option.id === "courtroom" ? 2 : 0;
    return {
      option,
      score:
        affinity +
        benefit +
        sensory -
        repeatPenalty -
        courtroomPenalty +
        stableTieBreak(input.seed || input.analysis.productName, option.id),
    };
  }).sort((left, right) => right.score - left.score);
  return ranked[0].option;
}

export function matchesVideoParodyGenre(value: VideoConcept | string, genre: VideoParodyGenre) {
  return inferVideoParodyGenre(value) === genre;
}

export function videoParodyGenrePrompt(genre?: VideoParodyGenre, recentGenres: VideoParodyGenre[] = []) {
  const selected = getVideoParodyGenre(genre);
  if (!selected) return "선택된 사건·상황극 세부 장르 없음";
  const excluded = [...new Set(recentGenres)]
    .filter((id) => id !== selected.id)
    .map((id) => getVideoParodyGenre(id)?.label)
    .filter(Boolean);
  return [
    `선택 장르: ${selected.label}`,
    `연출 규칙: ${selected.direction}`,
    "패러디 기획안은 처음부터 끝까지 이 장르의 인물 관계·사건·화면 문법만 사용한다.",
    "다른 장르의 대표 소품·직함·결말 문법을 섞지 않는다.",
    excluded.length ? `최근 사용으로 금지된 장르: ${excluded.join(" · ")}` : "최근 사용으로 금지된 장르: 없음",
    selected.id !== "courtroom"
      ? "법정·재판·판사·판결·변호사·검사·청문회·증거 제출 장면과 표현은 사용하지 않는다."
      : "이번에는 법정·청문회 장르가 명시적으로 선택되었으므로 다른 예능 장르를 섞지 않는다.",
  ].join("\n");
}
