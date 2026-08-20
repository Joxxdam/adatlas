import "server-only";
import type { ApprovedAdCopyMemory } from "./types";
import type { GenerationJob, GenerationResult } from "../creative-generation/types";

export const AD_COPY_PROMPT_VERSION = "meta-primary-copy-v1-product-single";

export function buildAdCopyPrompt(input: {
  job: GenerationJob;
  result: GenerationResult;
  approvedCopies: ApprovedAdCopyMemory[];
  retryFailures?: string[];
}) {
  const { job, result } = input;
  const facts = job.productTruth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified")
    .map((fact) => ({ id: fact.id, label: fact.label, value: fact.value, evidenceType: fact.evidenceType }));
  const brief = result.hookPlan.creativeBrief;
  const category = job.creativePlan.categoryCreativeProfile?.category || job.productTruth.product.category;
  const approvedStyle = input.approvedCopies.map((copy) => ({
    languageTraits: copy.languageTraits,
    primaryText: copy.primaryText,
    approvalReason: copy.approvalReason,
  }));
  return `당신은 한국 Meta 퍼포먼스 광고의 시니어 카피라이터다. 완성된 대표 광고 이미지와 대표 후킹을 분석해 이 상품의 Meta '기본 문구(primary text)' 하나만 작성한다.

출력 규칙:
- primaryText는 줄바꿈을 포함한 4~8줄이다. 첫 줄은 대표 후킹과 같은 고객 긴장을 강하게 이어간다.
- 확인된 경우에만 가격·중량·구성·혜택을 넣고, 구매 이유와 확인된 상세 근거, 짧은 CTA로 마무리한다.
- 모바일 피드에서 빠르게 읽히는 직접적이고 자연스러운 한국어를 쓴다.
- 이모지는 브랜드와 카테고리에 맞을 때만 2~5개 쓴다. 프리미엄 브랜드는 없어도 된다.
- 식품은 먹는 장면·맛·구성·준비 편의·확인된 가격을 자연스럽게 연결한다.
- 퍼스널케어는 감각·고객 상황·확인된 USP를 연결하되, 확인되지 않은 체감온도·체취 감소·임상 수치를 쓰지 않는다.
- '지금 만나보세요', '새로운 경험', '일상을 바꾸는', '특별한 선택', '당신을 위한', '프리미엄 라이프', '더 나은 내일', '스마트한 선택', '놓치지 마세요'를 쓰지 않는다.
- 확인되지 않은 가격, 할인율, 구성, 수량, 배송, 리뷰, 판매량, 효능, 인증, 원산지, 기간 한정, 품절 임박을 만들지 않는다.
- 아래 승인 문구는 줄바꿈·강도·직접성·CTA 같은 언어 특성만 학습하고 문장을 그대로 복사하지 않는다.

상품 및 근거:
${JSON.stringify({
  productName: job.productTruth.product.productName,
  brandName: job.productTruth.product.brandName || job.advertiserName,
  category,
  verifiedFacts: facts,
  verifiedClaims: job.productTruth.verifiedClaims,
  prohibitedClaims: [...job.productTruth.blockedClaimPatterns, ...(brief?.prohibitedClaims || [])],
}, null, 2)}

대표 후킹과 제작 브리프:
${JSON.stringify({
  hookId: result.hookPlan.id,
  hookCode: result.hookPlan.hookCode,
  headline: result.hookPlan.headline,
  subCopy: result.hookPlan.body,
  hypothesis: result.hookPlan.hypothesis,
  customerInsight: brief?.customerInsight,
  messageHypothesis: brief?.messageHypothesis,
  creativeBrief: brief ? {
    creativeId: brief.creativeId,
    visualStory: brief.visualStory,
    heroScene: brief.heroScene,
    intendedReaction: brief.intendedReaction,
    verifiedFacts: brief.verifiedFacts,
  } : undefined,
  completedImageQa: result.nativeCreative?.validation ? {
    hookAlignment: result.nativeCreative.validation.hookAlignment,
    factualAccuracy: result.nativeCreative.validation.factualAccuracy,
    productIdentity: result.nativeCreative.validation.productIdentity,
    observedKoreanText: result.nativeCreative.validation.observedKoreanText,
  } : result.qa ? { passed: result.qa.passed, score: result.qa.score } : undefined,
}, null, 2)}

승인 문구 학습 자료:
${JSON.stringify(approvedStyle, null, 2)}

${input.retryFailures?.length ? `직전 안의 검수 실패를 모두 수정한다: ${input.retryFailures.join(" · ")}` : ""}
JSON 스키마에 맞춰 primaryText와 languageTraits만 반환한다.`;
}

export function buildAdCopyQaPrompt(input: {
  job: GenerationJob;
  result: GenerationResult;
  primaryText: string;
}) {
  const facts = input.job.productTruth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified")
    .map((fact) => `${fact.label}: ${fact.value}`);
  return `Meta 기본 문구를 이미지 생성과 분리해 독립 검수한다.
- ProductTruth에 없는 가격·할인·수량·구성·배송·리뷰·효능·수치·긴급성을 찾는다.
- 대표 후킹과 같은 메시지를 이어가는지 확인한다.
- 4~8줄이고 모바일 피드에서 자연스럽게 읽히는지 확인한다.
- 일반적인 AI 문구나 기존 승인 문구의 기계적 복제로 보이면 실패다.

대표 후킹: ${input.result.hookPlan.headline} / ${input.result.hookPlan.body}
확인된 사실: ${JSON.stringify(facts)}
검수 문구:\n${input.primaryText}

JSON 스키마에 맞춰 점수와 failures, recommendation만 반환한다.`;
}
