import assert from "node:assert/strict";
import test from "node:test";

import { analyzeProductUsp, buildTargetedCopyVariants, buildTargetedStrategyContent, buildUspFirstFallbackCopy } from "../app/lib/mvp/productUsp.ts";

const product = {
  productName: "특마블링 등심 선별상품 1kg",
  category: "한우",
  price: "64,800원",
  originalPrice: "",
  discountInfo: "",
  mainBenefit: "특마블링 등심만 선별한 1kg 실속 구성 · 가족 식사와 캠핑에 활용하기 좋은 구성",
  targetCustomer: "",
  landingUrl: "https://example.com/product",
  productImagePath: "",
  backgroundImagePath: "",
  extractedDescription: "로그인 · 장바구니 · 육즙과 마블링을 살린 선별 등심 · 구매후기 · 관련상품",
};

test("상품 상세페이지 USP와 확인된 구매 조건을 우선 추출한다", () => {
  const analysis = analyzeProductUsp(product);

  assert.match(analysis.primaryUsp, /특마블링|마블링|선별/);
  assert.ok(analysis.uspSignals.some((value) => /육즙/.test(value)));
  assert.deepEqual(analysis.offerSignals, ["64,800원"]);
  assert.equal(
    analysis.uspSignals.some((value) => /로그인|장바구니|관련상품/.test(value)),
    false
  );
});

test("국대한우용 규칙 fallback도 전달 예문 대신 상품 USP를 사용한다", () => {
  const fallback = buildUspFirstFallbackCopy(product);
  const allCopy = JSON.stringify(fallback);

  assert.match(allCopy, /특마블링|마블링|선별|육즙/);
  assert.doesNotMatch(allCopy, /사장님|미쳤|마진|품절|오타|정육점/);
  assert.match(allCopy, /64,800원/);
});

test("상세페이지 신호를 근거·감각·상황과 타겟 긴장감으로 분리한다", () => {
  const analysis = analyzeProductUsp({
    ...product,
    verifiedBenefits: ["특마블링 등심 선별", "1kg 실속 구성"],
    ingredients: ["국내산 한우"],
  });

  assert.ok(analysis.proofSignals.some((value) => /선별|국내산|1kg/.test(value)));
  assert.ok(analysis.sensorySignals.some((value) => /육즙|마블링/.test(value)));
  assert.ok(analysis.situationSignals.some((value) => /가족|캠핑/.test(value)));
  assert.ok(analysis.targetSegments.length >= 3);
  assert.ok(new Set(analysis.hookAngles.map((angle) => angle.kind)).size >= 4);
  assert.equal(analysis.evidenceStrength, "strong");
});

test("타겟형 강한 문구도 확인된 상품 사실과 서로 다른 변형을 사용한다", () => {
  const brief = {
    productName: product.productName,
    category: product.category,
    price: product.price,
    originalPrice: "",
    discountInfo: "",
    mainBenefit: product.mainBenefit,
    targetCustomer: "캠핑과 가족 식사를 준비하는 고객",
    landingUrl: product.landingUrl,
    adObjective: "purchase",
    creativeIntensity: "performance",
    mandatoryInfo: [],
    prohibitedClaims: [],
  };
  const content = buildTargetedStrategyContent({
    product,
    brief,
    hookType: "problem-solution",
  });
  const variants = buildTargetedCopyVariants({ product, brief });
  const serialized = JSON.stringify({ content, variants });

  assert.match(serialized, /특마블링|선별|육즙|64,800원/);
  assert.doesNotMatch(serialized, /품절|오늘까지|한정 수량|리뷰 \d|평점/);
  assert.equal(new Set(Object.values(variants).map((variant) => variant.headline)).size, 3);
  assert.ok(content.audience.length > 0);
  assert.ok(content.targetTension.length > 0);
});

test("같은 상품도 광고 목표에 따라 헤드라인·타겟 상태·CTA가 달라진다", () => {
  const baseBrief = {
    productName: product.productName,
    category: product.category,
    price: product.price,
    originalPrice: "",
    discountInfo: "",
    mainBenefit: product.mainBenefit,
    targetCustomer: "캠핑과 가족 식사를 준비하는 고객",
    landingUrl: product.landingUrl,
    creativeIntensity: "balanced",
    mandatoryInfo: [],
    prohibitedClaims: [],
  };
  const brandedProduct = { ...product, brandName: "국대한우" };
  const objectives = ["purchase", "signup", "awareness", "retargeting"];
  const results = Object.fromEntries(
    objectives.map((adObjective) => {
      const brief = { ...baseBrief, adObjective };
      return [
        adObjective,
        {
          strategy: buildTargetedStrategyContent({
            product: brandedProduct,
            brief,
            hookType: "feature-usp",
          }),
          variants: buildTargetedCopyVariants({ product: brandedProduct, brief }),
        },
      ];
    })
  );

  assert.equal(new Set(objectives.map((objective) => results[objective].strategy.headline)).size, 4);
  assert.match(results.purchase.strategy.audience, /구매를 비교/);
  assert.match(results.signup.strategy.headline, /처음/);
  assert.match(results.signup.variants.medium.cta, /차이점/);
  assert.match(results.awareness.strategy.headline, /국대한우|기억/);
  assert.match(results.awareness.variants.medium.cta, /브랜드/);
  assert.match(results.retargeting.strategy.headline, /다시/);
  assert.match(results.retargeting.variants.medium.cta, /다시/);
});
