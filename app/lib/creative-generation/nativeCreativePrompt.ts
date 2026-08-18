import type { GenerationJob, GenerationResult } from "./types.ts";
import type { AdvertiserBrandMemory } from "./codexRegistry.server.ts";

export const NATIVE_FINAL_PROMPT_VERSION = "native-final-v1";

export function buildNativeFinalCreativePrompt(job: GenerationJob, result: GenerationResult, outputPath: string, feedback?: string, brandMemory?: AdvertiserBrandMemory) {
  const brief = result.hookPlan.creativeBrief;
  const facts = job.productTruth.facts.filter((fact) => fact.verification !== "unverified" && fact.usableInCopy).map((fact) => `- ${fact.label}: ${fact.value} (출처: ${fact.sourceUrl || fact.source})`).join("\n");
  const matrix = job.visualDiversityMatrix?.find((entry) => entry.hookCode === result.hookPlan.hookCode);
  return `당신은 한국 퍼포먼스 광고의 시니어 아트디렉터다. imagegen 스킬을 사용해 배경이 아니라 최종 완성 광고 이미지 전체를 한 번에 생성하라.

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

[광고주 공통 기억]
- 승인 방향: ${brandMemory?.approvedDirections.join(" / ") || "없음"}
- 제외 방향: ${brandMemory?.rejectedDirections.join(" / ") || "없음"}
- 일반 피드백: ${brandMemory?.feedback.join(" / ") || "없음"}
- 위 기억은 표현 방향에만 사용하고, 이전 상품의 가격·구성·리뷰·이미지나 상품 사실로 해석하지 말 것

[후킹 ${result.hookPlan.hookCode}]
메인 문구(한글 철자 그대로): ${result.hookPlan.headline}
서브 문구(한글 철자 그대로): ${result.hookPlan.body}
CTA(한글 철자 그대로): ${result.hookPlan.cta}
메시지 가설: ${result.hookPlan.hypothesis}
장면: ${brief?.sceneDescription || result.scenePlan.sceneAsset.scene}
비주얼 스토리: ${brief?.visualStory || result.hookPlan.sceneIntent}
다양성 지시: ${matrix ? JSON.stringify(matrix) : "다른 후킹과 다른 독립 장면"}

[제품 보존]
- 함께 전달한 상세페이지 상품 사진 1~4장을 시각 참조로 사용
- 패키지 실루엣, 색상, 로고, 라벨의 핵심 인상을 최대한 훼손하지 말 것
- 다른 제품, 가짜 옵션, 임의 수량을 추가하지 말 것

[상업 품질]
- 업체 미팅에서 즉시 보여줄 수 있는 전문 광고 완성도
- 모바일 피드에서 1초 내 메인 후킹이 읽히는 대비와 위계
- 제품이 명확한 주인공이며 장면에 자연스럽게 접지
- 워터마크, 목업 프레임, 설명용 주석 금지
${feedback ? `\n[이번 AI 수정 요청]\n${feedback}\n기존 이미지의 문제를 직접 고쳐 새 완성 광고로 저장하라.` : ""}`;
}

export function buildNativeValidationPrompt(job: GenerationJob, result: GenerationResult) {
  const facts = job.productTruth.facts.filter((fact) => fact.verification !== "unverified" && fact.usableInCopy).map((fact) => `${fact.label}: ${fact.value}`).join(" / ");
  return `첨부된 완성 광고를 엄격히 검수하라. 상품 참조 이미지와 비교하고, 실제 보이는 한국어 문구를 OCR처럼 옮겨 적어라. 아래 허용 사실에 있는 가격·수치·혜택은 사실로 인정하고, 목록에 없는 주장만 factualAccuracy를 낮춰라. 허용 사실: ${facts || "없음"}. 기대 문구: ${result.hookPlan.headline} / ${result.hookPlan.body} / ${result.hookPlan.cta}. 상품: ${job.productTruth.product.productName}. 모든 점수는 0~100 정수이며 과대평가하지 말라.`;
}
