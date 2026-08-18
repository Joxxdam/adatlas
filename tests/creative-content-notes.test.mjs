import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCreativeContentNotesToCopy,
  contentNotePromptContext,
  resolveCreativeContentNotes,
  validateCreativeContentNotes,
} from "../app/lib/creative-content-notes/service.ts";
import { buildCreativePlan, planScenes } from "../app/lib/creative-generation/planner.ts";
import { buildProductTruth, validateCopyAgainstTruth } from "../app/lib/creative-generation/productTruth.ts";

function note(overrides = {}) {
  return {
    id: `note-${Math.random()}`,
    advertiserId: "adv",
    scope: "advertiser",
    scopeId: "adv",
    type: "FREEFORM",
    title: "참고",
    content: "자연스럽게",
    required: false,
    prohibited: false,
    active: true,
    startsAt: null,
    endsAt: null,
    source: "user",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

const context = { advertiserId: "adv", categoryId: "beauty", productId: "mint", promotionId: "summer", at: "2026-08-12T00:00:00Z" };

test("광고주→카테고리→상품→프로모션 범위를 모두 매칭하고 구체 범위를 우선한다", () => {
  const result = resolveCreativeContentNotes([
    note({ id: "advertiser", scope: "advertiser", scopeId: "adv" }),
    note({ id: "category", scope: "category", scopeId: "beauty" }),
    note({ id: "product", scope: "product", scopeId: "mint" }),
    note({ id: "promotion", scope: "promotion", scopeId: "summer" }),
    note({ id: "other", scope: "product", scopeId: "other" }),
  ], context);
  assert.deepEqual(result.notes.map((item) => item.id), ["promotion", "product", "category", "advertiser"]);
});

test("필수·금지 규칙은 일반 참고사항보다 항상 우선한다", () => {
  const result = resolveCreativeContentNotes([
    note({ id: "general-product", scope: "product", scopeId: "mint" }),
    note({ id: "required-advertiser", required: true, content: "브랜드명" }),
  ], context);
  assert.equal(result.notes[0].id, "required-advertiser");
});

test("비활성·시작 전·종료 후 참고사항은 적용하지 않는다", () => {
  const result = resolveCreativeContentNotes([
    note({ id: "inactive", active: false }),
    note({ id: "future", startsAt: "2026-09-01T00:00:00Z" }),
    note({ id: "expired", endsAt: "2026-07-01T00:00:00Z" }),
    note({ id: "active" }),
  ], context);
  assert.deepEqual(result.notes.map((item) => item.id), ["active"]);
});

test("같은 문구의 필수와 금지 참고사항 충돌을 차단 상태로 만든다", () => {
  const result = resolveCreativeContentNotes([
    note({ id: "must", type: "MUST_INCLUDE", content: "민트 쿨링", required: true }),
    note({ id: "ban", type: "PROHIBITED_EXPRESSION", content: "민트 쿨링", prohibited: true }),
  ], context);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].blocking, true);
  assert.deepEqual(result.notes[0].conflictsWith.length, 1);
});

test("금지 표현을 제거하고 필수 문구를 자동 추가한다", () => {
  const resolved = resolveCreativeContentNotes([
    note({ id: "must", type: "MUST_INCLUDE", content: "오리지널 소스", required: true }),
    note({ id: "ban", type: "PROHIBITED_EXPRESSION", content: "100% 효과", prohibited: true }),
  ], context).notes;
  const applied = applyCreativeContentNotesToCopy({ headline: "100% 효과", body: "민트 샤워젤", proof: "", offer: "", cta: "보기" }, resolved);
  assert.equal(applied.compliance.state, "repaired");
  assert.equal(applied.copy.headline.includes("100% 효과"), false);
  assert.equal(applied.copy.body.includes("오리지널 소스"), true);
  assert.equal(applied.compliance.repairs.length, 2);
});

test("보정 이후에도 필수 누락이나 금지 표현이 있으면 검출한다", () => {
  const notes = resolveCreativeContentNotes([note({ id: "must", type: "MUST_INCLUDE", content: "필수" , required: true }), note({ id: "ban", type: "PROHIBITED_EXPRESSION", content: "금지", prohibited: true })], context).notes;
  const checked = validateCreativeContentNotes("금지 문구만 있음", notes);
  assert.deepEqual(checked.requiredMissing, ["필수"]);
  assert.deepEqual(checked.prohibitedFound, ["금지"]);
});

test("충돌 참고사항은 자동 보정하지 않고 생성을 차단한다", () => {
  const notes = resolveCreativeContentNotes([note({ id: "a", content: "동일", required: true }), note({ id: "b", content: "동일", prohibited: true })], context).notes;
  const result = applyCreativeContentNotesToCopy({ headline: "", body: "", proof: "", offer: "", cta: "" }, notes);
  assert.equal(result.compliance.state, "blocked");
});

test("프롬프트 컨텍스트는 내용과 우선순위만 구조화해 전달한다", () => {
  const notes = resolveCreativeContentNotes([note({ id: "tone", type: "TONE_OF_VOICE", content: "짧고 명확하게" })], context).notes;
  assert.deepEqual(contentNotePromptContext(notes), [{ id: "tone", type: "TONE_OF_VOICE", instruction: "짧고 명확하게", required: false, prohibited: false, priority: 10 }]);
});

test("금지 참고사항은 ProductTruth의 차단 패턴에 포함된다", () => {
  const appliedContentNotes = resolveCreativeContentNotes([note({ id: "ban", type: "PROHIBITED_EXPRESSION", content: "완치", prohibited: true })], context).notes;
  const truth = buildProductTruth({ product: { productName: "민트젤", category: "뷰티", price: "12,000원", discountInfo: "", mainBenefit: "상쾌한 사용감", targetCustomer: "성인", landingUrl: "https://example.com/mint", productImagePath: "/mint.jpg", backgroundImagePath: "", creativeContext: { advertiserId: "adv", productId: "mint", appliedContentNotes } }, source: "landing-page" });
  assert.equal(truth.productId, "mint");
  assert.equal(validateCopyAgainstTruth("피부 완치", truth).valid, false);
});

test("근거가 있는 추천 후킹과 USP·배경 참고사항이 6장 후킹 계획에 반영된다", () => {
  const appliedContentNotes = resolveCreativeContentNotes([
    note({ id: "usp", type: "PRODUCT_USP", content: "민트 사용감" }),
    note({ id: "review", type: "REVIEW_INSIGHT", content: "사용 후 산뜻하다는 후기" }),
    note({ id: "hook", type: "PREFERRED_HOOK", content: "review-ugc" }),
    note({ id: "background", type: "BACKGROUND_STYLE", content: "청량한 파란 배경" }),
  ], context).notes;
  const truth = buildProductTruth({ product: { productName: "민트젤", category: "뷰티", price: "12,000원", discountInfo: "", mainBenefit: "상쾌한 사용감", targetCustomer: "성인", landingUrl: "https://example.com/mint", productImagePath: "/mint.jpg", backgroundImagePath: "", creativeContext: { advertiserId: "adv", productId: "mint", recommendedHookTypes: ["price-value"], appliedContentNotes } }, source: "landing-page" });
  const plan = buildCreativePlan(truth);
  assert.equal(plan.hookPlans[0].hookType, "review-ugc");
  assert.equal(plan.hookPlans[1].body.includes("민트 사용감"), true);
  const library = Array.from({ length: 6 }, (_, index) => ({
    id: `bg-${index}`, file: `/bg-${index}.jpg`, enabled: true, category: "beauty",
    subcategories: ["샤워젤"], industries: ["뷰티"], assetType: "lifestyle_photo",
    hookTypes: ["review_ugc", "price_offer", "problem_solution", "usp_proof", "situation"],
    ageGroups: ["no_people"], peopleType: ["no_people"], peopleCount: 0,
    includesPerson: false, personPosition: "none", personGaze: "none", personEmotion: "",
    personAction: "", scene: `bathroom-${index}`, mood: ["clean"], elements: ["water"],
    colors: ["#00aacc"], productPosition: "center", textSafeArea: "top-left", focalArea: "center",
    brightness: "bright", contrast: "medium", orientation: "square", sourceType: "stock_photo",
    sourceName: "test", sourcePageUrl: "https://example.com", originalImageUrl: "https://example.com/bg.jpg",
    licenseUrl: "https://example.com/license", authorName: "test", width: 1200, height: 1200,
    fileSize: 1000, hash: `hash-${index}`,
  }));
  const scenes = planScenes(plan, library, false);
  assert.equal(scenes.every((scene) => scene.reason.includes("청량한 파란 배경")), true);
});

test("근거 없는 후기 선호는 강제하지 않고 제외 후킹 없이 안전한 6개 가설을 만든다", () => {
  const appliedContentNotes = resolveCreativeContentNotes([
    note({ id: "preferred", type: "PREFERRED_HOOK", content: "review-ugc" }),
    note({ id: "avoided", type: "AVOIDED_HOOK", content: "긴급 후킹은 다음 제작에서 제외" }),
  ], context).notes;
  const truth = buildProductTruth({
    product: {
      productName: "민트젤", category: "뷰티", price: "12,000원", discountInfo: "", mainBenefit: "상쾌한 사용감",
      targetCustomer: "성인", landingUrl: "https://example.com/mint", productImagePath: "/mint.jpg", backgroundImagePath: "",
      creativeContext: { advertiserId: "adv", productId: "mint", opportunityType: "RISING_PRODUCT", recommendedHookTypes: ["urgency", "price-value"], appliedContentNotes },
    },
    source: "landing-page",
  });
  const plan = buildCreativePlan(truth);
  assert.equal(plan.hookPlans.length, 6);
  assert.equal(plan.hookPlans.some((hook) => hook.hookType === "review-ugc"), false);
  assert.equal(plan.hookPlans.some((hook) => hook.hookType === "urgency"), false);
});

test("동일 후킹의 선호·제외 규칙은 범위가 달라도 충돌로 표시한다", () => {
  const resolution = resolveCreativeContentNotes([
    note({ id: "preferred", scope: "category", scopeId: "beauty", type: "PREFERRED_HOOK", content: "urgency" }),
    note({ id: "avoided", scope: "product", scopeId: "mint", type: "AVOIDED_HOOK", content: "긴급 후킹은 다음 제작에서 제외", prohibited: true }),
  ], context);
  assert.equal(resolution.conflicts.length, 1);
  assert.equal(resolution.conflicts[0].blocking, true);
  assert.equal(validateCreativeContentNotes("긴급 후킹은 다음 제작에서 제외", resolution.notes).prohibitedFound.length, 0);
});
