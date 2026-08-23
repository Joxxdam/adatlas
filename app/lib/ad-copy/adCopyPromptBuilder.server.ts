import "server-only";
import type { ApprovedAdCopyMemory } from "./types";
import type { GenerationJob, GenerationResult } from "../creative-generation/types";

export const AD_COPY_PROMPT_VERSION = "meta-primary-copy-v3-product-truth-first";

export function buildAdCopyPrompt(input: { job: GenerationJob; result: GenerationResult; approvedCopies: ApprovedAdCopyMemory[]; copyGuideContent?: string; retryFailures?: string[] }) {
  const { job, result } = input;
  const facts = job.productTruth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified").map((fact) => ({ id: fact.id, label: fact.label, value: fact.value, evidenceType: fact.evidenceType }));
  const brief = result.hookPlan.creativeBrief;
  const category = job.creativePlan.categoryCreativeProfile?.category || job.productTruth.product.category;
  const copyGuide = (input.copyGuideContent || job.productTruth.product.copyGuideContext?.content || "").slice(0, 7_000);
  const approvedStyle = input.approvedCopies.map((copy) => ({
    languageTraits: copy.languageTraits,
    primaryText: copy.primaryText,
    adTitle: copy.adTitle,
    approvalReason: copy.approvalReason,
  }));
  return `당신은 한국 Meta 퍼포먼스 광고의 시니어 카피라이터다. 이미지 제작을 기다리지 않고 검증된 ProductTruth와 대표 후킹을 분석해 이 상품의 Meta '기본 문구(primaryText)' 하나와 짧은 '광고 제목(adTitle)' 하나를 작성한다.

출력 규칙:
- primaryText는 5~8개의 짧은 문장 줄로 쓴다. 의미 단락 사이에는 빈 줄을 최대 2개 넣어 모바일에서 숨 쉴 틈을 만든다.
- 첫 줄은 "이게 이 가격이라고?!", "괜히 1등이 아니라니까?"처럼 상품에 맞는 놀람·질문·반전형 구어체로 강하게 시작한다. 이 예문 자체나 확인되지 않은 사실은 복사하지 않는다.
- 이어지는 줄은 확인된 가격·중량·구성·혜택 중 가장 강한 사실을 짧게 강조하고, 고객의 의심을 받아치는 한마디와 구매 이유를 붙인다.
- 마지막은 딱딱한 정형 CTA보다 사람에게 말하듯 자연스럽게 행동을 권한다.
- 전체 말투는 SNS 게시글처럼 직접적이고 리듬감 있게 쓴다. 필요하면 ?!, !!!, .., 👉 같은 표현을 제한적으로 사용할 수 있다.
- 이모지는 카테고리에 맞는 2~6개를 문장 끝이나 강조 지점에만 사용한다. 모든 줄에 기계적으로 붙이지 않고 같은 이모지를 과도하게 반복하지 않는다.
- 식품은 가격 놀람·맛과 식감·먹는 상황·구성·준비 편의를 연결한다. 강한 감탄형 말투는 허용하되 근거 없는 도매가·최저가·잡내 없음·신선도·등급을 만들지 않는다.
- 퍼스널케어·화장품은 대담한 질문형 첫 문장 뒤에 향·사용 상황·확인된 원료나 USP를 연결한다. 근거 없는 국가 1위·체취 제거·효능·체감온도·임상 표현은 만들지 않는다.
- adTitle은 6~24자 정도의 한 줄 제목이다. 상품명 반복보다 클릭 이유가 되는 호기심형 문구로 만들고, 가격·수치·1위 표현은 확인된 경우에만 쓴다.
- primaryText와 adTitle 모두 '지금 만나보세요', '새로운 경험', '일상을 바꾸는', '특별한 선택', '당신을 위한', '프리미엄 라이프', '더 나은 내일', '스마트한 선택' 같은 일반적인 AI 문구를 쓰지 않는다.
- 확인되지 않은 가격, 할인율, 구성, 수량, 배송, 리뷰, 판매량, 효능, 인증, 원산지, 기간 한정, 품절 임박을 만들지 않는다.
- 아래 업체 카피 가이드와 승인 문구는 줄바꿈·강도·직접성·CTA 같은 언어 특성만 학습한다. 가이드 속 예시 수치·주장·문장을 현재 상품 사실처럼 복사하지 않는다.

상품 및 근거:
${JSON.stringify(
  {
    productName: job.productTruth.product.productName,
    brandName: job.productTruth.product.brandName || job.advertiserName,
    category,
    verifiedFacts: facts,
    verifiedClaims: job.productTruth.verifiedClaims,
    prohibitedClaims: [...job.productTruth.blockedClaimPatterns, ...(brief?.prohibitedClaims || [])],
  },
  null,
  2
)}

대표 후킹과 제작 브리프:
${JSON.stringify(
  {
    hookId: result.hookPlan.id,
    hookCode: result.hookPlan.hookCode,
    headline: result.hookPlan.headline,
    subCopy: result.hookPlan.body,
    hypothesis: result.hookPlan.hypothesis,
    customerInsight: brief?.customerInsight,
    messageHypothesis: brief?.messageHypothesis,
    creativeBrief: brief
      ? {
          creativeId: brief.creativeId,
          visualStory: brief.visualStory,
          heroScene: brief.heroScene,
          intendedReaction: brief.intendedReaction,
          verifiedFacts: brief.verifiedFacts,
        }
      : undefined,
    completedImageQa: result.nativeCreative?.validation
      ? {
          hookAlignment: result.nativeCreative.validation.hookAlignment,
          factualAccuracy: result.nativeCreative.validation.factualAccuracy,
          productIdentity: result.nativeCreative.validation.productIdentity,
          observedKoreanText: result.nativeCreative.validation.observedKoreanText,
        }
      : result.qa
        ? { passed: result.qa.passed, score: result.qa.score }
        : undefined,
  },
  null,
  2
)}

업체 카피 가이드:
${copyGuide || "별도 업체 가이드 없음 · 위 공통 SNS 퍼포먼스 톤을 적용"}

승인 문구 학습 자료:
${JSON.stringify(approvedStyle, null, 2)}

${input.retryFailures?.length ? `직전 안의 검수 실패를 모두 수정한다: ${input.retryFailures.join(" · ")}` : ""}
JSON 스키마에 맞춰 primaryText, adTitle, languageTraits만 반환한다.`;
}

export function buildAdCopyQaPrompt(input: { job: GenerationJob; result: GenerationResult; primaryText: string; adTitle: string }) {
  const facts = input.job.productTruth.facts.filter((fact) => fact.usableInCopy && fact.verification !== "unverified").map((fact) => `${fact.label}: ${fact.value}`);
  return `Meta 기본 문구를 이미지 생성과 분리해 독립 검수한다.
- ProductTruth에 없는 가격·할인·수량·구성·배송·리뷰·효능·수치·긴급성을 찾는다.
- 대표 후킹과 같은 메시지를 이어가는지 확인한다.
- primaryText가 5~8개의 짧은 문장 줄이고, adTitle이 6~24자 정도의 자연스러운 한 줄인지 확인한다.
- SNS 광고처럼 강한 첫 문장·적당한 이모지·구어체 리듬을 갖추되 과장된 사실을 만들지 않았는지 확인한다.
- 일반적인 AI 문구나 기존 승인 문구의 기계적 복제로 보이면 실패다.

대표 후킹: ${input.result.hookPlan.headline} / ${input.result.hookPlan.body}
확인된 사실: ${JSON.stringify(facts)}
검수 문구:\n${input.primaryText}
광고 제목: ${input.adTitle}

JSON 스키마에 맞춰 점수와 failures, recommendation만 반환한다.`;
}
