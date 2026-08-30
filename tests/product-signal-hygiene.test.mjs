import assert from "node:assert/strict";
import test from "node:test";
import { isDomesticOriginCreativeSignal, isMalformedProductSignal, isMeatProductContext, isNonDomesticOriginCreativeSignal, isOriginCreativeSignal, isPriceOnlyCreativeSignal, isProhibitedAdCopySignal, isPromotionalProductSignal, isShippingCreativeSignal, isUnsafeProductCreativeSignal, isVagueStandaloneSensoryClaim } from "../app/lib/creative-generation/productSignalHygiene.ts";
import { buildProductTruth, cleanProductTitle, validateCopyAgainstTruth } from "../app/lib/creative-generation/productTruth.ts";

test("배송·출고·도착 정보는 광고 문구 후보와 최종 검증에서 차단한다", () => {
  for (const value of ["무료배송", "배송비 0원", "오늘 출발", "당일 출고", "내일 도착 예정", "택배 배송 안내", "free shipping"]) {
    assert.equal(isShippingCreativeSignal(value), true, value);
  }
  assert.equal(isShippingCreativeSignal("44% 할인"), false);
  const truth = buildProductTruth({
    source: "landing-page",
    product: {
      productName: "반건조 무화과 300g 무료배송",
      category: "식품",
      landingUrl: "https://example.com/products/fig",
      price: "8,900원",
      discountInfo: "무료배송",
      mainBenefit: "쫀득달콤한 식감",
      verifiedBenefits: ["오늘 출발", "쫀득달콤한 식감"],
      vendorResearch: {
        sourceDocument: "상품표",
        facts: [{ id: "shipping", label: "배송", value: "새벽 배송", kind: "usage", copyEligibility: "headlineEligible" }],
      },
    },
  });
  const copyFacts = truth.facts.filter((fact) => fact.usableInCopy).map((fact) => fact.value).join(" ");
  assert.doesNotMatch(copyFacts, /배송|출발|도착|택배/);
  assert.equal(truth.normalized.discountInfo, undefined);
  assert.equal(validateCopyAgainstTruth("무료배송으로 받아보세요", truth).valid, false);
  assert.equal(validateCopyAgainstTruth("한입부터 쫀득달콤", truth).valid, true);
  assert.equal(validateCopyAgainstTruth("두쫀쿠 다음엔 뭐 먹지? 한입부터 쫀득달콤", truth).valid, true);
  assert.equal(validateCopyAgainstTruth("가을 간식 고민될 때, 반건조 무화과 한입", truth).valid, true);
});

test("부정·양해·CS·판매주체 문구는 OCR 출처여도 광고 문구에서 차단한다", () => {
  for (const value of [
    "배송 중 흔들림으로 멍이 생길 수 있습니다",
    "해당 사유로 인한 CS 처리는 어려운 점 양해 부탁드립니다",
    "교환 및 환불은 불가합니다",
    "확인해주세요",
    "유통전문판매원: 예시상사",
    "책임판매업자: 예시회사",
  ]) {
    assert.equal(isProhibitedAdCopySignal(value), true, value);
  }
  assert.equal(isProhibitedAdCopySignal("국내산 제철 사과 8kg"), false);
  assert.equal(isProhibitedAdCopySignal("빵과 함께 먹기 좋은 반건조 무화과"), false);

  const truth = buildProductTruth({
    source: "landing-page",
    product: {
      productName: "국내산 황궁 사과 8kg",
      category: "식품",
      landingUrl: "https://example.com/products/apple",
      price: "7,900원",
      detailImageOcrInsights: [
        {
          id: "ocr-1",
          imageUrl: "https://example.com/detail-1.jpg",
          contentHash: "a",
          ocrText: "국내산 제철 사과\n배송 중 흔들림으로 멍이 생길 수 있습니다\n판매원: 예시상사",
          ocrProvider: "apple-vision",
          ocrConfidence: 0.95,
          copyFacts: ["국내산 제철 사과", "배송 중 흔들림으로 멍이 생길 수 있습니다", "판매원: 예시상사"],
          productConstraints: ["주스용 혼합과", "외관이 고르지 않은 사과가 포함될 수 있음"],
          discardedNotices: [],
          warnings: [],
        },
      ],
      productCopyConstraints: ["주스용 혼합과", "외관이 고르지 않은 사과가 포함될 수 있음"],
    },
  });
  const factText = truth.facts.filter((fact) => fact.usableInCopy).map((fact) => fact.value).join("\n");
  assert.doesNotMatch(factText, /국내산 제철 사과/);
  assert.doesNotMatch(factText, /배송 중|멍|판매원/);
  assert.deepEqual(truth.productCopyConstraints, ["주스용 혼합과", "외관이 고르지 않은 사과가 포함될 수 있음"]);
  assert.equal(validateCopyAgainstTruth("배송 중 흔들릴 수 있어 양해 부탁드립니다", truth).valid, false);
  assert.equal(validateCopyAgainstTruth("국내산 제철 사과", truth).valid, false);
});

test("원산지는 국내산 육류 광고에서만 허용한다", () => {
  assert.equal(isDomesticOriginCreativeSignal("국내산 무화과"), true);
  assert.equal(isDomesticOriginCreativeSignal("제주산 감귤"), true);
  assert.equal(isNonDomesticOriginCreativeSignal("원산지: 터키산"), true);
  assert.equal(isNonDomesticOriginCreativeSignal("터키산 무화과"), true);

  const foreignTruth = buildProductTruth({
    source: "landing-page",
    product: {
      productName: "반건조 꽃감무화과 300g",
      category: "식품",
      landingUrl: "https://example.com/products/fig",
      ingredients: ["원산지: 터키산"],
      verifiedBenefits: ["터키산 무화과", "오독오독한 씨앗과 쩐득한 식감"],
    },
  });
  assert.ok(foreignTruth.facts.filter((fact) => fact.evidenceType === "origin").every((fact) => !fact.usableInCopy && fact.copyEligibility === "blocked"));
  assert.doesNotMatch(foreignTruth.facts.filter((fact) => fact.usableInCopy).map((fact) => fact.value).join(" "), /터키산/);
  assert.equal(validateCopyAgainstTruth("터키산 무화과", foreignTruth).valid, false);

  const domesticTruth = buildProductTruth({
    source: "landing-page",
    product: { productName: "국내산 사과", category: "식품", landingUrl: "https://example.com/products/apple", ingredients: ["원산지: 국내산"] },
  });
  assert.ok(domesticTruth.facts.filter((fact) => fact.evidenceType === "origin").every((fact) => !fact.usableInCopy && fact.copyEligibility === "blocked"));
  assert.equal(validateCopyAgainstTruth("국내산 사과", domesticTruth).valid, false);
  assert.doesNotMatch(domesticTruth.normalized.cleanProductName, /국내산|국산/);

  const domesticMeatTruth = buildProductTruth({
    source: "landing-page",
    product: { productName: "국내산 한우 갈비", category: "식품/육류", landingUrl: "https://example.com/products/beef", ingredients: ["원산지: 국내산"] },
  });
  assert.equal(isMeatProductContext(domesticMeatTruth.product), true);
  assert.equal(isOriginCreativeSignal("국내산 한우"), true);
  assert.ok(domesticMeatTruth.facts.some((fact) => fact.evidenceType === "origin" && fact.usableInCopy));
  assert.equal(validateCopyAgainstTruth("국내산 한우 갈비", domesticMeatTruth).valid, true);
});

test("가격·깨진 SEO 판촉문구는 상품 USP로 승격하지 않는다", () => {
  assert.equal(isPriceOnlyCreativeSignal("19,900원"), true);
  assert.equal(isPriceOnlyCreativeSignal("정가 19,900원 → 7,900원"), true);
  assert.equal(isPromotionalProductSignal("[8kg 7,900원 전국최저가도전!]"), true);
  assert.equal(isMalformedProductSignal("[8kg 7,900원 전국최저가도전"), true);
  assert.equal(isPriceOnlyCreativeSignal("한입부터 아삭한 사과"), false);

  const appleTruth = buildProductTruth({
    source: "landing-page",
    product: {
      productName: "[8kg 전국최저가도전 ] 국내산 황궁 가정용 얼음골사과🍎",
      category: "식품/선물",
      price: "7,900원",
      originalPrice: "19,900원",
      discountInfo: "60% 할인",
      mainBenefit: "19,900원",
      verifiedBenefits: ["[8kg 7,900원 전국최저가도전", "국내산"],
      landingUrl: "https://example.com/products/apple",
    },
  });
  assert.equal(appleTruth.normalized.baseProductName, "황궁 가정용 얼음골사과🍎");
  assert.ok(appleTruth.facts.some((fact) => fact.key === "price" && fact.copyEligibility === "offerOnly"));
  assert.ok(appleTruth.facts.some((fact) => fact.key === "original-price" && fact.copyEligibility === "offerOnly"));
  assert.ok(appleTruth.facts.every((fact) => fact.key === "price" || fact.key === "original-price" || fact.value !== "19,900원"));
  assert.doesNotMatch(appleTruth.facts.filter((fact) => fact.evidenceType === "usp").map((fact) => fact.value).join(" "), /최저가|19,900원/);
});

test("무화과 SEO 상품명은 광고용 상품 정체성과 감각 표현을 분리한다", () => {
  const truth = buildProductTruth({
    source: "landing-page",
    product: {
      productName: "재구매 쫄깃달달 최고의 간식 반건조 곶감무화과 대용량 300g",
      category: "식품",
      detectedProductType: "snack",
      landingUrl: "https://example.com/products/dried-fig",
    },
  });
  assert.equal(truth.normalized.baseProductName, "반건조 곶감무화과");
  assert.equal(truth.normalized.verifiedDescriptor, "쫄깃달달");
  assert.doesNotMatch(truth.normalized.cleanProductName, /재구매|최고의 간식|대용량/);
});

test("부정 후기와 상세페이지 UI 문구는 광고용 상품 사실이 아니다", () => {
  assert.equal(isUnsafeProductCreativeSignal("시원함 조차 없습니다"), true);
  assert.equal(isUnsafeProductCreativeSignal("상세정보 탭 메뉴"), true);
  assert.equal(isUnsafeProductCreativeSignal("사용해보니 별로예요"), true);
  assert.equal(isUnsafeProductCreativeSignal("인공 색소 무첨가"), false);
  assert.equal(isUnsafeProductCreativeSignal("친구 초대 리워드 URL 복사 STEP.1"), true);
  assert.equal(isUnsafeProductCreativeSignal("제조사: 경상남도 거창군 거창읍 개화2길 121-72"), true);
  assert.equal(isUnsafeProductCreativeSignal("회원가입이 완료되면 포인트 적립"), true);
  assert.equal(isUnsafeProductCreativeSignal("상품 상세페이지에서 확인된 정보를 비교하는 고객"), true);
  assert.equal(isUnsafeProductCreativeSignal("2026-08-25 13:42:09"), true);
  assert.equal(isUnsafeProductCreativeSignal("작성일시: 2026.08.25 13:42"), true);
  assert.equal(isUnsafeProductCreativeSignal("구매자: min***"), true);
  assert.equal(isUnsafeProductCreativeSignal("[필수] 옵션을 선택해 주세요"), true);
  assert.equal(isUnsafeProductCreativeSignal("너무 시원하고 향기가 좋아요 레몬향기도 사보고 싶어요"), true);
  assert.equal(isUnsafeProductCreativeSignal("20일 숙성한 샤워젤"), false);
});

test("근거 없는 단독 감각 수사는 헤드라인 후보와 구분한다", () => {
  assert.equal(isVagueStandaloneSensoryClaim("향부터가 달라요"), true);
  assert.equal(isVagueStandaloneSensoryClaim("식감이 다릅니다"), true);
  assert.equal(isVagueStandaloneSensoryClaim("육질, 부위, 고춧가루 향부터가 달라요"), false);
  assert.equal(isVagueStandaloneSensoryClaim("20일 숙성으로 부드러운 식감"), false);

  const truth = buildProductTruth({
    source: "landing-page",
    product: {
      productName: "고급 닭갈비",
      category: "식품",
      landingUrl: "https://example.com/products/chicken",
      mainBenefit: "향부터가 달라요",
      verifiedBenefits: ["향부터가 달라요"],
    },
  });
  const vagueFacts = truth.facts.filter((fact) => fact.value === "향부터가 달라요");
  assert.ok(vagueFacts.length > 0);
  assert.ok(vagueFacts.every((fact) => fact.copyEligibility === "proofOnly"));
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
      extractedDescription: "상세정보 탭 메뉴 · 민트 쿨링 사용감 · 2026-08-25 13:42:09",
      verifiedBenefits: ["시원함 조차 없습니다", "민트 쿨링 사용감", "작성일시: 2026.08.25 13:42"],
      ingredients: ["리뷰 작성자", "민트 추출물"],
      reviewSources: [{ keySentence: "효과가 없어요", sourceContext: "구매후기" }],
      creativeContext: { reviewInsightSummaries: ["재구매 안 합니다", "산뜻한 사용감"] },
    },
  });
  const copyFacts = truth.facts.filter((fact) => fact.usableInCopy).map((fact) => fact.value).join(" ");
  assert.doesNotMatch(copyFacts, /시원함 조차 없습니다|실망했습니다|리뷰 작성자|효과가 없어요|재구매 안 합니다|2026-08-25|작성일시/);
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
