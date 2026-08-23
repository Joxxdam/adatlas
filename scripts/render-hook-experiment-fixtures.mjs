import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { buildCreativePlan, createGenerationJob, planScenes } from "../app/lib/creative-generation/planner.ts";
import { inspectProductTruthImages } from "../app/lib/creative-generation/productImages.server.ts";
import { buildProductTruth } from "../app/lib/creative-generation/productTruth.ts";
import { renderCreativeResult } from "../app/lib/creative-generation/renderer.server.ts";
import { buildGenerationSummary } from "../app/lib/creative-generation/generationSummary.ts";
import { analyzeProductReferences } from "../app/lib/creative-generation/referenceAnalyzer.server.ts";
import { planMasterScene } from "../app/lib/creative-generation/masterScenePlanner.ts";
import { createOrReuseMasterScene } from "../app/lib/creative-generation/masterSceneService.server.ts";
import { designFingerprintForMaster } from "../app/lib/creative-generation/masterDesign.ts";

const root = process.cwd();
const outDir = process.argv[2] || "/tmp/adatlas-hook-experiment-fixtures";
const fixtures = JSON.parse(await readFile(path.join(root, "tests/fixtures/creative-products.json"), "utf8"));
const library = JSON.parse(await readFile(path.join(root, "data/background-library.json"), "utf8"));

await mkdir(outDir, { recursive: true });
const selected = fixtures;
const reports = [];

for (const fixture of selected) {
  const fixtureDir = path.join(outDir, fixture.id);
  const imageDir = path.join(fixtureDir, "images");
  await mkdir(imageDir, { recursive: true });
  const rawTruth = buildProductTruth({
    product: fixture.product,
    productImagePaths: [fixture.product.productImagePath],
    source: "landing-page",
  });
  const truth = await inspectProductTruthImages(rawTruth);
  const creativePlan = buildCreativePlan(truth);
  const scenes = planScenes(creativePlan, library, false);
  const productReferenceProfile = await analyzeProductReferences(truth);
  const masterDesignForScene = {
    ...creativePlan.masterDesign,
    backgroundAssetId: scenes[0].sceneAsset.id,
  };
  masterDesignForScene.designFingerprint = designFingerprintForMaster(masterDesignForScene);
  const masterSceneSpec = planMasterScene({
    productId: truth.productId,
    profile: productReferenceProfile,
    masterDesign: masterDesignForScene,
    generationModePreference: "actual-product",
  });
  const masterScene = await createOrReuseMasterScene({
    truth,
    profile: productReferenceProfile,
    spec: masterSceneSpec,
    fallbackScene: scenes[0].sceneAsset,
  });
  const lockedScenes = scenes.map((scene) => ({
    ...scene,
    sceneAsset: { ...scene.sceneAsset, file: masterScene.file },
    masterSceneId: masterScene.id,
    generationMode: masterScene.generationMode,
    promptVersion: masterScene.generationPromptVersion,
    reason: `${scene.reason} · fixture 공통 마스터 비주얼`,
  }));
  const job = createGenerationJob({
    truth,
    creativePlan,
    scenes: lockedScenes,
    planningMs: 1,
    concurrency: 2,
    productReferenceProfile,
    masterScene,
  });
  const cards = [];
  const results = [];
  for (const result of job.results) {
    const rendered = await renderCreativeResult({ job, result });
    const localPath = path.join(root, "public", rendered.imagePath.replace(/^\//, ""));
    const imageBuffer = await readFile(localPath);
    const fixtureImagePath = path.join(imageDir, `${result.hookPlan.hookCode}.webp`);
    await writeFile(fixtureImagePath, imageBuffer);
    const card = await sharp(localPath)
      .resize(300, 300, { fit: "cover" })
      .composite([
        {
          input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect x="8" y="8" width="62" height="32" rx="16" fill="#07110f" fill-opacity=".86"/><text x="39" y="30" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="16" font-weight="700">${result.hookPlan.hookCode}</text></svg>`),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    cards.push(card);
    results.push({
      hookCode: result.hookPlan.hookCode,
      hookType: result.hookPlan.hookType,
      headline: result.hookPlan.headline,
      subCopy: result.hookPlan.body,
      qa: rendered.qa,
      imagePath: rendered.imagePath,
      fixtureImagePath,
    });
    result.status = rendered.qa.passed ? "success" : "failed";
    result.imagePath = rendered.imagePath;
    result.renderPlan = rendered.renderPlan;
    result.qa = rendered.qa;
  }
  const sheet = await sharp({
    create: {
      width: 1200,
      height: 600,
      channels: 3,
      background: "#e9eef3",
    },
  })
    .composite(
      cards.map((card, index) => ({
        input: card,
        left: (index % 4) * 300,
        top: Math.floor(index / 4) * 300,
      }))
    )
    .webp({ quality: 88 })
    .toBuffer();
  const contactSheet = path.join(fixtureDir, "contact-sheet.webp");
  await writeFile(contactSheet, sheet);
  await writeFile(path.join(fixtureDir, "generation-summary.json"), `${JSON.stringify(buildGenerationSummary(job), null, 2)}\n`, "utf8");
  await writeFile(
    path.join(fixtureDir, "qa.json"),
    `${JSON.stringify(
      {
        fixtureId: fixture.id,
        expected: 8,
        passed: results.filter((result) => result.qa.passed).length,
        designFingerprint: job.creativePlan.masterDesign.designFingerprint,
        results: results.map((result) => ({
          hookCode: result.hookCode,
          passed: result.qa.passed,
          score: result.qa.score,
          designLockVerified: result.qa.designLockVerified,
          findings: result.qa.findings,
        })),
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  reports.push({
    fixtureId: fixture.id,
    categoryProfile: creativePlan.categoryProfile.id,
    masterDesignId: creativePlan.masterDesign.id,
    categoryVariant: creativePlan.masterDesign.categoryVariant,
    designFingerprint: job.creativePlan.masterDesign.designFingerprint,
    backgroundAssetId: job.creativePlan.masterDesign.backgroundAssetId,
    masterSceneId: masterScene.id,
    generationMode: masterScene.generationMode,
    productIdentityScore: masterScene.productIdentityScore,
    contactSheet,
    passed: results.filter((result) => result.qa.passed).length,
    results,
  });
}

await writeFile(path.join(outDir, "report.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)}\n`, "utf8");
if (reports.length !== fixtures.length || reports.some((report) => report.results.length !== 8)) {
  throw new Error(`${fixtures.length}개 상품 × H01~H08 fixture가 모두 생성되지 않았습니다.`);
}
console.log(
  JSON.stringify(
    reports.map((report) => ({
      fixtureId: report.fixtureId,
      categoryProfile: report.categoryProfile,
      masterDesignId: report.masterDesignId,
      backgroundAssetId: report.backgroundAssetId,
      masterSceneId: report.masterSceneId,
      generationMode: report.generationMode,
      productIdentityScore: report.productIdentityScore,
      passed: report.passed,
      contactSheet: report.contactSheet,
    })),
    null,
    2
  )
);
