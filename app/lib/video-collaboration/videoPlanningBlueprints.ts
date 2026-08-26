import type {
  ProductAnalysisSnapshot,
  VideoConceptArchetype,
  VideoParodyGenre,
  VideoPlanningBlueprintSelection,
} from "./types.ts";

export type VideoPlanningBlueprintCategory = "meat" | "produce" | "food" | "beauty";

export type VideoPlanningBlueprintBeat = {
  role: string;
  timing: string;
  visual: string;
  direction: string;
};

export type VideoPlanningBlueprint = {
  id: string;
  title: string;
  sourceCategory: VideoPlanningBlueprintCategory;
  archetypes: VideoConceptArchetype[];
  duration: number;
  sceneCount: number;
  format: string;
  summary: string;
  transferableRules: string[];
  beats: VideoPlanningBlueprintBeat[];
};

const COMMON_RULES = [
  "첫 1~3초에 문제·가격·효익·갈등 중 하나를 완결하지 않고 던진다.",
  "주장 직후 그 주장과 맞는 상품·사용·공정·반응 장면을 붙인다.",
  "가격·원료·공정·사용 결과 중 확인된 근거 두 가지 이상을 교차한다.",
  "마지막 CTA에는 ProductTruth로 확인된 혜택만 사용한다.",
];

export const VIDEO_PLANNING_BLUEPRINTS: VideoPlanningBlueprint[] = [
  {
    id: "meat-real-review-secret-price",
    title: "고기영상1 · 리얼 후기와 비밀 가격",
    sourceCategory: "meat",
    archetypes: ["real-review", "secret-benefit"],
    duration: 31.32,
    sceneCount: 25,
    format: "리얼 후기형 + 시크릿 도매가형",
    summary:
      "가격 질문으로 멈추게 한 뒤 가족 반응, 감각 증거, 판매 근거를 쌓고 확인된 특가 CTA로 닫습니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "미완성 훅",
        timing: "0~3초",
        visual: "상품을 준비하거나 사용하는 손의 초근접",
        direction: "대표 불만과 반전을 두세 개의 짧은 자막으로 끊는다.",
      },
      {
        role: "상품 공개",
        timing: "3~8초",
        visual: "완성 결과와 상품을 빠르게 교차",
        direction: "검증된 가격·구성을 상품 결과 장면과 함께 공개한다.",
      },
      {
        role: "생활 후기",
        timing: "8~14초",
        visual: "타깃과 닮은 인물의 사용·식사 반응",
        direction: "광고용 상황극임이 드러나는 짧은 대사형 반응을 넣는다.",
      },
      {
        role: "품질 증거",
        timing: "14~24초",
        visual: "질감·원료·공정·포장 매크로",
        direction: "감각 주장과 관찰 가능한 화면을 1:1로 연결한다.",
      },
      {
        role: "근거와 CTA",
        timing: "24초~끝",
        visual: "상품 전체, 확인된 근거, 구매 행동",
        direction: "확인된 혜택만 다시 고정하고 한 문장의 직접 CTA로 끝낸다.",
      },
    ],
  },
  {
    id: "meat-wholesale-insider",
    title: "고기영상3 · 도매 지인 찬스",
    sourceCategory: "meat",
    archetypes: ["real-review", "secret-benefit"],
    duration: 35.48,
    sceneCount: 26,
    format: "리얼 후기형 + 도매 지인 찬스형",
    summary:
      "타깃을 직접 부르고 손실 질문을 던진 뒤 구성·가격·선별 근거와 코믹 리액션으로 설득합니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "호명형 훅",
        timing: "0~4초",
        visual: "결과물 초근접과 정면 화자",
        direction: "타깃 호칭과 손실 질문을 연속으로 배치한다.",
      },
      {
        role: "구성·가격",
        timing: "4~11초",
        visual: "상품 묶음, 단위, 결과 장면",
        direction: "구성을 먼저 고정한 뒤 확인된 가격을 공개한다.",
      },
      {
        role: "선별 근거",
        timing: "11~22초",
        visual: "원료 선택, 검수, 질감 B-roll",
        direction: "전문성은 확인 가능한 행동과 기준으로만 보여준다.",
      },
      {
        role: "코믹 반응",
        timing: "22~25초",
        visual: "화자의 짧고 큰 표정 변화",
        direction: "한 번의 리액션으로 설명 구간을 끊는다.",
      },
      {
        role: "혜택 회수",
        timing: "25초~끝",
        visual: "유통·포장·상품 전체",
        direction: "혜택의 이유와 행동 위치를 짧게 정리한다.",
      },
    ],
  },
  {
    id: "meat-family-expert-usp",
    title: "고기영상4 · 가족 업력과 USP 증명",
    sourceCategory: "meat",
    archetypes: ["usp-focus", "real-review"],
    duration: 39.38,
    sceneCount: 31,
    format: "USP 집중형 + 가족 정육업 스토리형",
    summary:
      "기억 가능한 전문가 캐릭터를 세우고 저가의 이유를 원료·선별·공정·유통 구조로 차례로 증명합니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "신뢰 캐릭터",
        timing: "0~3초",
        visual: "현장에서 일하는 화자와 손",
        direction: "허위 경력 없이 상품을 잘 아는 역할과 관찰 가능한 행동을 제시한다.",
      },
      {
        role: "손실 질문",
        timing: "3~8초",
        visual: "사용 결과와 비교 대상",
        direction: "고객이 놓치는 비용·시간·불편 중 하나를 질문한다.",
      },
      {
        role: "비결 예고",
        timing: "8~14초",
        visual: "원료와 검수 행동",
        direction: "핵심 차별점 하나를 비결로 압축한다.",
      },
      {
        role: "인과 증명",
        timing: "14~31초",
        visual: "원료→공정→결과의 연속 B-roll",
        direction: "원인과 결과를 장면 순서로 이해시킨다.",
      },
      {
        role: "선택 기준 CTA",
        timing: "31초~끝",
        visual: "상품 전체와 핵심 근거",
        direction: "시청자가 기억할 선택 기준 한 가지로 마무리한다.",
      },
    ],
  },
  {
    id: "produce-direct-secret",
    title: "깔라만시1 · 농장 직송 비밀 특가",
    sourceCategory: "produce",
    archetypes: ["usp-focus", "secret-benefit"],
    duration: 37.44,
    sceneCount: 18,
    format: "USP 집중형 + 농장 직송 비밀특가형",
    summary:
      "원물의 선명한 감각 장면으로 시작해 산지·공정·사용 장면을 보여주고 직송 혜택으로 연결합니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "감각 훅",
        timing: "0~4초",
        visual: "원물 절단·즙·물방울 매크로",
        direction: "색·질감·소리처럼 눈으로 확인되는 감각을 먼저 보여준다.",
      },
      {
        role: "상품 발견",
        timing: "4~9초",
        visual: "원물과 상품의 연결",
        direction: "상품이 어떤 원물 경험을 주는지 한 문장으로 연결한다.",
      },
      {
        role: "산지·공정",
        timing: "9~24초",
        visual: "농장, 수확, 선별, 가공",
        direction: "ProductTruth에 있는 산지·공정만 순서대로 시각화한다.",
      },
      {
        role: "사용 루틴",
        timing: "24~31초",
        visual: "붓기·음용·보관 등 실제 사용",
        direction: "상품에 맞는 한 가지 사용 상황을 행동으로 보여준다.",
      },
      {
        role: "직송 CTA",
        timing: "31초~끝",
        visual: "구성품과 배송 상태",
        direction: "확인된 구성·배송·가격만 사용해 CTA를 만든다.",
      },
    ],
  },
  {
    id: "produce-origin-documentary",
    title: "깔라만시2 · 산지 직송 다큐",
    sourceCategory: "produce",
    archetypes: ["usp-focus"],
    duration: 39.02,
    sceneCount: 20,
    format: "USP 집중형 + 산지 직송형",
    summary: "산지의 사람과 원물을 중심으로 상품의 출발점부터 소비 장면까지 다큐처럼 연결합니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "산지 질문",
        timing: "0~4초",
        visual: "원물과 생산 현장 와이드",
        direction: "이 상품이 어디서 어떻게 시작되는지 궁금하게 만든다.",
      },
      {
        role: "생산자 시점",
        timing: "4~12초",
        visual: "수확·선별하는 손과 표정",
        direction: "실제 생산자가 없으면 생산자라고 단정하지 말고 공정 중심으로 쓴다.",
      },
      {
        role: "공정 압축",
        timing: "12~25초",
        visual: "세척·가공·포장 단계",
        direction: "핵심 공정만 시간 순서대로 짧게 교차한다.",
      },
      {
        role: "결과 체험",
        timing: "25~34초",
        visual: "완성 음용·사용 결과",
        direction: "설명 후 반드시 소비 장면으로 리듬을 바꾼다.",
      },
      {
        role: "원산지 회수",
        timing: "34초~끝",
        visual: "원물과 상품 투샷",
        direction: "확인된 산지·원료를 한 번만 명확히 회수한다.",
      },
    ],
  },
  {
    id: "produce-price-negotiation",
    title: "깔라만시3 · 가격 협상 상황극",
    sourceCategory: "produce",
    archetypes: ["parody", "secret-benefit"],
    duration: 58.67,
    sceneCount: 45,
    format: "가격 협상 패러디형 + 시크릿 특가형",
    summary:
      "구매자와 판매자의 가격 협상을 사건으로 만들고 중간중간 상품 근거를 삽입해 혜택을 결말처럼 공개합니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "협상 발단",
        timing: "0~6초",
        visual: "두 인물 또는 화면 분할 대치",
        direction: "확인된 가격·구성에 대한 현실적인 이견으로 시작한다.",
      },
      {
        role: "판매자 저항",
        timing: "6~16초",
        visual: "표정 반응과 상품 제시",
        direction: "혜택이 쉽게 나온 것이 아닌 듯한 코믹 저항을 만든다.",
      },
      {
        role: "상품 증거",
        timing: "16~34초",
        visual: "원료·공정·사용 결과 B-roll",
        direction: "대사 사이마다 실제 상품 근거를 삽입한다.",
      },
      {
        role: "최종 협상",
        timing: "34~49초",
        visual: "조건 카드와 인물 반응",
        direction: "ProductTruth에 없는 가격·배송·증정은 협상 대사에도 쓰지 않는다.",
      },
      {
        role: "합의 CTA",
        timing: "49초~끝",
        visual: "상품 전체와 행동 안내",
        direction: "합의된 확인 정보만 크게 보여주며 끝낸다.",
      },
    ],
  },
  {
    id: "food-always-wholesale",
    title: "참고영상1 · 근거형 상시 가격",
    sourceCategory: "food",
    archetypes: ["usp-focus", "secret-benefit"],
    duration: 37.48,
    sceneCount: 23,
    format: "USP 집중형 + 상시 도매가형",
    summary:
      "대표 구매처보다 나은 곳을 찾는 질문에서 시작해 운영 주체·유통·원료·결과 장면으로 답합니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "탐색 훅",
        timing: "0~3초",
        visual: "상품과 익숙한 구매 상황",
        direction: "시청자가 반복해서 하는 탐색 질문을 직접 말한다.",
      },
      {
        role: "핵심 제안",
        timing: "3~9초",
        visual: "상품 결과와 확인된 혜택",
        direction: "일시 혜택인지 상시 조건인지 사실대로 구분한다.",
      },
      {
        role: "운영 근거",
        timing: "9~17초",
        visual: "공정·포장·운영 현장",
        direction: "낮은 가격 또는 품질의 이유를 한 가지 구조로 설명한다.",
      },
      {
        role: "감각 증명",
        timing: "17~27초",
        visual: "사용 결과와 질감 매크로",
        direction: "문장과 증거 장면을 바로 이어 붙인다.",
      },
      {
        role: "생활 대안 CTA",
        timing: "27초~끝",
        visual: "일상 사용과 상품",
        direction: "시청자가 바꿀 수 있는 구매·사용 행동을 제안한다.",
      },
    ],
  },
  {
    id: "food-bargaining-parody",
    title: "참고영상2 · 가격 흥정 패러디",
    sourceCategory: "food",
    archetypes: ["parody", "secret-benefit"],
    duration: 43.12,
    sceneCount: 32,
    format: "가격 흥정 패러디형 + 시크릿 혜택형",
    summary:
      "구매자가 대표적인 품질 불안과 가격 의심을 대신 말하고 판매자가 상품 근거로 반박한 뒤 혜택에 합의합니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "가격 갈등",
        timing: "0~8초",
        visual: "두 가격·두 인물·상품을 한 화면에 대비",
        direction: "실제 확인된 조건 안에서 소비자의 의심을 대사화한다.",
      },
      {
        role: "품질 반박",
        timing: "8~20초",
        visual: "공정·원료·상품 클로즈업",
        direction: "말싸움 중간에 증거 B-roll을 짧게 끼운다.",
      },
      {
        role: "태도 반전",
        timing: "20~28초",
        visual: "구매자 리액션과 상품 재확인",
        direction: "확인된 근거 때문에 인물의 태도가 바뀌게 한다.",
      },
      {
        role: "조건 공개",
        timing: "28~38초",
        visual: "가격·구성 카드와 판매자 반응",
        direction: "혜택 정보가 없으면 조건 공개 대신 상품 선택 기준으로 바꾼다.",
      },
      {
        role: "합의와 CTA",
        timing: "38초~끝",
        visual: "상품 전체와 정면 행동 지시",
        direction: "갈등을 한 문장으로 해소하고 직접 CTA로 끝낸다.",
      },
    ],
  },
  {
    id: "beauty-clay-lifestyle-usp",
    title: "오리지널소스영상1 · 클레이 생활 상황극",
    sourceCategory: "beauty",
    archetypes: ["parody", "usp-focus"],
    duration: 26.2,
    sceneCount: 22,
    format: "AI 클레이 생활 상황극 + USP 집중형",
    summary:
      "일상 불편을 반복 행동으로 과장하고 상품 등장 뒤 감각적 변화와 수치 USP를 미니어처 사건으로 보여줍니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "생활 불편",
        timing: "0~5초",
        visual: "한 인물의 반복 행동을 미니어처로 과장",
        direction: "타깃이 바로 아는 불편을 세 단계 이하 행동으로 보여준다.",
      },
      {
        role: "반복 절정",
        timing: "5~9초",
        visual: "같은 문제가 더 크게 반복",
        direction: "대사가 아니라 행동의 반복으로 문제를 키운다.",
      },
      {
        role: "상품 등장",
        timing: "9~13초",
        visual: "상품을 프레임 중심에 크게 공개",
        direction: "제품 형태와 라벨은 실제 상품 자료를 기준으로 한다.",
      },
      {
        role: "감각 변화",
        timing: "13~21초",
        visual: "색·입자·물방울·민트 등 효익 은유",
        direction: "확인된 상품 특성을 관찰 가능한 시각 사건으로 바꾼다.",
      },
      {
        role: "USP 회수",
        timing: "21초~끝",
        visual: "사용 결과와 상품 전체",
        direction: "검증된 특징 한 가지와 CTA만 남긴다.",
      },
    ],
  },
  {
    id: "beauty-discovery-documentary",
    title: "오리지널소스영상2 · 발견 후기와 공정 다큐",
    sourceCategory: "beauty",
    archetypes: ["real-review", "usp-focus"],
    duration: 39.75,
    sceneCount: 43,
    format: "리얼 발견 후기형 + 원산지·공정 다큐형",
    summary:
      "우연히 발견한 사용 후기처럼 시작해 향·사용감·원료·공정 근거를 빠른 다큐 B-roll로 연결합니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "발견 훅",
        timing: "0~4초",
        visual: "스마트폰 UGC 시점의 상품 발견",
        direction: "광고용 상황극임이 자연스럽게 보이는 솔직한 첫 반응을 쓴다.",
      },
      {
        role: "첫 사용",
        timing: "4~10초",
        visual: "손·제형·거품·사용 순서",
        direction: "상품을 어떻게 쓰는지 한 번에 이해되게 촬영한다.",
      },
      {
        role: "감각 반응",
        timing: "10~18초",
        visual: "인물 표정과 물방울·거품 매크로",
        direction: "향과 사용감은 단정적 효능이 아니라 감각 반응으로 표현한다.",
      },
      {
        role: "원료·공정",
        timing: "18~32초",
        visual: "검증된 원료와 제조 관련 B-roll",
        direction: "상세페이지에서 확인된 사실만 다큐 리듬으로 연결한다.",
      },
      {
        role: "한 줄 결론",
        timing: "32초~끝",
        visual: "상품 전체와 사용 후 일상",
        direction: "발견의 이유를 한 문장으로 회수한다.",
      },
    ],
  },
  {
    id: "beauty-clay-benefit-cta",
    title: "오리지널소스영상3 · 클레이 상황극과 혜택 CTA",
    sourceCategory: "beauty",
    archetypes: ["parody", "secret-benefit"],
    duration: 26.2,
    sceneCount: 22,
    format: "AI 클레이 생활 상황극 + 혜택형 CTA",
    summary:
      "검증된 본문 구조는 유지하고 마지막 카드에서 단품·세트·증정 등 확인된 혜택만 분리해 테스트합니다.",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "반복 문제",
        timing: "0~8초",
        visual: "문제가 해결되지 않아 행동을 반복하는 미니어처 인물",
        direction: "짧은 반복으로 생활 불편을 사건화한다.",
      },
      {
        role: "상품 해결",
        timing: "8~14초",
        visual: "상품 등장과 사용 행동",
        direction: "상품이 해결 장치로 자연스럽게 등장하게 한다.",
      },
      {
        role: "체감 장면",
        timing: "14~20초",
        visual: "사용 후 표정·환경의 시각 변화",
        direction: "검증된 특징을 과장된 시각 은유로 표현하되 효능을 창작하지 않는다.",
      },
      {
        role: "신뢰 보강",
        timing: "20~23초",
        visual: "확인된 후기·원료·판매 정보 중 하나",
        direction: "확인할 수 없는 성과 수치는 사용하지 않는다.",
      },
      {
        role: "혜택 카드",
        timing: "23초~끝",
        visual: "상품과 구성·가격·증정의 명확한 분리",
        direction: "확인된 판매 조건이 없으면 일반 CTA로 대체한다.",
      },
    ],
  },
];

function normalizedProductText(analysis: ProductAnalysisSnapshot) {
  return [
    analysis.productName,
    analysis.brandName,
    analysis.category,
    ...analysis.coreUsps,
    ...analysis.keyFeatures,
  ]
    .join(" ")
    .toLowerCase();
}

function preferredCategory(analysis: ProductAnalysisSnapshot): VideoPlanningBlueprintCategory {
  const identity = [analysis.productName, analysis.brandName, analysis.category]
    .join(" ")
    .toLowerCase();
  const text = normalizedProductText(analysis);
  if (/(고기|육우|한우|소고기|돼지|닭|갈비|등심|정육|육류)/u.test(identity)) return "meat";
  if (/(샤워|바디|워시|세럼|크림|화장|뷰티|티트리|클렌)/u.test(identity)) return "beauty";
  if (/(과일|농산|깔라만시|사과|복숭아|배|포도|감귤|오렌지|채소|농장|원물)/u.test(identity))
    return "produce";
  if (/(샤워|바디|워시|세럼|크림|화장|뷰티|향|민트|티트리|클렌)/u.test(text)) return "beauty";
  if (/(과일|농산|깔라만시|사과|복숭아|배|포도|감귤|오렌지|채소|농장|원물)/u.test(text))
    return "produce";
  return "food";
}

function categoryScore(
  expected: VideoPlanningBlueprintCategory,
  actual: VideoPlanningBlueprintCategory
) {
  if (expected === actual) return 5;
  if ([expected, actual].every((item) => ["meat", "produce", "food"].includes(item))) return 3;
  return 1;
}

const PRICE_NEGOTIATION_BLUEPRINTS = new Set(["produce-price-negotiation", "food-bargaining-parody"]);

function parodyGenreScore(blueprint: VideoPlanningBlueprint, genre?: VideoParodyGenre) {
  if (!genre) return 0;
  const isPriceNegotiation = PRICE_NEGOTIATION_BLUEPRINTS.has(blueprint.id);
  if (genre === "price-negotiation") return isPriceNegotiation ? 12 : -2;
  if (isPriceNegotiation) return -12;
  if (["blind-test", "competition-judging"].includes(genre)) {
    const evidenceScore = blueprint.archetypes.some((item) => item === "real-review" || item === "usp-focus") ? 5 : -3;
    return evidenceScore - (blueprint.archetypes.includes("parody") ? 6 : 0);
  }
  if (genre === "family-office-sitcom") return blueprint.archetypes.includes("real-review") ? 4 : 0;
  const evidenceScore = blueprint.archetypes.some((item) => item === "real-review" || item === "usp-focus") ? 2 : 0;
  return evidenceScore - (blueprint.archetypes.includes("parody") ? 6 : 0);
}

export function getVideoPlanningBlueprint(id?: string) {
  return VIDEO_PLANNING_BLUEPRINTS.find((item) => item.id === id);
}

export function selectVideoPlanningBlueprints(input: {
  analysis: ProductAnalysisSnapshot;
  archetypes: VideoConceptArchetype[];
  parodyGenre?: VideoParodyGenre;
}): Partial<Record<VideoConceptArchetype, VideoPlanningBlueprintSelection>> {
  const expected = preferredCategory(input.analysis);
  const used = new Set<string>();
  const result: Partial<Record<VideoConceptArchetype, VideoPlanningBlueprintSelection>> = {};
  for (const archetype of input.archetypes) {
    const ranked = VIDEO_PLANNING_BLUEPRINTS.map((blueprint, index) => ({
      blueprint,
      score:
        categoryScore(expected, blueprint.sourceCategory) +
        (blueprint.archetypes.includes(archetype) ? 6 : 0) -
        (used.has(blueprint.id) ? 2 : 0) -
        index / 100 +
        (archetype === "parody" ? parodyGenreScore(blueprint, input.parodyGenre) : 0),
    })).sort((left, right) => right.score - left.score);
    const primary = ranked[0].blueprint;
    used.add(primary.id);
    const secondary = ranked.find(
      ({ blueprint }) =>
        blueprint.id !== primary.id &&
        (blueprint.archetypes.includes(archetype) || (archetype === "parody" && input.parodyGenre !== "price-negotiation" && blueprint.archetypes.some((item) => item === "real-review" || item === "usp-focus"))) &&
        !(archetype === "parody" && input.parodyGenre !== "price-negotiation" && PRICE_NEGOTIATION_BLUEPRINTS.has(blueprint.id))
    )?.blueprint;
    const hasDirectGenreReference = archetype !== "parody" || !input.parodyGenre || (input.parodyGenre === "price-negotiation" && PRICE_NEGOTIATION_BLUEPRINTS.has(primary.id));
    result[archetype] = {
      primaryId: primary.id,
      secondaryId: secondary?.id,
      reason: hasDirectGenreReference
        ? `${primary.format}의 전개가 ${archetype} 콘셉트와 맞고, ${expected === primary.sourceCategory ? "상품군의 사용·증거 장면까지 직접 참고할 수 있습니다." : "카테고리는 달라도 훅·증거·CTA 구조를 안전하게 전용할 수 있습니다."}`
        : `분석된 11개 영상에 '${input.parodyGenre}' 장르와 직접 일치하는 원본이 없어 가격 흥정 문법은 사용하지 않습니다. ${primary.format}에서 상품군의 증거·자막 리듬만 가져오고 선택 장르의 사건 문법은 별도로 적용합니다.`,
      transferableRules: primary.transferableRules.slice(0, 4),
    };
  }
  return result;
}

export function blueprintPrompt(selection?: VideoPlanningBlueprintSelection) {
  const primary = getVideoPlanningBlueprint(selection?.primaryId);
  const secondary = getVideoPlanningBlueprint(selection?.secondaryId);
  if (!primary) return "선택된 큐레이션 블루프린트 없음";
  return JSON.stringify({
    primary: {
      title: primary.title,
      format: primary.format,
      summary: primary.summary,
      beats: primary.beats,
      rules: primary.transferableRules,
    },
    secondary: secondary
      ? {
          title: secondary.title,
          format: secondary.format,
          summary: secondary.summary,
          rules: secondary.transferableRules.slice(0, 2),
        }
      : undefined,
    instruction:
      "주 레퍼런스의 전체 리듬을 우선하고 보조 레퍼런스는 훅 또는 CTA 장치 하나만 참고한다. 원문 자막·상품 사실·인물은 복제하지 않는다.",
  });
}
