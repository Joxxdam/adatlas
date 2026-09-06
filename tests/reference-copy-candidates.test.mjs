import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assignCreativeAngles, availableCreativeAngles, generateReferenceCopyHookIdeas } from "../app/lib/creative-generation/referenceCopyAngles.ts";
import { createAutomaticSafeCandidate, reviewReferenceCopyClaims } from "../app/lib/creative-generation/referenceCopyClaims.ts";
import { deduplicateReferenceCopyCandidates, genericImageCopyPenalty, isReferenceCopySemanticDuplicate, validateReferenceCopyCandidate } from "../app/lib/creative-generation/referenceCopyCandidateValidation.ts";
import { applyReferenceCopyGroupRules } from "../app/lib/creative-generation/referenceCopyDiversity.ts";
import { findReferenceCopyNaturalnessErrors } from "../app/lib/creative-generation/referenceCopyNaturalness.ts";
import { REFERENCE_COPY_SELECTOR_WEIGHTS, selectReferenceCopyCandidate } from "../app/lib/creative-generation/referenceCopyCandidateSelector.ts";
import { leanPlannerSchema, normalizeReferenceCopyPlanMetadata } from "../app/lib/creative-generation/referenceCopyCandidates.ts";
import { fitReferenceCopyBlocks, splitCopyWithoutBreakingWords } from "../app/lib/creative-generation/referenceCopyTextFit.ts";
import { isReferenceCopyTimeoutError, isRetryableReferenceCopyTransportError } from "../app/lib/creative-generation/referenceCopyTransport.ts";
import { isSafeMinimalFactCandidate, safeMinimalFactText } from "../app/lib/creative-generation/referenceCopySafeMinimal.ts";

function productTruth({ price = "12,900원", category = "식품/육류", productName = "숙성 한우 등심", sensory = "팬에 구우면 육즙이 살아나는 숙성 등심" } = {}) {
  const facts = [
    { id: "identity", key: "base-product-name", label: "상품명", value: productName, verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: [], evidenceType: "identity", copyEligibility: "identityOnly" },
    { id: "sensory", key: "main-benefit", label: "상품 차이", value: sensory, verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: [], evidenceType: "usp", copyEligibility: "headlineEligible" },
    { id: "quantity", key: "quantity", label: "구성", value: "500g × 2팩", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: ["500g", "2팩"], evidenceType: "composition", copyEligibility: "proofOnly" },
  ];
  if (price) facts.push({ id: "price", key: "price", label: "판매가", value: price, verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: [price], evidenceType: "price", copyEligibility: "offerOnly" });
  return {
    productId: "fixture-product",
    product: { productName, category, price, landingUrl: "https://example.com/product" },
    normalized: { rawProductTitle: productName, cleanProductName: productName, baseProductName: productName, brandName: "", category, price: price || undefined, quantity: "500g", composition: "500g × 2팩", ingredients: [], verifiedBenefits: [sensory], uspCandidates: [sensory], reviewEvidence: [], usageOccasions: ["가족 저녁"], useSituations: ["가족 저녁"] },
    facts,
    verifiedClaims: facts.map((fact) => fact.value), unverifiedClaims: [], allowedNumericTokens: price ? ["500g", "2팩", price] : ["500g", "2팩"], blockedClaimPatterns: [], productCopyConstraints: [], imageAssets: [], referenceImages: [], imagePaths: [], completeness: 90, createdAt: new Date(0).toISOString(),
  };
}

function candidate(overrides = {}) {
  const headline = overrides.fullCopy || "팬에 올리자 육즙부터 반응 오는데요?";
  return {
    id: "candidate-bold",
    creativeAngle: "sensory-explosion",
    candidateMode: "performance-bold",
    claimModes: ["subjective-reaction"],
    coreFactIds: ["sensory"],
    fullCopy: headline,
    copyBlocks: [{ role: "headline", text: headline, coreFactIds: ["sensory"] }],
    copyRiskFlags: [], copyReviewRequired: false, safeAlternative: "",
    referenceFitReason: "감탄에서 구매 이유로 이어지는 원본 수사를 유지합니다.",
    productDifferenceReason: "검증된 육즙 특성을 조리 순간에 연결합니다.",
    noveltyReason: "현재 상품의 숙성 등심과 팬 조리 장면에서 새로 작성했습니다.",
    ...overrides,
  };
}

function references(count = 6) {
  const mechanisms = ["question", "comparison", "chat", "sensory", "proof", "story"];
  return Array.from({ length: count }, (_, index) => ({
    id: `reference-${index + 1}`,
    path: `/tmp/reference-${index + 1}.jpg`, publicPath: `/reference-${index + 1}.jpg`, sourceFile: `reference-${index + 1}.jpg`,
    layoutFamily: mechanisms[index % mechanisms.length], compositionType: index === 1 ? "comparison" : "product-packshot", categoryGroup: "food", categoryLabel: "식품", selectionReason: "fixture",
    nativeCopy: { rawText: index === 0 ? "왜 아직도 이렇게 고르세요?" : "반응이 달라요!", rawLines: ["원문 헤드라인", "원문 보조"], textRegions: [], useForCopyAdaptation: true },
  }));
}

test("가격 fact가 있는 주관적 가격 반응은 통과하고 없으면 price-shock을 배정하지 않는다", () => {
  const backed = reviewReferenceCopyClaims({ text: "이 가격, 보고도 다시 보게 되네요", truth: productTruth(), coreFactIds: ["price"] });
  assert.equal(backed.valid, true);
  assert.ok(backed.claimModes.includes("subjective-reaction"));
  const noPrice = productTruth({ price: "" });
  assert.equal(reviewReferenceCopyClaims({ text: "이 가격, 보고도 다시 보게 되네요", truth: noPrice, coreFactIds: [] }).valid, false);
  assert.ok(!availableCreativeAngles(noPrice).includes("price-shock"));
});

test("식품의 밈·감각·카테고리 대체형 주관 반응을 객관 순위로 오인하지 않는다", () => {
  const truth = productTruth();
  for (const text of ["이거 ㄹㅇ 밥도둑;;", "팬에 닿자 육즙부터 난리네요", "이거 먹고 나면 다른 고기는 잠깐 잊게 돼요"]) {
    const reviewed = reviewReferenceCopyClaims({ text, truth, coreFactIds: ["sensory"] });
    assert.equal(reviewed.valid, true, text);
    assert.ok(reviewed.claimModes.includes("subjective-reaction"), text);
    assert.ok(!reviewed.errors.some((error) => /판매량|1위/u.test(error)), text);
  }
});

test("근거 없는 물량·할인·등급·최저가·순위·전문가·품절 주장은 결정적으로 실패한다", () => {
  const truth = productTruth();
  for (const text of ["200톤 물량", "50% 할인", "1++등급", "국내 최저가", "판매량 1위", "셰프가 인정한 맛", "곧 품절 임박"]) {
    const reviewed = reviewReferenceCopyClaims({ text, truth, coreFactIds: ["sensory"] });
    assert.equal(reviewed.valid, false, text);
    assert.ok(reviewed.claimModes.includes("prohibited-or-unsupported"), text);
  }
});

test("옵션 선택 전 팩 수와 서로 충돌하는 팩 수 및 내부 분석 라벨을 문구에서 차단한다", () => {
  const truth = productTruth();
  truth.normalized.optionSelectionRequired = true;
  truth.normalized.ambiguousOptionCounts = [3, 4, 5];
  assert.match(reviewReferenceCopyClaims({ text: "한우 안심 4팩", truth, coreFactIds: ["quantity"] }).errors.join(" "), /옵션이 확정되지 않아 팩 수/u);
  assert.match(reviewReferenceCopyClaims({ text: "5팩 구성 · 4팩 선물세트", truth, coreFactIds: ["quantity"] }).errors.join(" "), /서로 다른 판매 팩 수/u);
  assert.match(reviewReferenceCopyClaims({ text: "확인된 상품 표현 · 4팩", truth, coreFactIds: ["quantity"] }).errors.join(" "), /내부 분석 라벨/u);
});

test("안전 최소 문구는 fact 라벨과 깨진 한자 OCR을 광고 문구로 내보내지 않는다", () => {
  const fact = { id: "composition", key: "composition", label: "확인된 상품 표현", value: "한우 안심 4팩", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: ["4팩"], evidenceType: "composition", copyEligibility: "proofOnly" };
  assert.equal(safeMinimalFactText(fact, "food", [], 8), "한우 안심 4팩");
  assert.doesNotMatch(safeMinimalFactText(fact, "food", [], 8), /확인된 상품 표현/u);
  assert.equal(isSafeMinimalFactCandidate({ ...fact, value: "48時間 비법숙성 안심4팩세트" }), false);
});

test("상품 사실의 의미 방향을 뒤집거나 등급 표현을 쉼표로 끊은 문구를 차단한다", () => {
  const truth = productTruth();
  truth.facts.push({ id: "grade-similarity", key: "verified-benefit-grade", label: "등급별 특성", value: "안창살은 저지방 부위로 등급별 차이가 거의 없습니다", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: [], evidenceType: "usp", copyEligibility: "headlineEligible" });
  const reversed = reviewReferenceCopyClaims({ text: "안창살은 저지방 부위로 등급별, 달라요", truth, coreFactIds: ["grade-similarity"] });
  assert.equal(reversed.valid, false);
  assert.match(reversed.errors.join(" "), /반대 의미|의미 없는 쉼표/u);
  const faithful = reviewReferenceCopyClaims({ text: "등급 고민보다 저지방 안창살의 부드러운 식감부터 보세요", truth, coreFactIds: ["grade-similarity", "sensory"] });
  assert.equal(faithful.valid, true);
});

test("한 이미지 안의 긴 핵심 구절 반복과 6장 묶음의 범용 후킹·CTA 반복을 차단한다", () => {
  const repeatedPlan = {
    referenceRawLines: ["원문 1", "원문 2"],
    adaptedLines: ["정말 부드럽고 맛난 프리미엄육 안창살", "한 끼 뒤에도 정말 부드럽고 맛난 프리미엄육 안창살"],
    copySlots: [], headline: "정말 부드럽고 맛난 프리미엄육 안창살", subCopy: "", proof: "", offer: "", cta: "",
  };
  assert.match(findReferenceCopyNaturalnessErrors(repeatedPlan).join(" "), /같은 핵심 구절/u);

  const plans = Array.from({ length: 4 }, (_, index) => ({
    referenceId: `r${index + 1}`,
    headline: index < 2 ? "한입부터 달라요" : `상품 이유 ${index + 1}`,
    subCopy: "", proof: "", offer: "", cta: "오늘 식탁에 담기",
    validationStatus: "valid", validationErrors: [], copySlots: [],
  }));
  const checked = applyReferenceCopyGroupRules(plans, productTruth());
  assert.match(checked[1].validationErrors.join(" "), /한입부터/u);
  assert.match(checked[2].validationErrors.join(" "), /같은 CTA/u);
  assert.match(checked[3].validationErrors.join(" "), /같은 CTA/u);
});

test("근거 없는 가족 경력·사장님 내부정보 원안은 copyReviewRequired와 안전 대체문을 가진다", () => {
  const truth = productTruth();
  for (const text of ["고기만 50년째 드시는 울아버지 원픽", "사장님 몰래 이 가격에 드려요"]) {
    const reviewed = reviewReferenceCopyClaims({ text, truth, coreFactIds: ["sensory", "price"] });
    assert.equal(reviewed.copyReviewRequired, true, text);
    assert.ok(reviewed.copyRiskFlags.length > 0, text);
    assert.ok(reviewed.safeAlternative?.length > 10, text);
  }
});

test("검토 필요 원안은 내부에 보존하면서 자동 제작용 강한 안전 후보로 바뀐다", () => {
  const original = candidate({ fullCopy: "고기만 50년째 드시는 울아버지 원픽", copyBlocks: [{ role: "headline", text: "고기만 50년째 드시는 울아버지 원픽", coreFactIds: ["sensory"] }], copyReviewRequired: true });
  const safe = createAutomaticSafeCandidate(original, productTruth());
  assert.ok(safe);
  assert.equal(safe.copyReviewRequired, false);
  assert.notEqual(safe.fullCopy, original.fullCopy);
  assert.match(safe.fullCopy, /아버지|등심/u);
});

test("OCR reviewRequired와 후보 copyReviewRequired는 독립 필드다", () => {
  const textRegion = { id: "ocr", role: "headline", text: "원문", lines: ["원문"], reviewRequired: true };
  const copy = candidate({ copyReviewRequired: false });
  assert.equal(textRegion.reviewRequired, true);
  assert.equal(copy.copyReviewRequired, false);
  assert.equal("copyReviewRequired" in textRegion, false);
  assert.equal("reviewRequired" in copy, false);
});

test("상품별 내부 후킹 아이디어는 최소 20개이며 가격 근거와 angle 다양성을 지킨다", () => {
  const truth = productTruth();
  const ideas = generateReferenceCopyHookIdeas(truth, references());
  assert.ok(ideas.length >= 20);
  assert.equal(new Set(ideas.map((idea) => idea.id)).size, ideas.length);
  assert.ok(new Set(ideas.map((idea) => idea.creativeAngle)).size >= 6);
  assert.ok(ideas.every((idea) => idea.consumerSituation && idea.tension && idea.reaction && idea.productBridge && idea.referenceMechanism));
  assert.ok(!generateReferenceCopyHookIdeas(productTruth({ price: "" }), references()).some((idea) => idea.creativeAngle === "price-shock"));
});

test("최종 6개 CreativeAngle은 가능한 범위에서 다르고 가격형은 최대 2개다", () => {
  const assigned = assignCreativeAngles(productTruth(), references());
  assert.equal(assigned.length, 6);
  assert.equal(new Set(assigned.map((idea) => idea.creativeAngle)).size, 6);
  assert.ok(assigned.filter((idea) => idea.creativeAngle === "price-shock").length <= 2);
});

test("사용자 예문의 상품명만 바꾼 후보와 조사·어순 변형 후보를 중복 제거한다", () => {
  const templateLike = candidate({ id: "template", fullCopy: "샤워젤만 50년째 쓰시는 울아버지 원픽", copyBlocks: [{ role: "headline", text: "샤워젤만 50년째 쓰시는 울아버지 원픽", coreFactIds: ["sensory"] }] });
  const unique = candidate({ id: "unique", fullCopy: "민트 원료를 보니 운동 뒤 샤워가 먼저 떠오르네요", copyBlocks: [{ role: "headline", text: "민트 원료를 보니 운동 뒤 샤워가 먼저 떠오르네요", coreFactIds: ["sensory"] }] });
  const kept = deduplicateReferenceCopyCandidates([templateLike, unique], ["고기만 50년째 드시는 울아버지 원픽"]);
  assert.deepEqual(kept.map((item) => item.id), ["unique"]);
  assert.equal(isReferenceCopySemanticDuplicate("왜 이 식감만 자꾸 찾게 될까?", "이 식감을 왜 자꾸 찾게 될까?"), true);
});

test("후보 3개는 조사 변경이 아니라 의미가 달라야 한다", () => {
  const candidates = [
    candidate({ id: "a", candidateMode: "reference-faithful", fullCopy: "팬에 올리자 육즙부터 반응 오는데요?" }),
    candidate({ id: "b", candidateMode: "performance-bold", fullCopy: "가족 저녁, 등심 한 팩이면 식탁 분위기가 달라져요" }),
    candidate({ id: "c", candidateMode: "natural-conversation", fullCopy: "평소 고르던 고기, 숙성 차이까지 보고 고르세요" }),
  ];
  assert.equal(deduplicateReferenceCopyCandidates(candidates).length, 3);
  assert.equal(new Set(candidates.map((item) => item.candidateMode)).size, 3);
});

test("selector는 범용 문구보다 상품 특화 문구를 고르고 generic penalty를 실제 반영한다", () => {
  const generic = candidate({ id: "generic", fullCopy: "특별한 선택, 직접 느껴보세요", copyBlocks: [{ role: "headline", text: "특별한 선택, 직접 느껴보세요", coreFactIds: ["sensory"] }] });
  const specific = candidate({ id: "specific" });
  const selected = selectReferenceCopyCandidate({ candidates: [generic, specific], truth: productTruth() });
  assert.equal(selected.selected?.id, "specific");
  assert.ok(genericImageCopyPenalty(generic.fullCopy) > 0);
  assert.deepEqual(REFERENCE_COPY_SELECTOR_WEIGHTS, { stopPower: 20, productDifference: 20, humanVoice: 20, concretePurchaseReason: 15, referenceFit: 20, novelty: 5 });
});

test("후보 검수는 같은 상품 사실 반복과 상품군 감각 충돌을 차단한다", () => {
  const repeated = candidate({ fullCopy: "숙성 한우 등심, 숙성 한우 등심의 육즙", copyBlocks: [
    { role: "headline", text: "숙성 한우 등심", coreFactIds: ["identity"] },
    { role: "support", text: "숙성 한우 등심의 육즙", coreFactIds: ["sensory"] },
  ], coreFactIds: ["identity", "sensory"] });
  assert.match(validateReferenceCopyCandidate({ candidate: repeated, truth: productTruth() }).errors.join(" "), /같은 상품명/u);
  const beauty = productTruth({ category: "퍼스널케어", productName: "민트 샤워젤", sensory: "민트 향과 풍성한 거품" });
  assert.match(validateReferenceCopyCandidate({ candidate: candidate({ fullCopy: "굽자마자 육즙이 터지는 민트 샤워젤", copyBlocks: [{ role: "headline", text: "굽자마자 육즙이 터지는 민트 샤워젤", coreFactIds: ["sensory"] }] }), truth: beauty }).errors.join(" "), /식품 감각/u);
});

test("후보 검수는 서버가 레퍼런스에 배정한 중심 상품 근거를 실제 블록에 요구한다", () => {
  const truth = productTruth();
  const evidenceAssignment = { referenceId: "reference-1", referenceMechanism: "숫자 놀람 → 상품 근거", primaryFactId: "quantity", supportingFactIds: [], evidenceDimension: "numeric-proof", sensoryLed: false, assignmentReason: "fixture" };
  const wrong = candidate({ fullCopy: "향으로 기분 전환해 보세요", coreFactIds: ["quantity"], copyBlocks: [{ role: "headline", text: "향으로 기분 전환해 보세요", coreFactIds: ["quantity"] }] });
  const reviewed = validateReferenceCopyCandidate({ candidate: wrong, truth, evidenceAssignment });
  assert.match(reviewed.errors.join(" "), /실제 내용이 문구에 드러나지|향이 아닌 근거/u);
});

test("육류와 퍼스널케어 fixture는 각 상품 근거·사용 장면 안에서 별도 후킹을 만든다", () => {
  const meatIdeas = assignCreativeAngles(productTruth(), references());
  assert.equal(new Set(meatIdeas.map((idea) => idea.creativeAngle)).size, 6);
  assert.ok(meatIdeas.some((idea) => /육즙|숙성|등심/u.test(idea.productBridge)));

  const beauty = productTruth({ category: "퍼스널케어", productName: "민트 샤워젤", sensory: "민트 향과 풍성한 거품, 운동 후 샤워에 사용" });
  beauty.facts.push({ id: "mint-leaf", key: "ingredient-amount", label: "민트 원료 환산", value: "민트잎 7,927장 분량", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: ["7,927"], evidenceType: "ingredient", copyEligibility: "headlineEligible" });
  beauty.allowedNumericTokens.push("7,927");
  beauty.normalized.usageOccasions = ["운동 후 샤워"];
  beauty.normalized.useSituations = ["운동 후 샤워"];
  const reviewed = reviewReferenceCopyClaims({ text: "한 병에 민트잎 7,927장 분량이라니, 운동 뒤 샤워가 기다려지겠는데요?", truth: beauty, coreFactIds: ["mint-leaf", "sensory"] });
  assert.equal(reviewed.valid, true);
  assert.ok(reviewed.claimModes.includes("objective-fact"));
  assert.ok(reviewed.claimModes.includes("lifestyle-scenario"));
  assert.ok(!generateReferenceCopyHookIdeas(beauty, references()).some((idea) => /육즙|식탁|굽/u.test(`${idea.consumerSituation} ${idea.tension} ${idea.reaction}`)));
});

test("전체 문구를 쓴 뒤 textRegion에 맞추며 단어·배열 계약·remove 슬롯을 보존한다", () => {
  const reference = references(1)[0];
  reference.nativeCopy.rawLines = ["첫 줄", "둘째 줄", "브랜드", "보조 문구"];
  reference.nativeCopy.textRegions = [
    { id: "headline", role: "headline", text: "첫 줄\n둘째 줄", lines: ["첫 줄", "둘째 줄"], characterBudget: 15 },
    { id: "brand", role: "badge", text: "브랜드", lines: ["브랜드"], sourceType: "source-brand", replacePolicy: "remove" },
    { id: "support", role: "support", text: "보조 문구", lines: ["보조 문구"], characterBudget: 20 },
  ];
  const blocks = [
    { role: "headline", text: "팬에 올리자 육즙부터 반응 오는데요?", coreFactIds: ["sensory"] },
    { role: "support", text: "숙성 등심의 육즙을 가족 저녁에 즐겨요", coreFactIds: ["sensory"] },
  ];
  const fitted = fitReferenceCopyBlocks({ reference, copyBlocks: blocks });
  assert.equal(fitted.adaptedLines.length, reference.nativeCopy.rawLines.length);
  assert.equal(fitted.adaptedLines[2], "");
  assert.equal(fitted.adaptedLines.slice(0, 2).join(" "), blocks[0].text);
  const originalWords = blocks[0].text.split(/\s+/);
  assert.ok(fitted.adaptedLines.slice(0, 2).flatMap((line) => line.split(/\s+/)).every((word) => originalWords.includes(word)));
});

test("문구 줄바꿈은 substring 없이 단어 경계에서만 일어난다", () => {
  const text = "가족 저녁에 숙성 등심을 굽는 순간 육즙부터 기대되죠";
  const lines = splitCopyWithoutBreakingWords(text, 3);
  assert.equal(lines.length, 3);
  assert.equal(lines.join(" "), text);
  assert.ok(lines.every((line) => !/(?:하면|인데|이고|라서|위해)$/u.test(line)));
});

test("기존 저장 plan은 신규 후보 메타데이터가 없어도 정상 정규화된다", () => {
  const legacy = { id: "old", resultCode: "H01", referenceId: "r1", referenceCopyProfileId: "p1", headline: "기존 문구", subCopy: "", proof: "", offer: "", cta: "", factIds: [], sourceFactValues: [], tone: "", sentenceStyle: "declaration", naturalnessScore: 90, referenceFitScore: 90, factualSafetyScore: 100, validationStatus: "valid", validationErrors: [], repairCount: 0, generationSource: "codex-local" };
  const normalized = normalizeReferenceCopyPlanMetadata(legacy);
  assert.equal(normalized.headline, "기존 문구");
  assert.deepEqual(normalized.claimModes, []);
  assert.deepEqual(normalized.copyCandidates, []);
  assert.equal(normalized.copyReviewRequired, false);
});

test("문구 기획 전송은 timeout과 일시 HTTP 오류만 재시도한다", () => {
  const timeout = new Error("The operation was aborted");
  timeout.name = "AbortError";
  assert.equal(isRetryableReferenceCopyTransportError(timeout), true);
  assert.equal(isReferenceCopyTimeoutError(timeout), true);
  assert.equal(isRetryableReferenceCopyTransportError(new Error("unexpected status 404 from codex responses")), true);
  assert.equal(isRetryableReferenceCopyTransportError(new Error("unexpected status 503")), true);
  assert.equal(isRetryableReferenceCopyTransportError(new Error("JSON schema validation failed")), false);
  assert.equal(isReferenceCopyTimeoutError(new Error("unexpected status 503")), false);
  assert.equal(isRetryableReferenceCopyTransportError(new Error("로컬 Codex 로그인이 없습니다.")), false);
});

test("가벼운 문구 스키마는 모델에게 문구 필드만 요구한다", () => {
  const copyItem = leanPlannerSchema.properties.copies.items;
  assert.deepEqual(Object.keys(copyItem.properties), ["resultCode", "referenceId", "headline", "support", "proof", "offer", "cta"]);
  assert.equal(copyItem.additionalProperties, false);
  assert.equal(leanPlannerSchema.properties.copies.maxItems, 6);
});

test("프롬프트와 가이드는 레퍼런스 구조 활용·문장 복사 금지·근거 경계를 명시한다", async () => {
  const planner = await readFile(new URL("../app/lib/creative-generation/referenceCopyPlannerRuntime.server.ts", import.meta.url), "utf8");
  assert.match(planner, /slots\.sourceLines와 sourceLinePattern은 저장·승인된 실제 OCR 원문/u);
  assert.match(planner, /sourceLines: region\.lines\.slice/u);
  assert.match(planner, /처음 보는 사람이 1초 안에 이해할 사람 말투/u);
  assert.match(planner, /숫자·가격·구성·효능·원산지·인증은 사용 가능한 사실에 있을 때만 정확히 쓴다/u);
  assert.match(planner, /설명·점수·분석 없이 copies JSON만 반환/u);
  assert.match(planner, /hydrateLeanPlannerPayload/u);
  for (const file of ["kookdae-hanwoo.md", "daehan-hanwoo.md", "fighting-farm.md", "original-source.md"]) {
    const guide = await readFile(new URL(`../data/copy-guides/${file}`, import.meta.url), "utf8");
    assert.match(guide, /표현 방식만 참고 가능/);
    assert.match(guide, /ProductTruth 근거가 있을 때만 사용 가능한 주장/);
  }
});

test("수동·자동 제작은 같은 reference-adapted 다중 후보 pipeline을 공유한다", async () => {
  const [runner, factory, auto] = await Promise.all([
    readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/auto-production/productionRunner.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(runner, /planReferenceAdaptedCopies/);
  assert.match(factory, /copyPlanMode\s*=\s*"reference-adapted"/);
  assert.match(auto, /createNativeGenerationJob/);
});
