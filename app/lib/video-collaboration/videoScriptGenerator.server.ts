import "server-only";

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadCopyGuideForProduct } from "../mvp/copyGuideLoader.ts";
import {
  VIDEO_HOOK_TYPES,
  VIDEO_CONCEPT_FORMAT_OPTIONS,
  VIDEO_CONCEPT_ARCHETYPE_OPTIONS,
  type HookScore,
  type ProductAnalysisSnapshot,
  type VideoConcept,
  type VideoCut,
  type VideoDuration,
  type VideoHookCandidate,
  type VideoHookType,
  type VideoObjective,
  type BrandGuideline,
  type VideoCreativeStyle,
  type VideoReferenceAsset,
  type ReferenceVideoAnalysis,
  type VideoConceptFormat,
  type VideoConceptArchetype,
  type VideoParodyGenre,
} from "./types.ts";
import { createVideoMaterialCode, VIDEO_HOOK_LABELS, VIDEO_OBJECTIVE_LABELS } from "./workflow.ts";
import {
  assignPlanningTimeline,
  hasVerifiedVideoBenefit,
  repairDetailedPlanningAudienceCopy,
  repairDetailedPlanningCommercialRestraint,
  repairDetailedPlanningCta,
  repairDetailedPlanningOpeningHook,
  repairDetailedPlanningSceneDescriptions,
  segmentRange,
  validateConceptDiversity,
  validateDetailedPlanning,
} from "./planningValidation.ts";
import {
  getVideoPlanningProvider,
  runVideoPlanningAi,
  VideoPlanningGenerationError,
} from "./videoPlanningAi.server.ts";
import {
  requestFourVideoConcepts,
  REQUIRED_VIDEO_CONCEPT_ARCHETYPES,
  VideoConceptBatchValidationError,
} from "./videoPlanningConceptBatch.ts";
import {
  blueprintPrompt,
  getVideoPlanningBlueprint,
  selectVideoPlanningBlueprints,
} from "./videoPlanningBlueprints.ts";
import { buildCurrentProductSelfIntroductionHook } from "./videoPlanningHookFallback.ts";
import { currentVideoCreativePremiseIssue } from "./videoPlanningVersion.ts";
import { runWithSingleVideoPlanningCorrection } from "./videoPlanningCorrection.ts";
import {
  matchesVideoParodyGenre,
  selectVideoParodyGenre,
  videoParodyGenrePrompt,
} from "./videoParodyGenres.ts";

import {
  hookTypeSchema,
  clean,
  compact,
  promptFacts,
  stylePrinciples,
  internetVoiceRules,
  PRODUCT_SELF_INTRODUCTION_RULES,
  SPECIFIC_CREATIVE_WORLD_RULES,
  NATURAL_REFERENCE_DIALOGUE_RULES,
  FOUR_CONCEPT_STORY_MECHANISM_RULES,
  referenceVoiceSignals,
} from "./videoPlanningPromptSupport";

type AiScriptRow = { caption: string; narration: string; sceneDescription: string };

function scriptSchema(duration: VideoDuration) {
  const count = segmentRange(duration).preferred;
  return {
    type: "object",
    additionalProperties: false,
    required: ["rows", "fullScript"],
    properties: {
      rows: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["caption", "narration", "sceneDescription"],
          properties: {
            caption: { type: "string", minLength: 4, maxLength: 46 },
            narration: { type: "string", minLength: 0, maxLength: 220 },
            sceneDescription: { type: "string", minLength: 70, maxLength: 420 },
          },
        },
      },
      fullScript: { type: "string", minLength: 40, maxLength: 3000 },
    },
  } as const;
}

function rowsToCuts(
  rows: AiScriptRow[],
  duration: VideoDuration,
  existing?: VideoCut[],
  concept?: VideoConcept
) {
  const blueprint = getVideoPlanningBlueprint(concept?.blueprintSelection?.primaryId);
  return assignPlanningTimeline(rows, duration).map((row, index): VideoCut => {
    const beat =
      blueprint?.beats[
        Math.min(
          blueprint.beats.length - 1,
          Math.floor((index / rows.length) * blueprint.beats.length)
        )
      ];
    return {
      id: existing?.[index]?.id || crypto.randomUUID(),
      cutNumber: index + 1,
      sceneName: `구간 ${String(index + 1).padStart(2, "0")}`,
      startSecond: row.startSecond,
      endSecond: row.endSecond,
      caption: clean(row.caption, 80),
      narration: clean(row.narration, 320),
      sceneDescription: clean(row.sceneDescription, 1000),
      requiredSources: beat ? [beat.visual] : [],
      referenceImages: [],
      productionMemo: beat
        ? `${blueprint?.title}의 ${beat.role} 리듬 참고. 원문 자막과 원본 인물은 복제하지 않음.`
        : "",
      sceneFormat: blueprint?.format.includes("클레이") ? "AI 클레이·미니어처" : "실사·상품 B-roll",
      cameraComposition: beat?.visual || "장면의 핵심 행동이 한눈에 보이는 세로형 구도",
      motionDirection: beat?.direction || "한 화면에 하나의 행동이 명확히 보이게 연출",
      transition:
        index === rows.length - 1
          ? "CTA에서 종료"
          : `다음 ${blueprint?.beats[Math.min(blueprint.beats.length - 1, Math.floor(((index + 1) / rows.length) * blueprint.beats.length))]?.role || "장면"}으로 빠르게 전환`,
    };
  });
}

function removeLiteralForbidden(value: string, forbidden: string[]) {
  let next = value;
  for (const phrase of forbidden.map((item) => clean(item, 180)).filter(Boolean)) {
    next = next
      .replaceAll(phrase, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return next;
}

function sanitizeGeneratedConceptCopy(concept: VideoConcept, forbidden: string[]): VideoConcept {
  const apply = (value: string) => removeLiteralForbidden(value, forbidden);
  return {
    ...concept,
    title: apply(concept.title),
    openingHook: apply(concept.openingHook),
    fullScript: apply(concept.fullScript),
    cta: apply(concept.cta),
    cuts: concept.cuts.map((cut) => ({
      ...cut,
      caption: apply(cut.caption),
      narration: apply(cut.narration),
      sceneDescription: apply(cut.sceneDescription),
    })),
  };
}

function detailedPrompt(input: {
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  concept: VideoConcept;
  duration: VideoDuration;
  correction?: string;
  referenceAnalyses?: ReferenceVideoAnalysis[];
  revisionFeedback?: string;
}) {
  const count = segmentRange(input.duration).preferred;
  const ctaDuration = input.duration >= 45 ? 3 : input.duration >= 30 ? 2.4 : input.duration >= 20 ? 2 : 1.5;
  const bodyDuration = Math.max(1, (input.duration - 3 - ctaDuration) / Math.max(1, count - 3));
  const bodyCaptionMax = Math.max(7, Math.min(22, Math.floor(bodyDuration * 10)));
  const ctaCaptionMax = Math.max(12, Math.min(30, Math.floor(ctaDuration * 10)));
  return `당신은 촬영팀이 추가 질문 없이 실행할 수 있는 한국 퍼포먼스 광고 숏폼 대본을 쓴다.

[상품의 검증된 사실]
${JSON.stringify(promptFacts(input.analysis))}
[선택한 기획안]
${JSON.stringify({
  title: input.concept.title,
  hookType: VIDEO_HOOK_LABELS[input.concept.hookType],
  openingHook: input.concept.openingHook,
  target: input.concept.coreTarget,
  problem: input.concept.customerProblem,
  usp: input.concept.usp,
  speaker: input.concept.speaker,
  style: input.concept.creativeStyle,
  selectedConceptFormat: input.concept.conceptFormat,
  conceptArchetype: input.concept.conceptArchetype,
  parodyGenre: input.concept.parodyGenre,
  narrative: input.concept.narrativeStructure,
  incident: input.concept.centralIncident,
  pointOfView: input.concept.speakerPointOfView,
  keyAppeal: input.concept.keyAppeal,
  visualStyle: input.concept.recommendedVisualStyle,
  supportingDevices: input.concept.supportingDevices,
  copyVoiceDirection: input.concept.copyVoiceDirection,
  targetCallout: input.concept.targetCallout,
  cta: input.concept.cta,
  evidenceIds: input.concept.evidenceIds,
  distinctiveCharacter: input.concept.distinctiveCharacter,
  socialWorld: input.concept.socialWorld,
  storyTrigger: input.concept.storyTrigger,
  truthBridge: input.concept.truthBridge,
  dramatizationBoundary: input.concept.dramatizationBoundary,
})}
${
  input.concept.conceptFormat
    ? `[선택 형식 연출 규칙]
${VIDEO_CONCEPT_FORMAT_OPTIONS.find((item) => item.id === input.concept.conceptFormat)?.direction || "선택 형식의 연출 문법을 일관되게 유지한다."}`
    : ""
}
${
  input.concept.conceptArchetype
    ? `[중심 콘셉트 규칙]
${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === input.concept.conceptArchetype)?.direction || "선택된 중심 유형의 사건과 시점을 끝까지 유지한다."}`
    : ""
}
${
  input.concept.conceptArchetype === "parody" && input.concept.parodyGenre
    ? `[선택된 창작 인물·상황극형 세부 장르]
${videoParodyGenrePrompt(input.concept.parodyGenre)}`
    : ""
}
[브랜드 기준]
${JSON.stringify({ tone: input.guideline.toneAndManner, required: input.guideline.requiredPhrases, forbidden: input.guideline.forbiddenPhrases })}
[카테고리 원칙]
${stylePrinciples(input.analysis.category)}
[참고 영상에서 재사용할 전개 원칙]
${JSON.stringify(referenceVoiceSignals(input.referenceAnalyses))}
[레퍼런스 말투 전용 규칙]
${internetVoiceRules(input.analysis.category)}
[창작 인물·세계·사건 구체화 규칙]
${SPECIFIC_CREATIVE_WORLD_RULES}
[최신 4개 이야기 작동 방식]
${FOUR_CONCEPT_STORY_MECHANISM_RULES}
[레퍼런스 수준의 시청자 전달형 구어체·자막 규칙]
${NATURAL_REFERENCE_DIALOGUE_RULES}
[상세 분석된 22개·617장면 레퍼런스에서 이 콘셉트에 배정된 원문]
${blueprintPrompt(input.concept.blueprintSelection)}
[사용자 수정 요청]
${clean(input.revisionFeedback, 1600) || "없음"}

정확히 ${count}개 구간을 만든다. 첫 두 행이 0~1.2초와 1.2~3초를 맡고 두 화면 사이에 실제 행동·갈등·발견 중 하나의 변화가 있어야 한다. 첫 구간부터 distinctiveCharacter가 socialWorld 안에서 storyTrigger를 시작하고, 중반에는 truthBridge의 검증된 USP가 사건의 반전·해결 또는 추천 이유가 되어야 한다. 인물과 세계를 도입 장식으로만 쓰고 사라지게 하지 말며 마지막 직전 또는 CTA에서 회수한다. 가상의 의사 가족 추천을 사용하면 sceneDescription에 광고용 가상 인물 고지를 넣고, 의학적 효능·치료·보증은 말하지 않는다. 배정된 주 블루프린트에 sourceReference가 있으면 5비트 요약보다 실제 자막·장면·역할·분석 전체를 순서대로 변환한다. sourceTranscriptAndScenes의 자막을 독립 표제로 재요약하지 말고, 앞뒤 말이 이어지는 리듬·정보 공개 순서·첫 사건 회수 방식을 현재 상품의 새 창작 장면으로 옮긴다. 하나의 사건이 시작→궁금증→직접 증거→반응→행동으로 이어져야 하며 장면을 가격·구성·USP 카드의 나열로 만들지 않는다. 일반 기획은 첫 자막부터 상품명을 설명하지 않고 첫 두 자막 중 하나에 targetCallout을 자연스럽게 변형해 넣는다. 신규 4안에서는 product-self-introduction을 사용하지 않으며, 과거 저장 기획이 그 유형일 때만 아래 하위 호환 문법을 적용한다.
[상품 자기소개형 전용]
${PRODUCT_SELF_INTRODUCTION_RULES}

[내레이션과 대화]
- narration은 한 명의 주 화자가 카메라 너머 시청자에게 경험과 정보를 들려주는 실제 구어체다. 제작 설명문이나 등장인물끼리 주고받는 드라마 대본이 아니다. 마지막 CTA를 제외한 구간의 절반 이상에 자연스러운 narration을 쓴다.
- caption은 말의 핵심을 짧게 보완하는 화면 문구다. narration을 그대로 복사하거나 모든 정보를 자막으로 압축하지 않는다.
- 아버지·배우자·친구 같은 주변 인물은 주 화자가 관찰하고 소개하는 대상이다. ‘아버지:’, ‘딸:’처럼 화자 라벨을 붙여 번갈아 말하게 하지 않는다.
- 팀장·사장·직원처럼 업무 관계의 문답 자체가 후킹이면 전체 대본에서 짧은 인용 대사 1~2회만 허용한다. 그 직후부터는 다시 한 명의 주 화자가 시청자에게 경위와 상품 근거를 설명한다. caption에는 어떤 경우에도 화자 라벨을 쓰지 않는다.
- 좋은 흐름: ‘아니 여러분, 명절마다 고깃값 비교에 신나시는 저희 아버지가 발견한 곳인데요’ → ‘도매가라길래 속는 셈 치고 구워봤거든요?’ → 굽는 소리와 육즙 근거 → ‘아버지가 왜 여기만 보셨는지 알겠더라고요.’ 예시의 상품·인물은 복사하지 말고 말의 거리감과 전달 방식을 현재 상품에 맞게 바꾼다.
- 실제 후기가 아닌 연출임을 밝혀야 할 때는 sceneDescription의 작은 화면 고지나 productionMemo 수준으로 처리한다. ‘광고용 상황극입니다’ 같은 제작 고지를 narration이나 caption으로 읽지 않는다.
- 첫 narration과 caption은 같은 사건을 가리켜야 한다. 첫 화면에서 뒤 장면의 대사를 미리 들려주는 콜드 오픈이라면 caption이 그 대사의 상황을 즉시 이해시켜야 한다.
- fullScript는 타임코드·괄호 지시·자막 목록 없이 한 명의 화자가 시청자에게 처음부터 끝까지 들려주는 narration 중심의 실제 음성 대본이다. 말이 없는 핵심 장면만 caption 문장을 보충한다.

[자막 분량과 완성도]
- 첫 3초의 두 자막은 공백 제외 5~13자로 쓴다. 짧아도 타깃 호명·상황·반응 중 하나가 완결되어야 한다.
- 3번째부터 마지막 직전까지는 공백 제외 7~${bodyCaptionMax}자로 쓴다. 한 화면에서 한 번에 읽히는 한 문장 또는 자연스러운 문장 파편만 사용한다.
- 마지막 CTA는 약 ${ctaDuration}초 동안 보이며 공백 제외 ${ctaCaptionMax}자 이내로 쓴다. 반드시 확인·구매·예약·신청처럼 시청자가 실행할 행동 동사로 끝낸다.
- 글자 수를 줄이려고 한국어 띄어쓰기를 삭제하지 않는다. ‘마블링 많으면 끝..?’, ‘국내산 설록우 등심’처럼 조사와 단어 사이의 자연스러운 띄어쓰기를 유지한다. 숫자와 단위(250ml, 1kg, 66%)만 붙여 쓴다.
- 조사·연결어에서 자막을 끊는 것은 앞뒤 2~4개 자막을 순서대로 읽었을 때 한 화자의 말로 자연스럽게 완결되는 의도적 연결 체인에서만 허용한다. 연결 체인이 아니라면 화면 하나만 읽어도 뜻이 완결되어야 한다.
- CTA에 ‘확인된 혜택’, ‘검증된 가격’ 같은 내부 검수 표현을 쓰지 않는다. 나쁜 예: ‘확인된 혜택은 66% 지금 확인하세요’. 좋은 예: ‘66% 할인, 지금 확인하세요’, ‘추석 예약 조건을 확인하세요’.
- 자막 전체는 46자를 넘지 않는다. 한 단어짜리 표제, 두세 단어짜리 기획 메모, 주어와 맥락이 없는 라벨은 금지한다.
- 한 화면에는 하나의 생각만 두되, 시청자가 그 자막만 읽어도 누구의 어떤 불편·반응·구매 이유인지 이해할 수 있어야 한다.
- copyVoiceDirection을 대본 전체에 유지하되 직접 호칭·말끝 기호·문장 파편을 정해진 횟수만큼 억지로 반복하지 않는다. 감정 기호 없이도 자연스럽게 이어지는 완성 문장을 우선한다.
- ProductTruth와 상세페이지 정보는 사실 상한선일 뿐 체크리스트가 아니다. 30초 안에 모든 USP·가격·구성·주의사항을 꾸역꾸역 넣지 말고, 핵심 구매 이유 하나와 이를 받치는 사실 두세 개만 선택한다.
- 배송·배송비·무료배송·도서산간·제주 추가비·배송지 안내는 상품 혜택이더라도 자막과 내레이션에 절대 쓰지 않는다.
- ‘담당자:’, ‘제작자:’, ‘정보 부족’, ‘확인부터요’, ‘검증’, ‘도장’, ‘태블릿’, ‘표’, ‘USP’, ‘CTA’처럼 제작자만 이해하는 화자 라벨·기획 용어·장면 소품을 자막으로 쓰지 않는다. 상황극의 ‘진행자:’, ‘친구 A:’ 같은 실제 화자 표기는 narration에서만 허용하고 caption에는 쓰지 않는다. 나머지 제작 정보는 sceneDescription에만 쓴다.
- [상품의 검증된 사실]은 사실값만 가져오는 내부 근거다. unsupportedClaims와 cautionPhrases는 다른 모든 필드보다 우선하며, 다른 필드에 같은 내용이 있어도 확정 사실처럼 쓰지 않는다. ‘상세페이지 구성 표기는’, ‘상세페이지에서 확인된’, ‘확인 결과’, ‘근거상’, ‘~로 보입니다’, ‘~표기에요’처럼 출처를 판독하는 검수 문장은 절대 자막에 쓰지 않는다.
- 확인된 중량·가격·할인 값은 내부 출처를 설명하지 말고 시청자 반응으로 바로 말한다. 나쁜 예: ‘상세페이지 구성 표기는 5KG로 보입니다’, ‘71% 할인 표기에요’. 좋은 방향: ‘5KG라고..? 이건 좀 놀랍죠?’, ‘71% 할인이라니 그냥 지나치기 어렵죠;;’.
- 자막에는 ‘한 사람이 한 점을 집습니다’, ‘카드 뒤에 상품이 있어요’, ‘화면으로 먼저 보이죠’, ‘표면 색이 바뀜’ 같은 촬영 지시·화면 중계를 쓰지 않는다. 해당 장면이 증명하는 맛·품질·가격·반응·구매 이유를 시청자 언어로 쓴다.
- ‘마블링 취향 갈리는 집들’, ‘선물 고르는 집들’처럼 사람을 어색하게 ‘집들’로 부르지 않는다. ‘집마다 마블링 취향 갈리죠?’, ‘추석 선물 고민 중이라면’처럼 자연스럽게 쓴다.
- 나쁜 예: ‘담당자: 확인부터요’, ‘할인? 정보 부족’. 좋은 방향: ‘형님들.. 씻었는데도 이 냄새 남았죠?’, ‘가격 얘긴 빼고 사용감부터 까볼게요ㅎㅎ’. 예시는 말투와 정보량만 참고하고 현재 상품 사실과 타깃에 맞게 새로 쓴다.

‘이 제품의 정체를 확인합니다’, ‘핵심 차이를 살펴봅니다’ 같은 진행자 설명문으로 순화하지 않는다. ㅎㅎ, ..., ..?, ;;는 필수가 아니며 전체 대본에서 감정상 꼭 필요한 곳에만 최대 1~2회 사용한다. 상세페이지 문장을 잘라 붙이지 않고 같은 문장과 상품명을 반복하지 않는다. 마지막 행의 caption에는 기획안의 CTA 문구를 정확히 포함한다.

첫 3초에는 인물의 즉각적인 반응, 상품의 가장 먹고 싶거나 써 보고 싶은 순간, 또는 선택 기획안의 갈등 중 하나를 강하게 보여준다. 6초 전에는 그 반응의 이유가 되는 다른 피사체나 행동으로 전환한다. ${hasVerifiedVideoBenefit(input.analysis) ? "가격·할인·구성은 기획안의 중심 사건이 가격일 때만 초반 근거로 쓰고, 그 외에는 욕구와 이유가 먼저 납득된 뒤 최대 두 구간에서만 보조 근거로 쓴다. 가격·중량·할인을 서로 이어 붙인 정보 카드 장면은 금지한다." : "확인된 판매 혜택이 없으므로 가격·할인·구성을 창작하지 않고 상품 사용 장면을 초반부터 보여준다."}

식품이라면 ‘맛있다’라는 결론만 말하지 않는다. 굽는 소리, 표면의 자연스러운 윤기와 육즙, 실제 부위에 맞는 잘리는 결, 밥이나 다음 한입을 찾는 생활 반응처럼 카메라로 확인 가능한 이유와 맥락을 먼저 만든다. 가족·친구의 반응은 구체적인 습관과 관계에서 나오는 짧은 광고용 생활 연출로 쓰고 실제 후기처럼 꾸미지 않는다. 주 화자·원물·포장·조리·먹는 반응·상품 정보를 레퍼런스의 정확한 진행 순서에 맞춰 필요한 만큼 교차한다. 배송 정보는 어떤 경우에도 사용하지 않는다. 원문 자막과 특정 인물·장면은 복제하지 않는다.

각 sceneDescription은 70~420자로, 촬영팀이 실행할 수 있을 만큼 구체적이되 체크리스트 문구를 반복하지 않는다. 장소와 주체, 이 구간에서 이야기가 바뀌는 한 가지 행동, 카메라가 먼저 잡는 시각 요소, 다음 구간으로 넘기는 전환을 자연스러운 2~3문장으로 쓴다. 사람이 없는 제품 B-roll은 표면 변화·윤기·색감·거품·수증기·질감처럼 카메라로 확인할 수 있는 반응을 쓴다. '고객의 문제 상황을 보여준다', 'USP를 클로즈업한다', '근거를 제시한다' 같은 추상 문장은 금지한다.

검증된 사실에 없는 숫자·효능·원산지·후기·성과는 쓰지 않는다. 이미지, 이미지 프롬프트, 이미지 생성, visualBible, productLockedAsset은 만들지 않는다. ${input.correction || ""} JSON만 반환한다.`;
}

async function requestDetailedRows(input: {
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  concept: VideoConcept;
  duration: VideoDuration;
  correction?: string;
  referenceAnalyses?: ReferenceVideoAnalysis[];
  revisionFeedback?: string;
}) {
  return runVideoPlanningAi<{ rows: AiScriptRow[]; fullScript: string }>({
    stage: input.correction ? "automatic-revision" : "detailed-script",
    purpose: input.correction ? "correction" : "script",
    outputSchema: scriptSchema(input.duration) as unknown as Record<string, unknown>,
    prompt: detailedPrompt(input),
  });
}

export async function generateDetailedVideoScriptAi(input: {
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  concept: VideoConcept;
  duration: VideoDuration;
  referenceAnalyses?: ReferenceVideoAnalysis[];
  revisionFeedback?: string;
}) {
  const premiseIssue = currentVideoCreativePremiseIssue(input.concept);
  if (premiseIssue) {
    throw new VideoPlanningGenerationError({
      stage: "schema-validation",
      code: "OUTDATED_VIDEO_CONCEPT",
      message: `구버전·일반화 기획안으로는 상세 자막과 장면을 생성하지 않습니다. 최신 기획안 4안을 다시 생성해 주세요. ${premiseIssue}`,
      retryable: false,
      attempts: 0,
      failedAt: new Date().toISOString(),
    });
  }
  const genreMatchedSelection = !input.concept.blueprintSelection?.primaryId && input.concept.conceptArchetype
    ? selectVideoPlanningBlueprints({ analysis: input.analysis, archetypes: [input.concept.conceptArchetype], parodyGenre: input.concept.parodyGenre })[input.concept.conceptArchetype]
    : undefined;
  const generationInput = { ...input, concept: genreMatchedSelection ? { ...input.concept, blueprintSelection: genreMatchedSelection } : input.concept };
  const toValidatedConcept = (
    payload: { rows: AiScriptRow[]; fullScript: string },
    previous: VideoConcept,
    revised: boolean
  ) => {
    const cuts = rowsToCuts(payload.rows, generationInput.duration, previous.cuts, previous);
    let concept: VideoConcept = {
      ...previous,
      cuts,
      fullScript: cuts
        .map((cut) => clean(cut.narration, 320) || clean(cut.caption, 80))
        .filter(Boolean)
        .join(" "),
      detailStatus: "ready",
      generationFailure: undefined,
      revision: previous.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    concept = repairDetailedPlanningSceneDescriptions(concept, generationInput.analysis);
    concept = sanitizeGeneratedConceptCopy(concept, generationInput.guideline.forbiddenPhrases);
    concept = repairDetailedPlanningAudienceCopy(concept);
    // 최초 응답의 반복은 구간 번호가 포함된 품질 피드백으로 AI가 문맥에 맞게
    // 고치게 합니다. 한 번의 교정 뒤에도 남은 경우에만 결정적 안전 보정을 씁니다.
    if (revised) concept = repairDetailedPlanningCommercialRestraint(concept, generationInput.analysis);
    concept = repairDetailedPlanningOpeningHook(concept);
    concept = repairDetailedPlanningCta(concept);
    concept.validation = {
      ...validateDetailedPlanning(concept, generationInput.analysis, generationInput.duration),
      revised,
    };
    return concept;
  };
  const result = await runWithSingleVideoPlanningCorrection({
    requestInitial: async () =>
      toValidatedConcept(await requestDetailedRows(generationInput), generationInput.concept, false),
    isValid: (concept) => concept.validation?.valid === true,
    requestCorrection: async (concept) => {
      const failures =
        concept.validation?.checks.filter((check) => !check.passed).map((check) => check.message) ||
        [];
      const payload = await requestDetailedRows({
        ...generationInput,
        concept,
        correction: `자동 검수에서 다음 문제가 발견됐다. 다른 항목은 유지하고 문제를 모두 수정해 전체 대본을 다시 반환한다: ${failures.join(" / ")}`,
        referenceAnalyses: generationInput.referenceAnalyses,
      });
      return toValidatedConcept(payload, concept, true);
    },
  });
  const concept = result.value;
  const validation = concept.validation!;
  if (!validation.valid) {
    throw new VideoPlanningGenerationError({
      stage: "quality-review",
      code: "SCRIPT_QUALITY_FAILED",
      message: validation.checks
        .filter((check) => !check.passed)
        .map((check) => check.message)
        .join(" "),
      retryable: true,
      attempts: 2,
      failedAt: new Date().toISOString(),
    });
  }
  return concept;
}

export async function regeneratePlanningSegmentAi(input: {
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  concept: VideoConcept;
  cutId: string;
  field: "caption" | "sceneDescription";
  duration: VideoDuration;
}) {
  const premiseIssue = currentVideoCreativePremiseIssue(input.concept);
  if (premiseIssue) {
    throw new VideoPlanningGenerationError({
      stage: "schema-validation",
      code: "OUTDATED_VIDEO_CONCEPT",
      message: `구버전·일반화 기획안의 일부만 재생성하지 않습니다. 최신 기획안 4안을 다시 생성해 주세요. ${premiseIssue}`,
      retryable: false,
      attempts: 0,
      failedAt: new Date().toISOString(),
    });
  }
  const index = input.concept.cuts.findIndex((cut) => cut.id === input.cutId);
  if (index < 0) throw new Error("다시 생성할 구간을 찾지 못했습니다.");
  const current = input.concept.cuts[index];
  const neighbor = {
    previous: input.concept.cuts[index - 1]
      ? {
          caption: input.concept.cuts[index - 1].caption,
          scene: input.concept.cuts[index - 1].sceneDescription,
        }
      : null,
    current: { caption: current.caption, scene: current.sceneDescription },
    next: input.concept.cuts[index + 1]
      ? {
          caption: input.concept.cuts[index + 1].caption,
          scene: input.concept.cuts[index + 1].sceneDescription,
        }
      : null,
  };
  const fieldSchema =
    input.field === "caption"
      ? {
          type: "object",
          additionalProperties: false,
          required: ["caption"],
          properties: { caption: { type: "string", minLength: 4, maxLength: 46 } },
        }
      : {
          type: "object",
          additionalProperties: false,
          required: ["sceneDescription"],
          properties: { sceneDescription: { type: "string", minLength: 80, maxLength: 700 } },
        };
  const segmentDuration = Math.max(0.5, current.endSecond - current.startSecond);
  const readableCaptionMax = Math.max(current.startSecond < 3 ? 5 : 7, Math.min(current.startSecond < 3 ? 11 : 24, Math.floor(segmentDuration * (current.startSecond < 3 ? 11 : 10.5))));
  const result = await runVideoPlanningAi<{ caption?: string; sceneDescription?: string }>({
    stage: "detailed-script",
    purpose: "segment",
    reasoningEffort: "low",
    outputSchema: fieldSchema,
    prompt: `아래 영상 대본에서 ${index + 1}번째 구간의 ${input.field === "caption" ? "자막" : "영상 장면 설명"}만 다시 쓴다. 다른 행은 바꾸지 않는다. 상품 근거에 없는 수치나 효능을 쓰지 않고 앞뒤 흐름을 자연스럽게 잇는다. 자막이라면 기획안의 말투 방향과 타깃 호명을 유지하되 인터넷 말투를 억지로 흉내 내지 않는다. 이 구간은 ${segmentDuration.toFixed(1)}초이므로 공백 제외 ${readableCaptionMax}자 이내의 완결된 시청자용 구어체로 쓴다. 글자 수를 줄이려고 한국어 띄어쓰기를 삭제하지 않고, ‘~될 수’, ‘~하면’, ‘~인데’처럼 연결어에서 문장을 끊지 않는다. 마지막 CTA라면 확인·구매·예약처럼 실행할 행동 동사로 끝내며 ‘확인된 혜택’, ‘검증된 가격’ 같은 내부 검수 표현을 쓰지 않는다. ‘한 사람이 집습니다’, ‘화면으로 보입니다’, ‘표면 색이 바뀜’ 같은 촬영 지시·화면 중계는 sceneDescription에만 쓰고 자막에는 구매 이유·증거·반응을 쓴다. ‘담당자:’, ‘제작자:’, ‘정보 부족’, ‘확인부터요’, ‘검증’, ‘도장’, ‘태블릿’, ‘표’, ‘USP’, ‘CTA’ 같은 내부 화자 라벨·기획 용어·장면 소품은 자막으로 쓰지 않는다. 상황극의 ‘진행자:’, ‘친구 A:’ 같은 화자 표기는 narration에서만 허용한다. ProductTruth와 상세페이지는 사실 확인용 내부 근거일 뿐이고 unsupportedClaims와 cautionPhrases가 다른 필드보다 우선한다. 배송·배송비·무료배송·도서산간·제주 추가비·배송지 안내는 자막과 내레이션에서 완전히 제외한다. ‘상세페이지 구성 표기는’, ‘확인된 표기’, ‘확인 결과’, ‘근거상’, ‘~로 보입니다’, ‘~표기에요’ 같은 검수 문장을 자막에 쓰지 말고, 확인된 사실값을 시청자 반응형 문장으로 바로 표현한다. ${internetVoiceRules(input.analysis.category)} 장면 설명이라면 구체적인 장소·배경·인물/상품·행동·표정·첫 시각 요소·자막과 연결되는 사건·다음 변화/전환을 80자 이상으로 모두 포함한다. 수정하는 한 구간도 distinctiveCharacter·socialWorld·storyTrigger의 동일한 이야기 안에 있어야 하며 truthBridge와 dramatizationBoundary를 훼손하지 않는다. JSON만 반환한다.\n상품=${JSON.stringify(promptFacts(input.analysis))}\n기획안=${JSON.stringify({ title: input.concept.title, hook: input.concept.openingHook, cta: input.concept.cta, copyVoiceDirection: input.concept.copyVoiceDirection, targetCallout: input.concept.targetCallout, distinctiveCharacter: input.concept.distinctiveCharacter, socialWorld: input.concept.socialWorld, storyTrigger: input.concept.storyTrigger, truthBridge: input.concept.truthBridge, dramatizationBoundary: input.concept.dramatizationBoundary })}\n앞뒤=${JSON.stringify(neighbor)}`,
  });
  const cuts = input.concept.cuts.map((cut) =>
    cut.id === input.cutId
      ? {
          ...cut,
          ...(input.field === "caption"
            ? { caption: clean(result.caption, 80) }
            : { sceneDescription: clean(result.sceneDescription, 1000) }),
        }
      : cut
  );
  let concept: VideoConcept = {
    ...input.concept,
    cuts,
    fullScript: cuts.map((cut) => cut.narration || cut.caption).join(" "),
    revision: input.concept.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  concept = repairDetailedPlanningSceneDescriptions(concept, input.analysis);
  concept = sanitizeGeneratedConceptCopy(concept, input.guideline.forbiddenPhrases);
  concept = repairDetailedPlanningAudienceCopy(concept);
  concept = repairDetailedPlanningCommercialRestraint(concept, input.analysis);
  concept = repairDetailedPlanningOpeningHook(concept);
  concept = repairDetailedPlanningCta(concept);
  concept.validation = validateDetailedPlanning(concept, input.analysis, input.duration);
  return concept;
}


