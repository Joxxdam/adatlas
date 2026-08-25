import assert from "node:assert/strict";
import test from "node:test";
import { isUnsafeProductCreativeSignal } from "../app/lib/creative-generation/productSignalHygiene.ts";
import { buildProductTruth } from "../app/lib/creative-generation/productTruth.ts";

test("부정 후기와 상세페이지 UI 문구는 광고용 상품 사실이 아니다", () => {
  assert.equal(isUnsafeProductCreativeSignal("시원함 조차 없습니다"), true);
  assert.equal(isUnsafeProductCreativeSignal("상세정보 탭 메뉴"), true);
  assert.equal(isUnsafeProductCreativeSignal("사용해보니 별로예요"), true);
  assert.equal(isUnsafeProductCreativeSignal("인공 색소 무첨가"), false);
});

test("ProductTruth는 모든 입력 경로에서 후기·UI 노이즈를 차단한다", () => {
  const truth = buildProductTruth({
    source: "landing-page",
    product: {
      productName: "민트 샤워젤",
      category: "화장품",
      landingUrl: "https://example.com/products/mint",
      mainBenefit: "시원함 조차 없습니다",
      targetCustomer: "사용 후 실망했습니다",
      extractedDescription: "상세정보 탭 메뉴 · 민트 쿨링 사용감",
      verifiedBenefits: ["시원함 조차 없습니다", "민트 쿨링 사용감"],
      ingredients: ["리뷰 작성자", "민트 추출물"],
      reviewSources: [{ keySentence: "효과가 없어요", sourceContext: "구매후기" }],
      creativeContext: { reviewInsightSummaries: ["재구매 안 합니다", "산뜻한 사용감"] },
    },
  });
  const copyFacts = truth.facts.filter((fact) => fact.usableInCopy).map((fact) => fact.value).join(" ");
  assert.doesNotMatch(copyFacts, /시원함 조차 없습니다|실망했습니다|리뷰 작성자|효과가 없어요|재구매 안 합니다/);
  assert.match(copyFacts, /민트 쿨링 사용감/);
  assert.deepEqual(truth.normalized.ingredients, ["민트 추출물"]);
});
