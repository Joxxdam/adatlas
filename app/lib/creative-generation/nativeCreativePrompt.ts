import type { GenerationJob, GenerationResult } from "./types.ts";
import type { AdvertiserBrandMemory } from "./codexRegistry.server.ts";

export const NATIVE_FINAL_PROMPT_VERSION = "native-final-v2-category-brief-golden";

export function buildNativeFinalCreativePrompt(job: GenerationJob, result: GenerationResult, outputPath: string, feedback?: string, brandMemory?: AdvertiserBrandMemory) {
  const brief = result.hookPlan.creativeBrief;
  const facts = job.productTruth.facts.filter((fact) => fact.verification !== "unverified" && fact.usableInCopy).map((fact) => `- ${fact.label}: ${fact.value} (출처: ${fact.sourceUrl || fact.source})`).join("\n");
  const matrix = job.visualDiversityMatrix?.find((entry) => entry.hookCode === result.hookPlan.hookCode);
  // Jobs created before the category router was introduced do not contain a
  // creativePlan. Keep their saved results reopenable while defaulting new
  // generation to the category-aware direction.
  const category = job.creativePlan?.categoryCreativeProfile;
  const golden = (brandMemory?.goldenReferences || []).slice(0, 3);
  const hasVerifiedReview = job.productTruth.facts.some((fact) => fact.usableInCopy && fact.verification !== "unverified" && (fact.evidenceType === "review" || /후기|리뷰|평점/i.test(`${fact.label} ${fact.key}`)));
  const verifiedFactText = job.productTruth.facts
    .filter((fact) => fact.usableInCopy && fact.verification !== "unverified")
    .map((fact) => fact.value)
    .join(" ");
  const safeProhibitedClaims = (brief?.prohibitedClaims || job.productTruth.blockedClaimPatterns || [])
    .filter((claim) => !job.productTruth.unverifiedClaims?.some((unverified) => claim.includes(unverified) || unverified.includes(claim)))
    .filter((claim) => {
      const numbers = claim.match(/\d[\d,.]*(?:\s*[%℃°]|\s*(?:kg|g|ml|mL|L|개|팩|병|매|입))?/g) || [];
      return numbers.every((value) => verifiedFactText.includes(value));
    });
  return `당신은 한국 퍼포먼스 광고의 시니어 아트디렉터다. imagegen 스킬을 사용해 배경이 아니라 최종 완성 광고 이미지 전체를 한 번에 생성하라.

Create one complete Korean performance advertising creative.
Generate the entire final advertisement in a single AI image creation process.
Include the referenced product naturally and prominently.
Preserve the product identity, package color, quantity and overall label structure.
If a human, hand or usage scene strengthens the hook, include it naturally.
Make the visual scene directly express the message hypothesis.
Do not reuse a fixed template or create a generic studio shot unless the hook requires it.
Do not place all copy in one small corner. Make the main Korean hook immediately readable on mobile.
Do not invent product claims, prices, reviews or certifications.
Do not copy any reference advertisement layout literally.
Output a commercially usable, high-impact Meta feed advertisement.

[출력]
- 정확히 1200×1200 정사각형 광고 한 장
- 장면, 실제 상품, 한국어 카피, 타이포그래피, 그래픽 도형, 레이아웃을 이미지 생성 단계에서 모두 완성
- 결과를 반드시 ${outputPath} 에 저장
- 코드/SVG/Canvas/Sharp로 글자나 상품을 사후 합성하지 말 것

[상품]
상품명: ${job.productTruth.product.productName}
브랜드: ${job.productTruth.product.brandName || job.advertiserName || ""}
검증 사실:
${facts || "- 확인된 수치·혜택 없음. 제공된 상품명과 이미지 밖의 사실을 만들지 말 것."}

[카테고리별 광고 문법 - 템플릿이 아닌 아트디렉션]
분류: ${category?.category || "general"} · ${category?.label || "일반 상품"}
선택 이유: ${category?.reason || "상품과 후킹에 맞는 독립 장면을 구성"}
시각 목표: ${category?.visualObjectives.join(" / ") || "상품 식별성과 후킹 전달"}
상품 연출: ${category?.productPresentation.join(" / ") || "상품을 핵심 피사체로 사용"}
사람 사용 원칙: ${category?.recommendedHumanUsage.join(" / ") || "후킹에 도움이 될 때만 자연스럽게 사용"}
타이포그래피: ${category?.typographyDirection.join(" / ") || "모바일에서 즉시 읽히는 한국어"}
금지: ${category?.avoidList.join(" / ") || "고정 템플릿·상품 왜곡·허위 정보"}

[광고주 공통 기억]
- 승인 방향: ${brandMemory?.approvedDirections.join(" / ") || "없음"}
- 제외 방향: ${brandMemory?.rejectedDirections.join(" / ") || "없음"}
- 일반 피드백: ${brandMemory?.feedback.join(" / ") || "없음"}
- 위 기억은 표현 방향에만 사용하고, 이전 상품의 가격·구성·리뷰·이미지나 상품 사실로 해석하지 말 것

[골든 레퍼런스]
${golden.length ? golden.map((reference, index) => `- 시각 참조 ${index + 1}: ${reference.category} / ${reference.visualArchetype} / 재사용 가능한 추상 특성: ${reference.reusableStyleTraits.join(" · ")} / 승인 이유: ${reference.approvalReason}`).join("\n") : "- 등록된 골든 레퍼런스 없음"}
- 골든 레퍼런스 이미지는 상품 이미지 뒤에 별도 시각 참조로 전달된다.
- 색 대비, 문구 강도, 제품 비중, 감정, 장면 설계 같은 추상 특성만 참고한다.
- 레이아웃·문구·상품을 그대로 복사하지 않는다. 특히 골든 레퍼런스의 메인/서브 문구를 현재 광고에 쓰지 않는다.

[후킹 ${result.hookPlan.hookCode}]
메인 문구(한글 철자 그대로): ${result.hookPlan.headline}
서브 문구(한글 철자 그대로): ${result.hookPlan.body}
CTA(한글 철자 그대로): ${result.hookPlan.cta}
메시지 가설: ${result.hookPlan.hypothesis}
장면: ${brief?.sceneDescription || result.scenePlan.sceneAsset.scene}
비주얼 스토리: ${brief?.visualStory || result.hookPlan.sceneIntent}
고객 상황: ${brief?.customerSituation || brief?.customerInsight || "확인 가능한 사용 상황"}
의도 반응: ${brief?.intendedReaction || "메시지를 즉시 이해하고 상품에 관심"}
Visual Archetype: ${brief?.visualArchetype || "product-hero"}
Hero Scene: ${brief?.heroScene || brief?.sceneDescription || result.hookPlan.sceneIntent}
사람/손의 역할: ${brief?.humanRole || "후킹에 도움이 될 때만 자연스럽게 사용"}
제품 역할: ${brief?.productRole || "실제 판매 상품이 핵심 피사체"}
카메라: ${brief?.cameraAngle || brief?.cameraDirection || "상품을 왜곡하지 않는 상업 광고 시점"}
구도: ${brief?.composition || "후킹과 상품이 한눈에 연결되는 구성"}
색감: ${brief?.colorPalette || brief?.colorDirection || "상품색과 후킹 감정에 맞는 대비"}
조명: ${brief?.lighting || brief?.lightingDirection || "상품 재질을 살리는 상업 조명"}
한국어 타이포그래피: ${brief?.typographyDirection || brief?.typographyStyle || "모바일에서 즉시 읽히는 대형 한글"}
보조 요소: ${brief?.supportingElements?.join(" / ") || "후킹을 설명하는 최소한의 요소"}
다른 후킹과의 차이: ${brief?.differentiationFromOtherHooks || "장면·카메라·제품 배치·타이포그래피를 반복하지 않음"}
다양성 지시: ${matrix ? JSON.stringify(matrix) : "다른 후킹과 다른 독립 장면"}

[제품 보존]
- 먼저 전달한 상세페이지 상품 원본 사진 최대 5장을 제품 동일성 참조로 사용
- 패키지 실루엣, 색상, 로고, 라벨의 핵심 인상을 최대한 훼손하지 말 것
- 다른 제품, 가짜 옵션, 임의 수량을 추가하지 말 것
- 자동 누끼나 훼손된 배경제거 이미지를 제품 기준으로 사용하지 말 것
- 브랜드명·용량·세트 구성·뚜껑과 용기 형태를 원본과 최대한 동일하게 유지

[사실·후기 안전]
- 금지 주장: ${safeProhibitedClaims.join(" / ") || "검증 사실 밖의 모든 가격·효능·수치·후기·인증"}
- 실제 후기 근거 존재: ${hasVerifiedReview ? "예. 허용된 후기 사실의 의미만 사용할 수 있음" : "아니오. 후기 문장, 댓글, 닉네임, 별점, 댓글 수, 커뮤니티 캡처를 생성하지 말 것"}
- 가격·중량·구성·임상 수치는 위 검증 사실에 정확히 존재할 때만 이미지에 포함

[상업 품질]
- 업체 미팅에서 즉시 보여줄 수 있는 전문 광고 완성도
- 모바일 피드에서 1초 내 메인 후킹이 읽히는 대비와 위계
- 메인 후킹 1개, 서브 1개, 검증 근거 또는 혜택 1개, 필요한 경우 짧은 CTA 1개 이내
- 문구를 한쪽 작은 모서리에 몰지 말고 제품과 경쟁하지 않는 명확한 위계
- 제품이 명확한 주인공이며 장면에 자연스럽게 접지
- 워터마크, 목업 프레임, 설명용 주석 금지
${feedback ? `\n[이번 AI 수정 요청]\n${feedback}\n기존 이미지의 문제를 직접 고쳐 새 완성 광고로 저장하라.` : ""}`;
}

export function buildNativeValidationPrompt(job: GenerationJob, result: GenerationResult) {
  const facts = job.productTruth.facts.filter((fact) => fact.verification !== "unverified" && fact.usableInCopy).map((fact) => `${fact.label}: ${fact.value}`).join(" / ");
  const category = job.creativePlan?.categoryCreativeProfile?.category || "general";
  const brief = result.hookPlan.creativeBrief;
  return `첨부된 완성 광고를 엄격히 검수하라. 상품 참조 이미지와 비교하고, 실제 보이는 한국어 문구를 OCR처럼 옮겨 적어라. 아래 허용 사실에 있는 가격·수치·혜택은 사실로 인정하고, 목록에 없는 주장만 factualAccuracy를 낮춰라. 허용 사실: ${facts || "없음"}. 기대 문구: ${result.hookPlan.headline} / ${result.hookPlan.body} / ${result.hookPlan.cta}. 상품: ${job.productTruth.product.productName}. 카테고리: ${category}. 기대 장면: ${brief?.heroScene || brief?.sceneDescription || result.hookPlan.sceneIntent}. 기대 visualArchetype: ${brief?.visualArchetype || "product-hero"}. 사람 역할: ${brief?.humanRole || "없음"}.
제품 동일성·노출 크기, 사람·손의 자연스러움, 한국어 정확성·모바일 가독성, 후킹-장면 일치, 카테고리 적합성, 가격·수치 정확성을 평가한다. 식품이면 실제 원물·조리 상태와 먹음직스러움을 foodAppetiteAppeal로, 화장품·퍼스널케어이면 효능에 맞는 감각 표현을 sensoryExpression으로 평가한다. 해당하지 않는 카테고리의 전용 점수는 100으로 둔다. 모든 점수는 0~100 정수이며 과대평가하지 말라.`;
}

export function buildNativeGroupValidationPrompt(job: GenerationJob) {
  const hooks = job.results.map((result) => ({
    hookCode: result.hookPlan.hookCode,
    mainHook: result.hookPlan.headline,
    messageHypothesis: result.hookPlan.hypothesis,
    intendedScene: result.hookPlan.creativeBrief?.sceneDescription || result.hookPlan.sceneIntent,
  }));
  return `첨부한 3×2 콘택트시트는 같은 상품의 후킹 6개 광고다. 개별 디자인 점수가 아니라 그룹 다양성을 엄격히 검수하라.
${JSON.stringify(hooks, null, 2)}
장면, 상품 배치·크기, 카메라, 색·무드, 타이포그래피, visualArchetype, 메시지의 구분, 후킹과 장면의 연결, 카테고리 적합성을 각각 0~100으로 평가한다. 6장 중 최소 4개가 서로 다른 visualArchetype으로 보이지 않거나 문구만 다르고 배경·제품 배치가 사실상 같으면 실패다. 그런 쌍을 duplicatePairs에 적고, 그중 다시 만들 최소 hook code만 reviseHookCodes에 적어라. 중복이 없고 각 메시지가 독립적으로 보이면 approve, 자동 수정 가능한 중복이면 revise, 판단이 어렵거나 반복 수정 후에도 유사하면 manual-review로 반환하라.`;
}
