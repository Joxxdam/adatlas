import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { validateBlueprintCatalog } from "../app/lib/creative-generation/blueprints.ts";
import { buildGenerationSummary } from "../app/lib/creative-generation/generationSummary.ts";
import { BANNED_HOOK_PHRASES, PENALIZED_HOOK_PATTERNS, buildFallbackHookMessages, categoryContamination, messageSimilarity, selectCoreEvidence, generateHookMessages, validateHookMessages } from "../app/lib/creative-generation/hookMessages.server.ts";
import { buildCreativePlan, buildExplorationCreativePlan, createGenerationJob, planAiScenes, planScenes } from "../app/lib/creative-generation/planner.ts";
import { buildProductHookExploration, buildProductInsightProfile, generateHookHypothesisCandidates, selectDiverseHookHypotheses } from "../app/lib/creative-generation/hookHypothesisEngine.ts";
import { buildCategoryHookPriorFromHistory } from "../app/lib/creative-generation/hookLearning.server.ts";
import { matchBrandProfile, matchCategoryProfile } from "../app/lib/creative-generation/profiles.ts";
import { buildProductTruth, validateCopyAgainstTruth } from "../app/lib/creative-generation/productTruth.ts";
import { qaRenderedCreative } from "../app/lib/creative-generation/qa.ts";
import { buildRenderPlan, renderCreativeResult } from "../app/lib/creative-generation/renderer.server.ts";
import { hookMessageCodes } from "../app/lib/creative-generation/types.ts";
import { applyKnownProductAssets } from "../app/lib/creative/knownProductAssets.ts";
import { analyzeProductReferences } from "../app/lib/creative-generation/referenceAnalyzer.server.ts";
import { planMasterScene } from "../app/lib/creative-generation/masterScenePlanner.ts";
import { buildAiFullCreativePrompt, buildMasterScenePrompt } from "../app/lib/creative-generation/promptBuilder.ts";
import { createOrReuseMasterScene } from "../app/lib/creative-generation/masterSceneService.server.ts";
import { masterSceneCacheKey } from "../app/lib/creative-generation/creativeCache.server.ts";
import { buildBenchmarkQualityContract } from "../app/lib/creative/benchmarkPatternMatcher.ts";
import { loadBenchmarkAnalysis } from "../app/lib/creative/benchmarkLoader.ts";

const root = process.cwd();
const fixtures = JSON.parse(await readFile(path.join(root, "tests/fixtures/creative-products.json"), "utf8"));
const categoryFixtures = fixtures.filter((fixture) => fixture.id !== "original-source-mini-shower-gel-set");
const library = JSON.parse(await readFile(path.join(root, "data/background-library.json"), "utf8"));

const genericProduct = {
  productName: "모노 데일리 멀티 파우치",
  category: "기타",
  price: "",
  advertiserName: "모노",
  brandName: "MONO",
  discountInfo: "",
  mainBenefit: "작은 소지품을 나누어 담는 내부 구성",
  targetCustomer: "가방 속 소지품을 정리하려는 고객",
  landingUrl: "https://example.com/mono-pouch",
  productImagePath: "/test-fixtures/creative/ririnco-dress.svg",
  backgroundImagePath: "",
  verifiedBenefits: ["여러 소지품을 나누어 담는 내부 구성"],
};

function truthFor(product) {
  return buildProductTruth({
    product,
    productImagePaths: product.productImagePaths || [product.productImagePath],
    source: "landing-page",
  });
}

function makeJob(product = fixtures[0].product, planOptions = {}) {
  const truth = truthFor(product);
  const creativePlan = buildCreativePlan(truth, planOptions);
  const scenes = planScenes(creativePlan, library, false, planOptions);
  const job = createGenerationJob({ truth, creativePlan, scenes, planningMs: 1, concurrency: 2 });
  return { truth, creativePlan, scenes, job };
}

test("creative blueprint catalog remains available for category-specific master selection", () => {
  const result = validateBlueprintCatalog();
  assert.equal(result.valid, true);
  assert.equal(result.count, 6);
});

test("ProductTruth keeps ad references separate from compositable product images", () => {
  const product = {
    ...fixtures[0].product,
    productImagePath: "/reference/ad.jpg",
    productImagePaths: ["/reference/ad.jpg"],
  };
  const truth = buildProductTruth({
    product,
    productImagePaths: ["/confirmed/product.png", "/reference/ad.jpg"],
    selectedAdImages: ["/reference/ad.jpg"],
    source: "landing-page",
  });
  assert.deepEqual(truth.imagePaths, ["/confirmed/product.png"]);
  assert.equal(truth.referenceImages.length, 1);
  assert.equal(truth.referenceImages[0].role, "ad-reference");
  assert.ok(!truth.imagePaths.includes("/reference/ad.jpg"));
});

test("ProductTruth blocks unverified performance numbers", () => {
  const truth = truthFor(fixtures[0].product);
  assert.equal(validateCopyAgainstTruth("체취 -72% 감소", truth).valid, false);
  assert.equal(validateCopyAgainstTruth("체감 온도 -8.9°C", truth).valid, false);
  assert.equal(validateCopyAgainstTruth(`판매가 ${fixtures[0].product.price}`, truth).valid, true);
});

test("brand and category profiles do not leak personal-care rules into meat or fashion", () => {
  const expected = [
    ["original-source", "personal-care"],
    ["original-source", "personal-care"],
    ["kookdae-hanwoo", "food-meat"],
    ["ririnco", "fashion"],
    ["generic-agriculture", "agriculture"],
    ["generic-household-goods", "household-goods"],
    ["generic-food", "packaged-food"],
  ];
  fixtures.forEach((fixture, index) => {
    assert.equal(matchBrandProfile(fixture.product).id, expected[index][0]);
    assert.equal(matchCategoryProfile(fixture.product).id, expected[index][1]);
  });
  assert.equal(categoryContamination("food-meat", "샤워 후 쿨링"), "샤워");
});

test("오리지널소스 미니 3종 세트 fixture는 고정 문구 없이 휴대·구성 근거로 상품 맞춤 가설을 만든다", () => {
  const fixture = fixtures.find((item) => item.id === "original-source-mini-shower-gel-set");
  assert.ok(fixture);
  assert.match(fixture.product.landingUrl, /originalsource\.co\.kr\/product\//);
  const truth = truthFor(fixture.product);
  const exploration = buildProductHookExploration(truth);
  assert.equal(exploration.selected.length, 6);
  assert.ok(exploration.candidates.some((item) => item.primaryTag === "bundle-choice"));
  assert.ok(exploration.candidates.some((item) => item.primaryTag === "convenience"));
  assert.ok(exploration.candidates.some((item) => /여행|헬스장|캠핑|휴대|파우치|3종/.test(`${item.mainHook} ${item.subCopy} ${item.customerReason}`)));
  assert.ok(exploration.selected.every((item) => item.evidence.length > 0));
  assert.equal(new Set(exploration.selected.map((item) => item.creativeBrief.sceneDescription)).size, 6);
  assert.ok(exploration.selected.every((item) => item.creativeBrief.forbiddenElements.length >= 4));
});

test("category contamination rules cover main, sub, proof and offer vocabulary", () => {
  const cases = [
    ["food-meat", "피부 보습 샤워"],
    ["packaged-food", "쿨링 샤워젤"],
    ["agriculture", "바디워시 세정"],
    ["fashion", "한우 육즙 굽기"],
    ["personal-care", "한우를 식탁에서 굽기"],
    ["household-goods", "피부 개선과 육즙"],
    ["generic-commerce", "즉시 개선 완치"],
  ];
  for (const [category, copy] of cases) assert.ok(categoryContamination(category, copy));
  assert.equal(categoryContamination("personal-care", "민트와 티트리의 산뜻한 사용감"), "");
});

test("fallback hooks use ranked product evidence and exclude banned generic hooks", () => {
  for (const fixture of fixtures) {
    const truth = truthFor(fixture.product);
    const evidence = selectCoreEvidence(truth);
    const hooks = buildFallbackHookMessages(truth);
    assert.ok(evidence.length >= 3 && evidence.length <= 5);
    assert.ok(evidence.every((item) => item.strength > 0 && item.specificity > 0 && item.evidenceType));
    for (const hook of hooks) {
      const copy = `${hook.mainHook} ${hook.subCopy}`;
      assert.ok(!BANNED_HOOK_PHRASES.some((phrase) => copy.includes(phrase)));
      assert.ok(hook.evidenceSummary);
      assert.equal(hook.generationSource, "fallback");
      assert.equal(hook.validationStatus, "fallback");
    }
  }
  assert.ok(PENALIZED_HOOK_PATTERNS.length > 3);
  assert.ok(messageSimilarity("민트로 씻는 순간", "민트로 씻어보세요") > messageSimilarity("민트로 씻는 순간", "원피스 핏을 확인"));
});

test("uncertain source images stay needs-confirmation and never enter composite paths", () => {
  const product = {
    ...genericProduct,
    productImagePath: "",
    productImagePaths: [],
    selectedSourceImagePath: "/images/candidate.jpg",
    sourceImageCandidates: [
      {
        id: "candidate",
        type: "upload",
        imagePath: "/images/candidate.jpg",
        label: "자동 발견 이미지",
        selected: true,
        createdAt: new Date().toISOString(),
        sourceType: "unknown",
      },
    ],
  };
  const truth = buildProductTruth({ product, source: "landing-page" });
  assert.equal(truth.imagePaths.length, 0);
  assert.equal(truth.needsConfirmationImages?.length, 1);
  assert.equal(truth.needsConfirmationImages?.[0].validationStatus, "needs-confirmation");
});

test("fallback copy returns six distinct, fact-linked category-safe message hypotheses", () => {
  for (const product of [...fixtures.map((fixture) => fixture.product), genericProduct]) {
    const truth = truthFor(product);
    const hooks = buildFallbackHookMessages(truth);
    const validation = validateHookMessages(hooks, truth);
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    assert.deepEqual(
      hooks.map((hook) => hook.code),
      hookMessageCodes
    );
    assert.equal(new Set(hooks.map((hook) => hook.hookType)).size, 6);
    assert.equal(new Set(hooks.map((hook) => hook.mainHook)).size, 6);
    assert.ok(hooks.every((hook) => hook.factIds.length > 0));
    const category = matchCategoryProfile(product).id;
    assert.ok(hooks.every((hook) => !categoryContamination(category, `${hook.mainHook} ${hook.subCopy}`)));
  }
});

test("products without price or reviews never receive price-benefit or review hooks", () => {
  const hooks = buildFallbackHookMessages(truthFor(genericProduct));
  assert.ok(!hooks.some((hook) => hook.hookType === "price-benefit"));
  assert.ok(!hooks.some((hook) => hook.hookType === "review-ugc"));
  assert.ok(!hooks.some((hook) => /원|할인|후기|리뷰/.test(`${hook.mainHook} ${hook.subCopy}`)));
});

test("상품별 후킹 탐색은 후보 12~15개를 만든 뒤 서로 다른 근거와 장면의 6개를 선택한다", () => {
  for (const fixture of fixtures) {
    const truth = truthFor(fixture.product);
    const exploration = buildProductHookExploration(truth);
    assert.ok(exploration.candidates.length >= 12 && exploration.candidates.length <= 15);
    assert.equal(exploration.selected.length, 6);
    const tagCounts = exploration.selected.reduce((map, item) => {
      map.set(item.primaryTag, (map.get(item.primaryTag) || 0) + 1);
      return map;
    }, new Map());
    assert.ok([...tagCounts.values()].every((count) => count <= 2));
    assert.equal(new Set(exploration.selected.map((item) => item.sceneKey)).size, 6);
    assert.equal(new Set(exploration.selected.map((item) => item.mainHook)).size, 6);
    assert.ok(exploration.selected.every((item) => item.factIds.length > 0));
    assert.ok(exploration.selected.every((item) => item.creativeBrief.mustUseReferenceImages));
    assert.ok(exploration.selected.every((item) => item.creativeBrief.textRendering === "ai-native-final"));
    assert.ok(exploration.selected.every((item) => item.creativeBrief.requiredKoreanText?.length === 2));
  }
});

test("후킹 후보 점수는 사실성·구체성·차별성·주목도·장면화·광고 적합성을 함께 평가한다", () => {
  const truth = truthFor(fixtures[0].product);
  const profile = buildProductInsightProfile(truth);
  const neutral = generateHookHypothesisCandidates(truth, profile);
  const favored = generateHookHypothesisCandidates(truth, profile, { "feature-usp": 100 });
  for (const candidate of neutral) {
    const score = candidate.score;
    const expected = Math.round(score.evidenceStrength * 0.18 + score.specificity * 0.12 + score.purchaseReasonStrength * 0.12 + score.distinctiveness * 0.12 + score.attentionPotential * 0.1 + score.visualizability * 0.12 + score.advertisingFit * 0.09 + score.claimSafety * 0.1 + score.categoryPrior * 0.03 + score.novelty * 0.02);
    assert.equal(score.total, expected);
    assert.ok(score.total >= 0 && score.total <= 100);
  }
  const baseFeature = neutral.find((item) => item.primaryTag === "feature-usp");
  const favoredFeature = favored.find((item) => item.id === baseFeature.id);
  assert.ok(favoredFeature.score.total - baseFeature.score.total <= 5);
});

test("카테고리 학습은 콜드 스타트를 중립 처리하고 적은 표본을 극단적인 prior로 만들지 않는다", () => {
  const emptyStore = {
    version: "hook-experiments-v1",
    experiments: [],
    hookGroups: [],
    experimentAssets: [],
    performanceRecords: [],
    analyses: [],
    insights: [],
  };
  assert.deepEqual(
    buildCategoryHookPriorFromHistory(emptyStore, {
      categoryId: "바디워시",
      objective: "SLS",
    }),
    {}
  );
  const baseRecord = {
    experimentId: "experiment-1",
    platform: "META",
    objective: "SLS",
    category: "바디워시",
    matchStatus: "matched",
    resultStatus: "promising",
    importedAt: new Date().toISOString(),
    dateEnd: new Date().toISOString().slice(0, 10),
  };
  const store = {
    ...emptyStore,
    performanceRecords: [
      { ...baseRecord, primaryTag: "convenience", roas: 3 },
      { ...baseRecord, primaryTag: "feature-usp", roas: 1 },
    ],
  };
  const prior = buildCategoryHookPriorFromHistory(store, {
    categoryId: "바디워시",
    objective: "SLS",
  });
  assert.ok(prior.convenience > 50 && prior.convenience < 60);
  assert.ok(prior["feature-usp"] > 40 && prior["feature-usp"] < 50);
});

test("가격·리뷰가 확인되지 않은 상품은 해당 후킹 후보를 생성하지 않는다", () => {
  const product = { ...genericProduct, price: "", discountInfo: "", reviewSources: [] };
  const truth = truthFor(product);
  const profile = buildProductInsightProfile(truth);
  const candidates = generateHookHypothesisCandidates(truth, profile);
  assert.equal(profile.priceSignals.length, 0);
  assert.equal(profile.reviewSignals.length, 0);
  assert.ok(!candidates.some((item) => item.primaryTag === "price-value"));
  assert.ok(!candidates.some((item) => item.primaryTag === "review-trust"));
  assert.ok(!candidates.some((item) => /할인|무료배송|후기|리뷰/.test(`${item.mainHook} ${item.subCopy}`)));
});

test("세트·옵션 근거가 있는 상품은 bundle-choice 후보를 만들고 없는 상품에는 강제하지 않는다", () => {
  const setTruth = truthFor(fixtures.find((fixture) => fixture.id === "tidy-home-storage-box").product);
  const setCandidates = generateHookHypothesisCandidates(setTruth);
  assert.ok(setCandidates.some((item) => item.primaryTag === "bundle-choice"));
  const plainTruth = truthFor({ ...genericProduct, discountInfo: "", price: "" });
  assert.ok(!generateHookHypothesisCandidates(plainTruth).some((item) => item.primaryTag === "bundle-choice"));
});

test("리뷰 근거가 실제로 존재할 때만 review-trust 후보가 만들어진다", () => {
  const truth = truthFor(fixtures[0].product);
  truth.facts.push({
    id: "fact-review-fixture",
    key: "review-summary",
    label: "공개 리뷰",
    value: "리뷰 1,644개 · 평점 5.0",
    verification: "source-backed",
    source: "landing-page",
    usableInCopy: true,
    numericTokens: ["1,644", "5.0"],
    strength: 95,
    specificity: 96,
    evidenceType: "review",
  });
  const candidates = generateHookHypothesisCandidates(truth);
  const review = candidates.find((item) => item.primaryTag === "review-trust");
  assert.ok(review);
  assert.match(review.evidenceSummary, /1,644|5\.0/);
});

test("청사과 상품은 확인된 가격·식감·시즌 사실로 서로 다른 후킹을 만든다", () => {
  const product = {
    ...genericProduct,
    productName: "여름 한정 봉황 청사과 5kg",
    category: "식품/선물",
    price: "9,900원",
    originalPrice: "14,900원",
    oldPrice: "14,900원",
    discountInfo: "34% 할인",
    mainBenefit: "아삭/새콤달콤/청량 3박자 한번에",
    targetCustomer: "여름 제철 사과를 합리적인 가격에 찾는 고객",
    landingUrl: "https://www.fightingfarm.com/Goods/Detail/SZE24538732",
    extractedDescription: "여름에만 드실 수 있어요. 이번 기간 지나면 또 1년 기다려야 해요.",
    productRepresentation: {
      type: "irregular-product",
      confidence: 0.8,
      reason: "농산물",
      recommendedExtractionScope: "single-item",
      selectedExtractionScope: "single-item",
    },
  };
  const candidates = generateHookHypothesisCandidates(truthFor(product));
  const messages = candidates.map((item) => `${item.mainHook} ${item.subCopy}`);
  assert.ok(messages.some((message) => /5kg.*9,900원/.test(message)));
  assert.ok(messages.some((message) => /아삭.*새콤달콤.*청량/.test(message)));
  assert.ok(messages.some((message) => /여름.*1년|여름에만/.test(message)));
  assert.ok(!messages.some((message) => /매일 사용하는 순간|핵심 선택/.test(message)));
  assert.ok(!messages.some((message) => /여름사과 1등/.test(message)));
});

test("마스터 장면 캐시는 실제 선택한 상품 사진별로 분리된다", () => {
  const truth = truthFor(fixtures[0].product);
  const profile = {
    id: "profile-test",
    productId: truth.productId,
    referenceImages: [],
  };
  const spec = {
    id: "spec-test",
    productId: truth.productId,
    concept: "실제 상품 사진 보존",
    generationMode: "real-photo-adaptation",
    referenceImageUrls: [],
    promptVersion: "test",
    designFingerprint: "design-test",
    strategyVariation: 1,
  };
  const base = {
    productId: truth.productId,
    profile,
    spec,
    promptVersion: "test",
    imageModel: "local",
  };
  assert.notEqual(masterSceneCacheKey({ ...base, sourceAssetFile: "/product/apple-whole.jpg" }), masterSceneCacheKey({ ...base, sourceAssetFile: "/product/apple-slice.jpg" }));
});

test("광고 콘셉트 탐색 모드는 6개 가설에 서로 다른 brief와 디자인을 연결한다", () => {
  const truth = truthFor({
    ...fixtures[0].product,
    creativeContext: { advertiserId: "advertiser-fixture", productId: "product-fixture" },
  });
  const creativePlan = buildExplorationCreativePlan(truth);
  const scenes = planScenes(creativePlan, library, false);
  const job = createGenerationJob({ truth, creativePlan, scenes, planningMs: 1, concurrency: 2 });
  assert.equal(creativePlan.mode, "concept-exploration");
  assert.equal(creativePlan.candidateHypotheses.length >= 10, true);
  assert.equal(job.results.length, 6);
  assert.equal(new Set(job.results.map((result) => result.hookPlan.creativeBrief.hypothesisId)).size, 6);
  assert.ok(job.results.every((result) => result.hookPlan.creativeBrief.advertiserId === "advertiser-fixture"));
  assert.ok(job.results.every((result) => result.hookPlan.creativeBrief.productId === "product-fixture"));
  assert.ok(job.results.every((result) => result.hookPlan.creativeBrief.differentiationReason));
  assert.equal(new Set(job.results.map((result) => result.creativeDesign.designFingerprint)).size >= 4, true);
  assert.equal(new Set(job.results.map((result) => result.scenePlan.sceneAsset.id)).size >= 4, true);
});

test("AI 전용 제작은 후킹마다 상세페이지 레퍼런스로 완성형 키비주얼 전체를 만든다", { timeout: 30_000 }, async () => {
  const truth = truthFor(fixtures[0].product);
  const creativePlan = buildExplorationCreativePlan(truth);
  const scenes = planAiScenes(creativePlan);
  const job = createGenerationJob({
    truth,
    creativePlan,
    scenes,
    planningMs: 1,
    concurrency: 1,
    paidImageGenerationEnabled: true,
  });
  assert.equal(scenes.length, creativePlan.hookPlans.length);
  assert.equal(new Set(scenes.map((scene) => scene.sceneAsset.id)).size, scenes.length);
  assert.ok(scenes.every((scene) => scene.provider === "openai"));
  assert.ok(scenes.every((scene) => scene.sceneAsset.file === ""));
  assert.ok(scenes.every((scene) => scene.generationMode === "ai-reference-full-creative"));
  assert.equal(job.concurrency, 1);

  const analyzedProfile = await analyzeProductReferences(truth);
  const profile = { ...analyzedProfile, referenceSufficiency: "high" };
  const spec = planMasterScene({
    productId: truth.productId,
    profile,
    masterDesign: job.results[0].creativeDesign,
    aiFullCreative: true,
    strategyVariation: 1,
    creativeBrief: job.results[0].hookPlan.creativeBrief,
  });
  assert.equal(spec.generationMode, "ai-reference-full-creative");
  assert.ok(spec.benchmarkPatterns.length > 0);
  const prompt = buildAiFullCreativePrompt(profile, spec);
  assert.match(prompt, /advertising KEY VISUAL/);
  assert.match(prompt, /authoritative product-page references/);
  assert.match(prompt, /abstract quality bar/i);
  assert.match(prompt, /Never reproduce any benchmark's exact layout/i);
  assert.match(prompt, /fresh hook-specific scene/i);

  const background = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><defs><pattern id="p" width="64" height="64" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#061a24"/><rect x="32" y="32" width="32" height="32" fill="#061a24"/><rect x="32" width="32" height="32" fill="#b7f7e8"/><rect y="32" width="32" height="32" fill="#b7f7e8"/></pattern></defs><rect width="1024" height="1024" fill="url(#p)"/></svg>`)).png().toBuffer();
  const previousEnabled = process.env.ADATLAS_IMAGE_GENERATION_ENABLED;
  const previousExplicitPaid = process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED;
  process.env.ADATLAS_IMAGE_GENERATION_ENABLED = "true";
  process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED = "true";
  let sceneCalls = 0;
  const provider = {
    id: "openai",
    isConfigured: () => true,
    supports: () => true,
    generateScene: async () => {
      throw new Error("AI 전체 콘텐츠 모드에서 텍스트 전용 장면 생성을 호출하면 안 됩니다.");
    },
    generateReferenceImage: async (input) => {
      sceneCalls += 1;
      assert.ok(input.referenceImages.length >= 1);
      assert.equal(input.referenceImages[0], truth.confirmedProductImage.path);
      return { imageBuffer: background, provider: "openai" };
    },
  };
  try {
    const master = await createOrReuseMasterScene({
      truth,
      profile,
      spec,
      forceRevision: true,
      revision: Date.now(),
      provider,
    });
    assert.equal(sceneCalls, 1);
    assert.equal(master.generationMode, "ai-reference-full-creative");
    assert.equal(master.includesProduct, true);
    assert.equal(master.provider, "openai");
    assert.ok(master.productIdentityScore >= 55);
    assert.ok(master.sceneQualityResult.copySafetyScore < 45);
    assert.ok(master.warnings.some((warning) => warning.includes("가독성 보호 그라데이션")));
    assert.ok(master.warnings.some((warning) => warning.includes("완성형 키비주얼 전체")));
  } finally {
    if (previousEnabled === undefined) delete process.env.ADATLAS_IMAGE_GENERATION_ENABLED;
    else process.env.ADATLAS_IMAGE_GENERATION_ENABLED = previousEnabled;
    if (previousExplicitPaid === undefined) delete process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED;
    else process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED = previousExplicitPaid;
  }
});

test("품질 레퍼런스는 21개를 추상 기준으로만 사용하고 신규 구도를 요구한다", () => {
  const analysis = loadBenchmarkAnalysis();
  const contract = buildBenchmarkQualityContract().join(" ");
  assert.equal(analysis.images.length, 21);
  assert.ok(analysis.images.some((image) => image.fileName === "753241875_28004183899268826_5238084778001079519_n.jpg"));
  assert.ok(analysis.images.some((image) => image.fileName === "764720068_841283742285516_8710510657235890494_n.jpg"));
  assert.match(contract, /abstract quality bar/i);
  assert.match(contract, /Never reproduce any benchmark's exact layout/i);
  assert.match(contract, /current verified product, hook and customer situation/i);
  assert.doesNotMatch(contract, /마장동도 놀란 가격|소고기 먹는 날/);
});

test("다양성 선택은 같은 주 태그를 두 개보다 많이 선택하지 않는다", () => {
  const truth = truthFor(fixtures[0].product);
  const candidates = generateHookHypothesisCandidates(truth);
  const duplicated = [...candidates, ...candidates.filter((item) => item.primaryTag === "feature-usp").map((item, index) => ({ ...item, id: `${item.id}-copy-${index}`, mainHook: `${item.mainHook} ${index + 1}`, sceneKey: `${item.sceneKey}-${index}` }))];
  const selected = selectDiverseHookHypotheses(duplicated, 6);
  assert.ok(selected.filter((item) => item.primaryTag === "feature-usp").length <= 2);
});

test("AI 후킹 한 개가 실패하면 통과한 5개를 유지하고 해당 코드만 부분 재생성한다", async () => {
  const truth = truthFor(fixtures[0].product);
  const safe = buildFallbackHookMessages(truth).map((hook) => ({
    code: hook.code,
    hookType: hook.hookType,
    hypothesis: hook.hypothesis,
    mainHook: hook.mainHook,
    subCopy: hook.subCopy,
    factIds: hook.factIds,
    confidence: hook.confidence,
  }));
  const broken = safe.map((hook) => (hook.code === "H02" ? { ...hook, mainHook: "직접 확인해보세요" } : hook));
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  const calls = [];
  process.env.OPENAI_API_KEY = "test-key";
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const hooks = calls.length === 1 ? broken : safe.filter((hook) => hook.code === "H02");
    return new Response(JSON.stringify({ output_text: JSON.stringify({ hooks }) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const generated = await generateHookMessages(truth);
    assert.equal(calls.length, 2);
    assert.equal(generated.hypotheses.length, 6);
    assert.equal(generated.hypotheses.find((hook) => hook.code === "H01").generationSource, "ai");
    assert.equal(generated.hypotheses.find((hook) => hook.code === "H02").generationSource, "repaired-ai");
    assert.equal(generated.hypotheses.find((hook) => hook.code === "H02").repairCount, 1);
    assert.equal(generated.provider, "openai");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("one product gets one master design and one background across H01-H06", () => {
  for (const fixture of fixtures) {
    const { creativePlan, scenes, job } = makeJob(fixture.product);
    assert.equal(creativePlan.hookPlans.length, 6);
    assert.equal(new Set(creativePlan.hookPlans.map((hook) => hook.blueprintId)).size, 1);
    assert.equal(new Set(scenes.map((scene) => scene.sceneAsset.id)).size, 1);
    assert.equal(new Set(job.results.map((result) => result.hookPlan.hookCode)).size, 6);
    assert.ok(job.results.every((result) => result.blueprintId === creativePlan.masterDesign.layoutFamily));
    assert.ok(creativePlan.masterDesign.categoryVariant);
    assert.ok(job.creativePlan.masterDesign.designFingerprint.startsWith("design-"));
  }
});

test("six product categories select evidence-led category variants", () => {
  const variants = categoryFixtures.map((fixture) => makeJob(fixture.product).creativePlan.masterDesign.categoryVariant);
  assert.equal(variants.length, 6);
  assert.ok(new Set(variants).size >= 5);
  assert.ok(variants.includes("ingredient-proof"));
  assert.ok(variants.includes("set-composition"));
  assert.ok(variants.includes("harvest-story"));
  assert.ok(variants.includes("function-demo"));
});

test("different product categories can select different master designs", () => {
  const personal = makeJob(fixtures[0].product).creativePlan.masterDesign.layoutFamily;
  const meat = makeJob(categoryFixtures[1].product).creativePlan.masterDesign.layoutFamily;
  const generic = makeJob(genericProduct).creativePlan.masterDesign.layoutFamily;
  assert.equal(personal, "problem-solution-split");
  assert.equal(meat, "editorial-story");
  assert.equal(generic, "product-hero-lifestyle");
});

test("master and background preservation keeps every fixed design variable stable", () => {
  const first = makeJob(fixtures[0].product);
  const secondTruth = truthFor(fixtures[0].product);
  const secondPlan = buildCreativePlan(secondTruth, {
    preserveMasterDesignId: first.creativePlan.masterDesign.id,
  });
  const secondScenes = planScenes(secondPlan, library, false, {
    preserveBackgroundAssetId: first.scenes[0].sceneAsset.id,
  });
  assert.equal(secondPlan.masterDesign.id, first.creativePlan.masterDesign.id);
  assert.deepEqual(secondPlan.masterDesign.productComposition, first.creativePlan.masterDesign.productComposition);
  assert.equal(secondScenes[0].sceneAsset.id, first.scenes[0].sceneAsset.id);
});

test("H01-H06 render as decodable ads with identical fixed geometry and passing split QA", { timeout: 120_000 }, async () => {
  const { job } = makeJob(fixtures[0].product);
  const rendered = [];
  for (const result of job.results) rendered.push(await renderCreativeResult({ job, result }));
  assert.equal(rendered.length, 6);
  const geometry = JSON.stringify({
    product: rendered[0].renderPlan.productComposition,
    slots: rendered[0].renderPlan.renderedSlots.map((slot) => ({
      id: slot.id,
      box: slot.box,
      fontSize: slot.fontSize,
      textColor: slot.textColor,
      fillColor: slot.fillColor,
    })),
  });
  for (const item of rendered) {
    assert.equal(item.qa.passed, true, JSON.stringify(item.qa.findings));
    assert.equal(item.qa.technicalPassed, true);
    assert.equal(item.qa.creativePassed, true);
    assert.equal(item.qa.designLockVerified, true);
    assert.ok(item.qa.score >= 85);
    assert.equal(item.qa.width, 1200);
    assert.equal(item.qa.height, 1200);
    assert.equal(item.qa.format, "webp");
    assert.ok(item.qa.fileSizeBytes <= 800 * 1024);
    assert.ok(item.qa.productAreaRatio >= 0.09);
    assert.equal(item.renderPlan.renderedSlots.filter((slot) => slot.id === "cta").length, 1);
    assert.equal(
      JSON.stringify({
        product: item.renderPlan.productComposition,
        slots: item.renderPlan.renderedSlots.map((slot) => ({
          id: slot.id,
          box: slot.box,
          fontSize: slot.fontSize,
          textColor: slot.textColor,
          fillColor: slot.fillColor,
        })),
      }),
      geometry
    );
    const metadata = await sharp(path.join(root, "public", item.imagePath.replace(/^\//, ""))).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 1200);
  }
  assert.equal(new Set(rendered.map((item) => item.renderPlan.masterDesignId)).size, 1);
  assert.equal(new Set(rendered.map((item) => item.renderPlan.backgroundAssetId)).size, 1);
  assert.equal(new Set(rendered.map((item) => item.renderPlan.designFingerprint)).size, 1);
  assert.equal(new Set(rendered.map((item) => item.qa.productAreaRatio)).size, 1);
});

test("Creative QA rejects contamination, unsupported graphs, tiny products, and invalid image roles", async () => {
  const { truth, job } = makeJob(categoryFixtures[1].product);
  const result = job.results[0];
  const renderPlan = await buildRenderPlan(job, result, {
    headline: "샤워 후 쿨링",
    body: "피부를 산뜻하게",
  });
  renderPlan.productImageAssets = [
    {
      id: "bad-reference",
      path: "/reference.jpg",
      role: "ad-reference",
      source: "selected-reference",
      verified: true,
      reason: "test",
    },
  ];
  const surfaceBeforeText = await sharp({
    create: { width: 1200, height: 1200, channels: 3, background: "#101010" },
  })
    .png()
    .toBuffer();
  const buffer = await sharp(surfaceBeforeText).webp().toBuffer();
  const qa = await qaRenderedCreative({
    buffer,
    surfaceBeforeText,
    renderPlan,
    truth,
    hookPlan: result.hookPlan,
    productPixelAreaRatio: 0.02,
    productBounds: { x: 700, y: 300, width: 100, height: 100 },
    logoRendered: false,
    unsupportedVisualization: true,
  });
  const ids = new Set(qa.findings.map((finding) => finding.id));
  assert.equal(qa.creativePassed, false);
  assert.equal(qa.passed, false);
  assert.ok(ids.has("category-contamination"));
  assert.ok(ids.has("image-role"));
  assert.ok(ids.has("product-too-small"));
  assert.ok(ids.has("unsupported-visualization"));
});

test("generation ZIP summary preserves all six statuses, failures, master design and missing codes", () => {
  const { job } = makeJob(categoryFixtures[2].product);
  job.results[0].status = "success";
  job.results[1].status = "failed";
  job.results[1].error = "QA 실패";
  job.results = job.results.slice(0, 5);
  const summary = buildGenerationSummary(job);
  assert.equal(summary.counts.expected, 6);
  assert.equal(summary.counts.success, 1);
  assert.equal(summary.counts.failed, 1);
  assert.deepEqual(summary.missingHookCodes, ["H06"]);
  assert.equal(summary.masterDesign.id, job.creativePlan.masterDesign.id);
  assert.equal(summary.results[1].error, "QA 실패");
});

test("Original Source URL jobs still use the registered product cutout and dedicated background", () => {
  const rawProduct = {
    ...fixtures[0].product,
    productName: "오리지널소스 민트 티트리 쿨링 샤워젤 · 바디워시 250ml",
    landingUrl: "https://originalsource.co.kr/product/%EC%98%A4%EB%A6%AC%EC%A7%80%EB%84%90%EC%86%8C%EC%8A%A4-%EB%AF%BC%ED%8A%B8-%ED%8B%B0%ED%8A%B8%EB%A6%AC-%EC%BF%A8%EB%A7%81-%EC%83%A4%EC%9B%8C%EC%A0%A4/65/category/91/display/1/",
    productImagePath: "https://originalsource.co.kr/web/product/big/product.jpg",
    productImagePaths: ["https://originalsource.co.kr/web/product/big/product.jpg"],
  };
  const enriched = applyKnownProductAssets(rawProduct);
  assert.equal(enriched.productImagePath, "/product-cutouts/original-source/mint-tea-tree-250ml.png");
  const { scenes } = makeJob(enriched);
  assert.equal(scenes.length, 6);
  assert.ok(scenes.every((scene) => scene.sceneAsset.id.startsWith("original-source-mint-tea-tree-")));
});

test("six category fixtures classify original images and create fact-safe ProductReferenceProfiles", async () => {
  assert.equal(categoryFixtures.length, 6);
  for (const fixture of categoryFixtures) {
    const profile = await analyzeProductReferences(truthFor(fixture.product));
    assert.equal(profile.productName, fixture.product.productName);
    assert.ok(profile.referenceImages.length >= 1);
    assert.equal(profile.referenceImages[0].role, "primary-product");
    assert.equal(profile.referenceImages[0].usableForGeneration, true);
    assert.ok(["high", "medium", "low"].includes(profile.referenceSufficiency));
    assert.ok(profile.visualIdentity.mustPreserve.length >= 4);
    assert.ok(!profile.verifiedClaims.some((claim) => /1위|판매량|ROAS|효과 보장/.test(claim)));
    assert.equal(profile.immutableFacts.origin, undefined);
  }
});

test("generic restaurant meat backgrounds are reference-only and excluded from automatic generation", () => {
  const genericRestaurants = library.filter((item) => /^meat-0[1-6]$/.test(item.id));
  assert.equal(genericRestaurants.length, 6);
  assert.ok(genericRestaurants.every((item) => item.enabled === false));
});

test("category scene planning uses real references and emits a no-text identity-preserving prompt", async () => {
  const environments = new Set();
  for (const fixture of categoryFixtures) {
    const { truth, creativePlan } = makeJob(fixture.product);
    const profile = await analyzeProductReferences(truth);
    const spec = planMasterScene({
      productId: truth.productId,
      profile,
      masterDesign: creativePlan.masterDesign,
      generationModePreference: "ai-full-scene",
    });
    const prompt = buildMasterScenePrompt(profile, spec);
    environments.add(spec.environment);
    assert.equal(spec.referenceImageUrls[0], fixture.product.productImagePath);
    assert.match(prompt, /실제 레퍼런스/);
    assert.match(prompt, /새로운 상품을 디자인하지 말고/);
    assert.match(prompt, /reference 1:/);
    assert.match(prompt, /no typography, no letters, no numbers/);
    assert.ok(spec.forbiddenElements.some((item) => item.includes("글자")));
  }
  assert.ok(environments.size >= 5);
});

test("scene-provider failure keeps the job data and falls back to an actual-product protected master", { timeout: 30_000 }, async () => {
  const fixture = fixtures[0];
  const { truth, creativePlan, scenes } = makeJob(fixture.product);
  const profile = await analyzeProductReferences(truth);
  const spec = planMasterScene({
    productId: truth.productId,
    profile,
    masterDesign: creativePlan.masterDesign,
    generationModePreference: "ai-full-scene",
    strategyVariation: 2,
  });
  const previousEnabled = process.env.ADATLAS_IMAGE_GENERATION_ENABLED;
  const previousPaid = process.env.PAID_IMAGE_GENERATION_ENABLED;
  const previousExplicitPaid = process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED;
  const calls = [];
  process.env.ADATLAS_IMAGE_GENERATION_ENABLED = "true";
  process.env.PAID_IMAGE_GENERATION_ENABLED = "false";
  process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED = "true";
  const failingProvider = {
    id: "mock",
    isConfigured: () => true,
    supports: () => true,
    generateScene: async () => {
      throw new Error("fixture provider failure");
    },
    generateReferenceImage: async (input) => {
      calls.push(input);
      throw new Error("fixture provider failure");
    },
  };
  try {
    const master = await createOrReuseMasterScene({
      truth,
      profile,
      spec,
      fallbackScene: scenes[0].sceneAsset,
      forceRevision: true,
      revision: Date.now(),
      provider: failingProvider,
    });
    assert.ok(calls.length >= 1);
    assert.deepEqual(calls[0].referenceImages, spec.referenceImageUrls);
    assert.equal(master.generationMode, "protected-product-composite");
    assert.equal(master.includesProduct, true);
    assert.equal(master.productIdentityScore, 100);
    assert.ok(master.file.startsWith("/generated-master-scenes/"));
    assert.ok(master.warnings.some((warning) => warning.includes("실제 상품")));
  } finally {
    if (previousEnabled === undefined) delete process.env.ADATLAS_IMAGE_GENERATION_ENABLED;
    else process.env.ADATLAS_IMAGE_GENERATION_ENABLED = previousEnabled;
    if (previousPaid === undefined) delete process.env.PAID_IMAGE_GENERATION_ENABLED;
    else process.env.PAID_IMAGE_GENERATION_ENABLED = previousPaid;
    if (previousExplicitPaid === undefined) delete process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED;
    else process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED = previousExplicitPaid;
  }
});

test("three unverified AI candidates are rejected before protected-product fallback", { timeout: 30_000 }, async () => {
  const { truth, creativePlan, scenes } = makeJob(categoryFixtures[5].product);
  const profile = await analyzeProductReferences(truth);
  const spec = planMasterScene({
    productId: truth.productId,
    profile,
    masterDesign: creativePlan.masterDesign,
    generationModePreference: "ai-full-scene",
  });
  const generatedWithoutProduct = await readFile(path.join(root, "public", scenes[0].sceneAsset.file.replace(/^\//, "")));
  const previousEnabled = process.env.ADATLAS_IMAGE_GENERATION_ENABLED;
  const previousCandidates = process.env.ADATLAS_MAX_SCENE_CANDIDATES;
  const previousExplicitPaid = process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED;
  process.env.ADATLAS_IMAGE_GENERATION_ENABLED = "true";
  process.env.ADATLAS_MAX_SCENE_CANDIDATES = "3";
  process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED = "true";
  let calls = 0;
  const unverifiedProvider = {
    id: "openai",
    isConfigured: () => true,
    supports: () => true,
    generateScene: async () => {
      throw new Error("not used");
    },
    generateReferenceImage: async () => {
      calls += 1;
      return { imageBuffer: generatedWithoutProduct, provider: "openai" };
    },
  };
  try {
    const master = await createOrReuseMasterScene({
      truth,
      profile,
      spec,
      fallbackScene: scenes[0].sceneAsset,
      forceRevision: true,
      revision: Date.now(),
      provider: unverifiedProvider,
    });
    assert.equal(calls, 3);
    assert.equal(master.candidates.filter((candidate) => candidate.provider === "openai").length, 3);
    assert.ok(master.candidates.filter((candidate) => candidate.provider === "openai").every((candidate) => candidate.quality.recommendation !== "approve"));
    assert.equal(master.generationMode, "protected-product-composite");
    assert.equal(master.productIdentityScore, 100);
  } finally {
    if (previousEnabled === undefined) delete process.env.ADATLAS_IMAGE_GENERATION_ENABLED;
    else process.env.ADATLAS_IMAGE_GENERATION_ENABLED = previousEnabled;
    if (previousCandidates === undefined) delete process.env.ADATLAS_MAX_SCENE_CANDIDATES;
    else process.env.ADATLAS_MAX_SCENE_CANDIDATES = previousCandidates;
    if (previousExplicitPaid === undefined) delete process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED;
    else process.env.ADATLAS_PAID_API_EXPLICIT_ENABLED = previousExplicitPaid;
  }
});

test("H01-H06 plans lock one masterSceneId, fingerprint, digest and identical master pixels", { timeout: 30_000 }, async () => {
  const { truth, creativePlan, scenes } = makeJob(categoryFixtures[5].product);
  const profile = await analyzeProductReferences(truth);
  const spec = planMasterScene({
    productId: truth.productId,
    profile,
    masterDesign: creativePlan.masterDesign,
    generationModePreference: "actual-product",
  });
  const master = await createOrReuseMasterScene({
    truth,
    profile,
    spec,
    fallbackScene: scenes[0].sceneAsset,
    forceRevision: true,
    revision: Date.now(),
  });
  const masterScenes = scenes.map((scene) => ({
    ...scene,
    sceneAsset: { ...scene.sceneAsset, file: master.file },
    masterSceneId: master.id,
    generationMode: master.generationMode,
  }));
  const job = createGenerationJob({
    truth,
    creativePlan,
    scenes: masterScenes,
    planningMs: 1,
    productReferenceProfile: profile,
    masterScene: master,
  });
  const renderPlans = [];
  for (const result of job.results) renderPlans.push(await buildRenderPlan(job, result));
  assert.equal(new Set(renderPlans.map((plan) => plan.masterSceneId)).size, 1);
  assert.equal(new Set(renderPlans.map((plan) => plan.designFingerprint)).size, 1);
  assert.equal(new Set(renderPlans.map((plan) => plan.masterVisualDigest)).size, 1);
  assert.equal(new Set(job.results.map((result) => result.scenePlan.sceneAsset.file)).size, 1);
  const masterPixels = await readFile(path.join(root, "public", master.file.replace(/^\//, "")));
  const repeatedPixels = await Promise.all(job.results.map(() => readFile(path.join(root, "public", master.file.replace(/^\//, "")))));
  assert.ok(repeatedPixels.every((buffer) => buffer.equals(masterPixels)));
  assert.ok(renderPlans.every((plan) => plan.productLayerRequired === false));
  assert.equal(new Set(renderPlans.map((plan) => plan.renderedSlots.find((slot) => slot.id === "headline")?.fontSize)).size, 1);
});

test("client bundle source never references server image API credentials", async () => {
  const clientSource = await readFile(path.join(root, "app/components/features/creative-generation/SixCreativeGenerator.tsx"), "utf8");
  assert.ok(!clientSource.includes("OPENAI_API_KEY"));
  assert.ok(!clientSource.includes("ADATLAS_IMAGE_MODEL"));
  assert.ok(!clientSource.includes("PAID_IMAGE_GENERATION_ENABLED"));
});
