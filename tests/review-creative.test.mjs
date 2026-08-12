import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildReviewHeadline,
  dedupeReviewCandidates,
  detectPrivacyRegions,
  inferReviewType,
  recommendReviewCrop,
  recommendReviewTemplate,
  reviewCandidateContextScore,
  selectKeyReviewSentence,
} from "../app/lib/mvp/reviewCreative.ts";

function candidate(overrides = {}) {
  return {
    id: "review-a",
    imagePath: "/uploaded-source-images/review-test-source.png",
    width: 1200,
    height: 900,
    sourceType: "upload",
    reviewType: "review-text-screenshot",
    classificationConfidence: 0.9,
    ocrText: "쓰자마자 시원해서 놀랐어요",
    ocrProvider: "apple-vision",
    ocrConfidence: 0.9,
    keySentence: "쓰자마자 시원해서 놀랐어요",
    imageQualityScore: 0.9,
    productRelevanceScore: 0.9,
    hookStrengthScore: 0.9,
    specificityScore: 0.8,
    privacyRiskScore: 0.2,
    policyRiskScore: 0,
    overallReviewScore: 0.9,
    textRegions: [],
    photoRegions: [],
    privacyRegions: [],
    recommendedCrop: { x: 0.1, y: 0.1, width: 0.8, height: 0.7 },
    cropConfidence: 0.9,
    automaticCropAvailable: true,
    warnings: [],
    ...overrides,
  };
}


test("후기 문맥을 일반 상품 이미지보다 높게 평가하고 유형을 구분한다", () => {
  const reviewScore = reviewCandidateContextScore({
    url: "https://shop.example/data/reviewimg/1.jpg",
    context: "구매 후기 댓글",
    width: 1200,
    height: 900,
  });
  const productScore = reviewCandidateContextScore({
    url: "https://shop.example/product/main.jpg",
    context: "대표 상품 이미지",
    width: 1200,
    height: 1200,
  });
  assert.ok(reviewScore > productScore + 40);
  assert.equal(
    inferReviewType({ sourceContext: "커뮤니티 댓글 반응", ocrText: "댓글 12", textRegionCount: 3 }).type,
    "community-reaction"
  );
  assert.equal(
    inferReviewType({ sourceContext: "사용 전 before 사용 후 after", textRegionCount: 2 }).type,
    "before-after"
  );
  assert.equal(
    inferReviewType({
      sourceContext: "ThumbImage 베스트 리뷰",
      ocrText: "땀찌든 날 냄새 싹 쿨하게 ORIGINAL SOURCE SHOWER 250ml",
      textRegionCount: 10,
    }).type,
    "not-review"
  );
});

test("실제 OCR 문장에서 핵심 문장을 고르고 개인정보 영역을 기본 가림 처리한다", () => {
  const text = "2026.07.15 14:30\n(108.104.***)\n오리지널소스 민트 샤워젤 쓰자마자 시원해서 소리지름";
  assert.match(selectKeyReviewSentence(text, "오리지널소스 민트 샤워젤"), /쓰자마자 시원/);
  const regions = [
    { id: "a", role: "text", text: "(108.104.***)", confidence: 1, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 } },
    { id: "b", role: "text", text: "2026.07.15 14:30", confidence: 1, box: { x: 0.7, y: 0.1, width: 0.2, height: 0.05 } },
    { id: "c", role: "text", text: "쓰자마자 시원해서 소리지름", confidence: 1, box: { x: 0.1, y: 0.4, width: 0.7, height: 0.08 } },
  ];
  const masks = detectPrivacyRegions(regions, []);
  assert.equal(masks.length, 2);
  assert.ok(masks.every((mask) => mask.enabled));
});

test("핵심 문장 주변을 포함해 크롭하고 고해상도 중복 후보를 유지한다", () => {
  const regions = [
    { id: "a", role: "text", text: "작성자 ***", confidence: 1, box: { x: 0.05, y: 0.1, width: 0.2, height: 0.05 } },
    { id: "b", role: "text", text: "쓰자마자 시원해서 소리지름", confidence: 1, box: { x: 0.08, y: 0.4, width: 0.75, height: 0.08 } },
    { id: "c", role: "text", text: "나는 이거 쓰고 계속 찾게 됨", confidence: 1, box: { x: 0.08, y: 0.5, width: 0.7, height: 0.08 } },
  ];
  const result = recommendReviewCrop({ type: "review-text-screenshot", textRegions: regions, keySentence: "쓰자마자 시원해서 소리지름", width: 1200, height: 900 });
  assert.ok(result.crop.y <= 0.4);
  assert.ok(result.crop.y + result.crop.height >= 0.58);
  const low = candidate({ id: "low", width: 500, height: 500, contentHash: "same" });
  const high = candidate({ id: "high", width: 1500, height: 1500, contentHash: "same" });
  assert.deepEqual(dedupeReviewCandidates([low, high]).map((item) => item.id), ["high"]);
});

test("후기 유형과 개수에 맞춰 공통 템플릿을 추천하고 원문 기반 후킹을 만든다", () => {
  assert.equal(recommendReviewTemplate([candidate({ reviewType: "before-after" })]), "before-after-usage");
  assert.equal(recommendReviewTemplate([candidate(), candidate({ id: "b" })], ["review-a", "b"]), "review-collection");
  assert.equal(recommendReviewTemplate([candidate({ reviewType: "community-reaction", keySentence: "짧은 댓글" })]), "reaction-comment");
  assert.match(buildReviewHeadline(candidate()), /쓰자마자 시원/);
});
