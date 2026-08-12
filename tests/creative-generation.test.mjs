import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import {
  creativeBlueprints,
  validateBlueprintCatalog,
} from "../app/lib/creative-generation/blueprints.ts";
import { buildCreativePlan, createGenerationJob, planScenes } from "../app/lib/creative-generation/planner.ts";
import { matchBrandProfile, matchCategoryProfile } from "../app/lib/creative-generation/profiles.ts";
import { buildProductTruth, validateCopyAgainstTruth } from "../app/lib/creative-generation/productTruth.ts";
import { renderCreativeResult } from "../app/lib/creative-generation/renderer.server.ts";
import { defaultAdBrief } from "../app/lib/mvp/adBrief.ts";
import { applyKnownProductAssets } from "../app/lib/creative/knownProductAssets.ts";

const root = process.cwd();
const fixtures = JSON.parse(await readFile(path.join(root, "tests/fixtures/creative-products.json"), "utf8"));
const library = JSON.parse(await readFile(path.join(root, "data/background-library.json"), "utf8"));

test("creative blueprint catalog defines six unique ad structures", () => {
  const result = validateBlueprintCatalog();
  assert.equal(result.valid, true);
  assert.equal(result.count, 6);
  assert.equal(new Set(result.ids).size, 6);
});

test("blueprints include large, repeated-overlap, and scale-contrast product directions", () => {
  const compositions = Object.fromEntries(
    creativeBlueprints.map((blueprint) => [blueprint.id, blueprint.productComposition])
  );
  assert.equal(compositions["product-hero-lifestyle"].mode, "single");
  assert.ok(
    compositions["product-hero-lifestyle"].instances[0].height >= 740,
    "hero product should be visibly large"
  );
  assert.equal(compositions["editorial-story"].mode, "repeat-overlap");
  assert.equal(compositions["editorial-story"].instances.length, 3);
  assert.equal(compositions["proof-data"].mode, "repeat-overlap");
  assert.equal(compositions["proof-data"].instances.length, 3);
  assert.equal(compositions["comparison-versus"].mode, "scale-contrast");
  assert.equal(compositions["comparison-versus"].instances.length, 2);
  assert.ok(
    compositions["comparison-versus"].instances[1].height >
      compositions["comparison-versus"].instances[0].height
  );
});

test("ProductTruth blocks reference-only performance numbers", () => {
  const truth = buildProductTruth({ product: fixtures[0].product, source: "landing-page" });
  assert.equal(validateCopyAgainstTruth("체취 -72% 감소", truth).valid, false);
  assert.equal(validateCopyAgainstTruth("체감 온도 -8.9°C", truth).valid, false);
  assert.equal(validateCopyAgainstTruth(`판매가 ${fixtures[0].product.price}`, truth).valid, true);
});

test("brand and category profiles match Original Source, Kookdae, and Ririnco without brand conditionals", () => {
  const expected = [
    ["original-source", "personal-care"],
    ["kookdae-hanwoo", "food-meat"],
    ["ririnco", "fashion"],
  ];
  fixtures.forEach((fixture, index) => {
    assert.equal(matchBrandProfile(fixture.product).id, expected[index][0]);
    assert.equal(matchCategoryProfile(fixture.product).id, expected[index][1]);
  });
});

test("planner makes six unique hooks, blueprints, and reusable scenes", () => {
  for (const fixture of fixtures) {
    const truth = buildProductTruth({ product: fixture.product, source: "landing-page" });
    const plan = buildCreativePlan(truth);
    const scenes = planScenes(plan, library, false);
    assert.equal(plan.hookPlans.length, 6);
    assert.equal(new Set(plan.hookPlans.map((item) => item.blueprintId)).size, 6);
    assert.equal(new Set(plan.hookPlans.map((item) => item.hookType)).size, 6);
    assert.equal(new Set(scenes.map((item) => item.sceneAsset.id)).size, 6);
    assert.ok(scenes.every((scene) => scene.provider === "library" && scene.generated === false));
  }
});

test("planner creates message hypotheses instead of product-name fallback copy", () => {
  const fixture = fixtures[0];
  const truth = buildProductTruth({ product: fixture.product, source: "landing-page" });
  const plan = buildCreativePlan(truth);
  const forbiddenFallbacks = [
    "한눈에 만나는 핵심",
    "광고 전에 확인할",
    "고르는 이유가 분명합니다",
    `${fixture.product.category} 고민`,
  ];
  for (const hook of plan.hookPlans) {
    assert.ok(hook.headline.trim(), hook.hookType);
    assert.ok(hook.body.trim(), hook.hookType);
    assert.ok(
      forbiddenFallbacks.every((phrase) => !hook.headline.includes(phrase)),
      hook.headline
    );
    assert.notEqual(hook.headline.replace(/\s+/g, " ").trim(), fixture.product.productName);
    assert.notEqual(hook.body.replace(/\s+/g, " ").trim(), fixture.product.productName);
  }
});

test("Original Source URL jobs use the registered cutout and matching background collection", () => {
  const rawProduct = {
    ...fixtures[0].product,
    productName: "오리지널소스 민트 티트리 쿨링 샤워젤 · 바디워시 250ml",
    landingUrl:
      "https://originalsource.co.kr/product/%EC%98%A4%EB%A6%AC%EC%A7%80%EB%84%90%EC%86%8C%EC%8A%A4-%EB%AF%BC%ED%8A%B8-%ED%8B%B0%ED%8A%B8%EB%A6%AC-%EC%BF%A8%EB%A7%81-%EC%83%A4%EC%9B%8C%EC%A0%A4/65/category/91/display/1/",
    productImagePath: "https://originalsource.co.kr/web/product/big/product.jpg",
    productImagePaths: ["https://originalsource.co.kr/web/product/big/product.jpg"],
  };
  const enriched = applyKnownProductAssets(rawProduct);
  assert.equal(
    enriched.productImagePath,
    "/product-cutouts/original-source/mint-tea-tree-250ml.png"
  );
  const truth = buildProductTruth({ product: enriched, source: "landing-page" });
  const creativePlan = buildCreativePlan(truth);
  const scenes = planScenes(creativePlan, library, false);
  assert.equal(scenes.length, 6);
  assert.ok(
    scenes.every((scene) => scene.sceneAsset.id.startsWith("original-source-mint-tea-tree-")),
    scenes.map((scene) => scene.sceneAsset.id).join(", ")
  );
});

test("selected objective and production approach change the six-card plan", () => {
  const truth = buildProductTruth({ product: fixtures[0].product, source: "landing-page" });
  const awarenessPlan = buildCreativePlan(truth, {
    adBrief: { ...defaultAdBrief, adObjective: "awareness", creativeIntensity: "brand" },
  });
  const conversionPlan = buildCreativePlan(truth, {
    adBrief: { ...defaultAdBrief, adObjective: "purchase", creativeIntensity: "performance" },
  });

  assert.equal(awarenessPlan.adBrief.adObjective, "awareness");
  assert.equal(awarenessPlan.hookPlans[0].hookType, "lifestyle");
  assert.ok(awarenessPlan.hookPlans.every((item) => item.cta === "브랜드 알아보기"));
  assert.ok(awarenessPlan.hookPlans.slice(0, 4).every((item) => item.offer === ""));
  assert.equal(conversionPlan.hookPlans[0].hookType, "price-benefit");
  assert.equal(conversionPlan.hookPlans[1].hookType, "problem-solution");
  assert.ok(conversionPlan.hookPlans.every((item) => item.cta === "구매 조건 보기"));
});

test("Original Source fixture renders six decodable 1200px WebP ads below 800KB", { timeout: 120_000 }, async () => {
  const truth = buildProductTruth({ product: fixtures[0].product, source: "landing-page" });
  const creativePlan = buildCreativePlan(truth);
  const scenes = planScenes(creativePlan, library, false);
  const job = createGenerationJob({ truth, creativePlan, scenes, planningMs: 1, concurrency: 2 });
  const rendered = [];
  for (const result of job.results) rendered.push(await renderCreativeResult({ job, result }));
  assert.equal(rendered.length, 6);
  for (const item of rendered) {
    assert.equal(item.qa.passed, true, JSON.stringify(item.qa.findings));
    assert.equal(item.qa.width, 1200);
    assert.equal(item.qa.height, 1200);
    assert.equal(item.qa.format, "webp");
    assert.ok(item.qa.fileSizeBytes <= 800 * 1024);
    const metadata = await sharp(path.join(root, "public", item.imagePath.replace(/^\//, ""))).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 1200);
  }
  assert.equal(
    rendered.find((item) => item.renderPlan.layout.blueprintId === "editorial-story")
      .renderPlan.productComposition.instances.length,
    3,
    "transparent fixture should preserve the repeated product direction"
  );
});

test("opaque product photos safely fall back from repetition to one image", { timeout: 120_000 }, async () => {
  const photoPath = library.find((item) => item.enabled !== false)?.file;
  assert.ok(photoPath);
  const product = {
    ...fixtures[0].product,
    productImagePath: photoPath,
    productImagePaths: [photoPath],
  };
  const truth = buildProductTruth({ product, productImagePaths: [photoPath], source: "landing-page" });
  const creativePlan = buildCreativePlan(truth);
  const scenes = planScenes(creativePlan, library, false);
  const job = createGenerationJob({ truth, creativePlan, scenes, planningMs: 1, concurrency: 1 });
  const target = job.results.find((result) => result.blueprintId === "editorial-story");
  assert.ok(target);
  const rendered = await renderCreativeResult({ job, result: target });
  assert.equal(rendered.renderPlan.productComposition.mode, "single");
  assert.equal(rendered.renderPlan.productComposition.instances.length, 1);
  assert.equal(rendered.qa.passed, true);
});

test("transparent Original Source cutout renders repeated and mixed-scale product compositions", { timeout: 120_000 }, async () => {
  const cutoutPath = "/product-cutouts/original-source/mint-tea-tree-250ml.png";
  const product = {
    ...fixtures[0].product,
    productImagePath: cutoutPath,
    productImagePaths: [cutoutPath],
  };
  const truth = buildProductTruth({ product, productImagePaths: [cutoutPath], source: "landing-page" });
  const creativePlan = buildCreativePlan(truth);
  const scenes = planScenes(creativePlan, library, false);
  const job = createGenerationJob({ truth, creativePlan, scenes, planningMs: 1, concurrency: 2 });
  const targets = job.results.filter((result) =>
    ["editorial-story", "comparison-versus", "proof-data"].includes(result.blueprintId)
  );
  const rendered = [];
  for (const result of targets) rendered.push(await renderCreativeResult({ job, result }));
  assert.equal(rendered.length, 3);
  assert.equal(rendered[0].renderPlan.productComposition.mode, "repeat-overlap");
  assert.equal(rendered[0].renderPlan.productComposition.instances.length, 3);
  assert.equal(rendered[1].renderPlan.productComposition.mode, "scale-contrast");
  assert.equal(rendered[1].renderPlan.productComposition.instances.length, 2);
  assert.equal(rendered[2].renderPlan.productComposition.mode, "repeat-overlap");
  assert.equal(rendered[2].renderPlan.productComposition.instances.length, 3);
  assert.ok(rendered.every((item) => item.qa.passed));
});
