import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createIdempotentJobRunner } from "../app/lib/creative-generation/jobRunnerCore.ts";
import { CURRENT_AUTO_PRODUCTION_JOB_VERSION, CURRENT_AUTO_PRODUCTION_PIPELINE, executionResults, isCurrentAutoProductionGenerationJob, isCurrentReferenceEditGenerationJob, isServerRunnableGenerationJob, staleRunningResultIds } from "../app/lib/creative-generation/jobRunnerPolicy.ts";
import { hasDuplicateRunKey, isProductRecentlyProduced, selectFreshHook, textSimilarity } from "../app/lib/auto-production/duplicateGuard.ts";
import { allHookCodes, hookHypothesesFromJob, resultIdsForHookCodes } from "../app/lib/auto-production/hookSelector.ts";
import { eligibleAutoProductionCandidates, plannedImageCount, selectAutoProductionCandidates } from "../app/lib/auto-production/productSelector.ts";
import { isTrustedAutoProductionRequest } from "../app/lib/auto-production/requestPolicy.ts";
import { dueAdvertisers, isScheduleDue, scheduledRunKey, seoulClock } from "../app/lib/auto-production/schedule.ts";
import { runCandidateSourceFallback } from "../app/lib/auto-production/sourceFallback.ts";
import { createAutoProductionTaskId, normalizeAutoProductionTaskIds } from "../app/lib/auto-production/taskIdentity.ts";
import { candidateIdentityKeys, normalizedProductFamilyName, productFamilyKey } from "../app/lib/auto-production/productIdentity.ts";
import { verifyAutoProductionProductImages } from "../app/lib/auto-production/productImageValidation.ts";
import { AUTO_PRODUCTION_CREATIVES_PER_PRODUCT, AUTO_PRODUCTION_DEFAULT_SCHEDULE_TIME, AUTO_PRODUCTION_IMAGES_PER_MALL, AUTO_PRODUCTION_PRODUCTS_PER_MALL, minimumDailyImageCapacity } from "../app/lib/auto-production/policy.ts";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

function config(overrides = {}) {
  return {
    advertiserId: "adv-1",
    advertiserName: "테스트 광고주",
    aliases: [],
    enabled: true,
    timezone: "Asia/Seoul",
    scheduleTime: "00:00",
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    productsPerRun: 4,
    creativesPerProduct: 6,
    fullHookTestForNewProducts: false,
    productCooldownDays: 7,
    productFamilyCooldownDays: 14,
    hookCooldownDays: 14,
    maxImagesPerRun: 24,
    dataSource: "auto",
    bigQueryBrandMatch: "테스트 광고주",
    siteUrl: "https://shop.example.com",
    excludedProductIds: [],
    excludedCategories: [],
    requiredProductIds: [],
    adminProductUrls: [],
    productVisibilityMode: "site-visible-only",
    selectionPriorities: ["core-expansion", "low-exposure-opportunity", "reactivation", "new-exploration"],
    adObjective: "purchase",
    explorationRatio: 0.3,
    lastRunAt: null,
    nextRunAt: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function candidate(id, overrides = {}) {
  return {
    id,
    externalId: id,
    advertiserId: "adv-1",
    productName: `상품 ${id}`,
    productUrl: `https://shop.example.com/products/${id}`,
    category: "식품",
    imageUrl: `https://cdn.example.com/${id}.jpg`,
    source: "site",
    sourceReason: "공개 상세페이지",
    recommendationRole: "new-exploration",
    recommendationReason: "확인된 상품 근거가 충분합니다.",
    verifiedEvidence: ["상세페이지에서 원산지 확인"],
    recommendedHookDirections: ["USP형"],
    selectionScore: 50,
    currentSales: null,
    previousSales: null,
    orders: null,
    revenue: null,
    impressions: null,
    views: null,
    conversionRate: null,
    reviewCount: null,
    rating: null,
    isNew: false,
    isSeasonal: false,
    siteVisible: true,
    soldOut: false,
    productInfo: {
      productName: `상품 ${id}`,
      category: "식품",
      price: "",
      originalPrice: "",
      discountInfo: "",
      advertiserName: "테스트 광고주",
      brandName: "테스트 광고주",
      mainBenefit: "원산지 확인",
      targetCustomer: "상품 정보를 비교하는 고객",
      landingUrl: `https://shop.example.com/products/${id}`,
      productImagePath: `https://cdn.example.com/${id}.jpg`,
      productImagePaths: [`https://cdn.example.com/${id}.jpg`],
      backgroundImagePath: "",
      extractedMainImage: `https://cdn.example.com/${id}.jpg`,
      extractedGalleryImages: [],
      verifiedBenefits: ["원산지 확인"],
      sourceImageCandidates: [],
    },
    ...overrides,
  };
}

function hooks() {
  return Array.from({ length: 6 }, (_, index) => ({
    code: `H0${index + 1}`,
    hookType: `유형 ${index + 1}`,
    mainHook: `서로 다른 후킹 ${index + 1}`,
    subCopy: `검증된 상품 근거 ${index + 1}`,
    messageHypothesis: `가설 ${index + 1}`,
    customerInsight: `고객 인사이트 ${index + 1}`,
    productEvidence: ["확인된 근거"],
    recommendedScene: `장면 ${index + 1}`,
    selectionReason: "상품 근거가 명확함",
  }));
}

function job(overrides = {}) {
  const results = hooks().map((hook, index) => ({
    id: `result-${index + 1}`,
    order: index + 1,
    status: "pending",
    attempts: 0,
    hookPlan: {
      hookCode: hook.code,
      hookType: hook.hookType,
      primaryTag: `tag-${index + 1}`,
      headline: hook.mainHook,
      body: hook.subCopy,
      hypothesis: hook.messageHypothesis,
      customerReason: hook.customerInsight,
      audience: "고객",
      evidenceSummary: "확인된 근거",
      sceneIntent: hook.recommendedScene,
      selectionReason: hook.selectionReason,
      creativeBrief: {
        messageHypothesis: hook.messageHypothesis,
        customerInsight: hook.customerInsight,
        verifiedFacts: ["확인된 근거"],
        sceneDescription: hook.recommendedScene,
      },
    },
  }));
  return {
    id: "job-1",
    version: "generation-job-v6-ai-native-final",
    engine: "codex_local",
    status: "running",
    retryLimit: 1,
    results,
    updatedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

test("1. 날짜가 바뀌는 자정 Asia/Seoul에 활성 광고주가 실행 대상으로 선택된다", () => {
  const at = new Date("2026-08-19T15:00:00.000Z");
  assert.deepEqual(seoulClock(at), { date: "2026-08-20", hour: 0, minute: 0, weekday: 4 });
  assert.equal(isScheduleDue(config(), at), true);
});

test("자정 예약을 놓친 작업은 저녁 서버 재시작 시 보충 실행하지 않는다", () => {
  assert.equal(isScheduleDue(config(), new Date("2026-08-20T11:18:00.000Z")), false);
  assert.equal(dueAdvertisers([config()], new Set(), new Date("2026-08-20T11:18:00.000Z")).length, 0);
  assert.equal(isScheduleDue(config(), new Date("2026-08-19T15:09:00.000Z")), true);
  assert.equal(isScheduleDue(config(), new Date("2026-08-19T15:10:00.000Z")), false);
});

test("서로 다른 상품 작업은 같은 실행에서도 고유한 React key를 갖고 기존 중복 ID도 복구된다", () => {
  const first = createAutoProductionTaskId("auto-run-same", "product-a");
  const second = createAutoProductionTaskId("auto-run-same", "product-b");
  assert.notEqual(first, second);
  const run = {
    id: "auto-run-same",
    tasks: [candidate("a"), candidate("b")].map((item) => ({ id: "auto-task-duplicated", candidate: item })),
  };
  const normalized = normalizeAutoProductionTaskIds(run);
  assert.equal(new Set(normalized.tasks.map((task) => task.id)).size, 2);
});

test("2. 비활성 광고주는 실행되지 않는다", () => {
  assert.equal(isScheduleDue(config({ enabled: false }), new Date("2026-08-20T01:00:00Z")), false);
});

test("3. 실행 요일이 아닌 광고주는 실행되지 않는다", () => {
  assert.equal(isScheduleDue(config({ scheduleDays: [1] }), new Date("2026-08-20T01:00:00Z")), false);
});

test("4. 동일 runKey는 두 번 실행 대상으로 선택되지 않는다", () => {
  const at = new Date("2026-08-20T01:00:00Z");
  const active = config();
  const key = scheduledRunKey(active, at);
  assert.equal(dueAdvertisers([active], new Set([key]), at).length, 0);
  assert.equal(hasDuplicateRunKey([{ runKey: key }], key), true);
});

test("예약 시간을 바꿔도 같은 날짜의 광고주 작업을 중복 실행하지 않는다", () => {
  const at = new Date("2026-08-20T10:00:00.000Z");
  const active = config({ scheduleTime: "00:00" });
  const oldScheduleKey = `2026-08-20:${active.advertiserId}:07:00`;
  assert.equal(dueAdvertisers([active], new Set([oldScheduleKey]), at).length, 0);
});

test("자동제작은 관리 도구 경로로 분리되고 기존 경로는 redirect 된다", async () => {
  const navigation = await read("app/components/AppFeatureNavigation.tsx");
  const legacyPage = await read("app/auto-production/page.tsx");
  const adminPage = await read("app/admin/auto-production/page.tsx");
  const mainBlock = navigation.slice(navigation.indexOf("const FEATURES"), navigation.indexOf("const AUXILIARY_FEATURES"));
  assert.doesNotMatch(mainBlock, /auto-production/);
  assert.match(navigation, /\/admin\/auto-production/);
  assert.match(legacyPage, /redirect\("\/admin\/auto-production"\)/);
  assert.match(adminPage, /AutoProductionWorkspace/);
});

test("기본 광고주 3곳은 매일 자정, 상품 4개 × 광고 6장으로 설정된다", async () => {
  const seeds = JSON.parse(await read("data/auto-production/advertiser-seed.json"));
  assert.deepEqual(
    seeds.map((item) => item.advertiserName),
    ["국대한우", "대한한우", "힘내라농가"]
  );
  for (const item of seeds) {
    assert.equal(item.scheduleTime, AUTO_PRODUCTION_DEFAULT_SCHEDULE_TIME);
    assert.deepEqual(item.scheduleDays, [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(item.productsPerRun, AUTO_PRODUCTION_PRODUCTS_PER_MALL);
    assert.equal(item.creativesPerProduct, AUTO_PRODUCTION_CREATIVES_PER_PRODUCT);
    assert.equal(item.maxImagesPerRun, AUTO_PRODUCTION_IMAGES_PER_MALL);
  }
});

test("동일 상품군의 용량·수량·옵션 변형은 실행당 한 번만 선정된다", () => {
  assert.equal(normalizedProductFamilyName("알등심 250g 2팩 [선물용]"), normalizedProductFamilyName("알등심 1kg 4팩"));
  const variants = [candidate("sirloin-250", { productName: "알등심 250g 2팩" }), candidate("sirloin-1kg", { productName: "알등심 1kg 세트" }), candidate("rib", { productName: "갈비살 500g" })];
  assert.equal(productFamilyKey(variants[0]), productFamilyKey(variants[1]));
  const selected = selectAutoProductionCandidates(variants, config({ productsPerRun: 3, maxImagesPerRun: 3 }));
  assert.equal(selected.filter((item) => item.productName.includes("알등심")).length, 1);
  assert.equal(new Set(selected.flatMap(candidateIdentityKeys)).size > 0, true);
});

test("관련상품·배너·배송 이미지는 참조에서 제외된다", () => {
  const product = candidate("images").productInfo;
  product.sourceImageCandidates = [
    { id: "hero", type: "hero", imagePath: "https://cdn.example.com/product-front.jpg", label: "제품 정면 라벨", selected: false, createdAt: "2026-08-20", sourceType: "product-gallery", sourceImageQualityScore: 90, salesUnitMatchScore: 95 },
    { id: "related", type: "detail", imagePath: "https://cdn.example.com/related.jpg", label: "함께 구매한 추천 상품", selected: false, createdAt: "2026-08-20" },
    { id: "banner", type: "detail", imagePath: "https://cdn.example.com/event-banner.jpg", label: "쿠폰 배송 이벤트 배너", selected: false, createdAt: "2026-08-20" },
  ];
  const verified = verifyAutoProductionProductImages("민트 샤워젤", product);
  assert.equal(verified.status, "verified");
  assert.deepEqual(verified.selectedPaths, ["https://cdn.example.com/product-front.jpg", "https://cdn.example.com/images.jpg"]);
  assert.equal(verified.rejectedPaths.length, 2);
});

test("세트 상품은 실제 판매 구성 이미지가 없으면 확인 필요로 남긴다", () => {
  const product = candidate("set").productInfo;
  product.sourceImageCandidates = [{ id: "single", type: "hero", imagePath: "https://cdn.example.com/single-product.jpg", label: "단품 정면", selected: false, createdAt: "2026-08-20", sourceType: "product-gallery" }];
  assert.equal(verifyAutoProductionProductImages("한우 4팩 세트", product).status, "needs-review");
  product.sourceImageCandidates.push({ id: "set", type: "detail", imagePath: "https://cdn.example.com/full-set.jpg", label: "4팩 전체 판매 구성", selected: false, createdAt: "2026-08-20", sourceType: "detail-content", multipleObjectsAreSalesUnit: true });
  assert.equal(verifyAutoProductionProductImages("한우 4팩 세트", product).status, "verified");
});

test("예약 CLI는 도래한 광고주만 실행하고 force를 API에 명시적으로 전달한다", async () => {
  const scheduler = await read("app/lib/auto-production/scheduler.server.ts");
  const route = await read("app/api/auto-production/run/route.ts");
  const cli = await read("scripts/run-daily-auto-production.mjs");
  assert.match(scheduler, /input\.trigger === "cli" && !input\.force/);
  assert.match(scheduler, /dueAdvertisers\(active/);
  assert.match(route, /force: trigger === "manual" \? true : Boolean\(body\.force\)/);
  assert.match(cli, /force: options\.force/);
});

test("5. 광고주별 상품 후보는 최대 4개 선정된다", () => {
  const selected = selectAutoProductionCandidates(
    Array.from({ length: 9 }, (_, index) => candidate(String(index))),
    config()
  );
  assert.equal(selected.length, 4);
});

test("6. 판매 규모가 큰 상품은 단순한 전주 하락만으로 탈락하지 않는다", () => {
  const large = candidate("large", { selectionScore: 45, currentSales: 1_000_000, previousSales: 1_200_000, orders: 1_000 });
  const small = candidate("small", { selectionScore: 58, currentSales: 20, previousSales: 10, orders: 1 });
  const selected = selectAutoProductionCandidates([small, large], config({ productsPerRun: 1, maxImagesPerRun: 1, selectionPriorities: ["core-expansion"] }));
  assert.equal(selected[0].id, "large");
});

test("7. 네 가지 상품 역할은 가능한 범위에서 분산된다", () => {
  const selected = selectAutoProductionCandidates([candidate("core", { currentSales: 1_000_000, orders: 1_000 }), candidate("low", { conversionRate: 0.2, impressions: 10 }), candidate("react", { currentSales: 1, previousSales: 1_000_000 }), candidate("new", { isNew: true })], config());
  assert.deepEqual(new Set(selected.map((item) => item.recommendationRole)), new Set(["core-expansion", "low-exposure-opportunity", "reactivation", "new-exploration"]));
});

test("8. 필수 상품을 먼저 선정하고 품절·제외 상품은 빠진다", () => {
  const active = config({ excludedProductIds: ["excluded"], excludedCategories: ["금지"] });
  const eligible = eligibleAutoProductionCandidates([candidate("ok"), candidate("sold", { soldOut: true }), candidate("excluded"), candidate("category", { category: "금지 상품" })], active);
  assert.deepEqual(
    eligible.map((item) => item.id),
    ["ok"]
  );

  const selected = selectAutoProductionCandidates([candidate("higher", { selectionScore: 99 }), candidate("required", { selectionScore: 1 })], config({ requiredProductIds: ["required"], productsPerRun: 1, maxImagesPerRun: 1 }));
  assert.equal(selected[0].id, "required");
});

test("9. 최근 7일 내 제작 상품은 기본적으로 제외된다", () => {
  const selected = selectAutoProductionCandidates([candidate("recent"), candidate("fresh")], config(), new Set(["recent"]));
  assert.equal(
    selected.some((item) => item.id === "recent"),
    false
  );
  assert.equal(
    selected.some((item) => item.id === "fresh"),
    true
  );
  assert.equal(isProductRecentlyProduced(candidate("recent"), [{ status: "completed", candidate: candidate("recent") }]), true);
});

test("10. 동일 또는 유사 후킹은 최근 14일 내 반복되지 않는다", () => {
  const currentHooks = hooks();
  currentHooks[0].mainHook = "오늘 저녁 한우로 특별하게";
  currentHooks[1].mainHook = "원산지를 확인한 한우 한 상";
  const recentTask = {
    status: "completed",
    selectedHookCode: "H01",
    hookHypotheses: [{ ...currentHooks[0], mainHook: "오늘저녁 한우로 특별하게" }],
    candidate: candidate("past"),
  };
  assert.ok(textSimilarity(currentHooks[0].mainHook, recentTask.hookHypotheses[0].mainHook) > 0.72);
  assert.equal(selectFreshHook(currentHooks, [recentTask]).hook.code, "H02");
  assert.equal(selectFreshHook(currentHooks, [], { hasPerformanceLearning: true, explorationRatio: 1, seed: "explore" }).hook.code, "H02");
  assert.match(selectFreshHook(currentHooks, [], { hasPerformanceLearning: true, explorationRatio: 1, seed: "explore" }).reason, /탐색 비율 100%/);
});

test("11. BigQuery 실패 시 사이트 분석 fallback이 작동한다", async () => {
  const result = await runCandidateSourceFallback(
    [
      async () => {
        throw new Error("BigQuery 연결 실패");
      },
      async () => ({ candidates: [candidate("site")], source: "site" }),
    ],
    "site"
  );
  assert.equal(result.source, "site");
  assert.equal(result.fallbackUsed, true);
  assert.match(result.warnings[0], /BigQuery/);
});

test("12. 공개 데이터에 없는 판매량과 매출을 생성하지 않는다", async () => {
  const source = await read("app/lib/auto-production/productSource.server.ts");
  const siteBlock = source.slice(source.indexOf("function siteCandidate"), source.indexOf("function cremaProductInfo"));
  for (const field of ["currentSales", "previousSales", "orders", "revenue", "impressions", "views", "conversionRate"]) {
    assert.match(siteBlock, new RegExp(`${field}: null`));
  }
});

test("13. 레거시 자동제작 기록의 내부 순번 6개를 계속 읽을 수 있다", () => {
  const hypotheses = hookHypothesesFromJob(job());
  assert.equal(hypotheses.length, 6);
  assert.equal(new Set(hypotheses.map((item) => item.mainHook)).size, 6);
});

test("14. 자동 제작에서도 수동 제작과 동일하게 상품별 6장을 독립 실행한다", () => {
  const generated = job({ executionResultIds: job().results.map((result) => result.id) });
  assert.deepEqual(
    executionResults(generated).map((result) => result.id),
    job().results.map((result) => result.id)
  );
});

test("15. 자동·수동 제작은 같은 공용 6장 레퍼런스 작업 생성기를 사용한다", async () => {
  const generated = job();
  assert.equal(allHookCodes(generated).length, 6);
  assert.equal(resultIdsForHookCodes(generated, ["H02"]).length, 1);
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  const factory = await read("app/lib/creative-generation/createNativeGenerationJob.server.ts");
  assert.match(runner, /createNativeGenerationJob/);
  assert.match(runner, /executionResultIds = job\.results\.map/);
  assert.match(runner, /isCurrentAutoProductionGenerationJob/);
  assert.match(runner, /assignedReferences/);
  assert.doesNotMatch(runner, /config\.creativesPerProduct|fullHookTestForNewProducts/);
  assert.match(factory, /selectCategoryNativeAdReferences\(\{ productTruth: truth, referenceCategoryOverride \}, 6/);
  assert.match(factory, /planReferenceAdaptedCopies/);
  assert.doesNotMatch(factory, /planHooksWithCodexLocal|buildExplorationCreativePlan/);
});

test("구형 4장 자동제작은 실행·복구하지 않고 현재 레퍼런스 우선 6장만 허용한다", () => {
  const base = job();
  const referenceResults = base.results.map((result, index) => ({
    ...result,
    nativeCreative: { adReference: { id: `reference-${index + 1}` } },
  }));
  const current = {
    ...base,
    sourceType: "auto-production",
    version: CURRENT_AUTO_PRODUCTION_JOB_VERSION,
    pipeline: CURRENT_AUTO_PRODUCTION_PIPELINE,
    copyPlanMode: "reference-adapted",
    results: referenceResults,
    executionResultIds: referenceResults.map((result) => result.id),
  };
  assert.equal(isCurrentAutoProductionGenerationJob(current), true);
  assert.equal(isServerRunnableGenerationJob(current), true);
  const manual = { ...current, sourceType: "manual", executionResultIds: undefined };
  assert.equal(isCurrentReferenceEditGenerationJob(manual), true);
  assert.equal(isServerRunnableGenerationJob(manual), true);
  assert.equal(isCurrentReferenceEditGenerationJob({ ...manual, results: manual.results.slice(0, 5) }), false);
  assert.equal(isCurrentAutoProductionGenerationJob({ ...current, version: "generation-job-v9-ai-native-complete-ad", pipeline: undefined, executionResultIds: current.executionResultIds.slice(0, 4) }), false);
  assert.equal(isServerRunnableGenerationJob({ ...current, version: "generation-job-v9-ai-native-complete-ad", pipeline: undefined, executionResultIds: current.executionResultIds.slice(0, 4) }), false);
  assert.equal(isServerRunnableGenerationJob({ ...current, sourceType: "manual", version: "generation-job-v9-ai-native-complete-ad", pipeline: undefined }), true);
  assert.equal(isCurrentAutoProductionGenerationJob({ ...current, results: current.results.map((result) => ({ ...result, nativeCreative: undefined })) }), false);
});

test("핫리로드는 구형 스케줄러를 폐기하고 영속 순차 대기열을 쓰는 v3만 유지한다", async () => {
  const scheduler = await read("app/lib/auto-production/scheduler.server.ts");
  assert.match(scheduler, /scheduler-v3-sequential-queue/);
  assert.match(scheduler, /scheduler-v2-exact-window/);
  assert.match(scheduler, /retireLegacyAutoProductionSchedulers/);
  assert.match(scheduler, /clearInterval/);
});

test("16. 하루 기본 용량은 활성 3개 몰의 4×6, 총 72장이며 추가 제작과 분리된다", async () => {
  const advertisers = [config({ advertiserId: "a" }), config({ advertiserId: "b" }), config({ advertiserId: "c" })];
  assert.equal(plannedImageCount(advertisers), 72);
  assert.equal(minimumDailyImageCapacity(advertisers), 72);
  const repository = await read("app/lib/auto-production/productionRepository.server.ts");
  assert.match(repository, /automaticExpectedImages \?\? run\.expectedImages/);
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  const manualBlock = runner.slice(runner.indexOf("export async function queueAutoProductionHooks"), runner.indexOf("export async function cancelAutoProductionRun"));
  assert.doesNotMatch(manualBlock, /maxImagesPerDay/);
});

test("17. 한 상품 실패가 다음 상품 작업을 막지 않는다", async () => {
  const seen = [];
  const runner = createIdempotentJobRunner(async (id) => {
    seen.push(id);
    if (id === "failed-product") throw new Error("상품 이미지 없음");
  }, 1);
  runner.enqueue("failed-product");
  runner.enqueue("next-product");
  await assert.rejects(runner.wait("failed-product"));
  await runner.wait("next-product");
  assert.deepEqual(seen, ["failed-product", "next-product"]);
});

test("17-1. 취소된 자동제작은 느린 상품 분석 뒤 새 작업을 등록하거나 다음 상품으로 진행하지 않는다", async () => {
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  const prepareBlock = runner.slice(runner.indexOf("async function prepareTask"), runner.indexOf("export async function runAutoProductionForProduct"));
  const scheduledBlock = runner.slice(runner.indexOf("export async function startScheduledAutoProductionRun"), runner.indexOf("export async function runAutoProductionForAdvertiser"));
  assert.match(prepareBlock, /await ensureRunActive\(run\.id\)/);
  assert.match(prepareBlock, /await cancelPreparedGenerationJob\(job\.id\)/);
  assert.match(prepareBlock, /if \(!registered\)/);
  assert.match(prepareBlock, /await cancelPreparedGenerationJob\(queuedJob\.id\)/);
  assert.match(scheduledBlock, /current\.status === "cancelled"/);
  assert.match(scheduledBlock, /if \(isCancellationError\(error\)\) break/);
});

test("18. 후킹별 단일 세션을 분리하고 한 상품에서 최대 3장을 병렬 처리한다", async () => {
  const [generation, provider, runner] = await Promise.all([read("app/lib/creative-generation/nativeResultGeneration.server.ts"), read("app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts"), read("app/lib/creative-generation/jobRunner.server.ts")]);
  assert.doesNotMatch(generation, /codexProductThreadKey|resumeThread|saveAdvertiserThread/);
  assert.doesNotMatch(generation, /advertiserLocks/);
  assert.match(generation, /withNativeCreativeSession\(provider/);
  assert.match(generation, /session\.generate/);
  assert.match(generation, /session\.validate/);
  assert.doesNotMatch(generation, /provider\.(?:generate|validate)\(/);
  const sessionBlock = provider.slice(provider.indexOf("async openSession"), provider.indexOf("async validateGroup"));
  assert.equal((sessionBlock.match(/this\.codex\.startThread/g) || []).length, 1);
  assert.doesNotMatch(provider, /qaThread|resumeThread|saveAdvertiserThread|codexProductThreadKey/);
  assert.match(runner, /selectRunnableResults/);
  assert.match(runner, /Promise\.all/);
});

test("19. 서버 복구는 완료 결과를 재생성하지 않고 실행 범위의 미완료만 복구한다", () => {
  const generated = job({
    executionResultIds: ["result-2"],
    updatedAt: "2026-08-19T00:00:00.000Z",
    results: job().results.map((result, index) => ({ ...result, status: index < 2 ? "running" : "success" })),
  });
  assert.deepEqual(staleRunningResultIds(generated, new Date("2026-08-20T00:00:00Z").getTime(), 60_000, false), ["result-2"]);
});

test("20. 자동 생성 결과에는 기존 소재코드 발급 흐름이 연결된다", async () => {
  const source = await read("app/lib/creative-generation/nativeResultGeneration.server.ts");
  assert.match(source, /createAssetFromGenerationResult/);
  assert.match(source, /toCreativeAssetSnapshot/);
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  assert.match(runner, /assetCode: result\.creativeAsset\?\.assetCode/);
});

test("21. 최종 이미지는 1200×1200 JPEG, 800KB 이하로 검증된다", async () => {
  const source = await read("app/lib/creative-generation/nativeCreativeStorage.server.ts");
  assert.match(source, /MAX_FINAL_BYTES = 800 \* 1024/);
  assert.match(source, /resize\(1200, 1200/);
  assert.match(source, /metadata\.format !== "jpeg" \|\| metadata\.width !== 1200 \|\| metadata\.height !== 1200/);
});

test("22. 자동 제작 경로에서는 템플릿 렌더러가 호출되지 않는다", async () => {
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  const service = await read("app/lib/creative-generation/createNativeGenerationJob.server.ts");
  assert.match(runner, /createNativeGenerationJob/);
  assert.doesNotMatch(runner, /renderer\.server|renderCreativeResult|template-ad/);
  assert.doesNotMatch(service, /renderer\.server|renderCreativeResult|template-ad/);
});

test("23. Codex 실패 시 유료 API로 자동 전환되지 않는다", async () => {
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  const service = await read("app/lib/creative-generation/createNativeGenerationJob.server.ts");
  assert.match(runner, /engine: "codex_local"/);
  assert.match(service, /다른 엔진이나 기존 배경으로 자동 전환하지 않습니다/);
  assert.doesNotMatch(runner, /openai_api/);
});

test("23-1. 완료 실행은 출근 전 ZIP과 후킹별 광고 세팅 파일을 미리 준비한다", async () => {
  const source = await read("app/lib/auto-production/package.server.ts");
  const productRoute = await read("app/api/auto-production/runs/[runId]/products/[taskId]/download/route.ts");
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  assert.match(source, /meta-ad-settings\.csv/);
  assert.match(source, /\$\{hookCode\}-ad-setup\.json/);
  assert.match(source, /engine: "codex_local"/);
  assert.match(source, /buildAutoProductionProductPackage/);
  assert.match(source, /failures\.json/);
  assert.match(productRoute, /buildAutoProductionProductPackage/);
  assert.match(runner, /buildAutoProductionPackage/);
  assert.match(runner, /packageStatus: "ready"/);
});

test("24. 실행 API는 외부 임의 요청과 CSRF 없는 변경을 차단한다", () => {
  assert.equal(isTrustedAutoProductionRequest({ url: "https://evil.example/api/auto-production/run", host: "evil.example", mutation: true }), false);
  assert.equal(isTrustedAutoProductionRequest({ url: "http://localhost:3000/api/auto-production/run", host: "localhost:3000", mutation: true }), false);
  assert.equal(isTrustedAutoProductionRequest({ url: "http://localhost:3000/api/auto-production/run", host: "localhost:3000", origin: "http://localhost:3000", mutation: true }), true);
});

test("25. 광고주 추가·수정·일시정지 기능이 API와 화면에 연결된다", async () => {
  const collectionRoute = await read("app/api/auto-production/advertisers/route.ts");
  const itemRoute = await read("app/api/auto-production/advertisers/[advertiserId]/route.ts");
  const workspace = await read("app/components/auto-production/AutoProductionWorkspace.tsx");
  assert.match(collectionRoute, /export async function POST/);
  assert.match(collectionRoute, /export async function PATCH/);
  assert.match(itemRoute, /export async function PATCH/);
  assert.match(workspace, /광고주 추가/);
  assert.match(workspace, /전체 일시정지/);
  assert.match(workspace, /설정 수정/);
  assert.match(workspace, /새 광고주는 일시정지 상태로 저장됩니다/);
  const repository = await read("app/lib/auto-production/advertiserConfig.server.ts");
  assert.match(repository, /current\?\.enabled \?\? false/);
  assert.match(repository, /usingSeed \? \{ \.\.\.config, enabled: false \}/);
});

test("27. 공개 자동제작 응답은 원본 분석 후보와 로컬 비공개 정보를 제거한다", async () => {
  const source = await read("app/lib/auto-production/publicAutoProduction.server.ts");
  assert.match(source, /sourceImageCandidates: \[\]/);
  assert.match(source, /selectionScore: Math\.max\(0, Math\.min\(100/);
  assert.match(source, /verifiedEvidence: candidate\.verifiedEvidence\.slice/);
  assert.match(source, /currentSales: null/);
  assert.match(source, /dataEvidence: \[\]/);
  assert.match(source, /tasks: run\.tasks\.map/);
  assert.match(source, /\[비공개 인증정보\]/);
});

test("28. UI는 날짜별 실행 내역과 자동제작 이미지를 한 화면에서 보여준다", async () => {
  const workspace = await read("app/components/auto-production/AutoProductionWorkspace.tsx");
  for (const label of ["자동 콘텐츠 제작", "오늘의 제작 현황", "몰별 다음 제작 예정 상품", "이 4개로 예정상품 확정", "자동제작 설정", "최근 자동 제작 결과", "어제", "최근 7일", "기간 선택", "전체 {productionRun.completedImages}장 ZIP 다운로드", "상품 {downloadableCount}장 ZIP", "다운로드"]) {
    assert.match(workspace, new RegExp(label));
  }
  assert.match(workspace, /settingsPanel/);
  assert.match(workspace, /result\.imageUrl/);
  assert.match(workspace, /result\.downloadUrl/);
  assert.match(workspace, /dateFrom/);
  assert.match(workspace, /dateTo/);
  assert.match(workspace, /\/create-product\?view=results/);
  assert.doesNotMatch(workspace, /골든 레퍼런스로 등록/);
});

test("26. 후킹 6개 전체 제작은 공용 엔진을 사용하고 자동제작 화면에도 저장 결과를 표시한다", async () => {
  const workspace = await read("app/components/auto-production/AutoProductionWorkspace.tsx");
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  assert.match(workspace, /imageResults/);
  assert.match(workspace, /\/products\/\$\{encodeURIComponent\(task\.id\)\}\/download/);
  assert.doesNotMatch(workspace, /후킹 가설 6개 보기/);
  assert.doesNotMatch(workspace, /6개 후킹 모두 제작/);
  assert.match(runner, /hookCodes\.length \? hookCodes : allHookCodes\(job\)/);
});

test("29. 최근 실행 API는 오늘·어제·7일·직접 기간 조회를 서버 날짜 범위로 제한한다", async () => {
  const route = await read("app/api/auto-production/runs/route.ts");
  const repository = await read("app/lib/auto-production/productionRepository.server.ts");
  assert.match(route, /dateFrom/);
  assert.match(route, /dateTo/);
  assert.match(route, /dateFrom > dateTo/);
  assert.match(repository, /run\.businessDate >= options\.dateFrom/);
  assert.match(repository, /run\.businessDate <= options\.dateTo/);
});

test("30. 자정 예약은 모든 몰을 먼저 저장하고 기존 작업이 끝날 때마다 하나씩 시작한다", async () => {
  const scheduler = await read("app/lib/auto-production/scheduler.server.ts");
  const runner = await read("app/lib/auto-production/productionRunner.server.ts");
  assert.match(scheduler, /scheduleAutoProductionForAdvertiser/);
  assert.match(scheduler, /startNextScheduledRun/);
  assert.match(scheduler, /if \(processing\.length\) return null/);
  assert.match(scheduler, /statuses: \["scheduled"\]/);
  assert.doesNotMatch(scheduler.slice(scheduler.indexOf("export async function tickAutoProductionScheduler"), scheduler.indexOf("export async function runAutoProductionNow")), /slice\(0, slots\.available\)/);
  assert.doesNotMatch(scheduler, /availableAdvertiserSlots/);
  assert.match(scheduler, /for \(const config of due\)/);
  assert.match(scheduler, /예약 후 광고주 자동제작 설정이 비활성화되어 건너뛰었습니다/);
  assert.match(runner, /if \(run\.status !== "scheduled"\) return run/);
  assert.match(runner, /startedAt: now\.toISOString\(\)/);
  assert.match(runner, /statuses: processingStatuses/);
});

test("31. 몰별 예정상품 URL을 수정·확정하고 공용 생성 결과를 같은 화면에서 확인한다", async () => {
  const [workspace, route, runner, packaging, source] = await Promise.all([
    read("app/components/auto-production/AutoProductionWorkspace.tsx"),
    read("app/api/auto-production/run/route.ts"),
    read("app/lib/auto-production/productionRunner.server.ts"),
    read("app/lib/auto-production/package.server.ts"),
    read("app/lib/auto-production/productSource.server.ts"),
  ]);
  assert.match(workspace, /plannedUrlDrafts/);
  assert.match(workspace, /adminProductUrls: urls/);
  assert.match(workspace, /저장하고 지금 제작/);
  assert.doesNotMatch(workspace, /상품 URL 직접 제작/);
  assert.match(workspace, /result\.imageUrl/);
  assert.match(route, /body\.productUrl/);
  assert.match(route, /directProductInfo/);
  assert.match(route, /runAutoProductionForProduct/);
  assert.match(runner, /createNativeGenerationJob/);
  assert.match(runner, /config\.adminProductUrls\.length/);
  assert.match(source, /fromPlannedProductUrls/);
  assert.match(source, /자동제작 화면에서 확정한 다음 제작 예정 상품 URL/);
  assert.match(source, /fromExactProductUrl/);
  assert.match(source, /extractProduct/);
  assert.match(source, /directProductInfo/);
  assert.match(source, /directProductCandidate/);
  const plannedSource = source.slice(source.indexOf("async function fromPlannedProductUrls"), source.indexOf("export async function loadAutoProductionCandidates"));
  assert.match(plannedSource, /fromExactProductUrl/);
  assert.doesNotMatch(plannedSource, /fromSite\(/);
  assert.match(runner, /Boolean\(result\.imageUrl\)/);
  assert.match(packaging, /Boolean\(result\.nativeCreative\?\.finalPath\)/);
});

test("32. 자동제작 실행 내역은 중복 안내 문구와 레거시 ID에도 고유한 React key를 사용한다", async () => {
  const workspace = await read("app/components/auto-production/AutoProductionWorkspace.tsx");
  assert.match(workspace, /key=\{`\$\{productionRun\.id\}:warning:\$\{warningIndex\}`\}/);
  assert.match(workspace, /key=\{`\$\{productionRun\.id\}:task:\$\{task\.id\}:\$\{taskIndex\}`\}/);
  assert.match(workspace, /key=\{`\$\{productionRun\.id\}:task:\$\{task\.id\}:result:\$\{result\.generationResultId\}:\$\{resultIndex\}`\}/);
  assert.doesNotMatch(workspace, /key=\{warning\}/);
});
