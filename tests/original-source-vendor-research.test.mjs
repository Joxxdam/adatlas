import assert from "node:assert/strict";
import test from "node:test";

import { buildProductTruth, validateCopyAgainstTruth } from "../app/lib/creative-generation/productTruth.ts";
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
  assert.deepEqual(result.vendorResearch?.blockedClaims, []);
  assert.equal(result.vendorResearch?.allowSheetClaimsInCopy, true);
  assert.ok(result.vendorResearch?.researchCautions?.some((value) => /특정 국가 원산지/.test(value)));
});

test("ProductTruth는 업체 문서 셀 출처를 보존하고 오리지널소스 시트 근거를 광고에 허용한다", () => {
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
  assert.ok(!truth.blockedClaimPatterns.some((value) => /수분 증발을 완벽히 차단/.test(value)));
});

test("민트 조사 수치·쿨링 근거는 UI·감상문 노이즈 없이 수동·자동 공통 ProductTruth에 연결된다", () => {
  const enriched = applyOriginalSourceVendorResearch(
    extracted({
      productName: "오리지널소스 민트 티트리 샤워젤 250ml",
      category: "기타",
      landingUrl: "https://originalsource.co.kr/product/mint/65/category/91/display/1/",
      verifiedBenefits: ["[필수] 옵션을 선택해 주세요", "너무 시원하고 향기가 좋아요 레몬향기도 사보고 싶어요"],
      ingredients: ["[필수] 옵션을 선택해 주세요"],
    }),
    "https://originalsource.co.kr/product/mint/65/category/91/display/1/"
  );
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

  const factValues = truth.facts.map((fact) => fact.value).join("\n");
  assert.equal(enriched.category, "화장품");
  assert.doesNotMatch(factValues, /옵션을 선택|사보고 싶어요/);
  assert.match(factValues, /-8\.9°C/);
  assert.match(factValues, /약 132장/);
  assert.match(factValues, /티트리/);
  assert.equal(validateCopyAgainstTruth("샤워 직후 체감 온도 -8.9°C, 달아오른 날 민트 쿨링", truth).valid, true);
});

test("다른 업체 상품에는 오리지널소스 조사 자료를 섞지 않는다", () => {
  const source = extracted({ productName: "다른 브랜드 바디워시", brandName: "다른 브랜드" });
  const result = applyOriginalSourceVendorResearch(source, "https://example.com/products/80");
  assert.equal(result, source);
  assert.equal(result.vendorResearch, undefined);
});
