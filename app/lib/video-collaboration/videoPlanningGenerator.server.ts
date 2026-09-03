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

const hookTypes = [...VIDEO_HOOK_TYPES];
const hookTypeSchema = { type: "string", enum: hookTypes } as const;

function clean(value: unknown, max = 1200) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function compact(values: unknown[], limit = 12, max = 240) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const item = clean(value, max);
    const key = item.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
    if (!item || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

const DELIVERY_DETAIL_PATTERN = /(?:무료\s*)?배송(?:비|료|조건|지|지역|일정|기간|안내|가능|불가|추가|제외|문의)?|(?:제주|도서\s*산간|산간\s*지역).*(?:추가|비용|요금|배송)|(?:택배|착불)\s*(?:비|비용|요금|안내)/i;

function withoutDeliveryDetails(values: unknown[]) {
  return values.map((value) => cleanPlanningSource(value, 1000)).filter(Boolean);
}

function cleanPlanningSource(value: unknown, max = 1200) {
  const sanitized = String(value || "")
    .replace(/(?:무료\s*)?배송(?:비|료|조건|지|지역|일정|기간|안내|가능|불가|추가|제외|문의)?/gi, " ")
    .replace(/(?:제주|도서\s*산간|산간\s*지역)[^.!?\n]*(?:추가|비용|요금)[^.!?\n]*/gi, " ")
    .replace(/(?:택배|착불)\s*(?:비|비용|요금|안내)/gi, " ");
  const parts = sanitized
    .split(/(?:\r?\n)+|(?<=[.!?])\s+|[·|]/)
    .filter((part) => !DELIVERY_DETAIL_PATTERN.test(part));
  return clean(parts.join(" "), max);
}

function promptFacts(analysis: ProductAnalysisSnapshot) {
  return {
    productName: analysis.productName,
    brandName: analysis.brandName,
    category: analysis.category,
    price: analysis.price,
    promotion: cleanPlanningSource(analysis.promotion || analysis.discountInfo, 240),
    volumeOrOption: analysis.volumeOrOption || "",
    composition: compact(withoutDeliveryDetails(analysis.composition || []), 8),
    minimumOrderQuantity: analysis.minimumOrderQuantity || "",
    origin: analysis.countryOfOrigin || "",
    ingredients: compact(withoutDeliveryDetails(analysis.ingredients || []), 8),
    manufacturingProcess: compact(withoutDeliveryDetails(analysis.manufacturingProcess || []), 8),
    certifications: compact(withoutDeliveryDetails(analysis.certifications || []), 6),
    actualBenefits: compact(withoutDeliveryDetails(analysis.actualBenefits || []), 8),
    verifiedBenefits: compact(withoutDeliveryDetails(analysis.coreUsps), 8),
    productFeatures: compact(withoutDeliveryDetails(analysis.keyFeatures), 10),
    customerProblems: compact(withoutDeliveryDetails(analysis.customerProblems), 6),
    targetSituations: compact(withoutDeliveryDetails(analysis.useSituations || []), 6),
    targetCustomers: compact(withoutDeliveryDetails(analysis.targetCustomers), 6),
    expectedChanges: compact(withoutDeliveryDetails(analysis.expectedChanges || []), 6),
    reviews: compact(withoutDeliveryDetails(analysis.repeatedReviewPhrases || analysis.trustSignals), 6),
    differentiators: compact(withoutDeliveryDetails(analysis.differentiators || []), 6),
    visualizableElements: compact(withoutDeliveryDetails(analysis.visualizableElements || []), 8),
    verifiedNumbers: compact(withoutDeliveryDetails(analysis.verifiedNumbers || []), 12),
    verifiedFacts: (analysis.verifiedFacts || []).map((fact) => ({
      id: fact.id,
      label: fact.label,
      value: cleanPlanningSource(fact.value, 400),
      source: fact.source,
    })).filter((fact) => fact.value && !DELIVERY_DETAIL_PATTERN.test(fact.label)).slice(0, 24),
    inferredAngles: (analysis.inferredAngles || []).map((fact) => ({
      id: fact.id,
      label: fact.label,
      value: cleanPlanningSource(fact.value, 400),
    })).filter((fact) => fact.value && !DELIVERY_DETAIL_PATTERN.test(fact.label)).slice(0, 12),
    unsupportedClaims: (analysis.unsupportedClaims || []).map((fact) => cleanPlanningSource(fact.value, 400)).filter(Boolean).slice(0, 12),
    cautionPhrases: compact(withoutDeliveryDetails(analysis.cautionPhrases), 10),
    rawDescription: cleanPlanningSource(analysis.rawDescription, 2400),
  };
}

function stylePrinciples(category: string) {
  if (/육류|축산|고기|식품|먹거리/i.test(category)) {
    return "외식비·실제 먹는 양·조리 과정·육즙과 식감·가족 식사·캠핑·명절 선물·원산지와 부위 중 핵심 두세 가지에 집중한다. ‘고기 사러 마장동까지 가는 분들’, ‘추석 선물 고민 중인 분들’, ‘이 가격이면 더 싸게 안 파나요?’, ‘정육점 가도 이것보다 싼 거 없어요’처럼 사람들이 실제로 하는 시장·명절·장보기 말을 구체적인 생활 맥락과 화자의 반응으로 사용할 수 있다. 이런 문장을 추상적인 ‘가성비가 좋아요’로 순화하거나 일반화하지 않는다. 다만 ‘전국 최저가 보장’ 같은 인증형 문구나 특정 경쟁점의 확인되지 않은 가격 수치는 만들지 않고 배송·배송비 이야기는 넣지 않는다.";
  }
  if (/뷰티|바디|샤워|화장|생활/i.test(category)) {
    return "사용 전 불편·운동이나 외출 뒤 샤워·향과 질감과 쿨링 같은 감각·원료와 확인된 수치·사용 후 체감·후기·브랜드 배경을 구체적인 일상 장면으로 만든다.";
  }
  if (/농산|과일|채소|수산/i.test(category)) {
    return "산지·생산자·수확·크기와 양·신선도·일반 상품과 차이·실제 요리와 식사 중 확인된 사실을 장면화한다.";
  }
  if (/패션|의류|신발|가방/i.test(category)) {
    return "체형과 핏·착용 전후·소재·움직이는 실루엣·출근과 여행 등 상황·코디·디테일을 장면화한다.";
  }
  return "상품의 실제 사용 장소와 고객 행동을 중심으로 카테고리에 맞는 구체적인 장면을 만든다.";
}

function internetVoiceRules(category: string) {
  const categoryExamples = /육류|축산|고기|식품|먹거리|과일|채소|농산|수산|음료/i.test(
    category
  )
    ? "예: ‘추석 선물 고민 중인 분들, 잠깐’, ‘고기 사러 마장동까지 가는 분들’, ‘정육점 가도 이것보다 싼 거 없어요’, ‘아, 이거 진짜 더 싸게 안 팔 거예요?’처럼 식탁·장보기·시장·명절·가격 상황에 구체적으로 붙인다. 생활 비교를 막연한 ‘합리적인 가격’으로 일반화하지 말고 실제 사람이 하는 반응형 문장으로 쓴다."
    : /뷰티|바디|샤워|화장|세정|생활/i.test(category)
      ? "예: ‘땀 줄줄 흐르는 형님들 잠깐;;’, ‘운동 끝나면 겨냄새부터 신경 쓰이는 분들..?’처럼 타깃의 실제 행동·불편을 직접 부른다."
      : /패션|의류|신발|가방|주얼리/i.test(category)
        ? "예: ‘나만 핏 왜 이럼..?’ ‘이 조합 은근 반칙인데ㅎㅎ’처럼 착용·핏·코디 상황에 붙인다."
        : "예: ‘이거 나만 이제 알았나..?’ ‘잠깐;; 이게 된다고?’처럼 실제 사용 상황에 붙인다.";
  return `레퍼런스의 말맛은 살리되 인터넷 유행어를 억지로 흉내 내지 않는다. 타깃을 ‘20~40대 고객’처럼 인구통계로 부르지 말고, 상품과 맞닿은 실제 행동·고민·욕망으로 자연스럽게 부른다. ㅎㅎ, ..., ..?, ;; 같은 기호는 필수가 아니며 전체 대본에서 감정상 꼭 필요한 곳에만 최대 1~2회 사용한다. 매초 놀라는 척하거나 모든 문장을 파편으로 끊지 말고, 실제 사람이 친구에게 추천하거나 혼잣말하는 흐름으로 이어 쓴다. ${categoryExamples} 가격·중량·할인 같은 상품 사실은 정확히 유지하되 시장 방문, 정육점 장보기, 명절 준비, 가족 식사처럼 사회에서 통용되는 생활 맥락은 자연스럽게 창작할 수 있다. ‘정육점 가도 이것보다 싼 거 없어요’ 같은 생활 비교는 화자의 반응으로 허용하되 ‘전국 최저가 보장’, 특정 경쟁점 가격표, 판매 1위처럼 검증이 필요한 인증·수치 비교는 만들지 않는다. 배송·배송비·도서산간·배송지 안내는 자막과 내레이션에서 완전히 제외한다. targetCallout은 첫 3초 자막에 바로 쓸 수 있는 8~28자의 자연스러운 한 문장으로 만든다. 예시는 말투만 참고하며 상품 근거에 없는 수치·체형·효능은 만들지 않고, 실존 인물 비하나 보호 특성에 대한 혐오 표현은 쓰지 않는다.`;
}

const PRODUCT_SELF_INTRODUCTION_RULES = `상품 자기소개형(‘나 ~인데’)은 단순 말투가 아니라 다음 이야기 문법을 사용한다.
1) ‘나 [짧고 정확한 상품 정체]인데!’로 상품 또는 상품 캐릭터가 1인칭 자기소개한다.
2) ‘그냥 흔한 [상품] 아니고’처럼 소비자의 흔한 오해·낮은 기대를 부정한다.
3) verifiedFacts에 있는 숫자·원료·공정·구성 중 가장 강한 한 가지를 정보 보상으로 공개한다.
4) ‘근데 나를 [한정된 상황]에만 찾는 거야?’처럼 쓰임을 좁게 보는 오해가 실제로 있을 때만 반문한다.
5) 서로 다른 실제 사용 상황 두 가지 이하를 행동 장면으로 확장하고 상품이 ‘이럴 때 나 써야지’처럼 직접 해결사로 말한다.
6) 감각 결과 또는 선택 이유를 회수하고, 확인된 가격·구성·증정이 있을 때만 혜택 CTA로 닫는다.
상품명이 길면 브랜드·수량·프로모션을 덜어낸 자연스러운 정체명으로 말한다. 같은 ‘나’를 매 자막에 반복하지 않고, 제품의 1인칭 시점을 끝까지 유지한다. ‘링크 여기에서 공개할게’, ‘장면 전환’, ‘연출 이미지’ 같은 메타·제작 문구는 광고 자막에 쓰지 않는다.`;

const SPECIFIC_CREATIVE_WORLD_RULES = `상세페이지는 상품 사실의 상한선이고, 레퍼런스 원문은 광고의 말 흐름·인물 관계·사건·장면 진행을 만드는 창작 기준이다. 인물과 세계는 상세페이지에 없어도 자유롭게 상상하되 상품에 관한 객관 사실과 섞지 않는다.
1) distinctiveCharacter에는 이름·가족/지인 관계·직업·지역·습관·경력·말버릇 중 최소 두 가지를 결합한다. ‘일반 사용자’, ‘한 고객’, ‘20~40대 여성’, ‘가족’만으로 끝내지 않는다.
2) socialWorld에는 현재의 생활 장소뿐 아니라 과거·미래·가상 사회를 사용할 수 있다. 출근 전 냉장고 앞, 새벽시장, 왕실 수라간, 미래 식품 심사장처럼 선택 장르의 화면이 바로 떠오르게 쓴다. 실존 작품·캐릭터·사건은 복제하지 않는다.
3) storyTrigger에는 그 인물과 세계에서만 벌어질 한 가지 행동·갈등·실수·발견·내기·심문·협상을 만든다. 상품 설명을 듣거나 USP를 확인하는 것 자체를 사건이라고 부르지 않는다.
4) truthBridge에는 창작 사건이 verifiedFacts의 어떤 두세 가지 가격·구성·품질·원료·공정 사실 때문에 해결·반전되는지 적는다. 인물의 반응과 상품 사실을 같은 사실처럼 섞지 않는다.
5) dramatizationBoundary에는 인물·관계·직업·시대·사건 중 무엇이 광고용 창작이고 어떤 상품 정보가 검증된 사실인지 명시한다. 이 문장은 내부 제작 정보이며 광고 자막으로 읽지 않는다.
6) 가상의 의사 남편·아내·친구·가족이 개인적 취향이나 사용 경험으로 상품을 추천하는 설정은 허용한다. dramatizationBoundary와 sceneDescription의 작은 화면 고지에 가상 인물임을 명시한다. 의사라는 직업을 질병·치료·효능·안전성·성분 보증의 근거로 사용하지 않는다.
7) 네 기획안은 인물·관계·시대 또는 장소·갈등·상품 등장 방식·증거 공개 순서·결말이 달라야 한다. 같은 상품의 필수 조리·사용 근거는 필요한 만큼 공유할 수 있다.
8) 창작 가능: 가상의 가족·지인·직업·지역·역사·미래·판타지·법정·뉴스·오디션·퀴즈쇼·경매·탐정극·상품 의인화·코믹한 대사. 창작 금지: 실제 고객 후기 사칭, 실존 인물·전문가·기관의 허위 보증, 질병·치료 설정, 확인되지 않은 숫자·판매성과·순위·효능.
좋은 구체성: ‘25년째 성분표부터 보는 가상의 의사 남편이 샤워젤을 먼저 챙긴 저녁’, ‘조선 수라간 감별관이 선물 상자의 구성을 심문하는 가상 청문회’. 나쁜 구체성: ‘전문가가 추천한 상품’, ‘가족 고객’. 예시는 복사하지 말고 선택된 레퍼런스와 현재 상품에 맞게 새로 만든다.`;

const NATURAL_REFERENCE_DIALOGUE_RULES = `레퍼런스처럼 자연스러운 광고 구어체를 만드는 규칙:
1) 대본 전체를 카메라 너머 시청자에게 말을 거는 한 명의 주 화자와 한 가지 실제 사건으로 연결한다. 등장인물끼리 연기하는 대사극이나 서로 무관한 후킹 문구·USP 표제·가격 문장의 나열로 만들지 않는다.
2) 첫 3초는 ‘아니 여러분..’, ‘근데 이거’, ‘저희 아버지가요’처럼 실제 사람이 이야기를 꺼내는 자연스러운 말과 가까운 사람의 수상한 행동·발견·실수·화자의 즉각적인 반응으로 시작할 수 있다. 같은 호칭을 반복하거나 억지 감탄으로 모든 문장을 시작하지 않는다.
3) ‘그랬더니’, ‘갑자기’, ‘이거’, ‘그래서’ 같은 지시어와 연결어를 자연스럽게 써서 앞 장면의 행동이 다음 말의 원인이 되게 한다. 지시 대상이 없는 ‘이거’와 맥락 없는 감탄은 금지한다.
4) 짧은 자막 2~4개를 이어 한 문장을 만들 수 있다. 예: ‘팬에 올리면’ → ‘치익 소리부터’ → ‘온 집안이 난리예요’. 단, 연속해서 읽으면 문법과 의미가 완결되어야 하고 마지막 조각을 빠뜨리면 안 된다.
5) 감각이나 효익을 말한 바로 그 장면에서 소리·표면·단면·거품·손동작·표정처럼 카메라로 확인 가능한 증거를 보여준다. ‘맛있어요’, ‘좋아요’, ‘특별해요’만 단독으로 쓰지 않는다.
6) 가격·중량·원료 수치는 욕구가 생긴 뒤 의심을 푸는 보상으로만 최대 두 구간에 둔다. 이야기를 시작하자마자 상품명·가격·구성을 연달아 읽지 않는다.
7) 마지막에는 첫 인물의 습관이나 첫 사건을 다시 불러온 뒤 화자가 시청자에게 자연스럽게 권하는 구매 행동으로 닫는다. ‘지금 만나보세요’, ‘특별한 선택’, ‘일상의 변화’ 같은 어느 상품에도 붙는 CTA는 금지한다.
8) 레퍼런스의 원문, 인물, 상품, 허위 후기, 의료·건강 효능은 복사하지 않는다. 자연스러운 말의 연결 방식만 가져오고 사실은 현재 ProductTruth로 제한한다.`;

const FOUR_CONCEPT_STORY_MECHANISM_RULES = `네 콘셉트는 같은 상품을 서로 다른 이야기 작동 방식으로 보여준다. 내부 conceptArchetype 코드는 과거 저장 데이터 호환용이며 아래 의미가 최신 기준이다.
1) parody = 창작 인물·상황극형: 서버가 자동 선택한 역사·미래·가족·직장·법정·뉴스·오디션·퀴즈·경매·탐정·비교 같은 장르 하나를 끝까지 유지한다. 인물과 사건은 과감하게 창작하되 상품 사실은 ProductTruth로 제한한다.
2) real-review = 가족·지인 생활 반응형: 아버지·배우자·아이·친구의 평소 습관과 이번 한마디를 주 화자가 제보하듯 전한다. 긴 가족 대화나 실제 후기 사칭은 쓰지 않는다.
3) usp-focus = 직접 확인·조리·사용형: 포장 개봉, 구성 확인, 팬 조리, 절단, 한입, 제형과 손동작처럼 카메라로 확인할 수 있는 순서로 차이를 보여준다. 거창한 실험실·심사·대결을 자동 생성하지 않는다.
4) secret-benefit = 구매 고민·가격 발견형: 외식비, 선물 가격, 판매 단위, 구성처럼 실제 구매 장벽을 먼저 말하고 확인된 가격·구성·품질 근거로 망설임을 푼다. 확인된 혜택이 없으면 할인·품절·비밀 링크를 만들지 않는다.
가상의 의사 가족 추천은 parody 또는 real-review에서 사용할 수 있지만 의학적 효능·치료·보증으로 확장하지 않는다. 네 안의 인물·첫 사건·증거 공개 순서는 서로 다르게 하되 레퍼런스처럼 같은 조리·사용 근거 본문은 필요한 만큼 공유할 수 있다. 원문 장면의 역할과 말 연결을 살리고 범용 훅→USP→CTA 표제로 다시 요약하지 않는다.`;

function referenceVoiceSignals(referenceAnalyses: ReferenceVideoAnalysis[] = []) {
  return referenceAnalyses
    .filter((item) => item.analysisStatus === "analyzed")
    .map((item) => ({
      opening: item.openingHookMethod,
      timing: item.timingMap,
      pace: item.averageCutLength,
      emotionalTone: item.emotionalTone,
      informationDensity: item.informationDensity,
      principles: item.reusablePrinciples,
    }));
}

type AiReferenceAnalysis = Omit<
  ReferenceVideoAnalysis,
  "analysisStatus" | "cutCount" | "averageCutLength"
> & {
  analysisStatus: "analyzed" | "limited";
  cutCount: number;
  averageCutLength: number;
};

const referenceAnalysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["analyses"],
  properties: {
    analyses: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "assetId",
          "assetName",
          "analysisStatus",
          "openingHookMethod",
          "openingTiming",
          "cutCount",
          "averageCutLength",
          "cameraAndGaze",
          "actions",
          "informationDensity",
          "subtitlePosition",
          "transitions",
          "timingMap",
          "compositionRatio",
          "emotionalTone",
          "reusablePrinciples",
          "limitations",
        ],
        properties: {
          assetId: { type: "string" },
          assetName: { type: "string" },
          analysisStatus: { type: "string", enum: ["analyzed", "limited"] },
          openingHookMethod: { type: "string", minLength: 4, maxLength: 240 },
          openingTiming: { type: "string", minLength: 2, maxLength: 80 },
          cutCount: { type: "integer", minimum: 0, maximum: 500 },
          averageCutLength: { type: "number", minimum: 0, maximum: 120 },
          cameraAndGaze: { type: "array", maxItems: 10, items: { type: "string" } },
          actions: { type: "array", maxItems: 12, items: { type: "string" } },
          informationDensity: { type: "string", maxLength: 240 },
          subtitlePosition: { type: "string", maxLength: 200 },
          transitions: { type: "array", maxItems: 10, items: { type: "string" } },
          timingMap: {
            type: "object",
            additionalProperties: false,
            required: ["problem", "product", "usp", "cta"],
            properties: {
              problem: { type: "string" },
              product: { type: "string" },
              usp: { type: "string" },
              cta: { type: "string" },
            },
          },
          compositionRatio: {
            type: "object",
            additionalProperties: false,
            required: ["liveAction", "animation", "composite"],
            properties: {
              liveAction: { type: "integer", minimum: 0, maximum: 100 },
              animation: { type: "integer", minimum: 0, maximum: 100 },
              composite: { type: "integer", minimum: 0, maximum: 100 },
            },
          },
          emotionalTone: { type: "string", maxLength: 200 },
          reusablePrinciples: { type: "array", maxItems: 10, items: { type: "string" } },
          limitations: { type: "array", maxItems: 10, items: { type: "string" } },
        },
      },
    },
  },
} as const;

function localReferencePath(asset: VideoReferenceAsset) {
  const referencesRoot = path.resolve(process.cwd(), "public", "video-collaboration", "references");
  const relative = asset.filePath.replace(/^\/+/, "");
  const resolved = path.resolve(process.cwd(), "public", relative);
  if (!resolved.startsWith(`${referencesRoot}${path.sep}`) || !existsSync(resolved)) return "";
  return resolved;
}

export async function analyzeVideoReferencesAi(assets: VideoReferenceAsset[]) {
  const provider = getVideoPlanningProvider();
  const mediaAssets = assets
    .filter((asset) => asset.mimeType.startsWith("image/") || (provider === "codex-local" && asset.mimeType.startsWith("video/")))
    .map((asset) => ({ ...asset, localPath: localReferencePath(asset) }))
    .filter((asset) => Boolean(asset.localPath))
    .slice(0, 3);
  const selectedAssetIds = new Set(mediaAssets.map((asset) => asset.id));
  const unavailableAssets: ReferenceVideoAnalysis[] = assets
    .filter((asset) => !selectedAssetIds.has(asset.id))
    .map((asset) => ({
      assetId: asset.id,
      assetName: asset.name,
      analysisStatus: asset.mimeType.startsWith("video/") || asset.mimeType.startsWith("image/") ? "limited" : "not-applicable",
      openingHookMethod: "확인 불가",
      openingTiming: "확인 불가",
      cutCount: null,
      averageCutLength: null,
      cameraAndGaze: [],
      actions: [],
      informationDensity: "확인 불가",
      subtitlePosition: "확인 불가",
      transitions: [],
      timingMap: { problem: "해당 없음", product: "해당 없음", usp: "해당 없음", cta: "해당 없음" },
      compositionRatio: { liveAction: null, animation: null, composite: null },
      emotionalTone: "확인 불가",
      reusablePrinciples: [],
      limitations: [
        provider === "openai-api" && asset.mimeType.startsWith("video/")
          ? "현재 Responses API 영상 기획 경로는 정지 이미지 레퍼런스만 직접 판독합니다."
          : "참고 자료 파일을 읽지 못했거나 지원하지 않는 형식입니다.",
      ],
    }));
  if (!mediaAssets.length) return unavailableAssets;

  try {
    const payload = await runVideoPlanningAi<{ analyses: AiReferenceAnalysis[] }>({
      stage: "reference-analysis",
      purpose: "analysis",
      outputSchema: referenceAnalysisSchema as unknown as Record<string, unknown>,
      timeoutMs: Number(process.env.VIDEO_PLANNING_ANALYSIS_TIMEOUT_MS || 45_000),
      imageDataUrls:
        provider === "openai-api"
          ? await Promise.all(
              mediaAssets.map(async (asset) =>
                `data:${asset.mimeType};base64,${(await readFile(asset.localPath)).toString("base64")}`
              )
            )
          : undefined,
      prompt: `당신은 숏폼 퍼포먼스 광고 편집 분석가다. ${provider === "openai-api" ? "첨부된 정지 광고 이미지를 직접 확인한다." : "아래 로컬 참고 영상 또는 정지 광고 이미지를 읽기 전용 도구로 직접 확인한다."} 확인하지 못한 값은 추측하지 않는다. 새 이미지나 영상을 생성하지 않으며 원본 파일을 수정하지 않는다.

[참고 자료]
${JSON.stringify(mediaAssets.map((asset) => ({ assetId: asset.id, assetName: asset.name, mimeType: asset.mimeType, ...(provider === "codex-local" ? { localPath: asset.localPath } : {}) })))}

영상은 첫 장면 후킹, 컷 속도, 자막 길이, 문제·상품·USP·CTA 시점, 인물 말투와 시각 변화를 분석한다. 정지 광고 이미지는 cutCount=1, averageCutLength=0으로 두고 openingTiming에는 ‘첫 화면’을 쓴다. 이미지 안에서 실제로 읽히는 헤드라인·가격·보조 문구, 가장 먼저 보이는 피사체, 상품의 식감·사용 욕구 또는 사람의 반응을 어떻게 후킹으로 만든 것인지, 가격이 주인공인지 보조 근거인지를 분석한다. 이미지에 없는 움직임이나 대사를 창작하지 않는다.

emotionalTone에는 단순히 ‘친근함’이라고 일반화하지 말고 반말/존댓말, 직접 호칭, 문장 파편, 머뭇거림, 과장 직전의 직설성 같은 화법을 구체적으로 적는다. reusablePrinciples에는 원문 전체를 복제하지 않는 범위에서 ‘관찰 가능한 맛의 이유 → 한입 반응’, ‘가격은 마지막 확신’처럼 맥락과 욕구가 이어지는 원리를 적는다. 브랜드·인물·완성 문장을 복제하지 않는다. 실제로 확인하지 못한 항목은 추측하지 말고 analysisStatus를 limited로 두고 limitations에 이유를 쓴다. JSON만 반환한다.`,
    });
    const allowed = new Set(mediaAssets.map((asset) => asset.id));
    const analyses = payload.analyses
      .filter((analysis) => allowed.has(analysis.assetId))
      .map((analysis): ReferenceVideoAnalysis => ({
        ...analysis,
        cutCount: analysis.cutCount || null,
        averageCutLength: analysis.averageCutLength || null,
      }));
    const completed = mediaAssets.map(
      (asset) =>
        analyses.find((analysis) => analysis.assetId === asset.id) || {
          assetId: asset.id,
          assetName: asset.name,
          analysisStatus: "limited" as const,
          openingHookMethod: "확인 불가",
          openingTiming: "확인 불가",
          cutCount: null,
          averageCutLength: null,
          cameraAndGaze: [],
          actions: [],
          informationDensity: "확인 불가",
          subtitlePosition: "확인 불가",
          transitions: [],
          timingMap: {
            problem: "확인 불가",
            product: "확인 불가",
            usp: "확인 불가",
            cta: "확인 불가",
          },
          compositionRatio: { liveAction: null, animation: null, composite: null },
          emotionalTone: "확인 불가",
          reusablePrinciples: [],
          limitations: ["참고 자료의 시각 구조를 완전히 확인하지 못했습니다."],
        }
    );
    return [...completed, ...unavailableAssets];
  } catch (error) {
    console.info(
      `[video-planning] stage=reference-analysis event=limited code=${error instanceof VideoPlanningGenerationError ? error.failure.code : "REFERENCE_ANALYSIS_LIMITED"}`
    );
    return [
      ...mediaAssets.map((asset): ReferenceVideoAnalysis => ({
        assetId: asset.id,
        assetName: asset.name,
        analysisStatus: "limited",
        openingHookMethod: "첨부 영상 확인 필요",
        openingTiming: "확인 불가",
        cutCount: null,
        averageCutLength: null,
        cameraAndGaze: [],
        actions: [],
        informationDensity: "확인 불가",
        subtitlePosition: "확인 불가",
        transitions: [],
        timingMap: {
          problem: "확인 불가",
          product: "확인 불가",
          usp: "확인 불가",
          cta: "확인 불가",
        },
        compositionRatio: { liveAction: null, animation: null, composite: null },
        emotionalTone: "확인 불가",
        reusablePrinciples: [],
        limitations: [
          "참고 자료 분석만 제한되었습니다. 상품 근거 기반 4개 콘셉트 생성은 계속할 수 있습니다.",
        ],
      })),
      ...unavailableAssets,
    ];
  }
}

function scoreTotal(score: Omit<HookScore, "total">) {
  return Math.round(
    score.stopPower * 0.16 +
      score.specificity * 0.14 +
      score.productRelevance * 0.15 +
      score.visualPotential * 0.13 +
      score.evidenceStrength * 0.14 +
      score.conversionPotential * 0.13 +
      score.originality * 0.08 +
      score.policySafety * 0.07
  );
}

type AiHook = {
  hookType: VideoHookType;
  hook: string;
  customerProblem: string;
  evidenceIds: string[];
  visualIdea: string;
  scores: Omit<HookScore, "total">;
  rejectionReasons: string[];
};

const hookSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hooks"],
  properties: {
    hooks: {
      type: "array",
      minItems: 10,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "hookType",
          "hook",
          "customerProblem",
          "evidenceIds",
          "visualIdea",
          "scores",
          "rejectionReasons",
        ],
        properties: {
          hookType: hookTypeSchema,
          hook: { type: "string", minLength: 8, maxLength: 70 },
          customerProblem: { type: "string", minLength: 4, maxLength: 100 },
          evidenceIds: { type: "array", maxItems: 4, items: { type: "string" } },
          visualIdea: { type: "string", minLength: 30, maxLength: 260 },
          scores: {
            type: "object",
            additionalProperties: false,
            required: [
              "stopPower",
              "specificity",
              "productRelevance",
              "visualPotential",
              "evidenceStrength",
              "conversionPotential",
              "originality",
              "policySafety",
            ],
            properties: Object.fromEntries(
              [
                "stopPower",
                "specificity",
                "productRelevance",
                "visualPotential",
                "evidenceStrength",
                "conversionPotential",
                "originality",
                "policySafety",
              ].map((key) => [key, { type: "integer", minimum: 0, maximum: 100 }])
            ),
          },
          rejectionReasons: { type: "array", maxItems: 4, items: { type: "string" } },
        },
      },
    },
  },
} as const;

export async function generateVideoHookCandidatesAi(
  analysis: ProductAnalysisSnapshot,
  guideline: BrandGuideline,
  referenceAnalyses: ReferenceVideoAnalysis[] = []
) {
  const allowedEvidenceIds = new Set((analysis.verifiedFacts || []).map((fact) => fact.id));
  const payload = await runVideoPlanningAi<{ hooks: AiHook[] }>({
    stage: "hook-candidates",
    outputSchema: hookSchema as unknown as Record<string, unknown>,
    prompt: `당신은 한국 퍼포먼스 광고의 숏폼 후킹 전략가다. 아래 공개 상품 사실만으로 서로 다른 후킹 후보 10~12개를 만든다.

[상품 사실]
${JSON.stringify(promptFacts(analysis))}

[브랜드 기준]
${JSON.stringify({ tone: guideline.toneAndManner, audience: guideline.primaryAudience, forbidden: guideline.forbiddenPhrases })}

[참고 영상에서 재사용 가능한 구조·속도·자막 리듬]
${JSON.stringify(referenceVoiceSignals(referenceAnalyses))}

[필수 유형]
고객 문제, 가격과 양, 손해 회피, 예상 밖 비교, 원산지와 원물, 사용 전후, 후기와 신뢰, 계절과 상황, 궁금증, 상식 뒤집기, 감각 장면, 실제 사용자 독백을 폭넓게 사용한다. 이와 별도로 product-self-introduction 후보를 최소 1개 만든다. hookType은 제공된 enum 중 가장 가까운 값을 쓴다.

[상품 자기소개형 전용]
${PRODUCT_SELF_INTRODUCTION_RULES}

[평가]
첫 3초 주목도, 상품 구체성, 고객 문제 연결, 시각화, 근거, 차별성, 전환, 과장 안전성을 각각 0~100으로 평가한다. verifiedFacts의 id만 evidenceIds에 넣는다. 근거 없는 수치·효능·성과는 절대 쓰지 않는다. 상품명을 붙인 범용 문구, '프리미엄 퀄리티', '특별한 경험', '지금 만나보세요'는 탈락 사유다. JSON만 반환한다.`,
  });
  const unique = new Set<string>();
  const hooks = payload.hooks
    .map((item): VideoHookCandidate => {
      const scores = {
        stopPower: Number(item.scores.stopPower),
        specificity: Number(item.scores.specificity),
        productRelevance: Number(item.scores.productRelevance),
        visualPotential: Number(item.scores.visualPotential),
        evidenceStrength: Number(item.scores.evidenceStrength),
        conversionPotential: Number(item.scores.conversionPotential),
        originality: Number(item.scores.originality),
        policySafety: Number(item.scores.policySafety),
      };
      return {
        id: `hook-${crypto.randomUUID()}`,
        hookType: item.hookType,
        hook: clean(item.hook, 100),
        customerProblem: clean(item.customerProblem, 160),
        evidenceIds: compact(
          item.evidenceIds.filter((id) => allowedEvidenceIds.has(id)),
          4,
          120
        ),
        visualIdea: clean(item.visualIdea, 400),
        score: { ...scores, total: scoreTotal(scores) },
        rejectionReasons: compact(item.rejectionReasons, 4, 160),
      };
    })
    .filter((item) => {
      const key = item.hook.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
      if (!item.hook || unique.has(key)) return false;
      unique.add(key);
      return true;
    });
  if (!hooks.some((item) => item.hookType === "product-self-introduction")) {
    hooks.push(buildCurrentProductSelfIntroductionHook(analysis));
  }
  if (hooks.length < 7) {
    throw new VideoPlanningGenerationError({
      stage: "schema-validation",
      code: "HOOK_CANDIDATES_INSUFFICIENT",
      message: `AI가 유효한 후킹을 ${hooks.length}개만 생성했습니다. 최소 7개가 필요합니다.`,
      retryable: true,
      attempts: 1,
      failedAt: new Date().toISOString(),
    });
  }
  return hooks;
}

type AiConceptSummary = {
  conceptArchetype: VideoConceptArchetype;
  hookId: string;
  hookType: VideoHookType;
  title: string;
  openingHook: string;
  coreTarget: string;
  customerProblem: string;
  usp: string;
  speaker: string;
  creativeStyle: VideoCreativeStyle;
  narrativeStructure: string;
  narrativeSummary: string;
  recommendationReason: string;
  evidenceIds: string[];
  claimsToVerify: string[];
  cta: string;
  centralIncident: string;
  speakerPointOfView: string;
  keyAppeal: string;
  recommendedVisualStyle: string;
  supportingDevices: string[];
  differenceFromPrevious: string;
  copyVoiceDirection: string;
  targetCallout: string;
  distinctiveCharacter: string;
  socialWorld: string;
  storyTrigger: string;
  truthBridge: string;
  dramatizationBoundary: string;
};

function conceptSummarySchema(options: { count: number; archetypes?: VideoConceptArchetype[] }) {
  const archetypes = options.archetypes?.length
    ? options.archetypes
    : [...REQUIRED_VIDEO_CONCEPT_ARCHETYPES];
  return {
    type: "object",
    additionalProperties: false,
    required: ["concepts"],
    properties: {
      concepts: {
        type: "array",
        minItems: options.count,
        maxItems: options.count,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "conceptArchetype",
            "hookId",
            "hookType",
            "title",
            "openingHook",
            "coreTarget",
            "customerProblem",
            "usp",
            "speaker",
            "creativeStyle",
            "narrativeStructure",
            "narrativeSummary",
            "recommendationReason",
            "evidenceIds",
            "claimsToVerify",
            "cta",
            "centralIncident",
            "speakerPointOfView",
            "keyAppeal",
            "recommendedVisualStyle",
            "supportingDevices",
            "differenceFromPrevious",
            "copyVoiceDirection",
            "targetCallout",
            "distinctiveCharacter",
            "socialWorld",
            "storyTrigger",
            "truthBridge",
            "dramatizationBoundary",
          ],
          properties: {
            conceptArchetype: { type: "string", enum: archetypes },
            hookId: { type: "string" },
            hookType: hookTypeSchema,
            title: { type: "string", minLength: 6, maxLength: 70 },
            openingHook: { type: "string", minLength: 8, maxLength: 70 },
            coreTarget: { type: "string", minLength: 4, maxLength: 100 },
            customerProblem: { type: "string", minLength: 4, maxLength: 120 },
            usp: { type: "string", minLength: 4, maxLength: 120 },
            speaker: { type: "string", minLength: 2, maxLength: 80 },
            creativeStyle: {
              type: "string",
              enum: [
                "auto",
                "smartphone-ugc",
                "ad-real",
                "clay-miniature",
                "3d",
                "live-ai",
                "mixed",
              ],
            },
            narrativeStructure: { type: "string", minLength: 12, maxLength: 180 },
            narrativeSummary: { type: "string", minLength: 30, maxLength: 400 },
            recommendationReason: { type: "string", minLength: 20, maxLength: 300 },
            evidenceIds: { type: "array", maxItems: 6, items: { type: "string" } },
            claimsToVerify: { type: "array", maxItems: 6, items: { type: "string" } },
            cta: { type: "string", minLength: 4, maxLength: 50 },
            centralIncident: { type: "string", minLength: 12, maxLength: 240 },
            speakerPointOfView: { type: "string", minLength: 4, maxLength: 100 },
            keyAppeal: { type: "string", minLength: 4, maxLength: 140 },
            recommendedVisualStyle: { type: "string", minLength: 4, maxLength: 140 },
            supportingDevices: {
              type: "array",
              maxItems: 4,
              items: { type: "string", maxLength: 100 },
            },
            differenceFromPrevious: { type: "string", minLength: 8, maxLength: 180 },
            copyVoiceDirection: { type: "string", minLength: 12, maxLength: 240 },
            targetCallout: { type: "string", minLength: 8, maxLength: 60 },
            distinctiveCharacter: { type: "string", minLength: 12, maxLength: 220 },
            socialWorld: { type: "string", minLength: 12, maxLength: 220 },
            storyTrigger: { type: "string", minLength: 18, maxLength: 300 },
            truthBridge: { type: "string", minLength: 18, maxLength: 300 },
            dramatizationBoundary: { type: "string", minLength: 16, maxLength: 300 },
          },
        },
      },
    },
  } as const;
}

function conceptScore(hook?: VideoHookCandidate) {
  const fallback: HookScore = {
    stopPower: 0,
    specificity: 0,
    productRelevance: 0,
    visualPotential: 0,
    evidenceStrength: 0,
    conversionPotential: 0,
    originality: 0,
    policySafety: 0,
    total: 0,
  };
  const score = hook?.score || fallback;
  return {
    ...score,
    narrativeFlow: Math.round((score.productRelevance + score.visualPotential) / 2),
  };
}

export class VideoConceptPartialGenerationError extends VideoPlanningGenerationError {
  readonly partialConcepts: VideoConcept[];
  readonly failedArchetypes: VideoConceptArchetype[];

  constructor(input: {
    failure: ConstructorParameters<typeof VideoPlanningGenerationError>[0];
    partialConcepts: VideoConcept[];
    failedArchetypes: VideoConceptArchetype[];
    cause?: unknown;
  }) {
    super(input.failure, input.cause);
    this.name = "VideoConceptPartialGenerationError";
    this.partialConcepts = input.partialConcepts;
    this.failedArchetypes = [...new Set(input.failedArchetypes)];
  }
}

export async function generateVideoConceptSummariesAi(input: {
  advertiserName: string;
  analysis: ProductAnalysisSnapshot;
  guideline: BrandGuideline;
  duration: VideoDuration;
  objective: VideoObjective;
  hooks: VideoHookCandidate[];
  existingConcepts?: VideoConcept[];
  referenceAnalyses?: ReferenceVideoAnalysis[];
  conceptFormat?: VideoConceptFormat;
  requiredContent?: string;
  excludedContent?: string;
  requestedArchetype?: VideoConceptArchetype;
  recentParodyGenres?: VideoParodyGenre[];
  selectionSeed?: string;
  onConceptProgress?: (input: {
    concepts: VideoConcept[];
    unresolvedArchetypes: VideoConceptArchetype[];
    repairRounds: number;
  }) => void | Promise<void>;
}) {
  const candidates = [...input.hooks]
    .filter(
      (hook) =>
        !hook.rejectionReasons.length && hook.hookType !== "product-self-introduction"
    )
    .sort((left, right) => right.score.total - left.score.total)
    .slice(0, 10);
  const evidenceIds = new Set((input.analysis.verifiedFacts || []).map((fact) => fact.id));
  const copyGuide = await loadCopyGuideForProduct({
    advertiserName: input.advertiserName,
    brandName: input.analysis.brandName,
    productUrl: input.analysis.productUrl,
    category: input.analysis.category,
    productName: input.analysis.productName,
  });
  const selectedFormat = VIDEO_CONCEPT_FORMAT_OPTIONS.find(
    (item) => item.id === input.conceptFormat
  );
  const selectedParodyGenre = selectVideoParodyGenre({
    analysis: input.analysis,
    recentGenres: input.recentParodyGenres,
    seed: `${input.advertiserName}:${input.analysis.productName}`,
  });
  const blueprintSelections = selectVideoPlanningBlueprints({
    analysis: input.analysis,
    archetypes: input.requestedArchetype ? [input.requestedArchetype] : [...REQUIRED_VIDEO_CONCEPT_ARCHETYPES],
    parodyGenre: selectedParodyGenre.id,
    selectionSeed: input.selectionSeed,
  });
  const request = async (archetypes: VideoConceptArchetype[] | undefined, correction = "") =>
    runVideoPlanningAi<{ concepts: AiConceptSummary[] }>({
      stage: "concept-summaries",
      purpose: "concept",
      outputSchema: conceptSummarySchema({
        count: archetypes?.length || 1,
        archetypes,
      }) as unknown as Record<string, unknown>,
      prompt: `당신은 한국 퍼포먼스 광고 영상 기획자다. 아래 상품 근거와 평가된 후킹을 사용해 ${archetypes?.length ? `${archetypes.map((archetype) => VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.label).join(" · ")} 기획안을 각각 1개씩, 총 ${archetypes.length}개` : "사용자가 선택한 형식의 기획안 1개"} 만든다.

[상품]
${JSON.stringify(promptFacts(input.analysis))}
[후킹 후보]
${JSON.stringify(candidates)}
[목표와 길이]
${input.duration}초, ${VIDEO_OBJECTIVE_LABELS[input.objective]}
${
  selectedFormat
    ? `[사용자가 선택한 영상 콘셉트]
${selectedFormat.title} · ${selectedFormat.description}
전개: ${selectedFormat.flow}
연출 규칙: ${selectedFormat.direction}
creativeStyle은 반드시 ${selectedFormat.creativeStyle}을 사용한다.`
    : ""
}
${
  archetypes?.length
    ? `[반드시 지킬 중심 유형]
${archetypes.map((archetype) => `${archetype} = ${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.label}: ${VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.direction}`).join("\n")}
conceptArchetype은 위 유형을 정확히 한 번씩 사용한다.`
    : ""
}
[카테고리 연출 원칙]
${stylePrinciples(input.analysis.category)}
[브랜드 가이드]
${clean(copyGuide?.content || input.guideline.toneAndManner, 3000)}
[참고 영상의 구조·속도·자막 리듬]
${JSON.stringify(referenceVoiceSignals(input.referenceAnalyses))}
[레퍼런스 말투 전용 규칙]
${internetVoiceRules(input.analysis.category)}
[모든 상품에 적용하는 창작 인물·세계·사건 구체화 규칙]
${SPECIFIC_CREATIVE_WORLD_RULES}
[최신 4개 이야기 작동 방식]
${FOUR_CONCEPT_STORY_MECHANISM_RULES}
[레퍼런스 수준의 시청자 전달형 구어체·자막 규칙]
${NATURAL_REFERENCE_DIALOGUE_RULES}
[상세 분석 완료 영상 22개·617장면의 큐레이션 레퍼런스]
${JSON.stringify((archetypes || []).map((archetype) => ({ archetype, blueprint: blueprintPrompt(blueprintSelections[archetype]) })))}
${
  archetypes?.includes("parody")
    ? `[창작 인물·상황극형의 자동 선택 세부 장르]
${videoParodyGenrePrompt(selectedParodyGenre.id, input.recentParodyGenres)}`
    : ""
}
[반드시 넣을 내용]
${clean(input.requiredContent, 1500) || "없음"}
[제외할 내용]
${clean(input.excludedContent, 1500) || "없음"}
[이 프로젝트의 기존 기획안]
${JSON.stringify((input.existingConcepts || []).map((item) => ({ opening: item.openingHook, incident: item.centralIncident, speaker: item.speakerPointOfView || item.speaker, appeal: item.keyAppeal || item.usp })))}

첫 문장부터 상품명을 설명하지 말고 실제 숏폼에서 사람이 꺼낼 법한 한마디와 촬영 가능한 생활 행동으로 시작한다. openingHook·narrativeSummary·copyVoiceDirection은 독립 광고 표제의 모음이 아니라 주 화자가 카메라 너머 시청자에게 시작→궁금증→증거→반응→행동을 이어 말하는 흐름이어야 한다. speakerPointOfView와 speaker에는 ‘딸과 아버지의 대화’가 아니라 ‘고기 없으면 밥을 미루는 아버지의 이번 반응을 시청자에게 들려주는 딸’처럼 누가 누구에게 어떤 생활 장면을 전하는지 적는다. 신규 자동 4안에서는 product-self-introduction을 선택하지 않는다.
title은 설명형 제목이 아니라 인물·세계·첫 사건이 바로 떠오르는 사건형 제목으로 쓴다. ProductTruth는 사용할 상품 사실의 상한선이며 레퍼런스 원문은 말의 연결과 화면 순서의 기준이다. 상세페이지 밖의 가상 인물·관계·직업·시대·세계·사건은 선택 장르에 맞게 과감하게 만들 수 있다. 가상의 의사 가족 추천도 허용하지만 가상 인물임을 dramatizationBoundary에 명시하고 의학적 효능·치료·보증으로 확대하지 않는다. 콘셉트 하나는 핵심 구매 이유 하나와 이를 받치는 가격·구성·품질 사실 두세 개만 골라 truthBridge로 연결한다. 배송·배송비·도서산간·제주 추가비·배송지 안내는 기획 제목, 사건, 소구, CTA에서 완전히 제외한다. coreTarget은 분석용 고객 정의로 쓰고 targetCallout은 그 사람의 행동·불편·욕망을 찌르는 첫 3초용 문장으로 쓴다. 네 안은 인물·세계·사건·증거 순서를 다르게 하되 같은 상품의 필수 조리·사용 장면까지 억지로 다르게 만들지 않는다. copyVoiceDirection에는 실제 호칭·문장 길이·직설 강도를 구체적으로 적고 ‘친근한 말투’처럼 일반화하지 않는다. 배정된 주 블루프린트의 sourceTranscriptAndScenes 전체에서 자막 연결·행동·증거·반응·CTA 순서를 읽고, 5비트 요약이나 범용 광고 공식으로 줄이지 않는다. 원문의 상품·가격·효능·인물·대사는 복제하지 않고 현재 ProductTruth와 새로운 창작 장면으로 치환한다. 확인되지 않은 수치나 효능은 claimsToVerify에만 쓴다. hookId와 evidenceIds는 입력에 존재하는 값만 쓰며 실제 이미지나 영상을 생성하지 않는다.
${correction} JSON만 반환한다.`,
    });
  const toConcepts = (rows: AiConceptSummary[]) => {
    const occupiedCodes = [...(input.existingConcepts || []).map((item) => item.materialCode)];
    return rows.map((row): VideoConcept => {
      const hook =
        input.hooks.find((item) => item.id === row.hookId) ||
        input.hooks.find((item) => item.hookType === row.hookType);
      const previous =
        input.existingConcepts?.find((item) => item.conceptArchetype === row.conceptArchetype);
      const now = new Date().toISOString();
      return {
        id: previous?.id || crypto.randomUUID(),
        title: clean(row.title, 100),
        hookType: row.hookType,
        coreTarget: clean(row.coreTarget, 140),
        objective: input.objective,
        openingHook: clean(row.openingHook, 100),
        fullScript: "",
        cuts: [],
        requiredSources: [],
        cta: clean(row.cta, 80),
        productionCautions: compact(input.analysis.cautionPhrases, 8, 240),
        materialCode:
          previous?.materialCode ||
          (() => {
            const code = createVideoMaterialCode({
              advertiserName: input.advertiserName,
              productName: input.analysis.productName,
              hookType: row.hookType,
              existingCodes: occupiedCodes,
            });
            occupiedCodes.push(code);
            return code;
          })(),
        generationSource: getVideoPlanningProvider() === "openai-api" ? "openai" : "codex-local",
        generationWarnings: [],
        revision: (previous?.revision || 0) + 1,
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        customerProblem: clean(row.customerProblem, 180),
        usp: clean(row.usp, 180),
        creativeStyle: selectedFormat?.creativeStyle || row.creativeStyle,
        narrativeSummary: clean(row.narrativeSummary, 600),
        narrativeStructure: clean(row.narrativeStructure, 260),
        speaker: clean(row.speaker, 120),
        recommendationReason: clean(row.recommendationReason, 400),
        claimsToVerify: compact(row.claimsToVerify, 6, 200),
        evidenceIds: compact(
          row.evidenceIds.filter((id) => evidenceIds.has(id)),
          6,
          120
        ),
        score: { ...conceptScore(hook), total: hook?.score.total || 0 },
        detailStatus: "not-generated",
        conceptFormat: input.conceptFormat,
        conceptArchetype: row.conceptArchetype,
        centralIncident: clean(row.centralIncident, 320),
        speakerPointOfView: clean(row.speakerPointOfView, 140),
        keyAppeal: clean(row.keyAppeal, 200),
        recommendedVisualStyle: clean(row.recommendedVisualStyle, 200),
        supportingDevices: compact(row.supportingDevices, 4, 120),
        differenceFromPrevious: clean(row.differenceFromPrevious, 240),
        copyVoiceDirection: clean(row.copyVoiceDirection, 300),
        targetCallout: clean(row.targetCallout, 100),
        distinctiveCharacter: clean(row.distinctiveCharacter, 300),
        socialWorld: clean(row.socialWorld, 300),
        storyTrigger: clean(row.storyTrigger, 400),
        truthBridge: clean(row.truthBridge, 400),
        dramatizationBoundary: clean(row.dramatizationBoundary, 400),
        blueprintSelection: blueprintSelections[row.conceptArchetype],
        parodyGenre:
          row.conceptArchetype === "parody" ? selectedParodyGenre.id : undefined,
      };
    });
  };
  if (input.requestedArchetype) {
    let payload = await request([input.requestedArchetype]);
    const initialSpecificityIssue = currentVideoCreativePremiseIssue(payload.concepts[0]);
    const initialGenreMismatch =
      input.requestedArchetype === "parody" &&
      !matchesVideoParodyGenre(
        [
          payload.concepts[0]?.title,
          payload.concepts[0]?.openingHook,
          payload.concepts[0]?.centralIncident,
          payload.concepts[0]?.narrativeSummary,
          payload.concepts[0]?.narrativeStructure,
          payload.concepts[0]?.speaker,
          payload.concepts[0]?.speakerPointOfView,
          payload.concepts[0]?.recommendedVisualStyle,
          ...(payload.concepts[0]?.supportingDevices || []),
        ].join(" "),
        selectedParodyGenre.id
      );
    if (initialSpecificityIssue || initialGenreMismatch) {
      payload = await request(
        [input.requestedArchetype],
        [
          initialSpecificityIssue
            ? `이전 응답의 인물·세계·사건이 일반적이었다: ${initialSpecificityIssue} distinctiveCharacter, socialWorld, storyTrigger, truthBridge를 선택 장르와 현재 상품에서만 나올 수 있는 수준으로 다시 구체화한다.`
            : "",
          initialGenreMismatch
            ? `자동 선택된 창작 장르 '${selectedParodyGenre.label}'을 따르지 않았다. 다른 장르를 섞지 말고 선택 장르의 인물·세계·사건·화면 진행이 제목과 중심 사건에 드러나게 다시 작성한다.`
            : "",
        ].filter(Boolean).join(" ")
      );
    }
    const finalSpecificityIssue = currentVideoCreativePremiseIssue(payload.concepts[0]);
    if (finalSpecificityIssue) {
      throw new VideoPlanningGenerationError({
        stage: "schema-validation",
        code: "CREATIVE_PREMISE_TOO_GENERIC",
        message: finalSpecificityIssue,
        retryable: true,
        attempts: 2,
        failedAt: new Date().toISOString(),
      });
    }
    if (
      input.requestedArchetype === "parody" &&
      !matchesVideoParodyGenre(
        payload.concepts.map((row) => [row.title, row.centralIncident, row.narrativeSummary, row.recommendedVisualStyle].join(" ")).join(" "),
        selectedParodyGenre.id
      )
    ) {
      throw new VideoPlanningGenerationError({
        stage: "schema-validation",
        code: "PARODY_GENRE_MISMATCH",
        message: "창작 인물·상황극 기획안이 자동 선택된 세부 장르를 따르지 않았습니다.",
        retryable: true,
        attempts: 2,
        failedAt: new Date().toISOString(),
      });
    }
    return toConcepts(payload.concepts);
  }
  const findInvalidArchetypes = (rows: AiConceptSummary[]) => {
    const invalid = new Set<VideoConceptArchetype>();
    for (const row of rows) {
      // Unknown hook/evidence IDs are deterministically resolved or removed in
      // toConcepts(). They must not discard an otherwise distinct, fact-safe set.
      if (currentVideoCreativePremiseIssue(row)) invalid.add(row.conceptArchetype);
      if (
        row.conceptArchetype === "parody" &&
        !matchesVideoParodyGenre(
          [
            row.title,
            row.openingHook,
            row.centralIncident,
            row.narrativeSummary,
            row.narrativeStructure,
            row.speaker,
            row.speakerPointOfView,
            row.recommendedVisualStyle,
            ...row.supportingDevices,
          ].join(" "),
          selectedParodyGenre.id
        )
      ) {
        invalid.add("parody");
      }
    }
    const fields = rows.map((row) => [
      row.hookType,
      row.openingHook,
      row.centralIncident,
      row.distinctiveCharacter,
      row.socialWorld,
      row.storyTrigger,
      row.truthBridge,
      row.customerProblem,
      row.usp,
      row.speakerPointOfView || row.speaker,
      row.recommendedVisualStyle,
      row.narrativeStructure,
      row.cta,
    ]);
    for (let left = 0; left < fields.length; left += 1) {
      for (let right = left + 1; right < fields.length; right += 1) {
        const same = fields[left].filter(
          (value, index) => value && value === fields[right][index]
        ).length;
        if (same / fields[left].length >= 0.45) invalid.add(rows[right].conceptArchetype);
      }
    }
    return [...invalid];
  };

  let rows: AiConceptSummary[];
  try {
    rows = await requestFourVideoConcepts({
      requestBatch: async () => (await request([...REQUIRED_VIDEO_CONCEPT_ARCHETYPES])).concepts,
      requestOne: async (archetype, correction, preservedRows) =>
        (
          await request(
            [archetype],
            `${correction}
[그대로 보존할 다른 기획안]
${JSON.stringify(
  preservedRows.map((row) => ({
    conceptArchetype: row.conceptArchetype,
    openingHook: row.openingHook,
    distinctiveCharacter: row.distinctiveCharacter,
    socialWorld: row.socialWorld,
    storyTrigger: row.storyTrigger,
    centralIncident: row.centralIncident,
    truthBridge: row.truthBridge,
    keyAppeal: row.keyAppeal,
    speakerPointOfView: row.speakerPointOfView || row.speaker,
    recommendedVisualStyle: row.recommendedVisualStyle,
    cta: row.cta,
  }))
)}
위 기획안은 수정하거나 섞지 말고, 지금 요청한 ${archetype} 한 개만 완전히 다른 인물·세계·사건으로 작성한다.`
          )
        ).concepts[0],
      initialStrategy: "per-archetype",
      concurrency: 2,
      findInvalidArchetypes,
      onProgress: async ({ preservedRows, unresolvedArchetypes, repairRounds }) => {
        await input.onConceptProgress?.({
          concepts: toConcepts(preservedRows),
          unresolvedArchetypes,
          repairRounds,
        });
      },
    });
  } catch (error) {
    if (error instanceof VideoPlanningGenerationError) throw error;
    const batchFailure =
      error instanceof VideoConceptBatchValidationError ? error : undefined;
    const failedArchetypes = [
      ...(batchFailure?.missingArchetypes || []),
      ...(batchFailure?.invalidArchetypes || []),
    ];
    const failedLabels = [...new Set(failedArchetypes)]
      .map(
        (archetype) =>
          VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find((item) => item.id === archetype)?.label ||
          archetype
      )
      .join(" · ");
    const upstreamFailure = batchFailure?.requestFailures
      .map((item) => item.error)
      .find((item): item is VideoPlanningGenerationError =>
        item instanceof VideoPlanningGenerationError
      )?.failure;
    const failure = upstreamFailure || {
      stage: "schema-validation" as const,
      code: "CONCEPTS_NOT_DISTINCT",
      message: failedLabels
        ? `기획안 4개 중 ${failedLabels} 유형이 구체성·차별성 검수를 통과하지 못했습니다. 통과한 기획안은 보존했고 부적합 유형만 ${batchFailure?.repairRounds || 0}회 다시 생성했습니다.`
        : "기획안 4개는 생성했지만 구체성·차별성 검수를 통과하지 못했습니다.",
      retryable: true,
      attempts: 1 + (batchFailure?.repairRounds || 0),
      failedAt: new Date().toISOString(),
    };
    if (batchFailure?.preservedRows.length) {
      throw new VideoConceptPartialGenerationError({
        failure,
        partialConcepts: toConcepts(batchFailure.preservedRows as AiConceptSummary[]),
        failedArchetypes: [...new Set(failedArchetypes)],
        cause: error,
      });
    }
    throw new VideoPlanningGenerationError(failure, error);
  }
  const concepts = toConcepts(rows);
  if (!validateConceptDiversity(concepts).valid) {
    throw new VideoPlanningGenerationError({
      stage: "schema-validation",
      code: "CONCEPTS_NOT_DISTINCT",
      message: "기획안 4개는 생성했지만 최종 저장 전 차별성 검수를 통과하지 못했습니다.",
      retryable: true,
      attempts: 3,
      failedAt: new Date().toISOString(),
    });
  }
  return concepts;
}

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
