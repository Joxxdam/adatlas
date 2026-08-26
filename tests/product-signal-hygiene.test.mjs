import assert from "node:assert/strict";
import test from "node:test";
import { isUnsafeProductCreativeSignal } from "../app/lib/creative-generation/productSignalHygiene.ts";
import { buildProductTruth, cleanProductTitle } from "../app/lib/creative-generation/productTruth.ts";

test("부정 후기와 상세페이지 UI 문구는 광고용 상품 사실이 아니다", () => {
  assert.equal(isUnsafeProductCreativeSignal("시원함 조차 없습니다"), true);
  assert.equal(isUnsafeProductCreativeSignal("상세정보 탭 메뉴"), true);
  assert.equal(isUnsafeProductCreativeSignal("사용해보니 별로예요"), true);
  assert.equal(isUnsafeProductCreativeSignal("인공 색소 무첨가"), false);
  assert.equal(isUnsafeProductCreativeSignal("친구 초대 리워드 URL 복사 STEP.1"), true);
  assert.equal(isUnsafeProductCreativeSignal("제조사: 경상남도 거창군 거창읍 개화2길 121-72"), true);
  assert.equal(isUnsafeProductCreativeSignal("회원가입이 완료되면 포인트 적립"), true);
  assert.equal(isUnsafeProductCreativeSignal("상품 상세페이지에서 확인된 정보를 비교하는 고객"), true);
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

test("추천상품·계정 UI가 섞인 육류 상세에서도 상품명 기반 특징과 구성만 보존한다", () => {
  const truth = buildProductTruth({
    source: "landing-page",
    rawProductTitle: "*추석맞이특가* 지방손질&로스제거 대한선별 프리미엄 황록우 부드러운 숙성등심 1kg (500g x2팩)",
    product: {
      productName: "*추석맞이특가* 지방손질&로스제거 대한선별 프리미엄 황록우 부드러운 숙성등심 1kg (500g x2팩)",
      advertiserName: "대한한우",
      brandName: "대한한우",
      category: "식품",
      landingUrl: "https://example.com/products/sirloin",
      mainBenefit: "친구 초대 리워드 친구와 함께 포인트도 받자! 리워드 URL 복사 STEP.1",
      targetCustomer: "상품 상세페이지에서 확인된 정보를 비교하는 고객",
      verifiedBenefits: [
        "제조사: 경상남도 거창군 거창읍 개화2길 121-72",
        "회원가입이 완료되면 포인트 적립",
        "같이 담으세요 추천상품",
      ],
    },
  });
  const facts = truth.facts.filter((fact) => fact.usableInCopy).map((fact) => fact.value).join("\n");
  assert.doesNotMatch(facts, /친구 초대|리워드|제조사|개화2길|회원가입|포인트 적립|비교하는 고객|추천상품/);
  assert.match(facts, /지방을 손질하고 로스를 제거한 구성/);
  assert.match(facts, /500g × 2팩/);
  assert.equal(truth.normalized.composition, "500g × 2팩");
});

test("육류 SEO 상품명은 광고에 쓸 핵심 상품명과 제목 근거로 분리한다", () => {
  const raw = "오르기전 가격에 추석 사전예약가능-후기1등*찰진등심 선별상품1kg박스(감칠맛 비법숙성*실속도매팩)";
  assert.equal(cleanProductTitle(raw, "대한한우"), "찰진등심 1kg박스");
  const truth = buildProductTruth({
    source: "landing-page",
    rawProductTitle: raw,
    product: { productName: raw, advertiserName: "대한한우", brandName: "대한한우", category: "식품", landingUrl: "https://example.com/products/sirloin" },
  });
  assert.equal(truth.normalized.baseProductName, "찰진등심");
  assert.match(truth.facts.filter((fact) => fact.usableInCopy).map((fact) => fact.value).join("\n"), /감칠맛을 살린 비법 숙성/);
});

test("행사형 자동제작 상품명과 판매 문장을 상품 정체성·추천 대상에서 제거한다", () => {
  const raw = "*추석맞이* 웻에이징 숙성한 왕도매가격! ★암소한우★ 설꽃등심 500g -당일생산 (선별 숙성등심)";
  assert.equal(cleanProductTitle(raw, "대한한우"), "암소한우 설꽃등심 500g");
  const truth = buildProductTruth({
    source: "landing-page",
    rawProductTitle: raw,
    product: {
      productName: "웻에이징 암소한우 설꽃등심 500g",
      advertiserName: "대한한우",
      brandName: "대한한우",
      category: "식품",
      landingUrl: "https://example.com/products/wet-aged-sirloin",
      mainBenefit: "암소한우 설꽃등심 500g을 파격특가로 쏩니다!!",
      targetCustomer: "암소한우 설꽃등심 500g을 파격특가로 쏩니다!!",
      verifiedBenefits: ["암소한우 설꽃등심 500g을 파격특가로 쏩니다!!", "웻에이징 선별 숙성등심"],
    },
  });
  assert.equal(truth.normalized.cleanProductName, "웻에이징 암소한우 설꽃등심 500g");
  assert.equal(truth.normalized.targetCustomer, undefined);
  const factValues = truth.facts.map((fact) => fact.value);
  assert.deepEqual(truth.normalized.verifiedBenefits, ["웻에이징 선별 숙성등심"]);
  assert.ok(factValues.includes("웻에이징 숙성"));
  assert.doesNotMatch(factValues.join("\n"), /파격특가로 쏩니다/);
});
