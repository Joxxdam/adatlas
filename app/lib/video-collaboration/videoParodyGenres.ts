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
    id: "historical-world-parody",
    label: "시대물 오프닝",
    direction:
      "첫 1~3초에 시대풍 필터·의상·말투 또는 오래된 가격표 같은 장치 하나만 보여준 뒤 현재의 실제 상품 개봉·조리·사용으로 바로 전환한다. 가상 왕국, 인물 이름, 비밀 장부, 위기와 구출 같은 세계관 서사를 만들지 않는다.",
    signals: /중세|조선|왕실|왕족|귀족|궁궐|과거|미래|시대|세기|년대|옛날|역사|마을|세계관|타임슬립/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
  {
    id: "price-negotiation",
    label: "가격 확인·가벼운 실랑이",
    direction: "현재의 판매 현장이나 사무실에서 구매자·직원이 확인된 가격·구성을 두고 짧게 한두 마디를 주고받은 뒤, 한 명의 화자가 상품 근거와 결론을 시청자에게 설명한다.",
    signals: /협상|흥정|깎아|판매자|구매자|조건을?\s*(?:맞추|제시)|딜\b/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
    benefitAffinity: true,
  },
  {
    id: "audition-interview",
    label: "오디션·면접",
    direction: "주 화자가 후보를 확인하듯 질문 한두 개를 던지고, 실제 상품의 구성·질감·사용 장면으로 곧바로 답한다. 지원자 캐릭터들의 장기 연기나 합격 서사를 만들지 않는다.",
    signals: /오디션|면접|지원자|합격|불합격|심사위원|자기소개/i,
    categoryAffinity: ["beauty", "food", "general"],
  },
  {
    id: "news-report",
    label: "뉴스 속보·현장 취재",
    direction: "한 명의 주 화자가 속보 자막과 리포터 말투를 첫 훅에만 사용하고, 이후에는 상품을 직접 열고 써 보는 UGC 화면으로 답한다. 앵커와 기자가 이어지는 뉴스 드라마는 만들지 않는다.",
    signals: /뉴스|속보|기자|현장\s*(?:취재|연결)|제보|앵커|특보/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
  {
    id: "quiz-show",
    label: "퀴즈쇼·선택 게임",
    direction: "첫 훅에서 상품 선택 질문 하나를 띄우고 실제 사용·조리 장면을 정답 근거로 보여준다. 진행자·참가자 역할극 없이 화면 선택지와 주 화자만 사용한다.",
    signals: /퀴즈|정답|오답|선택지|몇\s*번|문제입니다|찬스/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
  {
    id: "blind-test",
    label: "직접 비교·사용 확인",
    direction: "눈을 가리는 예능 장치 없이 실제 포장을 열고 조리하거나 사용하면서 맛·질감·구성·사용감처럼 카메라로 확인 가능한 차이를 보여준다.",
    signals: /블라인드|눈을\s*가리|가리고|정체\s*공개|비교\s*(?:시식|사용)|맞혀|직접\s*(?:조리|사용|확인)|포장을?\s*(?:열|뜯)|개봉/i,
    categoryAffinity: ["meat", "food", "beauty"],
  },
  {
    id: "competition-judging",
    label: "대결·심사",
    direction: "두 선택이나 사용법을 한 화면에서 짧게 비교하고 즉시 실제 상품의 차이를 확인한다. 심사위원 캐릭터·토너먼트·우승 서사를 만들지 않는다.",
    signals: /대결|승부|결승|경연|심사\s*(?:기준|평)|우승|도전자/i,
    categoryAffinity: ["meat", "food", "beauty"],
  },
  {
    id: "family-office-sitcom",
    label: "가족·직장 생활 대화",
    direction: "가족이나 동료의 평소 습관에서 나온 현실적인 한마디를 훅으로 쓰고, 긴 연기 대신 주 화자가 그 반응의 이유를 상품 장면과 함께 시청자에게 전한다.",
    signals: /시트콤|가족|부부|엄마|아빠|동료|상사|회사|사무실|회의실/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
  {
    id: "mystery-investigation",
    label: "탐정·미스터리",
    direction: "돋보기·단서 자막 같은 시각 장치로 상품의 한 가지 궁금증을 열고, 포장·구성·질감·사용 장면에서 바로 답을 찾는다. 용의자·범인·실종 같은 수사 드라마는 만들지 않는다.",
    signals: /탐정|추리|단서|용의자|미스터리|수사|사건의\s*범인/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
  {
    id: "live-auction",
    label: "경매·라이브 판매",
    direction: "한 명의 진행자가 경매 카운트나 가격 공개 리듬을 짧게 사용하되 대부분은 실물 구성과 사용 결과를 보여준다. 관객·입찰자 역할극이나 낙찰 서사를 길게 만들지 않는다.",
    signals: /경매|낙찰|입찰|호가|라이브\s*(?:판매|방송)|마감합니다/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
    benefitAffinity: true,
  },
  {
    id: "courtroom",
    label: "법정·청문회",
    direction: "이의 제기·판결 자막 같은 법정 장치를 한두 번만 쓰고, 주 화자가 실제 상품 근거를 직접 확인해 결론낸다. 판사·검사·변호사의 대사극이나 재판 사건을 만들지 않는다.",
    signals: /법정|재판|판결|판사|변호사|검사|청문회|이의\s*있|증거를?\s*제출/i,
    categoryAffinity: ["meat", "food", "beauty", "general"],
  },
];

/** 새 자동 4안의 가벼운 화면 장치 슬롯에서 회전 선택하는 전체 장르입니다. */
export const AUTOMATIC_CREATIVE_GENRES: VideoParodyGenre[] =
  VIDEO_PARODY_GENRE_OPTIONS.map((option) => option.id);

/** 과거 import 호환용 별칭입니다. */
export const AUTOMATIC_LIFESTYLE_GENRES = AUTOMATIC_CREATIVE_GENRES;

function productCategory(analysis: ProductAnalysisSnapshot) {
  const text = `${analysis.productName} ${analysis.category} ${analysis.productType || ""}`.toLowerCase();
  if (/(고기|육우|한우|소고기|돼지|닭|갈비|등심|정육|육류)/u.test(text)) return "meat" as const;
  if (/(샤워|바디|워시|세럼|크림|화장|뷰티|클렌|향수)/u.test(text)) return "beauty" as const;
  if (/(식품|과일|채소|음료|간식|사과|농산|원물|먹|맛)/u.test(text)) return "food" as const;
  return "general" as const;
}

function hasBenefit(analysis: ProductAnalysisSnapshot) {
  return Boolean(
    analysis.discountInfo ||
      analysis.originalPrice ||
      analysis.promotion
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
  const benefitAvailable = hasBenefit(input.analysis);
  const ranked = VIDEO_PARODY_GENRE_OPTIONS.filter(
    (option) =>
      AUTOMATIC_CREATIVE_GENRES.includes(option.id) &&
      (!option.benefitAffinity || benefitAvailable)
  ).map((option) => {
    const recentIndex = recent.indexOf(option.id);
    const affinity = option.categoryAffinity.includes(category) ? 8 : option.categoryAffinity.includes("general") ? 4 : 0;
    const benefit = option.benefitAffinity && benefitAvailable ? 4 : 0;
    const sensory =
      hasSensoryOrUseEvidence(input.analysis) &&
      ["blind-test", "competition-judging"].includes(option.id)
        ? 3
        : 0;
    const everydayRelationship = option.id === "family-office-sitcom" ? 1 : 0;
    const repeatPenalty = recentIndex < 0 ? 0 : 30 - recentIndex * 4;
    return {
      option,
      score:
        affinity +
        benefit +
        sensory +
        everydayRelationship -
        repeatPenalty +
        stableTieBreak(input.seed || input.analysis.productName, option.id) * 10,
    };
  }).sort((left, right) => right.score - left.score);
  return ranked[0].option;
}

export function matchesVideoParodyGenre(value: VideoConcept | string, genre: VideoParodyGenre) {
  const selected = getVideoParodyGenre(genre);
  if (!selected) return false;
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
  if (!selected.signals.test(text)) return false;

  // Courtroom language is explicitly forbidden for every other genre. Other
  // genres intentionally share words such as "심사위원" and "선택"; resolving
  // those overlaps by declaration order incorrectly rejects valid 대결·심사
  // concepts as 오디션·면접.
  const courtroom = getVideoParodyGenre("courtroom");
  return genre === "courtroom" || !courtroom?.signals.test(text);
}

export function videoParodyGenrePrompt(genre?: VideoParodyGenre, recentGenres: VideoParodyGenre[] = []) {
  const selected = getVideoParodyGenre(genre);
  if (!selected) return "선택된 콘셉트 장치 없음";
  const excluded = [...new Set(recentGenres)]
    .filter((id) => id !== selected.id)
    .map((id) => getVideoParodyGenre(id)?.label)
    .filter(Boolean);
  return [
    `선택 장르: ${selected.label}`,
    `연출 규칙: ${selected.direction}`,
    "이 장르는 드라마 줄거리가 아니라 스크롤을 멈추게 하는 가벼운 화면·자막 문법이다. 첫 1~3초와 짧은 전환에만 사용하고, 3초 이후에는 한 명의 주 화자가 실제 상품을 확인하는 UGC 흐름으로 옮긴다.",
    "전체 분량의 최소 70%는 상품 실물·포장 개봉·구성·조리·사용·질감·가격 확인 장면으로 구성한다. 장르 인물끼리 대화하거나 가상 세계를 설명하는 장면은 만들지 않는다.",
    "장소는 원칙적으로 한 곳, 주 화자는 한 명으로 제한한다. 고유 이름·가상 지역명·세계관 설정·위기·실종·구출·운명·비밀 장부를 만들지 않는다.",
    "선택하지 않은 장르의 대표 소품·직함·결말 문법을 섞지 않는다.",
    selected.id === "historical-world-parody"
      ? "시대감은 필터·의상·소품·짧은 말투로만 표현하고 곧바로 현재 상품으로 돌아온다. 상품의 성분·효능·가격·수치·순위는 ProductTruth에 있는 사실만 사용한다."
      : "화면 장치는 상품에 맞게 구체화하되 실제 후기·경력·자격을 사칭하지 않는다.",
    "가상의 의사 가족이 개인적 취향이나 사용 경험으로 상품을 추천하는 설정은 허용한다. 해당 인물이 광고용 창작임을 dramatizationBoundary와 장면 고지에 명시하고, 의학적 효능·치료·보증의 근거로 사용하지 않는다.",
    excluded.length ? `최근 사용으로 금지된 장르: ${excluded.join(" · ")}` : "최근 사용으로 금지된 장르: 없음",
    selected.id !== "courtroom"
      ? "법정·재판·판사·판결·변호사·검사·청문회·증거 제출 장면과 표현은 사용하지 않는다."
      : "이번에는 법정·청문회 장르가 명시적으로 선택되었으므로 다른 예능 장르를 섞지 않는다.",
  ].join("\n");
}
