import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { buildCreativePlan, createGenerationJob, planScenes } from "../app/lib/creative-generation/planner.ts";
import { inspectProductTruthImages } from "../app/lib/creative-generation/productImages.server.ts";
import { buildProductTruth } from "../app/lib/creative-generation/productTruth.ts";
import { renderCreativeResult } from "../app/lib/creative-generation/renderer.server.ts";

const root = process.cwd();
const outDir = process.argv[2] || "/tmp/adatlas-hook-experiment-fixtures";
const fixtures = JSON.parse(
  await readFile(path.join(root, "tests/fixtures/creative-products.json"), "utf8")
);
const library = JSON.parse(
  await readFile(path.join(root, "data/background-library.json"), "utf8")
);

const generic = {
  id: "generic-no-price-review",
  product: {
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
  },
};

await mkdir(outDir, { recursive: true });
const selected = [fixtures[1], fixtures[0], fixtures[2], generic];
const reports = [];

for (const fixture of selected) {
  const rawTruth = buildProductTruth({
    product: fixture.product,
    productImagePaths: [fixture.product.productImagePath],
    source: "landing-page",
  });
  const truth = await inspectProductTruthImages(rawTruth);
  const creativePlan = buildCreativePlan(truth);
  const scenes = planScenes(creativePlan, library, false);
  const job = createGenerationJob({
    truth,
    creativePlan,
    scenes,
    planningMs: 1,
    concurrency: 2,
  });
  const cards = [];
  const results = [];
  for (const result of job.results) {
    const rendered = await renderCreativeResult({ job, result });
    const localPath = path.join(root, "public", rendered.imagePath.replace(/^\//, ""));
    const card = await sharp(localPath)
      .resize(300, 300, { fit: "cover" })
      .composite([
        {
          input: Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect x="8" y="8" width="62" height="32" rx="16" fill="#07110f" fill-opacity=".86"/><text x="39" y="30" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="16" font-weight="700">${result.hookPlan.hookCode}</text></svg>`
          ),
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
    });
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
  const contactSheet = path.join(outDir, `${fixture.id}-contact-sheet.webp`);
  await writeFile(contactSheet, sheet);
  reports.push({
    fixtureId: fixture.id,
    categoryProfile: creativePlan.categoryProfile.id,
    masterDesignId: creativePlan.masterDesign.id,
    backgroundAssetId: job.creativePlan.masterDesign.backgroundAssetId,
    contactSheet,
    passed: results.filter((result) => result.qa.passed).length,
    results,
  });
}

await writeFile(
  path.join(outDir, "report.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)}\n`,
  "utf8"
);
console.log(
  JSON.stringify(
    reports.map((report) => ({
      fixtureId: report.fixtureId,
      categoryProfile: report.categoryProfile,
      masterDesignId: report.masterDesignId,
      backgroundAssetId: report.backgroundAssetId,
      passed: report.passed,
      contactSheet: report.contactSheet,
    })),
    null,
    2
  )
);
