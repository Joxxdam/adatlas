import "server-only";

import { Codex } from "@openai/codex-sdk";
import { resolveRuntimeTimeout } from "./fastCreativeRuntime";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { selectMasterCreativeDirection } from "./masterDesign";
import { matchBrandProfile, matchCategoryProfile, withRequestedLogo } from "./profiles";
import { extractNumericTokens, validateCopyAgainstTruth } from "./productTruth";
import type { NativeAdReference } from "./referenceCreativeLibrary.server";
import { applyReferenceCopyGroupRules } from "./referenceCopyDiversity";
import { consumerFacingFactHint, findReferenceCopyNaturalnessErrors } from "./referenceCopyNaturalness";
import { isAmbiguousMerchantCredentialCreativeSignal, isIncompleteOcrCopyFragment, isMalformedProductSignal, isMerchantCredentialCreativeSignal, isNonDomesticOriginCreativeSignal, isProhibitedAdCopySignal, isShippingCreativeSignal } from "./productSignalHygiene";
import { CURRENT_REFERENCE_COPY_POLICY_VERSION } from "./jobRunnerPolicy";
import { referenceRequiresComparisonSemantics } from "./referenceSemanticRoles.ts";
import { isApprovedReferenceNativeCopy, normalizeReferenceRawLines, type ReferenceTextRegion } from "./referenceLibraryManagement";
import { findProductCopySemanticErrors, resolveProductCopyDomain } from "./productCopySemantics";
import { buildImageCreativePremiseSeed, buildImageCreativePremiseSeeds, findImageCreativePremiseCopyErrors, findImageCreativePremiseErrors, IMAGE_CREATIVE_PREMISE_POLICY_VERSION, normalizeImageCreativePremise } from "./imageCreativePremise.ts";
import { loadCopyGuideForProduct, type LoadedCopyGuide } from "../mvp/copyGuideLoader";
import type { AdBrief } from "../mvp/types";
import type { CreativeBlueprintId, CreativePlan, HookPlan, ImageCreativePremise, ProductFact, ProductTruth, ReferenceAdaptedCopyPlan, ReferenceCopyProfile, ScenePlan } from "./types";

import {
  CREATIVE_CONTEXT_POLICY,
  NATURALNESS_PASS_SCORE,
  REFERENCE_COPY_PROFILE_VERSION,
  REFERENCE_FIT_PASS_SCORE,
  copyGuidePromptBlock,
  criticSchema,
  fallbackProfile,
  plannerSchema,
  profileSchema,
  readProfileCache,
  referenceHash,
  sheetClaimPolicy,
  vendorCopyExamplePromptBlock,
  writeProfileCache,
  type CriticPayload,
  type PlannerPayload,
  type ProfilePayload,
} from "./referenceCopyProfiles.server";
import {
  ensureRenderableReferencePlans,
  factsForPlanning,
  fallbackPlan,
  plannerDeclaredSafetyErrors,
  shortProductIdentity,
} from "./referenceCopyPlanningCore";

function planningPrompt(input: { truth: ProductTruth; references: NativeAdReference[]; profiles: ReferenceCopyProfile[]; premiseSeeds: ImageCreativePremise[]; missingProfileIds: string[]; copyGuide?: LoadedCopyGuide | null; repairPlans?: ReferenceAdaptedCopyPlan[] }) {
  const productionDate = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return `한국 광고 제작용 레퍼런스 원문 적응 문구를 한 번의 배치로 작성한다. 레퍼런스와 무관한 별도 후킹 전략·성과 가설·장면 콘셉트는 만들지 않되, 레퍼런스의 수사 골격 안에서 상품 사실을 소비자가 반응할 광고 후킹으로 번역한다.

현재 제작 날짜(Asia/Seoul): ${productionDate}

업체별 문구 가이드:
${copyGuidePromptBlock(input.copyGuide)}

작업 원칙:
- 목표는 맞춤법만 통과하는 안전 문구가 아니라 사람의 추가 수정 없이 광고에 넣을 수 있는 최소 7/10 이상의 문장력이다. 각 안은 자연스러움과 레퍼런스 수사 적합도 모두 80점 이상을 목표로 하고, 상품명·특징·가격을 단순 나열한 문구는 통과시키지 않는다.
- 각 레퍼런스의 rawText/rawLines가 유일한 문구 출발점이다. 일반화된 청사진이나 새 후킹을 만들지 않는다.
- creativePremise는 rawLines의 수사 골격 안에서 사용할 가벼운 소비자 말투 방향이다. 별도 세계관·인물 서사·레이아웃·새 슬롯을 만드는 콘셉트가 아니며, 원문의 질문→대답·비교→결론·경험→추천 관계를 해치지 않는다.
- 6장에 인물형·시대극·상품 1인칭·USP·비교 역할별 장수를 강제하지 않는다. 각 레퍼런스 원문이 실제로 가진 질문·관계·비유·비교·정보 구조에 가장 자연스러운 kind를 선택한다. 원문에 필요하지 않으면 인물과 장소를 새로 넣지 않는다.
- everyday-relationship은 ‘울 아버지’, ‘우리 가족’, ‘남편’, ‘엄마’, ‘퇴근한 나’처럼 바로 이해되는 관계나 생활 주체 하나와 익숙한 장면 하나만 사용한다. 직업·성격·경력·말버릇·시대 배경을 덧붙여 뒷이야기를 만들지 않는다.
- everyday-question-answer는 소비자가 실제로 할 법한 짧은 질문 뒤에 짧은 해결이나 상품 제안을 둔다. 예: ‘아침마다 고기 사러 마장동 가세요? / 여기서 그냥 시켜요’. 질문만 던지고 답을 상품정보 나열로 바꾸지 않는다.
- obvious-ad-metaphor는 ‘임금님도 감동할 진짜 특급한우’, ‘오늘 밥상의 주인공’처럼 누구나 사실이 아닌 광고 비유로 이해할 수 있는 한 줄만 허용한다. ‘임금님이 먹던 한우’, ‘전문가가 인정한 1위’처럼 실제 이력·보증·인증으로 오해되는 주장은 금지한다.
- ‘수라간 감별관’, ‘상품 큐레이터’, ‘구매 담당’, ‘저녁밥 총무’, ‘욕실 집사’처럼 기획서에서 만든 직업형 인물, 상품이 직접 말하는 1인칭 화자, 설명이 필요한 시대극·세계관을 소비자 문구에 사용하지 않는다.
- 관계·생활 장면·비유는 광고용 창작 맥락이며 상품의 실제 성분·효능·수치·가격·구성·후기인 것처럼 쓰지 않는다. 알레르기·질병·치료·의사/전문가 추천, 실제 고객 후기처럼 들리는 설정은 금지한다.
- creativePremise의 productBridge와 상품 관련 문구는 supportingFactIds의 ProductTruth 근거만 사용한다. ‘가상’, ‘상황극’, ‘ProductTruth’, ‘검증된 설정’ 같은 내부 관리어는 소비자용 adaptedLines에 노출하지 않는다.
- observedSourceLines에는 저장된 rawLines를 글자와 빈 줄까지 그대로 복사한다. 이 단계에서는 이미지 파일을 열거나 OCR하지 않는다.
- adaptedLines는 rawLines와 같은 개수·순서·빈 줄을 유지하고, 각 줄에서 상품에 맞지 않는 사실만 교체한다.
- textRegions의 sourceType이 source-brand이거나 replacePolicy가 remove인 줄은 예외적으로 adaptedLines를 빈 문자열로 둔다. '연출 이미지', '예시 이미지', '이해를 돕기 위한 이미지', 원본 AI 활용 고지처럼 레퍼런스에 붙은 출처성 이미지 고지도 remove 영역으로 취급한다. 이 영역에는 현재 상품명·브랜드명·광고 문구를 넣지 않고 주변 배경만 복원한다. 실제 결과의 AI 고지는 사용자가 선택한 별도 후처리에서만 적용한다.
- 저장 rawLines가 비어 있는 레퍼런스는 이 배치에 전달되지 않으며 별도의 ProductTruth 안전 최소 문구를 사용한다.
- source-brand/remove 영역을 제외한 원본의 모든 비어 있지 않은 문구 블록은 최종 문구에서도 비어 있지 않아야 한다. 가격·할인·증정처럼 현재 상품에 근거가 없는 슬롯은 삭제하거나 수치를 만들지 말고, 비슷한 길이의 검증된 USP·사용 사실·상품 식별 문구로 역할을 바꿔 시각적 밀도를 유지한다.
- 원문의 단어 순서, 줄 수, 문장부호, 이모지, ㅋㅋ, ㅎㅎ, ㅠㅠ, ;;, .., ㄷㄷ, 헐, 뭐임, 겨 같은 구어체를 최대한 그대로 둔다.
- 기존 상품·가격·혜택·업체·상품별 근거만 ProductTruth의 현재 상품 사실로 치환한다. 다만 레퍼런스의 수사 의도와 말투를 보존하는 것이 목적이지, 명사를 슬롯처럼 바꾸는 것이 목적이 아니다.
- 문구의 첫 선택 기준은 현재 상품의 구체 USP·식감/사용감·원료·구성·사용 순간이다. 가격·혜택은 offer 역할에서만 그다음으로 사용한다. 업체의 업력·순위·수상은 상품 USP를 대신할 수 없고, 상품 근거가 충분할 때는 선택하지 않는다.
- 브랜드명·업체명·판매자명과 업체 업력·순위·수상·브랜드 파워 문구는 모든 광고 문구에서 제외한다. 브랜드는 사용자가 선택한 별도 로고 후처리에서만 적용하며, 상품명이나 proof/badge에 섞지 않는다.
- 업체별 문구 가이드는 레퍼런스 구조 안에서 어떤 상품 사실을 어떤 소비자 언어로 강조할지 결정하는 품질 기준이다. 가이드의 강한 문제 제기·손실 회피·감각 표현을 사실 범위 안에서 충분히 살리고, 무난한 상품 소개문으로 순화하지 않는다.
${sheetClaimPolicy(input.truth)}
- 최종 상품 카테고리는 ${resolveProductCopyDomain(input.truth.product)}이다. 상세페이지 원료명에 과일·먹거리 단어가 있어도 바디워시·샤워젤·화장품을 간식이나 음식처럼 말하면 치명적인 상품 카테고리 의미 충돌이다. 반대로 실제 식품을 피부·샤워용 제품처럼 말하지 않는다.
- 미리 정리된 광고 문구 후보:
${vendorCopyExamplePromptBlock(input.truth)}
- ${CREATIVE_CONTEXT_POLICY}
- 계절·시즌 맥락은 위 제작 날짜와 맞아야 한다. 유행 표현은 모델이 의미와 사용 맥락을 확실히 아는 경우에만 사용하고, 모르는 신조어를 지어내지 않는다.
- 창작 맥락은 상품명을 꾸미는 계절 단어 하나로 끝내지 말고, 소비자가 실제로 겪는 질문·선택·먹는 순간·선물 상황·유행과의 비교처럼 문장 안에서 역할을 갖게 한다. 상품과 연결이 억지스럽거나 소비자가 관계를 추측해야 하면 naturalness 오류로 본다.
- ProductTruth의 value는 사실 근거이고 copyHint는 조사 보고서 말투를 제거한 작성 힌트다. 둘을 문구 칸에 그대로 복사하지 말고 레퍼런스의 질문·대화·반전·비교·사용 장면 문법으로 압축한다.
- 배송, 무료배송, 배송비, 출고, 도착 예정, 택배 관련 정보는 ProductTruth에 있더라도 광고 문구에 절대 사용하지 않는다. 원본 레퍼런스에 배송 슬롯이 있으면 현재 상품의 다른 검증된 구매 이유나 CTA로 바꾼다.
- 부정적인 상품 경험·하자·파손·흠집 문장, CS·교환·환불·반품 안내, 소비자에게 양해·주의·확인을 구하는 공지, 판매원·제조원·공급원·판매자·사업자 정보는 이미지 OCR에 실제로 있어도 광고 문구에 절대 사용하지 않는다.
- productConstraints는 상품을 더 좋게 과장하지 않기 위한 내부 시각·표현 제한이다. 해당 원문을 광고 카피로 옮기지 말고, 제한과 모순되는 프리미엄·완벽한 외관·선물용 같은 주장을 만들지 않는다.
- 원산지는 현재 상품이 육류이고 국내산·국산 근거가 확인된 경우에만 광고에 표기한다. 과일·채소·간식·가공식품·화장품 등 비육류에서는 국내산이어도 원산지를 헤드라인·근거·배지·이미지 내 문구에 사용하지 않는다. 수입산·외국산은 상품군과 관계없이 사용하지 않는다.
- '~으로 소개됨', '~라고 정리됨', '~에게 어울리는 방향'은 업체 조사 문장이지 광고 문구가 아니다. 최종 문구에는 '소개됨·정리됨·방향' 같은 조사 보고서 어미를 남기지 않는다.
- 단일 상품의 250ml·500g 같은 용량은 '총 250ml 구성'처럼 세트로 표현하지 않는다. 용량은 레퍼런스에 수치 슬롯이 있을 때 한 이미지 안에서 한 번만 작게 사용하고 헤드라인으로 삼지 않는다.
- 동일한 정식 상품명은 한 이미지에서 최대 한 블록에만 사용한다. 나머지 블록은 사용 상황·향·성분·추출 방식·가격·CTA처럼 서로 다른 역할을 맡긴다.
- 여섯 소재는 레퍼런스 구조가 다를 뿐 아니라 핵심 주장도 달라야 한다. 같은 헤드라인·같은 감각 표현·같은 가격 결론을 어순이나 조사만 바꿔 반복하지 않는다. 각 소재가 담당할 대표 메시지를 먼저 서로 다르게 배분한 뒤 작성한다.
- 원문이 중간·고밀도이면 source-brand/remove를 제외한 문구 블록 수와 시각적 글자량을 유지한다. 긴 질문·비교·문제 제기를 짧은 상품명, 카테고리명, '구성 확인' 같은 범용 문구 하나로 축약하지 않는다.
- '향 그대로네요'처럼 비교 대상이나 앞선 경험이 없는 지시 표현을 독립 헤드라인으로 쓰지 않는다.
- 화장품·바디워시의 상세 사실은 소비자 선택 장면으로 바꾼다. 해당 사실이 ProductTruth에 있을 때만 '꽃향 말고, 산뜻한 시트러스 향 찾는 분?', '무거운 아침, 라임 향으로 깨워볼까요?', '레몬보다 쌉싸름하고 선명한 라임 향', '열 없이 눌러 얻은 라임·오렌지 껍질 오일' 같은 압축 방향을 사용할 수 있다. 예문을 다른 상품에 복사하지 않는다.
- 생성한 단어를 한 글자씩 확인한다. '소개됨'을 '소거됨'처럼 바꾸거나 원문에 없는 유사 단어를 만들면 치명 오류다.
- 상품 사실을 바꾼 뒤에는 주어·서술어, 조사, 수식 관계와 문장 완결성을 현재 상품 기준으로 반드시 다시 조립한다. 자연스러운 문법을 위해 같은 줄 안의 어순과 조사를 바꿀 수 있으며, 이 수정은 레퍼런스 훼손으로 보지 않는다.
- 사람 주어를 계절·상품·가격 명사로 바꾸지 않는다. 예: ‘남편이 먼저 더 사자고 졸라요’의 ‘남편’을 ‘추석’으로 치환한 ‘추석이 먼저 더 사자고 졸라요’는 금지한다. 사람 근거가 없으면 ‘명절 준비라면 한 세트 더 챙기고 싶어요’처럼 확인된 상품 상황으로 문장 전체를 다시 쓴다.
- 여러 줄이 한 문장을 이루면 줄바꿈을 제거해 이어 읽었을 때도 자연스러워야 한다. ‘명절 특별구성에 / 소 찜갈비 대용량으로 / 드셔보신 적 있으세요?’처럼 조사 연결이 깨진 문구, ‘갈비찜으로 간편해결,’처럼 미완성 쉼표·붙여 쓴 명사로 끝나는 문구를 금지한다.
- 명절·식사·선물처럼 소비 상황이 있는 상품은 상품명 앞에 계절 단어만 붙이지 말고, 소비자가 실제로 고민하거나 묻는 장면으로 바꾼다. 나쁜 예: ‘명절 메뉴 없더니...’. 좋은 방향: ‘명절 갈비, 언제 손질해요...’, ‘명절 음식 언제 만들어요...’. 단, 손질·간편 준비 같은 구체 내용은 ProductTruth에 근거가 있을 때만 쓴다.
- 사람 반응형 원문의 핵심은 사람과 행동의 관계다. 나쁜 예: ‘추석이 먼저 사자고 졸라요’. 좋은 방향: ‘먹어본 사람은 계속 달라고 졸라요’. 단, 먹어본 사람의 반응·재구매·후기 표현은 ProductTruth에 실제 후기 근거가 있을 때만 허용하고, 근거가 없으면 ‘명절 갈비, 한 팩 더 준비할까요?’처럼 검증된 상품 상황의 질문으로 바꾼다.
- 광고 문구는 맞춤법만 맞는 설명문이 아니라, 처음 보는 소비자가 1초 안에 상황·대상·행동을 이해할 수 있는 구어체여야 한다. ‘명절 특별구성’, ‘대용량으로 준비’ 같은 범용 단어를 이어 붙인 문장보다 구체적인 질문·대화·사용 장면을 우선한다.
- 원문 헤드라인이 질문·반전·비교·문제 제기·긴급성·수치 강조형이면 그 수사 장치와 판매 강도를 유지한다. 강한 헤드라인을 현재 상품명만 적은 소개 문구로 약화하지 않는다.
- 원문의 헤드라인/서브/근거/혜택/CTA/배지 블록 수, 읽기 순서, 상대적 글자 분량을 유지한다. 전체 문구량을 원문의 절반 이하로 축약하지 않는다.
- 원문에 채팅/댓글/밈 문법이 있을 때만 그 형식을 유지하고, 없으면 새로 추가하지 않는다.
- ProductTruth는 사실 상한선이다. 제공된 fact 이외의 가격, 할인, 구성, 후기, 효능, 원산지, 수치를 만들지 않는다.
- 후기 카드의 작성 날짜·시각·작성자·닉네임 같은 UI 메타데이터는 광고 사실이 아니다. ProductTruth에 실수로 남아 있더라도 문구로 옮기지 않는다.
- 레퍼런스 문장의 관계가 작성의 골격이다. 문제→해결, 질문→대답, 비교→결론, 경험→추천처럼 여러 줄 사이의 수사 관계를 유지하고, 상품 사실을 나열한 상세페이지 요약문으로 바꾸지 않는다.
- semanticComparison=true인 VS 레퍼런스는 좌측/문제 문구와 우측/해결 문구의 역할을 절대 합치지 않는다. 불리한 쪽은 현재 상품과 같은 카테고리의 익명·일반 대안이 양이 적거나 만족감·가성비가 아쉬운 구체적 선택 상황을 말하고, 유리한 쪽은 현재 상품의 검증된 구성·식감·가격·사용 이점으로 답한다. 불리한 쪽에 고기·채소·화장품처럼 다른 상품군을 넣거나, 양쪽 모두 현재 상품을 칭찬하거나, 이름 있는 경쟁사를 비방하거나, 근거 없는 비교 수치를 만들지 않는다.
- 같은 상품명·구성·중량 설명을 여러 블록에 반복하지 않는다. 원문에서 역할이 다른 블록은 현재 상품의 서로 다른 검증 사실이나 CTA로 그 역할을 유지한다.
- headlineEligible은 헤드라인/보조 문구에, proofOnly는 근거에, offerOnly는 offer에만 쓴다. identityOnly는 상품 식별에만 쓴다.
- 애매한 상투어보다 ProductTruth의 구체 사실을 우선하고, 확인된 사실 안에서는 판매형 말투를 충분히 강하게 유지한다.
- CTA는 레퍼런스에 실제 CTA 역할이 있을 때만 짧게 작성한다.
- 여섯 결과가 같은 의미가 되지 않게 서로 다른 원문 의미 구조를 유지한다.
- 가격은 최대 2장, 할인율은 최대 2장, 쿠폰/증정 등 혜택은 최대 3장, 수량·중량은 최대 2장에서만 메인 강조한다.
- 각 plan은 스스로 점검한 naturalnessScore, referenceFitScore, factualSafetyScore와 validationErrors를 반드시 포함한다. naturalnessScore는 주어·서술어·조사·문장 완결성과 소비자가 한 번에 이해하는지를 기준으로 엄격하게 채점하며 ${NATURALNESS_PASS_SCORE}점 미만이면 스스로 invalid 사유를 적는다.
- 결과 코드는 내부 순번 H01~H06일 뿐 후킹 유형이 아니다.

상품 사실:
${JSON.stringify({ productName: shortProductIdentity(input.truth), facts: factsForPlanning(input.truth), forbiddenBrandNames: [input.truth.product.advertiserName, input.truth.product.brandName, input.truth.normalized.brandName].filter(Boolean), productConstraints: input.truth.productCopyConstraints || [] }, null, 2)}

6장 CreativePremise 초안(역할 수를 맞추지 말고 레퍼런스 원문에 더 자연스러운 현재 v2 kind로 바꿀 수 있다. productBridge와 supportingFactIds는 바꾸지 않는다):
${JSON.stringify(input.references.map((reference, index) => ({ resultCode: `H${String(index + 1).padStart(2, "0")}`, referenceId: reference.id, creativePremise: input.premiseSeeds[index] })), null, 2)}

레퍼런스:
${JSON.stringify(input.references.map((reference, index) => ({ resultCode: `H${String(index + 1).padStart(2, "0")}`, referenceId: reference.id, layoutFamily: reference.layoutFamily, textDensity: reference.textDensity, compositionType: reference.compositionType, productSlotCount: reference.productSlotCount, semanticComparison: referenceRequiresComparisonSemantics(reference), rawText: reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "", rawLines: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.rawLines || [], textRegions: reference.nativeCopy?.useForCopyAdaptation === false ? [] : reference.nativeCopy?.textRegions || [] })), null, 2)}

이미 분석된 프로필:
${JSON.stringify(input.profiles.filter((profile) => !input.missingProfileIds.includes(profile.referenceId)), null, 2)}

profiles는 과거 저장 구조 호환용이므로 빈 배열로 반환한다. 각 plan의 headline/subCopy/proof/offer/cta는 adaptedLines의 같은 역할 문구와 반드시 일치해야 한다.
${input.repairPlans?.length ? `다음 검증 실패 문구만 한 번 수정한다. 나머지 resultCode는 plans에 포함하지 않는다. 각 validationErrors를 체크리스트로 모두 해결하고, 고친 결과의 validationErrors는 빈 배열로 반환한다. factIds에는 실제 사용한 가격·혜택·상품 사실을 빠짐없이 넣는다. 원문 슬롯 수와 역할은 그대로 유지하며 문구를 삭제해 오류를 피하지 않는다: ${JSON.stringify(input.repairPlans, null, 2)}` : "여섯 레퍼런스 각각의 plans를 작성한다."}
JSON 스키마만 반환한다.`;
}

function profilePrompt(references: NativeAdReference[]) {
  return `광고 레퍼런스 이미지의 문구 구조만 분석한다. 상품 전략이나 새 문구는 생성하지 않는다. 각 imagePath를 확인해 headline/support/proof/offer/CTA 역할, 줄 수와 글자 수 예산, 말투, 문장형, 수치 강조, 문장부호 리듬을 기록한다. 원문의 핵심 리터럴 문구는 prohibitedLiteralPhrases에 기록한다. JSON 스키마만 반환한다.\n${JSON.stringify(references.map((reference) => ({ referenceId: reference.id, imagePath: reference.path, layoutFamily: reference.layoutFamily, textDensity: reference.textDensity })), null, 2)}`;
}

function criticPrompt(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[]; copyGuide?: LoadedCopyGuide | null }) {
  return `아래 6개 한국 광고 문구를 한 번에 독립 검수한다. 새 문구를 만들지 말고 점수와 오류만 반환한다.\n창작 맥락 허용 규칙: ${CREATIVE_CONTEXT_POLICY} 따라서 자연스럽게 연결된 계절·시즌·유행·밈·사용 상황이 ProductTruth에 없다는 이유만으로 factualSafety를 감점하거나 오류로 판정하지 않는다.\nCreativePremise 검수 규칙: creativePremise는 레퍼런스 구조를 대체하는 새 청사진이나 인물 세계관이 아니라 그 구조 안에서 사용할 가벼운 소비자 말투 방향이다. 여섯 장에 역할별 장수를 강제하지 않는다. everyday-relationship은 익숙한 관계 또는 생활 주체 하나와 바로 이해되는 장면 하나면 충분하며 직업·경력·성격·시대 배경을 덧붙이면 naturalness 실패다. everyday-question-answer는 실제 소비자가 할 법한 짧은 질문과 짧은 해결을 유지한다. obvious-ad-metaphor는 ‘임금님도 감동할’, ‘오늘 밥상의 주인공’처럼 명백한 비유만 허용하고 실제 이력·인증·전문가 보증처럼 들리면 factualSafety 실패다. ‘수라간 감별관’, ‘상품 큐레이터’, ‘구매 담당’, ‘저녁밥 총무’, ‘욕실 집사’와 상품 1인칭 화자는 naturalness 실패다. usp-focus는 하나의 구체 USP가, comparison-benefit은 같은 상품군의 익명 일반 대안→현재 상품 이점이 보여야 한다. 의료·알레르기·전문가 보증·실제 고객 증언처럼 오인되는 설정은 factualSafety 실패다. ProductTruth 상품 사실은 supportingFactIds 안에서만 쓰되 '가상', '상황극', 'ProductTruth' 같은 내부어는 광고 문구에 노출하지 않는다.\n${sheetClaimPolicy(input.truth)}\n최종 상품 카테고리: ${resolveProductCopyDomain(input.truth.product)}. 상세페이지 원료명에 과일·먹거리 단어가 있어도 바디워시·샤워젤·화장품을 간식이나 음식처럼 말하면 '상품 카테고리 의미 충돌' 치명 오류다. 반대로 실제 식품을 피부·샤워용 제품처럼 말해도 같은 오류다.\n현재 상품에서 미리 정리된 광고 문구 후보:\n${vendorCopyExamplePromptBlock(input.truth)}\n업체별 문구 품질 기준:\n${copyGuidePromptBlock(input.copyGuide)}\n검수 기준: 자연스러운 한국어, 업체별 가이드에 맞는 판매 강도와 최소 7/10 문장력, referenceRawCopy/referenceRawLines의 줄 수·기호·구어체와 수사 의도 보존, source-brand/remove를 제외한 원본 문구 블록과 정보 밀도 보존, 질문→대답·문제→해결·비교→결론·경험→추천 같은 줄 사이 관계 보존, 질문·반전·비교·문제 제기·긴급성 같은 헤드라인 판매 강도 보존, 상품의 사실 주장만 ProductTruth 안에 있는지, ProductTruth 밖 수치·혜택·효능 금지, 후기 작성 날짜·시각·작성자·닉네임 같은 UI 메타데이터 금지, 장면과 문구의 일치, 여섯 결과의 의미 중복 억제. 브랜드명·업체명·판매자명과 업체 업력·순위·수상·브랜드 파워는 한 줄이라도 나오면 치명 오류다. 브랜드는 별도 로고 후처리에서만 허용한다. ProductTruth에 승인된 vendor-research fact가 있으면 그 수치·효능·사용 상황은 정당한 근거이며 강하게 썼다는 이유만으로 감점하지 않는다. source-brand/remove 슬롯은 빈 targetText가 정답이며 현재 상품명·브랜드명으로 채우거나 새 로고 문구로 바꾸면 치명 오류다. 원문 어순을 기계적으로 유지하는 것보다 현재 상품 문장의 주어·서술어·조사·수식 관계·완결성이 우선이다. adaptedLines를 줄바꿈 없이 이어 읽어도 하나의 자연스러운 소비자 문장이 되어야 한다. 사람 주어를 추석·명절·가격·상품 같은 무생물 명사로 단순 치환하거나, 연결 조사·쉼표에서 문장이 끊기거나, 소비자가 의미를 추측해야 하면 naturalness 치명 오류다. ‘명절 메뉴 없더니...’처럼 상황과 주체가 빠진 문구, 계절 단어와 범용 판매어를 이어 붙인 문구도 naturalness 실패다. 처음 보는 소비자가 1초 안에 상황과 제안을 이해할 수 있어야 한다. ‘고기 없이는 못 사는 울 아버지.. 오늘은 이거 드세요’, ‘아침마다 고기 사러 마장동 가세요? 여기서 그냥 시켜요’, ‘임금님도 감동할 진짜 특급한우’처럼 관계 하나·생활 질문 하나·명백한 비유 하나로 끝나는 문장이 좋은 방향이다. 예문을 다른 상품에 그대로 복사하거나 확인되지 않은 특급·등급 사실로 확장하지 않는다. ‘먹어본 사람은 계속 달라고 졸라요’ 같은 반응·후기 문구는 ProductTruth에 후기 근거가 있을 때만 factualSafety를 통과시킨다. 강한 원문 헤드라인을 단순 상품명으로 바꾸거나, 레퍼런스 문장 관계를 버리고 상품 스펙 목록으로 바꾸거나, 동일 상품명·중량을 여러 블록에 반복하거나, 근거 없는 가격·혜택 슬롯을 빈칸으로 지우거나, 전체 문구량을 과도하게 줄이면 referenceFit 실패다. 원문의 말투와 수사 의도를 자연스럽게 보존한 사실 자체는 오류가 아니다. valid는 naturalness ${NATURALNESS_PASS_SCORE}, referenceFit ${REFERENCE_FIT_PASS_SCORE}, factualSafety 90 이상이고 치명 오류가 없을 때만 true다.\n금지 브랜드·업체명: ${JSON.stringify([input.truth.product.advertiserName, input.truth.product.brandName, input.truth.normalized.brandName].filter(Boolean))}\nProductTruth: ${JSON.stringify(factsForPlanning(input.truth))}\nPlans: ${JSON.stringify(input.plans)}\nJSON 스키마만 반환한다.`;
}

async function runCodexJson<T>(prompt: string, outputSchema: object) {
  if (!(await codexLocalAuthenticated({ force: true }))) throw new Error("로컬 Codex 로그인이 없습니다.");
  const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
  const thread = codex.startThread({ workingDirectory: process.cwd(), sandboxMode: "read-only", approvalPolicy: "never", networkAccessEnabled: false, model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", modelReasoningEffort: "medium" });
  const response = await thread.run(prompt, { outputSchema, signal: AbortSignal.timeout(resolveRuntimeTimeout(process.env.ADATLAS_CODEX_REFERENCE_COPY_TIMEOUT_MS, 180_000, 30_000)) });
  return JSON.parse(response.finalResponse) as T;
}

async function runPlanner(prompt: string) {
  return runCodexJson<PlannerPayload>(prompt, plannerSchema);
}

async function reviewPlans(input: { truth: ProductTruth; profiles: ReferenceCopyProfile[]; plans: ReferenceAdaptedCopyPlan[]; copyGuide?: LoadedCopyGuide | null }) {
  const critic = await runCodexJson<CriticPayload>(criticPrompt(input), criticSchema);
  return input.plans.map((plan) => {
    const review = critic.reviews.find((candidate) => candidate.referenceId === plan.referenceId);
    if (!review) return { ...plan, validationStatus: "invalid" as const, validationErrors: [...plan.validationErrors, "일괄 자연스러움 검수 결과가 누락됐습니다."] };
    const deterministicErrors = findReferenceCopyNaturalnessErrors(plan);
    const reviewErrors = [...new Set([...plan.validationErrors, ...review.errors, ...deterministicErrors])];
    const reviewSafetyErrors = plannerDeclaredSafetyErrors(review.errors);
    // critic의 valid 불리언은 같은 점수에서도 흔들릴 수 있다. 서버의 결정적
    // 사실·문장 검증과 명시적 점수를 실행 여부의 기준으로 사용하되, critic이
    // 구체적으로 지적한 사실 안전 오류는 점수와 무관하게 차단한다.
    const valid = plan.validationStatus === "valid" && review.naturalnessScore >= NATURALNESS_PASS_SCORE && review.referenceFitScore >= REFERENCE_FIT_PASS_SCORE && review.factualSafetyScore >= 90 && deterministicErrors.length === 0 && reviewSafetyErrors.length === 0;
    return {
      ...plan,
      naturalnessScore: review.naturalnessScore,
      referenceFitScore: review.referenceFitScore,
      factualSafetyScore: review.factualSafetyScore,
      validationStatus: valid ? "valid" as const : "invalid" as const,
      validationErrors: valid ? [] : reviewErrors.length ? reviewErrors : ["일괄 문구 검수 기준을 통과하지 못했습니다."],
    };
  });
}

export async function prewarmReferenceCopyProfiles(references: NativeAdReference[]) {
  const hashes = await Promise.all(references.map(referenceHash));
  const cached = await readProfileCache();
  const existing = references.map((reference, index) => cached.find((profile) => profile.referenceId === reference.id && profile.referenceHash === hashes[index] && profile.profileVersion === REFERENCE_COPY_PROFILE_VERSION));
  const missingReferences = references.filter((_, index) => !existing[index]);
  if (!missingReferences.length) return { profiles: existing.filter((profile): profile is ReferenceCopyProfile => Boolean(profile)), analyzedCount: 0, fallbackCount: 0 };
  let analyzed: ProfilePayload["profiles"] = [];
  let analysisError = "";
  try {
    analyzed = (await runCodexJson<ProfilePayload>(profilePrompt(missingReferences), profileSchema)).profiles;
  } catch (error) {
    analysisError = error instanceof Error ? error.message : "레퍼런스 문구 구조 분석에 실패했습니다.";
  }
  const created = missingReferences.map((reference) => {
    const index = references.findIndex((candidate) => candidate.id === reference.id);
    const base = fallbackProfile(reference, hashes[index]);
    const raw = analyzed.find((profile) => profile.referenceId === reference.id);
    return raw ? { ...base, ...raw, analysisSource: "codex-local" as const, analysisError: undefined, createdAt: new Date().toISOString() } : { ...base, analysisError };
  });
  await writeProfileCache(created);
  const resolved = references.map((reference, index) => existing[index] || created.find((profile) => profile.referenceId === reference.id) || fallbackProfile(reference, hashes[index]));
  return { profiles: resolved, analyzedCount: created.filter((profile) => profile.analysisSource === "codex-local").length, fallbackCount: created.filter((profile) => profile.analysisSource === "safe-minimal").length };
}

/**
 * 작업 생성 요청은 사용자가 누른 버튼에 즉시 응답해야 한다. AI 문구 기획은
 * 서버 러너가 이어서 수행하고, 그 전까지는 레퍼런스 OCR 구조와 ProductTruth만
 * 사용한 렌더 가능한 초안을 저장한다. 이 초안은 이미지 생성에 바로 사용하지
 * 않고 referenceCopyPlanning 상태가 ready가 된 뒤에만 실행된다.
 */
export async function prepareReferenceAdaptedCopyScaffold(input: { truth: ProductTruth; references: NativeAdReference[] }) {
  const profiles = await Promise.all(input.references.map(async (reference) => {
    const profile = fallbackProfile(reference, await referenceHash(reference));
    const raw = reference.nativeCopy?.useForCopyAdaptation === false ? "" : reference.nativeCopy?.rawText || "";
    return {
      ...profile,
      tone: /ㅋㅋ|;;|\.\.|\?!|!\?/.test(raw) ? "레퍼런스 원문 구어체" : "레퍼런스 원문 말투",
      headlineLineBudget: Math.max(1, Math.min(4, reference.nativeCopy?.textRegions.find((region) => region.role === "headline")?.lines.length || 2)),
      supportLineBudget: Math.max(0, Math.min(5, reference.nativeCopy?.rawLines.length || 2)),
      prohibitedLiteralPhrases: [],
      analysisSource: reference.nativeCopy?.extractionSource === "codex-local" ? "codex-local" as const : "safe-minimal" as const,
    };
  }));
  const premiseSeeds = buildImageCreativePremiseSeeds(input.truth, input.references);
  const fallbackPlans = input.references.map((reference, index) => fallbackPlan(input.truth, reference, profiles[index], index, premiseSeeds[index]));
  return {
    profiles,
    plans: ensureRenderableReferencePlans({
      truth: input.truth,
      references: input.references,
      profiles,
      plans: fallbackPlans,
      premiseSeeds,
    }),
    provider: "fallback" as const,
    warnings: ["작업을 먼저 저장하고 최신 문구 기획을 서버 대기열에서 준비합니다."],
  };
}


export { planningPrompt, runPlanner, reviewPlans };

