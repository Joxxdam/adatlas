import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import JSZip from "jszip";
import sharp from "sharp";

import { analyzeCatalogImage, detectCatalogImageSignature, perceptualHashDistance } from "../app/lib/background-library/catalogImageAnalysis.server.ts";
import { filterBackgroundCatalog, readBackgroundCollectionConfigs } from "../app/lib/background-library/catalogStore.server.ts";
import { checkComfyUi, createComfyPlan } from "../app/lib/background-library/comfyui.server.ts";
import { extractCatalogZip, importBackgroundSources } from "../app/lib/background-library/importPipeline.server.ts";
import { assertPexelsBulkAllowed, pexelsStatus } from "../app/lib/background-library/pexels.server.ts";
import { normalizeStorageKey } from "../app/lib/background-library/storage.ts";

const root = process.cwd();

function verifiedLicense(overrides = {}) {
  return {
    sourceName: "광고주 제공",
    sourcePageUrl: "https://example.com/license/source",
    creatorName: "Advertiser",
    creatorUrl: "https://example.com",
    licenseType: "Advertiser-owned",
    licenseUrl: "https://example.com/license",
    proofPath: "contracts/asset-proof-001.pdf",
    commercialUseAllowed: true,
    attributionRequired: false,
    attributionText: "",
    acquiredAt: "2026-08-07T00:00:00.000Z",
    licenseCheckedAt: "2026-08-07T00:00:00.000Z",
    licenseStatus: "verified",
    manuallyReviewed: true,
    ...overrides,
  };
}

async function sample(width = 1800, height = 1800, format = "jpeg") {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 52, g: 128, b: 92 } } }).composite([{ input: Buffer.from(`<svg width="${width}" height="${height}"><rect x="${Math.round(width * 0.55)}" y="0" width="${Math.round(width * 0.45)}" height="${height}" fill="#d8ead8"/></svg>`) }]);
  return format === "png" ? image.png().toBuffer() : image.jpeg({ quality: 92 }).toBuffer();
}

test("four configured collections total 2,000 targets without advertiser conditionals", async () => {
  const configs = await readBackgroundCollectionConfigs();
  assert.deepEqual(
    configs.map((config) => config.id),
    ["korean-beef-scenes", "fresh-bodycare-scenes", "farm-produce-scenes", "womens-fashion-scenes"]
  );
  assert.equal(
    configs.reduce((sum, config) => sum + config.targetCount, 0),
    2_000
  );
  for (const config of configs) {
    assert.equal(config.targetCount, 500);
    assert.equal(
      Object.values(config.categories).reduce((sum, count) => sum + count, 0),
      500
    );
    assert.ok(config.generationPromptParts.promptFamilies.length >= 12);
    assert.match(config.negativePrompt, /watermark/);
    assert.match(config.negativePrompt, /product package/);
  }
});

test("local storage keys and ZIP paths cannot escape the background root", async () => {
  assert.throws(() => normalizeStorageKey("../outside.txt"));
  assert.throws(() => normalizeStorageKey("/absolute/file.jpg"));
  const zip = new JSZip();
  zip.file("../escape.jpg", await sample());
  const archive = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(() => extractCatalogZip(archive), /허용되지 않은 경로/);
});

test("image signatures are checked before local heuristic analysis", async () => {
  const image = await sample();
  assert.equal(detectCatalogImageSignature(image), "jpeg");
  assert.equal(detectCatalogImageSignature(Buffer.from("<svg>not allowed</svg>")), null);
  const analysis = await analyzeCatalogImage(image);
  assert.equal(analysis.width, 1800);
  assert.match(analysis.dominantColor, /^#[a-f0-9]{6}$/i);
  assert.ok(analysis.brightness > 0 && analysis.brightness < 1);
  assert.ok(analysis.productPlacementSpace >= 0 && analysis.productPlacementSpace <= 1);
  assert.ok(analysis.squareCropScore > 0.99);
  assert.match(analysis.perceptualHash, /^[a-f0-9]+$/);
});

test("dry-run import validates, optimizes and records licensing without writing", async () => {
  const result = await importBackgroundSources({
    collectionId: "fresh-bodycare-scenes",
    categoryId: "mint-herbs",
    dryRun: true,
    sources: [{ name: "mint-owned.jpg", buffer: await sample(), license: verifiedLicense() }],
  });
  assert.equal(result.approved, 1);
  assert.equal(result.review, 0);
  assert.equal(result.items[0].licenseStatus, "verified");
  assert.equal(result.items[0].analysisStatus, "manually-reviewed");
  assert.equal(result.items[0].localWidth, 1600);
  assert.equal(result.items[0].localHeight, 1600);
  assert.equal(result.items[0].format, "webp");
  assert.ok(result.writtenBytes > 0);
});

test("low resolution and disguised files are rejected without stopping the job", async () => {
  const low = await sample(900, 900);
  const result = await importBackgroundSources({
    collectionId: "farm-produce-scenes",
    categoryId: "farm-field",
    dryRun: true,
    sources: [
      { name: "small.jpg", buffer: low, license: verifiedLicense() },
      { name: "fake.png", buffer: Buffer.from("not an image"), license: verifiedLicense() },
    ],
  });
  assert.equal(result.rejected, 2);
  assert.ok(result.items.some((item) => item.rejectionReasons.includes("low-resolution")));
  assert.ok(result.failures.some((failure) => failure.name === "fake.png"));
});

test("content hash and perceptual hash remove duplicates and prefer higher resolution", async () => {
  const exactBuffer = await sample(1800, 1800, "jpeg");
  const exact = await importBackgroundSources({
    collectionId: "korean-beef-scenes",
    categoryId: "rustic-table",
    dryRun: true,
    sources: [
      { name: "one.jpg", buffer: exactBuffer, license: verifiedLicense() },
      { name: "two.jpg", buffer: exactBuffer, license: verifiedLicense() },
    ],
  });
  assert.equal(exact.exactDuplicates, 1);
  assert.equal(exact.items.length, 1);

  const lower = await sample(1800, 1800, "jpeg");
  const higher = await sample(2200, 2200, "png");
  const similar = await importBackgroundSources({
    collectionId: "womens-fashion-scenes",
    categoryId: "minimal-studio",
    dryRun: true,
    sources: [
      { name: "lower.jpg", buffer: lower, license: verifiedLicense() },
      { name: "higher.png", buffer: higher, license: verifiedLicense() },
    ],
  });
  assert.equal(similar.similarDuplicates, 1);
  const kept = similar.items.find((item) => item.status !== "inactive");
  assert.equal(kept?.originalWidth, 2200);
  assert.ok(perceptualHashDistance(similar.items[0].perceptualHash, similar.items[1].perceptualHash) <= 5);
});

test("Pexels remains search-only and refuses unconfirmed bulk downloads", () => {
  assert.equal(pexelsStatus().mode, "search-only");
  assert.throws(() => assertPexelsBulkAllowed({ confirmedByUser: false, permissionEvidence: "" }), /거부/);
});

test("ComfyUI rejects external hosts and still produces a local dry-run plan", async () => {
  const previousUrl = process.env.COMFYUI_URL;
  const previousWorkflow = process.env.COMFYUI_WORKFLOW_PATH;
  process.env.COMFYUI_URL = "https://example.com:8188";
  delete process.env.COMFYUI_WORKFLOW_PATH;
  try {
    const status = await checkComfyUi();
    assert.equal(status.available, false);
    assert.match(status.workflowError, /localhost|127\.0\.0\.1/);
    const plan = await createComfyPlan({ collectionId: "korean-beef-scenes", categoryId: "camping-barbecue", limit: 12, dryRun: true });
    assert.equal(plan.checkpoint.items.length, 12);
    assert.equal(new Set(plan.checkpoint.items.map((item) => item.seed)).size, 12);
    assert.equal(new Set(plan.checkpoint.items.map((item) => item.positivePrompt)).size, 12);
    assert.equal(plan.canRun, false);
  } finally {
    if (previousUrl == null) delete process.env.COMFYUI_URL;
    else process.env.COMFYUI_URL = previousUrl;
    if (previousWorkflow == null) delete process.env.COMFYUI_WORKFLOW_PATH;
    else process.env.COMFYUI_WORKFLOW_PATH = previousWorkflow;
  }
});

test("catalog filters paginate-ready metadata without rendering all assets", () => {
  const base = {
    status: "approved",
    licenseStatus: "verified",
    sourceType: "local-import",
    collectionIds: ["korean-beef-scenes"],
    primaryCategory: "camping-barbecue",
    sceneType: "camping-barbecue",
    moodTags: ["warm"],
    dominantColor: "#553322",
    secondaryColors: [],
    brightness: 0.4,
    peoplePresence: "none",
    negativeSpaceDirection: "right",
    indoorOutdoor: "outdoor",
    favorite: false,
    adCompositionScore: 0.8,
    createdAt: "2026-08-07T00:00:00.000Z",
  };
  const items = Array.from({ length: 60 }, (_, index) => ({ ...base, id: `bg-test-${index}`, adCompositionScore: index / 60 }));
  const filtered = filterBackgroundCatalog(items, { collectionId: "korean-beef-scenes", category: "camping-barbecue", people: "none", sort: "recommended", page: 1, pageSize: 24 });
  assert.equal(filtered.length, 60);
  assert.ok(filtered[0].adCompositionScore > filtered[59].adCompositionScore);
});

test("new catalog providers contain no automatic paid image or Vision calls", async () => {
  const files = ["app/lib/background-library/importPipeline.server.ts", "app/lib/background-library/pexels.server.ts", "app/lib/background-library/comfyui.server.ts"];
  const source = (await Promise.all(files.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
  assert.doesNotMatch(source, /api\.openai\.com|generativelanguage\.googleapis\.com|api\.anthropic\.com|api\.stability\.ai|replicate\.com|fal\.ai/i);
});
