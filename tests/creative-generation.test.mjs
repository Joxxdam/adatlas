import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { validateBlueprintCatalog } from "../app/lib/creative-generation/blueprints.ts";
import { buildGenerationSummary } from "../app/lib/creative-generation/generationSummary.ts";
import {
  buildFallbackHookMessages,
  categoryContamination,
  validateHookMessages,
} from "../app/lib/creative-generation/hookMessages.server.ts";
import {
  buildCreativePlan,
  createGenerationJob,
  planScenes,
} from "../app/lib/creative-generation/planner.ts";
import { matchBrandProfile, matchCategoryProfile } from "../app/lib/creative-generation/profiles.ts";
import {
  buildProductTruth,
  validateCopyAgainstTruth,
} from "../app/lib/creative-generation/productTruth.ts";
import { qaRenderedCreative } from "../app/lib/creative-generation/qa.ts";
import {
  buildRenderPlan,
  renderCreativeResult,
} from "../app/lib/creative-generation/renderer.server.ts";
import { hookMessageCodes } from "../app/lib/creative-generation/types.ts";
import { applyKnownProductAssets } from "../app/lib/creative/knownProductAssets.ts";

const root = process.cwd();
const fixtures = JSON.parse(
  await readFile(path.join(root, "tests/fixtures/creative-products.json"), "utf8")
);
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
    productImagePaths: [product.productImagePath],
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
    ["kookdae-hanwoo", "food-meat"],
    ["ririnco", "fashion"],
  ];
  fixtures.forEach((fixture, index) => {
    assert.equal(matchBrandProfile(fixture.product).id, expected[index][0]);
    assert.equal(matchCategoryProfile(fixture.product).id, expected[index][1]);
  });
  assert.equal(categoryContamination("food-meat", "샤워 후 쿨링"), "샤워");
});

test("fallback copy returns eight distinct, fact-linked category-safe message hypotheses", () => {
  for (const product of [...fixtures.map((fixture) => fixture.product), genericProduct]) {
    const truth = truthFor(product);
    const hooks = buildFallbackHookMessages(truth);
    const validation = validateHookMessages(hooks, truth);
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    assert.deepEqual(hooks.map((hook) => hook.code), hookMessageCodes);
    assert.equal(new Set(hooks.map((hook) => hook.hookType)).size, 8);
    assert.equal(new Set(hooks.map((hook) => hook.mainHook)).size, 8);
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

test("one product gets one master design and one background across H01-H08", () => {
  for (const fixture of fixtures) {
    const { creativePlan, scenes, job } = makeJob(fixture.product);
    assert.equal(creativePlan.hookPlans.length, 8);
    assert.equal(new Set(creativePlan.hookPlans.map((hook) => hook.blueprintId)).size, 1);
    assert.equal(new Set(scenes.map((scene) => scene.sceneAsset.id)).size, 1);
    assert.equal(new Set(job.results.map((result) => result.hookPlan.hookCode)).size, 8);
    assert.ok(job.results.every((result) => result.blueprintId === creativePlan.masterDesign.layoutFamily));
  }
});

test("different product categories can select different master designs", () => {
  const personal = makeJob(fixtures[0].product).creativePlan.masterDesign.layoutFamily;
  const meat = makeJob(fixtures[1].product).creativePlan.masterDesign.layoutFamily;
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
  assert.deepEqual(
    secondPlan.masterDesign.productComposition,
    first.creativePlan.masterDesign.productComposition
  );
  assert.equal(secondScenes[0].sceneAsset.id, first.scenes[0].sceneAsset.id);
});

test(
  "H01-H08 render as decodable ads with identical fixed geometry and passing split QA",
  { timeout: 120_000 },
  async () => {
    const { job } = makeJob(fixtures[0].product);
    const rendered = [];
    for (const result of job.results) rendered.push(await renderCreativeResult({ job, result }));
    assert.equal(rendered.length, 8);
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
      const metadata = await sharp(
        path.join(root, "public", item.imagePath.replace(/^\//, ""))
      ).metadata();
      assert.equal(metadata.width, 1200);
      assert.equal(metadata.height, 1200);
    }
    assert.equal(new Set(rendered.map((item) => item.renderPlan.masterDesignId)).size, 1);
    assert.equal(new Set(rendered.map((item) => item.renderPlan.backgroundAssetId)).size, 1);
    assert.equal(new Set(rendered.map((item) => item.qa.productAreaRatio)).size, 1);
  }
);

test("Creative QA rejects contamination, unsupported graphs, tiny products, and invalid image roles", async () => {
  const { truth, job } = makeJob(fixtures[1].product);
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

test("generation ZIP summary preserves all eight statuses, failures, master design and missing codes", () => {
  const { job } = makeJob(fixtures[2].product);
  job.results[0].status = "success";
  job.results[1].status = "failed";
  job.results[1].error = "QA 실패";
  job.results = job.results.slice(0, 7);
  const summary = buildGenerationSummary(job);
  assert.equal(summary.counts.expected, 8);
  assert.equal(summary.counts.success, 1);
  assert.equal(summary.counts.failed, 1);
  assert.deepEqual(summary.missingHookCodes, ["H08"]);
  assert.equal(summary.masterDesign.id, job.creativePlan.masterDesign.id);
  assert.equal(summary.results[1].error, "QA 실패");
});

test("Original Source URL jobs still use the registered product cutout and dedicated background", () => {
  const rawProduct = {
    ...fixtures[0].product,
    productName: "오리지널소스 민트 티트리 쿨링 샤워젤 · 바디워시 250ml",
    landingUrl:
      "https://originalsource.co.kr/product/%EC%98%A4%EB%A6%AC%EC%A7%80%EB%84%90%EC%86%8C%EC%8A%A4-%EB%AF%BC%ED%8A%B8-%ED%8B%B0%ED%8A%B8%EB%A6%AC-%EC%BF%A8%EB%A7%81-%EC%83%A4%EC%9B%8C%EC%A0%A4/65/category/91/display/1/",
    productImagePath: "https://originalsource.co.kr/web/product/big/product.jpg",
    productImagePaths: ["https://originalsource.co.kr/web/product/big/product.jpg"],
  };
  const enriched = applyKnownProductAssets(rawProduct);
  assert.equal(enriched.productImagePath, "/product-cutouts/original-source/mint-tea-tree-250ml.png");
  const { scenes } = makeJob(enriched);
  assert.equal(scenes.length, 8);
  assert.ok(scenes.every((scene) => scene.sceneAsset.id.startsWith("original-source-mint-tea-tree-")));
});
