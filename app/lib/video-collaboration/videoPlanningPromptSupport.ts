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


export {
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
};

