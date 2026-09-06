import assert from "node:assert/strict";
import test from "node:test";

import { buildImageCreativePremiseSeeds, findImageCreativePremiseErrors, hasCurrentImageCreativePremiseSet } from "../app/lib/creative-generation/imageCreativePremise.ts";
import { buildProductTruth, validateCopyAgainstTruth } from "../app/lib/creative-generation/productTruth.ts";
import { alignPremiseSeedsToEvidenceAssignments, buildReferenceCopyEvidenceAssignments, referenceCopyEvidenceDimensionForFact } from "../app/lib/creative-generation/referenceCopyAngles.ts";
import { applyReferenceCopyGroupRules } from "../app/lib/creative-generation/referenceCopyDiversity.ts";
import { applySafeMinimalRhetoric, isSafeMinimalFactCandidate, isSafeMinimalOfferFact, safeMinimalCta, safeMinimalFactText } from "../app/lib/creative-generation/referenceCopySafeMinimal.ts";
import { findProductCopySemanticErrors, resolveProductCopyDomain } from "../app/lib/creative-generation/productCopySemantics.ts";
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

function copyReferences() {
  const raws = [
    "시칠리아 레몬 10개가 이 한 통에!?",
    "선수들이 선택한 바디워시\n땀으로 범벅된 몸을 식히는 방법",
    "퇴근하고도 찝찝한 사람\n씻는 것부터 바꾸세요",
    "열을 가한 추출과 뭐가 다를까요?",
    "물과 만나면 거품이 어떻게 달라질까?",
    "매일 쓰는 제품, 무엇을 확인하세요?",
  ];
  return raws.map((rawText, index) => ({
    id: `original-source-reference-${index + 1}`,
    path: `/tmp/original-source-reference-${index + 1}.jpg`,
    publicPath: `/original-source-reference-${index + 1}.jpg`,
    sourceFile: `original-source-reference-${index + 1}.jpg`,
    layoutFamily: index === 1 ? "proof-data" : index === 2 ? "problem-objection" : "editorial-story",
    compositionType: "product-packshot",
    categoryGroup: "beauty",
    categoryLabel: "화장품",
    selectionReason: "fixture",
    nativeCopy: { rawText, rawLines: rawText.split("\n"), textRegions: [], useForCopyAdaptation: true },
  }));
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

test("민트 조사 수치·희소 원료 근거는 UI·감상문 노이즈 없이 수동·자동 공통 ProductTruth에 연결된다", () => {
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
  assert.doesNotMatch(factValues, /약 132장/);
  assert.match(factValues, /7,927장/);
  assert.match(factValues, /히말라야.*인도 민트 벨트/);
  assert.match(factValues, /티트리/);
  assert.equal(validateCopyAgainstTruth("샤워 직후 체감 온도 -8.9°C, 달아오른 날 민트 쿨링", truth).valid, true);
});

test("시칠리아 레몬은 일반 원산지가 아니라 오리지널소스 희소 원료 근거로 사용할 수 있다", () => {
  const enriched = applyOriginalSourceVendorResearch(
    extracted({
      productName: "오리지널소스 레몬 티트리 샤워젤 250ml",
      landingUrl: "https://originalsource.co.kr/product/lemon/77/category/91/display/1/",
    }),
    "https://originalsource.co.kr/product/lemon/77/category/91/display/1/"
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

  const sicilianFact = truth.facts.find((fact) => /시칠리아.*페미넬로/.test(fact.value));
  assert.equal(sicilianFact?.evidenceType, "ingredient");
  assert.equal(sicilianFact?.usableInCopy, true);
  assert.notEqual(sicilianFact?.copyEligibility, "blocked");
  assert.ok(truth.facts.some((fact) => /레몬 10개 분량/.test(fact.value) && fact.usableInCopy));
});

test("오리지널소스 6장은 OCR 수사에 맞춰 비향 조사 근거를 먼저 배정하고 향 중심은 최대 1장이다", () => {
  const enriched = applyOriginalSourceVendorResearch(
    extracted({
      productName: "오리지널소스 레몬 티트리 샤워젤 250ml",
      landingUrl: "https://originalsource.co.kr/product/lemon/77/category/91/display/1/",
    }),
    "https://originalsource.co.kr/product/lemon/77/category/91/display/1/"
  );
  const truth = buildProductTruth({
    product: { ...enriched, advertiserName: "오리지널소스", productImagePath: enriched.mainImage, productImagePaths: enriched.galleryImages, backgroundImagePath: "" },
    productImagePaths: enriched.galleryImages,
    source: "landing-page",
  });
  const assignments = buildReferenceCopyEvidenceAssignments(truth, copyReferences());
  assert.equal(assignments.length, 6);
  assert.equal(new Set(assignments.map((assignment) => assignment.primaryFactId)).size, 6);
  assert.ok(assignments.filter((assignment) => assignment.sensoryLed).length <= 1);
  assert.ok(new Set(assignments.filter((assignment) => !assignment.sensoryLed).map((assignment) => assignment.evidenceDimension)).size >= 4);
  assert.equal(assignments[0].evidenceDimension, "numeric-proof");

  const alignedPremises = alignPremiseSeedsToEvidenceAssignments(truth, buildImageCreativePremiseSeeds(truth, copyReferences()), assignments);
  assert.equal(hasCurrentImageCreativePremiseSet(alignedPremises), true);
  alignedPremises.forEach((premise, index) => {
    assert.deepEqual(premise.supportingFactIds[0], assignments[index].primaryFactId);
    assert.deepEqual(findImageCreativePremiseErrors(premise, truth), []);
    assert.match(premise.factBoundary, /창작|비유/u);
    assert.match(premise.factBoundary, /ProductTruth|상품\s*(?:사실|속성)|검증/u);
  });

  const sensoryFact = truth.facts.find((fact) => /향의 흐름/u.test(fact.label));
  assert.ok(sensoryFact);
  const scentPlans = [0, 1].map((index) => ({
    referenceId: `scent-${index}`,
    headline: sensoryFact.value,
    subCopy: "",
    proof: "",
    offer: "",
    cta: "",
    factIds: [sensoryFact.id],
    validationStatus: "valid",
    validationErrors: [],
    copySlots: [],
    evidenceAssignment: { referenceId: `scent-${index}`, referenceMechanism: "감탄 → 구매 이유", primaryFactId: sensoryFact.id, supportingFactIds: [], evidenceDimension: "sensory", sensoryLed: true, assignmentReason: "fixture" },
  }));
  assert.match(applyReferenceCopyGroupRules(scentPlans, truth)[1].validationErrors.join(" "), /향 중심 소재는 6장 중 최대 1장/u);
});

test("안전 최소 문구는 사실을 자르거나 식품 표현을 만들지 않고 OCR 문장부호만 적용한다", () => {
  const numeric = { id: "numeric", key: "public-evidence", label: "원료 함량 표현", value: "250ml 한 병에 시칠리아 레몬 10개 분량을 담았다고 소개됨", verification: "user-provided", source: "vendor-research", usableInCopy: true, numericTokens: ["250ml", "10개"], evidenceType: "numeric" };
  const process = { id: "process", key: "public-evidence", label: "추출 방식", value: "레몬 껍질을 열 대신 물리적인 힘으로 눌러 오일을 얻는 냉압착 방식으로 소개됨", verification: "user-provided", source: "vendor-research", usableInCopy: true, numericTokens: [], evidenceType: "usp" };
  const scent = { id: "scent", key: "public-evidence", label: "향료 정보", value: "100% 천연 향료를 사용한 제품으로 소개됨", verification: "user-provided", source: "vendor-research", usableInCopy: true, numericTokens: ["100%"], evidenceType: "ingredient" };
  const reviewNoise = { ...process, id: "review", value: "레몬 티트리 리뷰", evidenceType: "ingredient" };
  const brandedNoise = { ...process, id: "brand", value: "오리지널소스 레몬 티트리 샤워젤 250ml", evidenceType: "ingredient" };
  const offer = { ...process, id: "offer", key: "detail-ocr-3", label: "상세 이미지에서 확인된 상품 사실", value: "특별기획특가 74,000원", evidenceType: "numeric", copyEligibility: "proofOnly" };

  assert.equal(referenceCopyEvidenceDimensionForFact(numeric), "numeric-proof");
  assert.equal(referenceCopyEvidenceDimensionForFact(scent), "sensory");
  assert.equal(isSafeMinimalFactCandidate(reviewNoise, ["오리지널소스"]), false);
  assert.equal(isSafeMinimalFactCandidate(brandedNoise, ["오리지널소스"]), false);
  assert.equal(isSafeMinimalOfferFact(offer), true);
  assert.match(safeMinimalFactText(numeric, "personal-care", ["오리지널소스"], 24), /레몬\s*10개\s*분량/u);
  assert.match(safeMinimalFactText(process, "personal-care", ["오리지널소스"], 24), /냉압착/u);
  assert.doesNotMatch(`${safeMinimalFactText(numeric, "personal-care")} ${safeMinimalFactText(process, "personal-care")}`, /한입|식탁|맛있|식감/u);
  assert.equal(applySafeMinimalRhetoric("진짜 이 안에!?", "레몬 10개 분량"), "레몬 10개 분량!?");
  assert.equal(safeMinimalCta("personal-care", 0), "원료 정보 보기");
});

test("라임 40개 오해와 루바브 미공개 추정 성분은 광고 근거에 들어오지 않는다", () => {
  const lime = applyOriginalSourceVendorResearch(
    extracted({ productName: "오리지널소스 징기 라임 샤워젤", landingUrl: "https://originalsource.co.kr/product/lime/82/category/91/display/1/" }),
    "https://originalsource.co.kr/product/lime/82/category/91/display/1/"
  );
  const limeFacts = (lime.vendorResearch?.facts || []).map((fact) => fact.value).join("\n");
  assert.match(limeFacts, /40개의 리얼 라임 조각/);
  assert.doesNotMatch(limeFacts, /라임 40개가 (?:통째로 )?(?:들어|소모)/);

  const rhubarb = applyOriginalSourceVendorResearch(
    extracted({ productName: "오리지널소스 루바브 라즈베리 샤워젤", landingUrl: "https://originalsource.co.kr/product/rhubarb/84/category/91/display/1/" }),
    "https://originalsource.co.kr/product/rhubarb/84/category/91/display/1/"
  );
  const rhubarbFacts = (rhubarb.vendorResearch?.facts || []).map((fact) => fact.value).join("\n");
  assert.doesNotMatch(rhubarbFacts, /제라늄|로즈우드|영국산|EU산|중국산/);
});

test("다른 업체 상품에는 오리지널소스 조사 자료를 섞지 않는다", () => {
  const source = extracted({ productName: "다른 브랜드 바디워시", brandName: "다른 브랜드" });
  const result = applyOriginalSourceVendorResearch(source, "https://example.com/products/80");
  assert.equal(result, source);
  assert.equal(result.vendorResearch, undefined);
});

test("최신 조사 파일의 버전·해시·사전 광고 문구가 매 요청 결과에 연결된다", () => {
  const result = applyOriginalSourceVendorResearch(
    extracted({
      productName: "오리지널소스 레몬 티트리 샤워젤 250ml",
      landingUrl: "https://originalsource.co.kr/product/lemon/77/category/91/display/1/",
    }),
    "https://originalsource.co.kr/product/lemon/77/category/91/display/1/"
  );

  assert.equal(result.vendorResearch?.researchVersion, 2);
  assert.equal(result.vendorResearch?.extractedAt, "2026-08-31T22:42:40+09:00");
  assert.match(result.vendorResearch?.researchHash || "", /^[a-f0-9]{64}$/u);
  assert.equal(result.vendorResearch?.adCopyExamples?.length, 3);
  assert.ok(result.vendorResearch?.adCopyExamples?.some((example) => /시칠리아 레몬 10개/u.test(example.headline)));
});

test("오리지널소스 골라담기는 선택지 이름과 함께 다섯 단품의 광고 근거를 안전하게 연결한다", () => {
  const result = applyOriginalSourceVendorResearch(
    extracted({
      productName: "오리지널소스 샤워젤 바디워시 250ml 5종 골라담기팩",
      landingUrl: "https://originalsource.co.kr/product/selection/999/category/91/display/1/",
      mainBenefit: "원하는 향을 골라 담는 샤워젤",
      extractedDescription: "5종 골라담기",
    }),
    "https://originalsource.co.kr/product/selection/999/category/91/display/1/"
  );

  assert.equal(result.vendorResearch?.researchProductId, "original-source-selection-pack");
  assert.equal(result.vendorResearch?.memberResearchProductIds?.length, 5);
  assert.equal(result.vendorResearch?.facts.length, 5);
  assert.ok(result.vendorResearch?.facts.some((fact) => /민트&티트리.*7,927장/u.test(fact.value)));
  assert.ok(result.vendorResearch?.facts.some((fact) => /레몬&티트리.*시칠리아 레몬 10개/u.test(fact.value)));
  assert.ok(result.vendorResearch?.facts.every((fact) => /^pack-/u.test(fact.id)));
  assert.equal(result.vendorResearch?.adCopyExamples?.length, 3);
  assert.ok(result.vendorResearch?.adCopyExamples?.every((example) => example.factIds.every((id) => /^pack-/u.test(id))));
  assert.equal(result.mainBenefit, "원하는 향을 골라 담는 샤워젤");

  const truth = buildProductTruth({
    product: {
      ...result,
      advertiserName: "오리지널소스",
      productImagePath: result.mainImage,
      productImagePaths: result.galleryImages,
      backgroundImagePath: "",
    },
    productImagePaths: result.galleryImages,
    source: "landing-page",
  });
  assert.ok(truth.facts.some((fact) => fact.key === "vendor-pack-mint-7927" && fact.source === "vendor-research"));
});

test("상품 용도가 원료 단어보다 우선해 화장품 간식 오분류를 차단한다", () => {
  const showerGel = extracted({
    productName: "오리지널소스 루바브 라즈베리 샤워젤 250ml",
    category: "화장품",
    detectedProductType: "fruit",
  });
  assert.equal(resolveProductCopyDomain(showerGel), "personal-care");
  assert.match(findProductCopySemanticErrors("오늘 간식으로 루바브 라즈베리 한입", showerGel).join(" "), /상품 카테고리 의미 충돌/u);

  const apple = extracted({ productName: "얼음골 사과 8kg", category: "식품", detectedProductType: "fruit" });
  assert.equal(resolveProductCopyDomain(apple), "snack");
  assert.deepEqual(findProductCopySemanticErrors("오늘 간식으로 사과 한입", apple), []);
  assert.match(findProductCopySemanticErrors("욕실 샤워 루틴에 사과", apple).join(" "), /상품 카테고리 의미 충돌/u);

  const meat = extracted({ productName: "48시간 숙성 특수부위 모듬 구이세트", category: "육류", subcategory: "소고기", detectedProductType: "fruit" });
  assert.equal(resolveProductCopyDomain(meat), "food");
  assert.match(findProductCopySemanticErrors("오늘 간식으로 고기 한입", meat).join(" "), /상품 카테고리 의미 충돌/u);
});
