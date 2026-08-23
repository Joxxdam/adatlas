import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { adCopyFingerprint, buildAdCopyCsv, canGenerateAdCopyAfterQa, selectRepresentativeResultId, shouldRegenerateAdCopy, validateAdCopyAgainstTruth } from "../app/lib/ad-copy/adCopyValidator.ts";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

function truth(overrides = {}) {
  return {
    productId: "product-1",
    product: {
      productName: "한우 불고기 250g",
      category: "식품",
      price: "17,800원",
      originalPrice: "",
      oldPrice: "",
      discountInfo: "",
      mainBenefit: "팬에 바로 익히는 불고기",
      targetCustomer: "저녁 준비를 빠르게 하려는 가족",
      landingUrl: "https://example.com/1",
      productImagePath: "/product.jpg",
      backgroundImagePath: "",
      verifiedBenefits: ["250g 한 팩 구성"],
      ingredients: ["한우"],
      ...overrides,
    },
    facts: [
      { id: "price", key: "price", label: "판매가", value: "17,800원", verification: "verified", source: "landing-page", usableInCopy: true, numericTokens: ["17800"], evidenceType: "price" },
      { id: "qty", key: "quantity", label: "중량", value: "250g", verification: "verified", source: "landing-page", usableInCopy: true, numericTokens: ["250"], evidenceType: "quantity" },
      { id: "usage", key: "usage", label: "사용", value: "팬에 바로 익히는 불고기", verification: "verified", source: "landing-page", usableInCopy: true, numericTokens: [], evidenceType: "usage" },
    ],
    verifiedClaims: [],
    unverifiedClaims: [],
    allowedNumericTokens: ["17800", "250"],
    blockedClaimPatterns: [],
    imageAssets: [],
    referenceImages: [],
    imagePaths: [],
    completeness: 90,
    createdAt: new Date().toISOString(),
  };
}

const validCopy = "저녁 메뉴 고민, 팬 하나면 끝 🍳\n한우 불고기 250g 한 팩\n팬에 바로 익혀 든든하게 차려보세요\n17,800원으로 오늘 저녁 준비 🥩";

test("상품 작업은 이미지 수와 관계없이 대표 결과 ID 하나를 선택한다", () => {
  const id = selectRepresentativeResultId({
    executionResultIds: ["r2", "r1"],
    results: [
      { id: "r1", status: "success" },
      { id: "r2", status: "success" },
      { id: "r3", status: "success" },
    ],
  });
  assert.equal(id, "r2");
});

test("여러 이미지 중 사용자가 승인한 대표 이미지가 문구 기준이 된다", () => {
  const id = selectRepresentativeResultId({
    representativeResultId: "r3",
    executionResultIds: ["r1"],
    results: [
      { id: "r1", status: "success" },
      { id: "r3", status: "approved" },
    ],
  });
  assert.equal(id, "r3");
});

test("최종 이미지 QA 전에는 광고문구를 생성하지 않는다", () => {
  assert.equal(canGenerateAdCopyAfterQa({ resultStatus: "running", nativeQaRecommendation: "approve" }), false);
  assert.equal(canGenerateAdCopyAfterQa({ resultStatus: "success", nativeQaRecommendation: "revise" }), false);
  assert.equal(canGenerateAdCopyAfterQa({ resultStatus: "success", nativeQaRecommendation: "approve" }), true);
});

test("6장 그룹 검수가 필요한 경우 그룹 승인 후에만 생성한다", () => {
  assert.equal(canGenerateAdCopyAfterQa({ resultStatus: "success", nativeQaRecommendation: "approve", groupRequired: true, groupRecommendation: "revise" }), false);
  assert.equal(canGenerateAdCopyAfterQa({ resultStatus: "success", nativeQaRecommendation: "approve", groupRequired: true, groupRecommendation: "approve" }), true);
});

test("대표 후킹과 연결된 자연스러운 4~8줄 문구를 통과시킨다", () => {
  assert.equal(validateAdCopyAgainstTruth({ primaryText: validCopy, truth: truth(), hookHeadline: "저녁 메뉴 고민, 팬 하나면 끝" }).passed, true);
});

test("가격 정보가 없으면 가격을 쓰지 않은 문구는 통과할 수 있다", () => {
  const noPrice = truth({ price: "" });
  noPrice.facts = noPrice.facts.filter((fact) => fact.id !== "price");
  const copy = "저녁 메뉴 고민, 팬 하나면 끝 🍳\n한우 불고기 한 팩을 준비하고\n팬에 바로 익혀 든든하게 차려보세요\n오늘 저녁을 간단하게 준비해요 🥩";
  assert.equal(validateAdCopyAgainstTruth({ primaryText: copy, truth: noPrice, hookHeadline: "저녁 메뉴 고민" }).passed, true);
});

test("확인되지 않은 가격·할인율은 차단한다", () => {
  const result = validateAdCopyAgainstTruth({ primaryText: validCopy.replace("17,800원", "9,900원 50% 할인"), truth: truth(), hookHeadline: "저녁 메뉴 고민" });
  assert.equal(result.passed, false);
  assert.match(result.failures.join(" "), /확인되지 않은 숫자/);
});

test("확인되지 않은 품절 임박과 기간 한정은 차단한다", () => {
  const result = validateAdCopyAgainstTruth({ primaryText: validCopy.replace("오늘 저녁 준비", "오늘만 품절 임박"), truth: truth(), hookHeadline: "저녁 메뉴 고민" });
  assert.equal(result.passed, false);
  assert.match(result.failures.join(" "), /긴급성/);
});

test("확인되지 않은 임상·효과 수치는 차단한다", () => {
  const result = validateAdCopyAgainstTruth({ primaryText: validCopy.replace("든든하게", "100% 효과로 완벽하게"), truth: truth(), hookHeadline: "저녁 메뉴 고민" });
  assert.equal(result.passed, false);
  assert.match(result.failures.join(" "), /효과/);
});

test("승인 문구와 완전히 같은 문구를 다시 내보내지 않는다", () => {
  const result = validateAdCopyAgainstTruth({ primaryText: validCopy, truth: truth(), hookHeadline: "저녁 메뉴 고민", approvedCopies: [validCopy] });
  assert.equal(result.passed, false);
  assert.match(result.failures.join(" "), /그대로 복사/);
});

test("후킹이 바뀌면 문구 fingerprint가 바뀐다", () => {
  assert.notEqual(adCopyFingerprint(["p1", "후킹 A", "사실"]), adCopyFingerprint(["p1", "후킹 B", "사실"]));
  assert.equal(shouldRegenerateAdCopy({ hookChanged: true }), true);
});

test("가격·ProductTruth·구성 변경은 문구 재생성 대상이다", () => {
  assert.equal(shouldRegenerateAdCopy({ priceChanged: true }), true);
  assert.equal(shouldRegenerateAdCopy({ productTruthChanged: true }), true);
  assert.equal(shouldRegenerateAdCopy({ compositionChanged: true }), true);
});

test("색상 또는 상품 위치만 바뀌면 기존 문구를 유지한다", () => {
  assert.equal(shouldRegenerateAdCopy({ colorOnlyChanged: true }), false);
  assert.equal(shouldRegenerateAdCopy({ productPositionOnlyChanged: true }), false);
});

test("대표 이미지 승인 변경은 문구 재생성 대상이다", () => {
  assert.equal(shouldRegenerateAdCopy({ representativeImageChanged: true }), true);
});

test("줄바꿈·이모지·원화·중량 표현을 그대로 보존한다", () => {
  const result = validateAdCopyAgainstTruth({ primaryText: validCopy, truth: truth(), hookHeadline: "저녁 메뉴 고민" });
  assert.equal(result.lineCount, 4);
  assert.equal(result.emojiCount, 2);
  assert.match(validCopy, /17,800원/);
  assert.match(validCopy, /250g/);
});

test("광고 설정 CSV는 문구 줄바꿈과 UTF-8 BOM을 포함한다", () => {
  const csv = buildAdCopyCsv([{ productName: "한우", primaryText: validCopy, adName: "AD-1", utm: "utm_content=x", assetCode: "AT-1", hookId: "H01" }]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /Meta 기본 문구/);
  assert.match(csv, /저녁 메뉴 고민/);
});

test("이미지 제작 완료 후 상품당 한 번 설명 문구를 자동 생성하고 내부 프롬프트는 공개 응답에서 제거한다", async () => {
  const native = await read("app/lib/creative-generation/nativeResultGeneration.server.ts");
  const runner = await read("app/lib/creative-generation/jobRunner.server.ts");
  const publicJob = await read("app/lib/creative-generation/publicJob.server.ts");
  const manualUi = await read("app/components/features/creative-generation/SixCreativeGenerator.tsx");
  const adCopyPanel = await read("app/components/ad-copy/ProductAdCopyPanel.tsx");
  const autoUi = await read("app/components/auto-production/AutoProductionWorkspace.tsx");
  const autoRunner = await read("app/lib/auto-production/productionRunner.server.ts");
  assert.doesNotMatch(native, /ensureProductAdCopy/);
  assert.match(runner, /hasGeneratedImage && !completed\.adCopy/);
  assert.match(runner, /ensureProductAdCopy\(jobId\)/);
  assert.match(manualUi, /ProductAdCopyPanel/);
  assert.match(adCopyPanel, /상품 광고 설명 문구 · 상품당 1개/);
  assert.match(adCopyPanel, /이미지 제작이 끝나면 자동으로 생성됩니다/);
  assert.match(autoRunner, /createNativeGenerationJob/);
  assert.match(autoUi, /\/create-product\?view=results/);
  assert.doesNotMatch(autoUi, /ProductAdCopyPanel/);
  assert.match(publicJob, /promptVersion:\s*""/);
  assert.doesNotMatch(publicJob, /buildAdCopyPrompt/);
});
