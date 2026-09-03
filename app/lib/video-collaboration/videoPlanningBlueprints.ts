import type {
  ProductAnalysisSnapshot,
  VideoConceptArchetype,
  VideoParodyGenre,
  VideoPlanningBlueprintSelection,
} from "./types.ts";
import { curatedVideoReferencePrompt } from "./curatedVideoReferences.ts";

export type VideoPlanningBlueprintCategory = "meat" | "produce" | "food" | "beauty";

export type VideoPlanningBlueprintBeat = {
  role: string;
  timing: string;
  visual: string;
  direction: string;
};

export type VideoPlanningBlueprint = {
  id: string;
  familyId?: string;
  variantRole?: "base" | "opening-variant" | "cta-variant";
  title: string;
  sourceCategory: VideoPlanningBlueprintCategory;
  archetypes: VideoConceptArchetype[];
  duration: number;
  sceneCount: number;
  format: string;
  summary: string;
  hookMethods?: string[];
  evidenceSequence?: string[];
  sourceReferenceId?: string;
  transferableRules: string[];
  beats: VideoPlanningBlueprintBeat[];
};

const COMMON_RULES = [
  "첫 1~3초에 문제·가격·효익·갈등 중 하나를 완결하지 않고 던진다.",
  "주장 직후 그 주장과 맞는 상품·사용·공정·반응 장면을 붙인다.",
  "가격·원료·공정·사용 결과 중 확인된 근거 두 가지 이상을 교차한다.",
  "마지막 CTA에는 ProductTruth로 확인된 혜택만 사용한다.",
];

const VIDEO_PLANNING_BLUEPRINT_DEFINITIONS: VideoPlanningBlueprint[] = [
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
    id: "beauty-clay-problem-loop",
    familyId: "beauty-clay-lifestyle",
    variantRole: "base",
    title: "오리지널소스영상1 · 샤워 반복 문제와 단품 CTA",
    sourceCategory: "beauty",
    archetypes: ["parody", "usp-focus"],
    duration: 26.2,
    sceneCount: 22,
    format: "패러디형(AI 클레이 생활 상황극) + USP 집중형",
    summary:
      "샤워 직후 다시 땀이 나는 여름철 불편을 ‘샤워→드라이→또 땀’의 무한 루프로 코믹하게 키운 뒤, 제품과 수치 USP를 해결책으로 공개하고 사용 후 변화·사회적 증거·단품 CTA까지 연결합니다.",
    hookMethods: ["구체 시간으로 타깃 호명", "행동 실패 반복", "무한 루프 명명"],
    evidenceSequence: ["생활 불편", "반복 실패", "상품·수치 USP", "사용 결과", "사회적 증거", "단품 CTA"],
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "생활 불편 훅",
        timing: "0~2.5초",
        visual: "샤워 직후 다시 땀이 난 동일 인물의 표정과 몸 상태",
        direction: "누구나 알아볼 불편을 구체 시간과 행동으로 먼저 보여준다.",
      },
      {
        role: "실패 루프",
        timing: "2.5~10초",
        visual: "샤워→드라이→문제 재발을 같은 인물·공간에서 두 차례 가속 반복",
        direction: "같은 실패 행동을 짧게 반복하고 마지막에 하나의 기억어로 명명한다.",
      },
      {
        role: "해결책·수치 USP",
        timing: "10~15.2초",
        visual: "상품 공개 뒤 검증된 원료 수량을 규모가 보이는 장면으로 변환",
        direction: "숫자를 낭독하지 말고 원물·얼음·제형 등 확인 가능한 이미지로 크기를 체감시킨다.",
      },
      {
        role: "사용 결과·신뢰",
        timing: "15.2~23.5초",
        visual: "사용 전후 인물 행동과 확인 가능한 판매·후기 근거",
        direction: "첫 문제의 반대 결과를 행동으로 회수하고 근거가 있는 신뢰 정보만 붙인다.",
      },
      {
        role: "단품 CTA",
        timing: "23.5초~끝",
        visual: "상품과 확인된 가격·판매 조건을 한 화면에 집중",
        direction: "현재 ProductTruth에서 확인된 단품 조건만 사용해 행동 CTA로 끝낸다.",
      },
    ],
  },
  {
    id: "beauty-historical-world-truth-bridge",
    familyId: "beauty-historical-world",
    variantRole: "base",
    title: "오리지널소스1 · 역사 세계관과 현대 상품 연결",
    sourceCategory: "beauty",
    archetypes: ["parody", "usp-focus"],
    duration: 34.24,
    sceneCount: 20,
    format: "역사 세계관 패러디 + 실패한 해결 + 성분 USP + 현대 상품 공개",
    summary:
      "낯선 시대의 사회적 문제와 특정 계층의 실패를 먼저 극화하고, 반대편 인물이 아는 비밀을 현재 상품의 검증된 USP로 연결한 뒤 제품을 이야기의 현대적 해답처럼 공개합니다.",
    hookMethods: ["낯선 시대의 문제", "두 집단의 대비", "비밀 해결법", "현대 상품으로 시간 전환"],
    evidenceSequence: ["창작 세계의 문제", "실패한 해결", "검증된 원물·성분·공정", "현대 상품", "세계관 회수 CTA"],
    sourceReferenceId: "original-source-history-problem-truth-bridge",
    transferableRules: COMMON_RULES,
    beats: [
      {
        role: "시대·사회 문제 훅",
        timing: "0~7초",
        visual: "현재 상품과 뜻밖에 연결되는 과거·미래·특정 사회의 인물과 실패 행동",
        direction: "상품을 보여주기 전에 이름·관계·습관이 기억되는 인물이 겪는 문제와 익숙하지만 실패한 해결을 연속으로 보여준다.",
      },
      {
        role: "대조와 비밀 예고",
        timing: "7~13초",
        visual: "문제를 겪는 집단과 해결법을 아는 다른 인물·계층·관계의 대비",
        direction: "상반된 인물이 아는 비밀을 결과부터 보여주고 해답 공개를 지연한다.",
      },
      {
        role: "비밀과 작용 설명",
        timing: "13~21초",
        visual: "원물 매크로, 공정 또는 관찰 가능한 작용 그래픽",
        direction: "창작 세계의 비밀을 현재 상품의 verifiedFacts 한두 가지와 1:1로 연결한다.",
      },
      {
        role: "현대 상품 공개",
        timing: "21~30초",
        visual: "시대 또는 장소가 전환되고 실제 상품·원료·사용 장면이 처음 크게 등장",
        direction: "상품을 이야기의 해답처럼 공개하고 확인된 수치·원료·구성만 설명한다.",
      },
      {
        role: "세계관 회수 CTA",
        timing: "30초~끝",
        visual: "첫 세계의 상징과 현대 상품을 한 화면에 연결",
        direction: "첫 인물·장소·문제를 다시 불러오되 현재의 구매·확인 행동으로 끝낸다.",
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
    familyId: "beauty-clay-lifestyle",
    variantRole: "cta-variant",
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
  {
    id: "meat-catalog-holiday-clearance",
    title: "고기영상5 · 카탈로그 혜택과 명절 창고 정리",
    sourceCategory: "meat",
    archetypes: ["secret-benefit", "usp-focus"],
    duration: 29.5,
    sceneCount: 28,
    format: "혜택 카탈로그형 + 명절 창고 정리형",
    summary:
      "상품 구성을 빠르게 펼쳐 보인 뒤 명절 식탁의 쓰임과 확인된 혜택을 짧은 카탈로그 리듬으로 회수합니다.",
    hookMethods: ["구성 연속 공개", "기간·상황 호명", "혜택 결론 지연"],
    evidenceSequence: ["구성", "용량", "사용 장면", "확인된 혜택"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "구성 훅", timing: "0~4초", visual: "서로 다른 구성품이 차례로 프레임을 채움", direction: "확인된 구성만 짧은 명사형 자막으로 연속 공개한다." },
      { role: "상황 호명", timing: "4~9초", visual: "명절·모임처럼 상품이 필요한 식탁", direction: "상품과 맞는 실제 소비 상황 하나만 선택한다." },
      { role: "품질 근거", timing: "9~18초", visual: "원물·단면·조리 결과 매크로", direction: "구성 나열 뒤 반드시 품질을 확인할 장면을 붙인다." },
      { role: "선택 이유", timing: "18~25초", visual: "여럿이 먹거나 준비하는 행동", direction: "구성과 사용 장면을 구매 이유 한 문장으로 연결한다." },
      { role: "혜택 CTA", timing: "25초~끝", visual: "상품 전체와 확인된 판매 조건", direction: "기간·가격·증정이 확인된 경우에만 혜택으로 닫는다." },
    ],
  },
  {
    id: "meat-couple-wholesale-review",
    sourceReferenceId: "meat-video-06-natural-dialogue",
    familyId: "meat-wholesale-family-reaction",
    variantRole: "base",
    title: "고기영상6 · 부부 생활 후기와 도매 USP",
    sourceCategory: "meat",
    archetypes: ["real-review", "usp-focus"],
    duration: 40.02,
    sceneCount: 41,
    format: "부부 생활 후기형 + 도매 USP형",
    summary:
      "부부의 현실적인 식사 대화로 시작해 조리 과정·식감 반응·대량 매입 근거를 교차하며 가격과 품질을 함께 설득합니다.",
    hookMethods: ["생활 대화", "가격 의심", "반응 반전"],
    evidenceSequence: ["생활 문제", "조리", "식감 반응", "매입·구성 근거"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "부부 갈등", timing: "0~6초", visual: "식사 준비 중 서로 다른 반응의 두 인물", direction: "실제 부부가 할 법한 짧은 질문으로 사건을 연다." },
      { role: "상품 투입", timing: "6~13초", visual: "포장 개봉과 팬 투입", direction: "상품을 해결책처럼 과장하지 말고 행동 속에 자연스럽게 넣는다." },
      { role: "감각 증거", timing: "13~25초", visual: "굽기·절단·한입 반응", direction: "맛 표현마다 대응하는 질감 또는 반응 장면을 붙인다." },
      { role: "가격 이유", timing: "25~34초", visual: "구성·포장·확인된 유통 근거", direction: "가격의 이유는 확인된 운영·구성 사실로만 설명한다." },
      { role: "생활 결론", timing: "34초~끝", visual: "함께 먹는 식탁과 상품 전체", direction: "처음 갈등을 생활 변화 한 문장으로 회수한다." },
    ],
  },
  {
    id: "meat-holiday-gift-comparison",
    title: "고기영상7 · 명절 선물 비교와 프리미엄 가치",
    sourceCategory: "meat",
    archetypes: ["real-review", "usp-focus"],
    duration: 35.11,
    sceneCount: 23,
    format: "선물 비교형 + 프리미엄 가치형",
    summary:
      "익숙한 선물 후보와 실제 받는 순간을 대비한 뒤 구성·품질·사용 장면으로 선택 이유를 증명합니다.",
    hookMethods: ["선물 후보 비교", "받는 사람 반응", "가격보다 쓰임"],
    evidenceSequence: ["비교 상황", "구성", "품질", "선물 후 사용"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "선물 고민", timing: "0~5초", visual: "두세 가지 선물 후보 앞에서 망설이는 손", direction: "경쟁 제품을 비하하지 않고 선택 상황만 대비한다." },
      { role: "받는 순간", timing: "5~11초", visual: "포장 개봉과 자연스러운 반응", direction: "실제 후기처럼 단정하지 말고 광고용 상황극 반응으로 연출한다." },
      { role: "구성 공개", timing: "11~19초", visual: "구성품과 용량을 정돈해 공개", direction: "확인된 구성만 화면과 자막에 일치시킨다." },
      { role: "가치 증명", timing: "19~29초", visual: "조리·사용·함께 먹는 장면", direction: "선물 이후 실제 쓰임이 보이게 한다." },
      { role: "선택 CTA", timing: "29초~끝", visual: "상품 전체와 선물 상황", direction: "가격보다 기억할 선택 기준 한 가지로 닫는다." },
    ],
  },
  {
    id: "meat-parents-gift-review",
    title: "고기영상8 · 부모님 선물 후기와 도매 설득",
    sourceCategory: "meat",
    archetypes: ["real-review", "secret-benefit"],
    duration: 25.84,
    sceneCount: 19,
    format: "부모님 선물 후기형 + 도매 설득형",
    summary:
      "선물을 고르는 자녀의 고민에서 시작해 개봉·조리·가족 반응을 거쳐 확인된 구성과 가격으로 빠르게 닫습니다.",
    hookMethods: ["자녀 시점 고민", "부모 반응", "짧은 구매 결론"],
    evidenceSequence: ["선물 고민", "개봉", "사용 반응", "구성·혜택"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "자녀 고민", timing: "0~4초", visual: "선물 화면을 넘기다 멈추는 손", direction: "타깃의 실제 고민을 한 문장으로 직접 말한다." },
      { role: "선물 공개", timing: "4~9초", visual: "부모 앞 개봉과 상품 전체", direction: "과도한 감동 연기보다 상품 확인 행동을 먼저 잡는다." },
      { role: "사용 반응", timing: "9~16초", visual: "조리·식사·표정의 짧은 교차", direction: "상품 주장과 연결되는 반응만 사용한다." },
      { role: "구매 근거", timing: "16~22초", visual: "구성·용량·가격 카드", direction: "확인된 사실 두 가지 이하로 압축한다." },
      { role: "선물 CTA", timing: "22초~끝", visual: "상품과 가족 식탁", direction: "누구에게 언제 줄지 행동이 보이는 CTA로 마무리한다." },
    ],
  },
  {
    id: "meat-child-meal-wholesale",
    familyId: "meat-wholesale-family-reaction",
    variantRole: "opening-variant",
    title: "고기영상9 · 아이 식사 반응과 도매 USP",
    sourceCategory: "meat",
    archetypes: ["real-review", "usp-focus"],
    duration: 38.38,
    sceneCount: 39,
    format: "아이 식사 반응형 + 도매 USP형",
    summary:
      "아이 밥상 고민을 오프닝 변주로 쓰고, 고기영상6과 같은 조리·가격·도매 근거 본문을 반복하지 않도록 가족 반응만 차별화합니다.",
    hookMethods: ["아이 식사 고민", "한입 반응", "가족 선택 기준"],
    evidenceSequence: ["밥상 문제", "조리", "아이 반응", "구성·매입 근거"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "밥상 문제", timing: "0~6초", visual: "식탁 앞에서 머뭇거리는 아이와 준비하는 보호자", direction: "아동 효능을 주장하지 말고 식사 행동만 보여준다." },
      { role: "조리 시작", timing: "6~14초", visual: "고기를 굽고 먹기 좋게 자르는 손", direction: "제품과 조리 행동을 가까이 연결한다." },
      { role: "반응 변화", timing: "14~24초", visual: "한입과 보호자의 안도 반응", direction: "맛있게 먹는 광고용 상황극으로만 표현한다." },
      { role: "선택 근거", timing: "24~33초", visual: "상품 구성과 확인된 품질 근거", direction: "본문은 같은 family의 다른 레퍼런스와 문장까지 복제하지 않는다." },
      { role: "가족 CTA", timing: "33초~끝", visual: "식탁과 상품 전체", direction: "가족 식사 선택 기준으로 첫 고민을 회수한다." },
    ],
  },
  {
    id: "produce-friend-secret-process",
    sourceReferenceId: "calamansi-video-04-secret-dialogue",
    familyId: "produce-transformation-process",
    variantRole: "base",
    title: "깔라만시4 · 친구 비밀 후기와 공정 효익",
    sourceCategory: "produce",
    archetypes: ["real-review", "usp-focus"],
    duration: 45.78,
    sceneCount: 38,
    format: "친구 비밀 후기형 + 효익·공정형",
    summary:
      "친구 사이의 궁금증을 사건으로 만들고 사용 루틴·원물·공정·감각 변화를 차례로 공개합니다.",
    hookMethods: ["친구의 비밀 질문", "루틴 발견", "근거 공개"],
    evidenceSequence: ["생활 변화 질문", "사용 루틴", "원물", "공정", "감각 결과"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "비밀 질문", timing: "0~6초", visual: "친구가 달라진 행동을 알아채고 묻는 장면", direction: "외모·건강 효능을 단정하지 않고 관찰 가능한 행동을 질문한다." },
      { role: "루틴 공개", timing: "6~14초", visual: "상품을 꺼내 준비하고 사용하는 손", direction: "상품 사용 방법을 한 번에 이해시킨다." },
      { role: "원물 근거", timing: "14~25초", visual: "원물·절단·즙·제품의 연결", direction: "확인된 원료와 수치만 공개한다." },
      { role: "공정·감각", timing: "25~38초", visual: "가공 공정과 완성 사용 장면", direction: "공정 설명 뒤 반드시 소비 장면으로 전환한다." },
      { role: "친구 CTA", timing: "38초~끝", visual: "함께 사용하는 상황과 상품", direction: "처음 질문에 답하는 한 문장으로 닫는다." },
    ],
  },
  {
    id: "produce-reunion-transformation",
    familyId: "produce-transformation-process",
    variantRole: "opening-variant",
    title: "깔라만시5 · 재회 변화와 효익 공정",
    sourceCategory: "produce",
    archetypes: ["real-review", "usp-focus"],
    duration: 48.85,
    sceneCount: 41,
    format: "재회 변화형 + 효익·공정형",
    summary:
      "오랜만에 만난 인물의 달라진 루틴을 오프닝으로 쓰고 같은 family 본문은 원물·공정 근거만 공유합니다.",
    hookMethods: ["재회 반응", "달라진 루틴", "과거·현재 대비"],
    evidenceSequence: ["재회", "행동 변화", "사용 루틴", "원물·공정", "현재 선택"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "재회 훅", timing: "0~7초", visual: "오랜만에 만난 두 인물의 즉각적인 반응", direction: "신체 변화 효능 대신 달라진 습관이나 준비 행동을 포착한다." },
      { role: "과거 대비", timing: "7~15초", visual: "같은 장소의 과거·현재 행동 분할", direction: "상품 사용 전후를 관찰 가능한 행동으로만 대비한다." },
      { role: "루틴 공개", timing: "15~25초", visual: "상품 준비와 사용 순서", direction: "사용법과 상황을 빠르게 이해시킨다." },
      { role: "근거 보강", timing: "25~41초", visual: "원물·공정·완성 결과", direction: "같은 family의 대사를 복제하지 않고 현재 상품 사실로 다시 쓴다." },
      { role: "현재 CTA", timing: "41초~끝", visual: "현재 루틴과 상품 전체", direction: "재회 장면의 궁금증을 현재 선택으로 회수한다." },
    ],
  },
  {
    id: "produce-motion-graphic-compression",
    title: "깔라만시6 · 원료·가격 모션그래픽 압축",
    sourceCategory: "produce",
    archetypes: ["usp-focus", "secret-benefit"],
    duration: 14.27,
    sceneCount: 9,
    format: "모션그래픽형 + 원료·가격 압축형",
    summary:
      "한 가지 원료 근거와 한 가지 판매 조건을 큰 숫자·아이콘·제품 동작으로 15초 안에 압축합니다.",
    hookMethods: ["숫자 선공개", "아이콘 변환", "압축형 CTA"],
    evidenceSequence: ["숫자 또는 원료", "제품", "사용", "혜택"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "숫자 훅", timing: "0~2초", visual: "확인된 숫자와 상품이 동시에 등장", direction: "수치는 출처가 확인될 때만 첫 화면에 쓴다." },
      { role: "원료 변환", timing: "2~5초", visual: "원물이 제품으로 이어지는 단순 모션", direction: "원료와 상품의 관계를 한 동작으로 설명한다." },
      { role: "사용 장면", timing: "5~9초", visual: "손이 제품을 실제 방식으로 사용", direction: "모션그래픽 사이에 실제 사용 행동을 반드시 넣는다." },
      { role: "결과 회수", timing: "9~12초", visual: "감각 결과와 제품 정면", direction: "효능 대신 관찰 가능한 감각 결과를 쓴다." },
      { role: "압축 CTA", timing: "12초~끝", visual: "상품과 확인된 조건 한 줄", direction: "혜택 하나와 행동 동사 하나만 남긴다." },
    ],
  },
  {
    id: "produce-morning-routine-compression",
    title: "깔라만시7 · 아침 루틴 문제 해결 압축",
    sourceCategory: "produce",
    archetypes: ["real-review", "usp-focus"],
    duration: 14.61,
    sceneCount: 8,
    format: "아침 루틴형 + 문제 해결 압축형",
    summary:
      "아침의 반복 불편을 한 장면으로 보여주고 준비·사용·결과를 15초 안에 빠르게 연결합니다.",
    hookMethods: ["아침 행동", "준비 시간 갈등", "루틴 전환"],
    evidenceSequence: ["문제 행동", "상품 준비", "사용", "일상 복귀"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "아침 문제", timing: "0~3초", visual: "시간에 쫓기는 한 가지 행동", direction: "타깃이 즉시 알아볼 행동 하나만 크게 잡는다." },
      { role: "상품 발견", timing: "3~5초", visual: "손이 상품을 꺼내는 빠른 하드컷", direction: "상품명 설명보다 사용 행동을 먼저 보여준다." },
      { role: "준비·사용", timing: "5~9초", visual: "한두 단계의 실제 사용", direction: "실제 사용법을 생략하거나 창작하지 않는다." },
      { role: "루틴 변화", timing: "9~12초", visual: "다음 일상 행동으로 자연스럽게 이동", direction: "전후 차이는 시간·행동 변화로만 보여준다." },
      { role: "루틴 CTA", timing: "12초~끝", visual: "상품과 아침 공간", direction: "내일 바로 따라 할 수 있는 행동으로 닫는다." },
    ],
  },
  {
    id: "produce-long-negotiation-process",
    title: "깔라만시8 · 장편 가격 협상과 공정 공개",
    sourceCategory: "produce",
    archetypes: ["parody", "secret-benefit"],
    duration: 62.8,
    sceneCount: 44,
    format: "가격 협상 장편 상황극 + 공정 공개형",
    summary:
      "가격 협상을 긴 사건으로 끌고 가되 중간마다 원료·공정·사용 근거를 넣어 대사극이 상품과 분리되지 않게 합니다.",
    hookMethods: ["협상 미결", "조건 단계 공개", "근거 삽입"],
    evidenceSequence: ["가격 갈등", "원료", "공정", "사용", "최종 조건"],
    transferableRules: COMMON_RULES,
    beats: [
      { role: "협상 시작", timing: "0~10초", visual: "판매자와 구매자가 조건을 두고 대치", direction: "실제 확인된 가격·구성 안에서만 갈등을 만든다." },
      { role: "첫 근거", timing: "10~23초", visual: "원물·구성·사용 B-roll", direction: "대사 여섯 초 이상이 이어지기 전에 상품 근거를 삽입한다." },
      { role: "조건 재협상", timing: "23~38초", visual: "조건 카드와 인물의 태도 변화", direction: "협상 단계마다 새 사실 하나만 공개한다." },
      { role: "공정 증명", timing: "38~53초", visual: "확인된 공정과 완성 결과", direction: "최종 가격 전에 품질 선택 이유를 충분히 보여준다." },
      { role: "합의 CTA", timing: "53초~끝", visual: "상품 전체와 최종 확인 조건", direction: "확인된 조건만 결말처럼 공개한다." },
    ],
  },
];

const SOURCE_REFERENCE_BY_BLUEPRINT: Record<string, string> = {
  "meat-real-review-secret-price": "meat-video-01",
  "meat-wholesale-insider": "meat-video-03",
  "meat-family-expert-usp": "meat-video-04",
  "produce-direct-secret": "calamansi-video-01",
  "produce-origin-documentary": "calamansi-video-02",
  "produce-price-negotiation": "calamansi-video-03",
  "food-always-wholesale": "reference-video-01",
  "food-bargaining-parody": "reference-video-02",
  "beauty-clay-problem-loop": "original-source-video-01",
  "beauty-historical-world-truth-bridge": "original-source-history-problem-truth-bridge",
  "beauty-discovery-documentary": "original-source-video-02",
  "beauty-clay-benefit-cta": "original-source-video-03",
  "meat-catalog-holiday-clearance": "meat-video-05",
  "meat-couple-wholesale-review": "meat-video-06-natural-dialogue",
  "meat-holiday-gift-comparison": "meat-video-07",
  "meat-parents-gift-review": "meat-video-08",
  "meat-child-meal-wholesale": "meat-video-09",
  "produce-friend-secret-process": "calamansi-video-04-secret-dialogue",
  "produce-reunion-transformation": "calamansi-video-05",
  "produce-motion-graphic-compression": "calamansi-video-06",
  "produce-morning-routine-compression": "calamansi-video-07",
  "produce-long-negotiation-process": "calamansi-video-08",
};

export const VIDEO_PLANNING_BLUEPRINTS: VideoPlanningBlueprint[] =
  VIDEO_PLANNING_BLUEPRINT_DEFINITIONS.map((blueprint) => ({
    ...blueprint,
    sourceReferenceId: SOURCE_REFERENCE_BY_BLUEPRINT[blueprint.id],
  }));

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
  if (genre === "historical-world-parody") {
    return blueprint.sourceReferenceId === "original-source-history-problem-truth-bridge" ? 14 : -4;
  }
  if (isPriceNegotiation) return -12;
  if (["blind-test", "competition-judging"].includes(genre)) {
    const evidenceScore = blueprint.archetypes.some((item) => item === "real-review" || item === "usp-focus") ? 5 : -3;
    return evidenceScore - (blueprint.archetypes.includes("parody") ? 6 : 0);
  }
  if (genre === "family-office-sitcom") return blueprint.archetypes.includes("real-review") ? 4 : 0;
  const evidenceScore = blueprint.archetypes.some((item) => item === "real-review" || item === "usp-focus") ? 2 : 0;
  return evidenceScore - (blueprint.archetypes.includes("parody") ? 6 : 0);
}

function blueprintFamily(blueprint: VideoPlanningBlueprint) {
  return blueprint.familyId || blueprint.id;
}

export function recommendAutomaticVideoDuration(input: {
  analysis: ProductAnalysisSnapshot;
  hasVideoReference?: boolean;
}) {
  const factCount =
    (input.analysis.verifiedFacts?.length || 0) +
    input.analysis.coreUsps.length +
    input.analysis.keyFeatures.length +
    (input.analysis.repeatedReviewPhrases?.length || 0);
  if (input.hasVideoReference || factCount >= 12) return 45 as const;
  return 30 as const;
}

export function getVideoPlanningBlueprint(id?: string) {
  return VIDEO_PLANNING_BLUEPRINTS.find((item) => item.id === id);
}

export function selectVideoPlanningBlueprints(input: {
  analysis: ProductAnalysisSnapshot;
  archetypes: VideoConceptArchetype[];
  parodyGenre?: VideoParodyGenre;
  /**
   * 새 프로젝트마다 적합 후보의 우선순위를 회전하되, 같은 프로젝트의
   * 재시도·상세 대본 생성에서는 같은 레퍼런스를 다시 선택하기 위한 값입니다.
   */
  selectionSeed?: string;
}): Partial<Record<VideoConceptArchetype, VideoPlanningBlueprintSelection>> {
  const expected = preferredCategory(input.analysis);
  const used = new Set<string>();
  const usedFamilies = new Set<string>();
  const result: Partial<Record<VideoConceptArchetype, VideoPlanningBlueprintSelection>> = {};

  function rotationScore(blueprintId: string, archetype: VideoConceptArchetype) {
    if (!input.selectionSeed) return 0;
    const value = `${input.selectionSeed}:${archetype}:${blueprintId}`;
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    // Keep category and archetype compatibility dominant. This only rotates
    // candidates inside the same compatibility tier.
    return ((hash >>> 0) / 0xffffffff) * 0.95;
  }

  for (const archetype of input.archetypes) {
    const ranked = VIDEO_PLANNING_BLUEPRINTS.map((blueprint, index) => ({
      blueprint,
      score:
        categoryScore(expected, blueprint.sourceCategory) +
        (blueprint.archetypes.includes(archetype) ? 6 : 0) -
        (used.has(blueprint.id) ? 2 : 0) -
        (usedFamilies.has(blueprintFamily(blueprint)) ? 1 : 0) -
        (input.selectionSeed ? index / 100_000 : index / 100) +
        // 22개 모두 실제 자막·장면 원문이 연결돼 있다. 이 가중치는 향후
        // 불완전한 운영자 등록본이 섞여도 상세 정본을 우선하기 위한 방어선이다.
        (blueprint.sourceReferenceId ? 0.5 : 0) +
        (archetype === "parody" ? parodyGenreScore(blueprint, input.parodyGenre) : 0) +
        rotationScore(blueprint.id, archetype),
    })).sort((left, right) => right.score - left.score);
    const primary = ranked[0].blueprint;
    used.add(primary.id);
    usedFamilies.add(blueprintFamily(primary));
    const secondary = ranked.find(
      ({ blueprint }) =>
        blueprint.id !== primary.id &&
        blueprintFamily(blueprint) !== blueprintFamily(primary) &&
        (blueprint.archetypes.includes(archetype) || (archetype === "parody" && input.parodyGenre !== "price-negotiation" && blueprint.archetypes.some((item) => item === "real-review" || item === "usp-focus"))) &&
        !(archetype === "parody" && input.parodyGenre !== "price-negotiation" && PRICE_NEGOTIATION_BLUEPRINTS.has(blueprint.id))
    )?.blueprint;
    const hasDirectGenreReference =
      archetype !== "parody" ||
      !input.parodyGenre ||
      (input.parodyGenre === "price-negotiation" && PRICE_NEGOTIATION_BLUEPRINTS.has(primary.id)) ||
      (input.parodyGenre === "historical-world-parody" && primary.sourceReferenceId === "original-source-history-problem-truth-bridge") ||
      (input.parodyGenre === "family-office-sitcom" && primary.archetypes.includes("real-review"));
    result[archetype] = {
      primaryId: primary.id,
      secondaryId: secondary?.id,
      reason: hasDirectGenreReference
        ? `${primary.format}의 전개가 ${archetype} 콘셉트와 맞고, ${expected === primary.sourceCategory ? "상품군의 사용·증거 장면까지 직접 참고할 수 있습니다." : "카테고리는 달라도 훅·증거·CTA 구조를 안전하게 전용할 수 있습니다."}`
        : `분석된 22개 영상에 '${input.parodyGenre}' 전개와 직접 일치하는 원본이 없어 ${primary.format}의 실제 증거·자막 리듬만 가져옵니다. 원문에 없는 영화식 장치나 다른 장르 문법은 덧붙이지 않습니다.`,
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
      duration: primary.duration,
      sceneCount: primary.sceneCount,
      averageSceneSeconds: Number((primary.duration / primary.sceneCount).toFixed(2)),
      familyId: primary.familyId,
      variantRole: primary.variantRole,
      hookMethods: primary.hookMethods,
      evidenceSequence: primary.evidenceSequence,
      beats: primary.beats,
      rules: primary.transferableRules,
      sourceReference: curatedVideoReferencePrompt(primary.sourceReferenceId),
    },
    secondary: secondary
      ? {
          title: secondary.title,
          format: secondary.format,
          summary: secondary.summary,
          familyId: secondary.familyId,
          variantRole: secondary.variantRole,
          hookMethods: secondary.hookMethods,
          rules: secondary.transferableRules.slice(0, 2),
          sourceReference: curatedVideoReferencePrompt(secondary.sourceReferenceId),
        }
      : undefined,
    instruction:
      "주 레퍼런스의 sourceTranscriptAndScenes 전체를 번호 순서대로 읽고 각 장면의 자막·화면·역할·분석과 정보 공개 시점을 5비트 요약보다 우선한다. 장면을 범용 훅→USP→CTA 공식으로 다시 일반화하지 않는다. 보조 레퍼런스는 상세 원문 중 훅 또는 CTA 장치 하나만 참고하고, 같은 family의 A/B 변형은 독립 본문처럼 중복 사용하지 않는다. 원문 자막·상품 사실·인물은 복제하지 않되 현재 상품에도 같은 정도로 구체적인 새 인물·사회 또는 시대·사건을 만든다.",
  });
}
