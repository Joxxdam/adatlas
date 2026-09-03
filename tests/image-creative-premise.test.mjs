import assert from "node:assert/strict";
import test from "node:test";
import { buildImageCreativePremiseSeeds, findImageCreativePremiseCopyErrors, findImageCreativePremiseErrors, hasCurrentImageCreativePremiseSet, IMAGE_CREATIVE_PREMISE_POLICY_VERSION } from "../app/lib/creative-generation/imageCreativePremise.ts";
import { buildProductTruth } from "../app/lib/creative-generation/productTruth.ts";

function references() {
  return [
    { id: "human", layoutFamily: "human-use", compositionType: "human-use", photographyType: "human-model", nativeCopy: { rawText: "고기 없이는 못 사는 울 아버지" } },
    { id: "chat", layoutFamily: "chat-ugc", compositionType: "lifestyle-scene", photographyType: "lifestyle", nativeCopy: { rawText: "오늘 뭐 먹을까요? 이걸로 골라요" } },
    { id: "story", layoutFamily: "editorial-story", compositionType: "lifestyle-scene", photographyType: "lifestyle" },
    { id: "hero", layoutFamily: "product-hero", compositionType: "product-hero", photographyType: "packshot", nativeCopy: { rawText: "오늘 식탁의 주인공" } },
    { id: "proof", layoutFamily: "proof-data", compositionType: "product-hero", photographyType: "packshot" },
    { id: "versus", layoutFamily: "comparison-versus", compositionType: "split-comparison", photographyType: "packshot" },
  ];
}

function truth(productName, category, mainBenefit) {
  return buildProductTruth({
    source: "landing-page",
    product: {
      productName,
      category,
      landingUrl: `https://example.com/products/${encodeURIComponent(productName)}`,
      price: "",
      discountInfo: "",
      mainBenefit,
      verifiedBenefits: [mainBenefit],
    },
  });
}

test("6장 역할 수를 강제하지 않고 레퍼런스의 수사 장치에 따라 생활형 역할을 배정한다", () => {
  const plans = buildImageCreativePremiseSeeds(truth("선별 갈비", "식품/육류", "선별한 갈비 구성"), references());
  assert.equal(plans.length, 6);
  assert.equal(plans[0].kind, "everyday-relationship");
  assert.equal(plans[1].kind, "everyday-question-answer");
  assert.equal(plans[3].kind, "obvious-ad-metaphor");
  assert.equal(plans[5].kind, "comparison-benefit");
  assert.match(plans[0].character, /아버지|가족/);
  assert.ok(plans.every((premise) => premise.policyVersion === IMAGE_CREATIVE_PREMISE_POLICY_VERSION));
  assert.ok(plans.every((premise) => findImageCreativePremiseErrors(premise).length === 0));
  assert.equal(hasCurrentImageCreativePremiseSet(plans), true);

  const plainReferences = Array.from({ length: 6 }, (_, index) => ({ id: `plain-${index}`, layoutFamily: "product-hero", compositionType: "product-hero", photographyType: "packshot" }));
  const plainPlans = buildImageCreativePremiseSeeds(truth("선별 갈비", "식품/육류", "선별한 갈비 구성"), plainReferences);
  assert.ok(plainPlans.every((premise) => premise.kind === "usp-focus"));
  assert.equal(hasCurrentImageCreativePremiseSet(plainPlans), true);
});

test("상품군에 따라 창작 인물·상황은 달라지되 상품 사실은 ProductTruth id에만 연결한다", () => {
  const snack = buildImageCreativePremiseSeeds(truth("종합전병", "식품/간식", "바삭한 5종 구성"), references());
  const shower = buildImageCreativePremiseSeeds(truth("민트 티트리 샤워젤", "퍼스널케어", "민트와 티트리 사용"), references());
  assert.match(snack[0].character, /간식|가족/);
  assert.match(shower[0].situation, /아침|퇴근|루틴/);
  assert.ok(snack.every((premise) => premise.supportingFactIds.length >= 1));
  assert.ok(shower.every((premise) => premise.supportingFactIds.length >= 1));
});

test("의료 설정·실제 후기 위장과 근거 없는 fact id는 차단한다", () => {
  const productTruth = truth("선별 갈비", "식품/육류", "선별한 갈비 구성");
  const premise = buildImageCreativePremiseSeeds(productTruth, references())[0];
  const errors = findImageCreativePremiseErrors({
    ...premise,
    character: "야채 알레르기가 있는 실제 구매자 아버지",
    supportingFactIds: ["missing-fact"],
  }, productTruth);
  assert.ok(errors.some((error) => /의료 사실|실제 고객/u.test(error)));
  assert.ok(errors.some((error) => /존재하지 않는/u.test(error)));
});

test("상황형 기획이 메타데이터에만 있고 최종 문구가 상품정보 나열이면 차단한다", () => {
  const productTruth = truth("한우 안심 스테이크", "식품/육류", "48시간 숙성");
  const premise = buildImageCreativePremiseSeeds(productTruth, references())[0];
  assert.ok(findImageCreativePremiseCopyErrors(premise, "한정물량 반짝행사 국내산 한우 안심 스테이크 선물포장 가능").some((error) => /관계|생활 장면/u.test(error)));
  assert.deepEqual(findImageCreativePremiseCopyErrors(premise, "밥상에 앉자마자 나물은 밀어두고 고기부터 찾는 아버지"), []);
  assert.ok(findImageCreativePremiseCopyErrors(premise, "수라간 감별관이 고른 한우").some((error) => /직업·세계관/u.test(error)));
});

test("생활 질문과 명백한 광고 비유는 허용하되 각 역할의 핵심 수사를 확인한다", () => {
  const productTruth = truth("한우 안심 스테이크", "식품/육류", "48시간 숙성");
  const premises = buildImageCreativePremiseSeeds(productTruth, references());
  const question = premises.find((premise) => premise.kind === "everyday-question-answer");
  const metaphor = premises.find((premise) => premise.kind === "obvious-ad-metaphor");
  assert.deepEqual(findImageCreativePremiseCopyErrors(question, "아침마다 고기 사러 마장동 가세요? 여기서 그냥 골라요"), []);
  assert.ok(findImageCreativePremiseCopyErrors(question, "오늘은 한우로 골라요").some((error) => /생활 질문/u.test(error)));
  assert.deepEqual(findImageCreativePremiseCopyErrors(metaphor, "임금님도 감동할 오늘의 한우"), []);
  assert.ok(findImageCreativePremiseCopyErrors(metaphor, "오늘 먹기 좋은 한우").some((error) => /광고 비유/u.test(error)));
});

test("비교형·USP형 기획은 각각 비교 관계와 배정 USP가 문구에 보여야 한다", () => {
  const productTruth = truth("한우 안심 스테이크", "식품/육류", "48시간 숙성");
  const premises = buildImageCreativePremiseSeeds(productTruth, references());
  const comparison = premises.find((premise) => premise.kind === "comparison-benefit");
  const usp = premises.find((premise) => premise.kind === "usp-focus");
  assert.ok(findImageCreativePremiseCopyErrors(comparison, "스테이크 최고 부위만 드려요").some((error) => /비교 관계/u.test(error)));
  assert.deepEqual(findImageCreativePremiseCopyErrors(comparison, `평범한 대안보다 ${comparison.productBridge}를 확인하세요`), []);
  assert.ok(findImageCreativePremiseCopyErrors(usp, "오늘 메뉴 고민은 여기까지").some((error) => /상품 USP/u.test(error)));
  assert.deepEqual(findImageCreativePremiseCopyErrors(usp, `${usp.productBridge}, 이 한 가지부터 보세요`), []);
});
