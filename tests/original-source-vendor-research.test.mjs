import assert from "node:assert/strict";
import test from "node:test";

import { buildProductTruth } from "../app/lib/creative-generation/productTruth.ts";
import { applyOriginalSourceVendorResearch } from "../app/lib/product-research/originalSourceResearch.ts";

function extracted(overrides = {}) {
  return {
    productName: "오리지널소스 코코넛 시어버터 보습 샤워젤 · 바디워시 250ml",
    category: "화장품",
    price: "12,000원",
    discountInfo: "",
    brandName: "오리지널소스",
    mainImage: "https://example.com/product.jpg",
    galleryImages: ["https://example.com/product.jpg"],
    description: "코코넛 시어버터 바디워시",
    extractedDescription: "코코넛 시어버터 바디워시",
    mainBenefit: "코코넛 시어버터 바디워시",
    landingUrl: "https://originalsource.co.kr/product/coconut/80/category/91/display/1/",
    verifiedBenefits: [],
    ingredients: [],
    ...overrides,
  };
}

test("오리지널소스 상품번호로 업체 제공 조사 자료를 매칭해 수동·자동 공통 상품정보를 보강한다", () => {
  const result = applyOriginalSourceVendorResearch(extracted(), "https://originalsource.co.kr/product/coconut/80/category/91/display/1/");

  assert.equal(result.vendorResearch?.researchProductId, "coconut-shea-butter");
  assert.match(result.vendorResearch?.matchReason || "", /상품번호 80/);
  assert.equal(result.mainBenefit, "달콤하고 포근한 코코넛·시어버터 향과 매끄러운 보습 사용감");
  assert.match(result.targetCustomer || "", /건조함과 당김/);
  assert.ok(result.verifiedBenefits?.some((value) => /영생의 나무/.test(value)));
  assert.ok(result.verifiedBenefits?.some((value) => /생크림 같은 거품/.test(value)));
  assert.ok(result.ingredients?.includes("시어버터"));
  assert.ok(!result.verifiedBenefits?.some((value) => /피부 속 깊은 곳까지 수분을 밀어/.test(value)));
});

test("공개되지 않은 루바브 원산지와 4가지 오일 추정명은 문구 근거에서 제외한다", () => {
  const result = applyOriginalSourceVendorResearch(
    extracted({
      productName: "오리지널소스 루바브 라즈베리 샤워젤 250ml",
      landingUrl: "https://originalsource.co.kr/product/rhubarb/84/category/91/display/1/",
    }),
    "https://originalsource.co.kr/product/rhubarb/84/category/91/display/1/"
  );

  assert.equal(result.vendorResearch?.researchProductId, "rhubarb-raspberry");
  assert.ok(result.verifiedBenefits?.some((value) => /4가지 에센셜 오일 함유/.test(value)));
  assert.ok(!result.verifiedBenefits?.some((value) => /제라늄|로즈우드|영국산|EU산/.test(value)));
  assert.ok(result.vendorResearch?.blockedClaims.some((value) => /특정 국가 원산지/.test(value)));
});

test("ProductTruth는 업체 문서 셀 출처를 보존하고 위험 표현을 차단한다", () => {
  const enriched = applyOriginalSourceVendorResearch(extracted(), "https://originalsource.co.kr/product/coconut/80/category/91/display/1/");
  const truth = buildProductTruth({
    product: {
      ...enriched,
      advertiserName: "오리지널소스",
      targetCustomer: enriched.targetCustomer || "",
      productImagePath: enriched.mainImage,
      productImagePaths: enriched.galleryImages,
      backgroundImagePath: "",
    },
    productImagePaths: enriched.galleryImages,
    source: "landing-page",
  });

  const originFact = truth.facts.find((fact) => /영생의 나무/.test(fact.value));
  assert.equal(originFact?.source, "vendor-research");
  assert.equal(originFact?.verification, "user-provided");
  assert.equal(originFact?.sourceDocument, "3. 오리지널소스 코코넛 시어버터(coconut&shea butter)상세 조사 .xlsx");
  assert.deepEqual(originFact?.sourceCells, ["B54", "C56"]);
  assert.ok(truth.blockedClaimPatterns.some((value) => /수분 증발을 완벽히 차단/.test(value)));
});

test("다른 업체 상품에는 오리지널소스 조사 자료를 섞지 않는다", () => {
  const source = extracted({ productName: "다른 브랜드 바디워시", brandName: "다른 브랜드" });
  const result = applyOriginalSourceVendorResearch(source, "https://example.com/products/80");
  assert.equal(result, source);
  assert.equal(result.vendorResearch, undefined);
});

