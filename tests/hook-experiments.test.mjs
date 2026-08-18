import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";

import { createCreativeAssetRepository } from "../app/lib/creative-assets/repository.server.ts";
import {
  extractCreativeAssetCode,
  validateCreativeAssetCode,
} from "../app/lib/creative-assets/code.ts";
import {
  createExperimentAssetCode,
  createExperimentCode,
  createHookCategoryCode,
} from "../app/lib/hook-experiments/codes.ts";
import {
  buildExperimentPlan,
  buildGenerationJobForExperiment,
} from "../app/lib/hook-experiments/generation.ts";
import { createHostingRegistrationPackageService } from "../app/lib/hook-experiments/hostingPackage.server.ts";
import { ObjectiveHookLearningService } from "../app/lib/hook-experiments/learning.ts";
import {
  HookPerformanceAggregationService,
  HookValidationService,
} from "../app/lib/hook-experiments/performance.ts";
import {
  createCreativePerformanceMatchingService,
  PerformanceImportService,
} from "../app/lib/hook-experiments/performanceImport.server.ts";
import { createHookExperimentRepository } from "../app/lib/hook-experiments/repository.server.ts";

const fixtures = JSON.parse(
  await readFile(path.join(process.cwd(), "tests/fixtures/creative-products.json"), "utf8")
);

function product(overrides = {}) {
  return {
    ...fixtures[0].product,
    brandName: "Original Source",
    advertiserName: "오리지널소스",
    price: "19,900원",
    discountInfo: "",
    productImagePaths: [fixtures[0].product.productImagePath],
    creativeContext: {
      advertiserId: "advertiser-original-source",
      productId: "product-mint",
      reviewInsightIds: ["review-1"],
      reviewInsightSummaries: ["상쾌한 사용감이 반복 언급됨"],
      appliedContentNotes: [],
    },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    advertiserId: "advertiser-original-source",
    advertiserName: "오리지널소스",
    brandId: "original-source",
    brandName: "Original Source",
    categoryId: "personal-care",
    productId: "product-mint",
    originalHostProductNo: "102938",
    product: product(),
    objective: "TRF",
    stage: "DISCOVERY",
    ...overrides,
  };
}

function withLinkedAssets(plan) {
  return {
    ...plan,
    experimentAssets: plan.experimentAssets.map((asset) => ({
      ...asset,
      assetId: `asset-${asset.id}`,
      assetCode: createExperimentAssetCode({
        brandCode: plan.experiment.brandCode,
        originalHostProductNo: plan.experiment.originalHostProductNo,
        hookCode: asset.hookCode,
        generationRound: plan.experiment.testRound,
        variant: asset.variant,
      }),
    })),
  };
}

function performanceRecords(plan, landingPageViewsFor) {
  const linked = withLinkedAssets(plan);
  const records = linked.experimentAssets.map((asset, index) => {
    const groupIndex = linked.hookGroups.findIndex((group) => group.id === asset.hookGroupId);
    const assetIndex = linked.experimentAssets
      .filter((item) => item.hookGroupId === asset.hookGroupId)
      .findIndex((item) => item.id === asset.id);
    const landingPageViews = landingPageViewsFor(groupIndex, assetIndex);
    return {
      id: `record-${index}`,
      experimentId: linked.experiment.id,
      assetId: asset.assetId,
      assetCode: asset.assetCode,
      hookGroupId: asset.hookGroupId,
      platform: "META",
      objective: linked.experiment.objective,
      campaignName: "동일 캠페인",
      adsetName: "동일 광고세트",
      adId: `ad-${index}`,
      adName: `광고_${asset.assetCode}`,
      dateStart: "2026-08-01",
      dateEnd: "2026-08-07",
      spend: 100,
      impressions: 10_000,
      reach: 8_000,
      frequency: 1.25,
      clicks: 200,
      linkClicks: 100,
      outboundClicks: 90,
      landingPageViews,
      engagements: 250,
      purchases: 4,
      purchaseValue: 500,
      matchStatus: "matched",
      importedAt: "2026-08-08T00:00:00.000Z",
      source: "fixture.xlsx",
    };
  });
  return { linked, records };
}

test("실험·소재·비노출 카테고리 코드는 지정 형식을 따르고 소재코드에는 목표가 없다", () => {
  assert.equal(
    createExperimentCode({
      brandCode: "ORS",
      originalHostProductNo: "102938",
      objective: "SLS",
      testRound: 2,
    }),
    "EXP-ORS-102938-SLS-T02"
  );
  const assetCode = createExperimentAssetCode({
    brandCode: "ORS",
    originalHostProductNo: "102938",
    hookCode: "USP",
    generationRound: 2,
    variant: "C",
  });
  assert.equal(assetCode, "AT-ORS-102938-USP-T02-C");
  assert.equal(assetCode.includes("SLS"), false);
  assert.equal(validateCreativeAssetCode(assetCode), true);
  assert.equal(extractCreativeAssetCode(`TRF_${assetCode}_광고`), assetCode);
  assert.equal(
    createHookCategoryCode({
      brandCode: "ORS",
      originalHostProductNo: "102938",
      objective: "TRF",
      testRound: 1,
      hookCode: "SEN",
    }),
    "AA_ORS102938_TRF_T01_SEN"
  );
});

test("T01은 기본 6개 후킹을 두 표현으로 계획하고 같은 후킹 메시지를 유지한다", () => {
  const plan = buildExperimentPlan(input());
  assert.deepEqual(
    plan.recommendations.map((item) => item.hookCode),
    ["SEN", "CUR", "PRB", "PRC", "USP", "EMP"]
  );
  assert.equal(plan.experiment.totalAssetCount, 12);
  assert.equal(plan.hookGroups.length, 6);
  for (const group of plan.hookGroups) {
    const variants = plan.experimentAssets.filter((asset) => asset.hookGroupId === group.id);
    assert.deepEqual(
      variants.map((asset) => asset.variant),
      ["A", "B"]
    );
    assert.equal(new Set(variants.map((asset) => asset.mainMessage)).size, 1);
    assert.deepEqual(
      variants.map((asset) => asset.visualDirection),
      ["COPY_INFORMATION", "SCENE_VISUAL"]
    );
  }
});

test("리뷰 근거가 없으면 REV를 만들지 않고 안전한 대체 후킹을 사용한다", () => {
  const plan = buildExperimentPlan(
    input({
      product: product({
        creativeContext: {
          advertiserId: "a",
          productId: "p",
          reviewInsightIds: [],
          reviewInsightSummaries: [],
          appliedContentNotes: [],
        },
      }),
    })
  );
  assert.equal(
    plan.recommendations.some((item) => item.hookCode === "REV"),
    false
  );
  assert.equal(plan.recommendations.length, 6);
});

test("선택 대조군은 T01 기본 12장과 분리해 2장을 추가한다", () => {
  const plan = buildExperimentPlan(input({ useControl: true }));
  assert.equal(plan.recommendations.at(-1).hookCode, "CTL");
  assert.equal(plan.experiment.totalAssetCount, 14);
});

test("T02는 상위 3개 후킹×6장, T03은 우승 후킹 1개×6장으로 고정한다", () => {
  const t02 = buildExperimentPlan(
    input({ stage: "VALIDATION", selectedHookCodes: ["SEN", "USP", "EMP"], variantsPerHook: 2 })
  );
  const t03 = buildExperimentPlan(
    input({ stage: "REFINEMENT", selectedHookCodes: ["SEN"], variantsPerHook: 2 })
  );
  assert.equal(t02.experiment.testRound, 2);
  assert.equal(t02.experiment.totalAssetCount, 18);
  assert.equal(t02.experiment.ruleConfig.minimumEligibleAssetsPerHook, 3);
  assert.equal(t03.experiment.testRound, 3);
  assert.equal(t03.experiment.totalAssetCount, 6);
});

test("서로 다른 캠페인 목표는 콘텐츠 계획을 바꾸지 않고 실험 코드만 바꾼다", () => {
  const awareness = buildExperimentPlan(input({ objective: "AWR" }));
  const sales = buildExperimentPlan(input({ objective: "SLS" }));
  assert.deepEqual(
    awareness.recommendations.map(({ mainMessage, hookCode }) => ({ mainMessage, hookCode })),
    sales.recommendations.map(({ mainMessage, hookCode }) => ({ mainMessage, hookCode }))
  );
  assert.deepEqual(
    awareness.experimentAssets.map(({ mainMessage, visualDirection, hookCode, variant }) => ({
      mainMessage,
      visualDirection,
      hookCode,
      variant,
    })),
    sales.experimentAssets.map(({ mainMessage, visualDirection, hookCode, variant }) => ({
      mainMessage,
      visualDirection,
      hookCode,
      variant,
    }))
  );
  assert.notEqual(awareness.experiment.experimentCode, sales.experiment.experimentCode);
});

test("기존 생성 엔진에 T01 12개 결과를 전달하고 목표와 무관한 후킹 계획을 유지한다", async () => {
  const plan = buildExperimentPlan(input());
  const job = await buildGenerationJobForExperiment(plan);
  assert.equal(job.results.length, 12);
  assert.equal(job.creativePlan.adBrief, undefined);
  assert.ok(
    job.results.every((result) => result.hookPlan.hookCode && result.hookPlan.experimentVariant)
  );
  assert.equal(new Set(job.results.map((result) => result.hookPlan.mainMessage)).size, 6);
});

test("실험 소재 저장은 T 회차 코드를 발급하고 수정본에 V02를 붙이며 objective를 비운다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-hook-assets-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeAssetRepository({ dataDirectory: directory });
  const base = {
    brandId: "original-source",
    brandName: "Original Source",
    productId: "product-mint",
    productName: "민트 샤워젤",
    originalHostProductNo: "102938",
    category: "바디워시",
    hookType: "sensory",
    mainMessage: "민트의 상쾌함",
    visualDirection: "COPY_INFORMATION",
    generationRound: 1,
    variant: "A",
    experimentId: "experiment-1",
    advertisingHypothesis: "감각 가설",
    headline: "민트의 상쾌함",
    subCopy: "상품 정보",
    benefitCopy: "",
    templateId: "proof-data",
    layoutType: "proof-data",
    backgroundType: "library",
    sourceProductImage: "/product.webp",
    generatedImageUrl: "/generated-ads/hook-a.webp",
    generationRequestKey: "hook-a",
  };
  const first = await repository.create(base);
  const revision = await repository.create({
    ...base,
    parentAssetCode: first.asset.assetCode,
    generatedImageUrl: "/generated-ads/hook-a-v2.webp",
    generationRequestKey: "hook-a-v2",
  });
  assert.match(first.asset.assetCode, /-102938-SEN-T01-A$/);
  assert.match(revision.asset.assetCode, /-102938-SEN-T01-A-V02$/);
  assert.equal(first.asset.objective, "");
});

test("같은 소재를 서로 다른 목표 실험 관계에 연결해도 소재코드는 바뀌지 않는다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-hook-relations-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createHookExperimentRepository({ dataDirectory: directory });
  const awr = buildExperimentPlan(input({ objective: "AWR" }));
  const sls = buildExperimentPlan(input({ objective: "SLS" }));
  await repository.createPlan(awr, "creative-job-awr-12345678");
  await repository.createPlan(sls, "creative-job-sls-12345678");
  const code = createExperimentAssetCode({
    brandCode: "ORS",
    originalHostProductNo: "102938",
    hookCode: awr.experimentAssets[0].hookCode,
    generationRound: 1,
    variant: "A",
  });
  await repository.linkExistingAsset({
    experimentId: awr.experiment.id,
    experimentAssetId: awr.experimentAssets[0].id,
    assetId: "shared-asset",
    assetCode: code,
  });
  await repository.linkExistingAsset({
    experimentId: sls.experiment.id,
    experimentAssetId: sls.experimentAssets[0].id,
    assetId: "shared-asset",
    assetCode: code,
  });
  assert.equal((await repository.get(awr.experiment.id)).experimentAssets[0].assetCode, code);
  assert.equal((await repository.get(sls.experiment.id)).experimentAssets[0].assetCode, code);
});

test("성과 집계는 원시 합계를 먼저 더하고 0과 null을 구분한다", () => {
  const rows = [
    {
      spend: 10,
      impressions: 1000,
      reach: 800,
      clicks: 0,
      linkClicks: 0,
      outboundClicks: null,
      landingPageViews: null,
      engagements: 10,
      purchases: 0,
      purchaseValue: 0,
    },
    {
      spend: 20,
      impressions: 2000,
      reach: 1600,
      clicks: 30,
      linkClicks: 20,
      outboundClicks: null,
      landingPageViews: 10,
      engagements: 20,
      purchases: 1,
      purchaseValue: 100,
    },
  ];
  const metrics = HookPerformanceAggregationService.aggregate(rows);
  assert.equal(metrics.spend, 30);
  assert.equal(metrics.impressions, 3000);
  assert.equal(metrics.ctr, 20 / 3000);
  assert.equal(metrics.cpc, 1.5);
  assert.equal(metrics.outboundClicks, null);
  assert.equal(metrics.purchases, 1);
});

test("T01 비교 가능 데이터는 상위 3개만 선택하고 불균형 데이터는 승자를 강제하지 않는다", () => {
  const base = buildExperimentPlan(input());
  const { linked, records } = performanceRecords(base, (groupIndex) => 100 - groupIndex * 5);
  const analysis = HookValidationService.analyze({
    experiment: linked.experiment,
    hookGroups: linked.hookGroups,
    experimentAssets: linked.experimentAssets,
    performanceRecords: records,
  });
  assert.equal(analysis.comparable, true);
  assert.equal(analysis.selectedHookCodes.length, 3);
  assert.equal(analysis.needsMoreData, false);

  const imbalanced = records.map((record) =>
    record.hookGroupId === linked.hookGroups[0].id ? { ...record, spend: 1000 } : record
  );
  const rejected = HookValidationService.analyze({
    experiment: linked.experiment,
    hookGroups: linked.hookGroups,
    experimentAssets: linked.experimentAssets,
    performanceRecords: imbalanced,
  });
  assert.equal(rejected.comparable, false);
  assert.deepEqual(rejected.selectedHookCodes, []);
  assert.equal(rejected.needsMoreData, true);
});

test("T02는 여러 소재가 반복 우세할 때만 안정 우승 후킹을 정한다", () => {
  const base = buildExperimentPlan(
    input({ stage: "VALIDATION", selectedHookCodes: ["SEN", "USP", "EMP"] })
  );
  const { linked, records } = performanceRecords(base, (groupIndex) =>
    groupIndex === 0 ? 100 : groupIndex === 1 ? 25 : 20
  );
  const analysis = HookValidationService.analyze({
    experiment: linked.experiment,
    hookGroups: linked.hookGroups,
    experimentAssets: linked.experimentAssets,
    performanceRecords: records,
  });
  assert.equal(analysis.comparable, true);
  assert.equal(analysis.groups[0].stability, "STABLE_WINNER");
  assert.equal(analysis.winnerHookCode, "SEN");
  assert.equal(analysis.needsMoreData, false);
});

test("T02의 한 장만 좋은 후킹은 SINGLE_ASSET_WINNER로 표시하고 다음 단계로 넘기지 않는다", () => {
  const base = buildExperimentPlan(
    input({ stage: "VALIDATION", selectedHookCodes: ["SEN", "USP", "EMP"] })
  );
  const { linked, records } = performanceRecords(base, (groupIndex, assetIndex) =>
    groupIndex === 0 ? (assetIndex === 0 ? 1000 : 20) : 50
  );
  const analysis = HookValidationService.analyze({
    experiment: linked.experiment,
    hookGroups: linked.hookGroups,
    experimentAssets: linked.experimentAssets,
    performanceRecords: records,
  });
  const sensory = analysis.groups.find((group) => group.hookCode === "SEN");
  assert.equal(sensory.stability, "SINGLE_ASSET_WINNER");
  assert.equal(analysis.winnerHookCode, undefined);
  assert.equal(analysis.needsMoreData, true);
});

test("CSV/XLSX 보고서는 한영 헤더·0·빈 값을 보존하고 광고명 소재코드를 자동 연결한다", async () => {
  const code = "AT-ORS-102938-SEN-T01-A";
  const sheet = XLSX.utils.json_to_sheet([
    {
      플랫폼: "Meta",
      "캠페인 목표": "트래픽",
      "캠페인 이름": "테스트",
      "광고세트 이름": "세트",
      "광고 ID": "ad-1",
      "광고 이름": `광고_${code}`,
      시작일: "2026-08-01",
      종료일: "2026-08-07",
      지출: 0,
      노출수: 1000,
      "링크 클릭": "",
      "랜딩페이지 조회": 10,
    },
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Meta");
  const rows = PerformanceImportService.parse(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    "meta.xlsx",
    "SLS"
  );
  assert.equal(rows[0].objective, "TRF");
  assert.equal(rows[0].spend, 0);
  assert.equal(rows[0].linkClicks, null);
  const matching = createCreativePerformanceMatchingService({
    getByCode: async (value) => (value === code ? {
      id: "asset-1",
      assetCode: code,
      advertiserId: "advertiser-ors",
      productId: "product-mini-set",
      category: "바디워시/여행용 세트",
      hookVariantCode: "H01",
      hypothesisId: "hypothesis-mini-convenience",
      primaryHookTag: "convenience",
      secondaryHookTags: ["problem-solution"],
      visualDirection: "캐리어 안의 미니 3종과 파우치",
    } : null),
  });
  const records = await matching.match({
    experiment: buildExperimentPlan(input()).experiment,
    experimentAssets: [
      { ...buildExperimentPlan(input()).experimentAssets[0], assetId: "asset-1", assetCode: code },
    ],
    rows,
  });
  assert.equal(records[0].matchStatus, "matched");
  assert.equal(records[0].assetId, "asset-1");
  assert.equal(records[0].advertiserId, "advertiser-ors");
  assert.equal(records[0].productId, "product-mini-set");
  assert.equal(records[0].category, "바디워시/여행용 세트");
  assert.equal(records[0].hypothesisId, "hypothesis-mini-convenience");
  assert.equal(records[0].primaryTag, "convenience");
  assert.deepEqual(records[0].secondaryTags, ["problem-solution"]);
  assert.equal(records[0].dataSufficiency, "additional-data-required");
  assert.equal(records[0].resultStatus, "needs-more-data");
});

test("등록 ZIP은 00_experiment와 후킹별 이미지·XLSX·CSV 구조를 만든다", async () => {
  const plan = buildExperimentPlan(input({ stage: "REFINEMENT", selectedHookCodes: ["SEN"] }));
  const relation = {
    ...plan.experimentAssets[0],
    assetId: "asset-1",
    assetCode: "AT-ORS-102938-SEN-T03-A",
  };
  const asset = {
    id: "asset-1",
    assetCode: relation.assetCode,
    fileName: `${relation.assetCode}.webp`,
    generatedImageUrl: "/generated.webp",
    recommendedAdName: relation.assetCode,
    utmContent: `utm_content=${relation.assetCode}`,
  };
  const service = createHostingRegistrationPackageService({
    assetRepository: { getById: async (id) => (id === asset.id ? asset : null) },
    readRasterAsset: async () => Buffer.from("fake-image"),
  });
  const output = await service.build({
    experiment: plan.experiment,
    hookGroups: plan.hookGroups,
    experimentAssets: [relation],
  });
  const zip = await JSZip.loadAsync(output.buffer);
  assert.equal(output.rowCount, 1);
  assert.ok(zip.file("00_experiment/experiment-plan.xlsx"));
  assert.ok(zip.file("00_experiment/all-registration.xlsx"));
  assert.ok(zip.file("01_SEN/SEN-registration.csv"));
  assert.ok(zip.file(`01_SEN/${asset.fileName}`));
});

test("목표별 후킹 학습은 적격 실험 3회·소재 6개 전에는 VERIFIED가 되지 않는다", () => {
  const store = {
    version: "hook-experiments-v1",
    experiments: [],
    hookGroups: [],
    experimentAssets: [],
    performanceRecords: [],
    analyses: [],
    insights: [],
  };
  for (let index = 0; index < 3; index += 1) {
    const base = buildExperimentPlan(input());
    const { linked, records } = performanceRecords(base, (groupIndex) => 100 - groupIndex * 5);
    const analysis = HookValidationService.analyze({
      experiment: linked.experiment,
      hookGroups: linked.hookGroups,
      experimentAssets: linked.experimentAssets,
      performanceRecords: records,
    });
    store.experiments.push(linked.experiment);
    store.hookGroups.push(...linked.hookGroups);
    store.experimentAssets.push(...linked.experimentAssets);
    store.analyses.push(analysis);
    if (index === 0) {
      const early = ObjectiveHookLearningService.build(store);
      assert.equal(
        early.some((item) => item.status === "VERIFIED"),
        false
      );
    }
  }
  const learned = ObjectiveHookLearningService.build(store);
  const verified = learned.find((item) => item.hookCode === "SEN");
  assert.equal(verified.eligibleExperimentCount, 3);
  assert.equal(verified.assetCount, 6);
  assert.equal(verified.status, "VERIFIED");
  assert.ok(
    ObjectiveHookLearningService.recommendations(learned, "TRF").every(
      (item) => item.status === "VERIFIED"
    )
  );
});
