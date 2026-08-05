import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  inferBackgroundCategory,
  recommendBackgrounds,
} from "../app/lib/background-library/recommender.ts";
import { inspectCutoutQuality } from "../app/lib/mvp/cutoutQuality.ts";
import { resolveCurrentProductImagePaths } from "../app/lib/mvp/imageSelectionResolver.ts";

const projectRoot = process.cwd();
const library = JSON.parse(
  await readFile(path.join(projectRoot, "data", "background-library.json"), "utf8")
);
const categories = ["beauty", "fashion", "food", "agriculture", "lifestyle", "commerce"];

test("royalty-free background metadata contains six usable files per category", () => {
  const royaltyFree = library.filter((item) => item.sourceType === "royalty_free");
  assert.equal(royaltyFree.length, 36);
  categories.forEach((category) => {
    assert.equal(royaltyFree.filter((item) => item.category === category).length, 6);
  });
  assert.equal(new Set(royaltyFree.map((item) => item.id)).size, 36);
  assert.equal(new Set(royaltyFree.map((item) => item.file)).size, 36);
  royaltyFree.forEach((item) => {
    assert.match(item.sourceUrl, /^https:\/\/www\.pexels\.com\/photo\//);
    assert.match(item.downloadUrl, /^https:\/\/images\.pexels\.com\/photos\//);
    assert.equal(item.licenseUrl, "https://www.pexels.com/license/");
    assert.equal(item.enabled, true);
  });
});

test("background files are square optimized WebP images", async () => {
  await Promise.all(
    library
      .filter((item) => item.sourceType === "royalty_free")
      .map(async (item) => {
        const file = path.join(projectRoot, "public", item.file.replace(/^\//, ""));
        const [metadata, fileStats] = await Promise.all([sharp(file).metadata(), stat(file)]);
        assert.equal(metadata.format, "webp", item.id);
        assert.equal(metadata.width, 1600, item.id);
        assert.equal(metadata.height, 1600, item.id);
        assert.ok(fileStats.size > 0 && fileStats.size < 1_200_000, item.id);
      })
  );
});

test("hook base library contains eight product-free optimized backgrounds", async () => {
  const hookBases = library.filter((item) => item.sourceName === "AdAtlas Hook Base");
  assert.equal(hookBases.length, 8);
  await Promise.all(
    hookBases.map(async (item) => {
      const file = path.join(projectRoot, "public", item.file.replace(/^\//, ""));
      const [metadata, fileStats] = await Promise.all([sharp(file).metadata(), stat(file)]);
      assert.equal(metadata.format, "webp", item.id);
      assert.equal(metadata.width, 1600, item.id);
      assert.equal(metadata.height, 1600, item.id);
      assert.ok(fileStats.size > 0 && fileStats.size < 1_200_000, item.id);
      assert.ok(item.hookTypes.length >= 3, item.id);
    })
  );
});

test("recommendations prioritize category, hook and safe areas with commerce fallback", () => {
  const beautyProduct = {
    category: "뷰티/스킨케어",
    productName: "수분 진정 세럼",
    mainBenefit: "건조한 피부를 위한 산뜻한 보습",
  };
  assert.equal(inferBackgroundCategory(beautyProduct), "beauty");
  const result = recommendBackgrounds(library, {
    product: beautyProduct,
    hook: {
      hookType: "feature-usp",
      sceneDescription: "정제된 프리미엄 욕실",
      mood: ["정제된", "클린"],
      backgroundTags: ["욕실", "자연광"],
      textSafeArea: "top-left",
      productPosition: "bottom-right",
    },
    limit: 3,
  });
  assert.equal(result.recommendations.length, 3);
  assert.equal(result.recommendations[0].background.category, "beauty");
  assert.equal(result.recommendations[0].connectionLabel, "후킹 기본 배경");
  assert.ok(
    result.recommendations.every((item) => item.background.hookTypes.includes("feature-usp"))
  );

  const fallback = recommendBackgrounds(library, {
    product: { category: "분류되지 않은 신규 상품" },
    hook: {
      hookType: "curiosity",
      sceneDescription: "대담한 범용 커머스 세트",
      mood: ["현대적"],
      backgroundTags: ["여백"],
      textSafeArea: "center-left",
      productPosition: "center-right",
    },
    limit: 3,
  });
  assert.equal(fallback.category, "commerce");
  assert.equal(fallback.recommendations.length, 3);
  assert.ok(fallback.recommendations.every((item) => item.background.category === "commerce"));
});

test("meat and Korean beef products use food scenes rather than crop-farm scenes", () => {
  const meatProduct = {
    category: "식품/선물",
    productName: "한우 등심 선물세트",
    mainBenefit: "정육 등심 구성",
  };
  assert.equal(inferBackgroundCategory(meatProduct), "food");
  const result = recommendBackgrounds(library, {
    product: meatProduct,
    hook: {
      hookType: "price-benefit",
      sceneDescription: "따뜻한 다이닝 테이블",
      mood: ["먹음직스러운", "따뜻한"],
      backgroundTags: ["dining", "table", "food"],
      textSafeArea: "top-left",
      productPosition: "bottom-right",
    },
    limit: 3,
  });
  assert.equal(result.category, "food");
  assert.ok(
    result.recommendations.every((item) => item.background.hookTypes.includes("price-benefit"))
  );
});

test("detail-page images take priority and rotate with the selected hook", () => {
  const product = {
    category: "식품/선물",
    productName: "한우 등심 선물세트",
    brandName: "국대축산",
    landingUrl: "https://example.com/products/beef-set",
    productImagePath: "https://cdn.example.com/hero.jpg",
    extractedGalleryImages: [
      "https://cdn.example.com/hero.jpg",
      "https://cdn.example.com/detail-1.jpg",
      "https://cdn.example.com/detail-2.jpg",
      "https://cdn.example.com/detail-3.jpg",
    ],
  };
  const baseHook = {
    sceneDescription: "원목 테이블 위 먹음직스러운 한우",
    mood: ["먹음직스러운", "따뜻한"],
    backgroundTags: ["table", "food"],
    textSafeArea: "top-left",
    productPosition: "bottom-right",
  };
  const price = recommendBackgrounds(library, {
    product,
    hook: { ...baseHook, hookType: "price-benefit" },
    limit: 3,
  });
  const sensory = recommendBackgrounds(library, {
    product,
    hook: { ...baseHook, hookType: "sensory" },
    limit: 3,
  });

  assert.equal(price.recommendations.length, 3);
  assert.equal(price.recommendations[0].connectionLabel, "후킹 기본 배경");
  assert.equal(
    price.recommendations.filter((item) => item.background.sourceType === "site_derived").length,
    1
  );
  assert.notEqual(
    price.recommendations[0].background.file,
    sensory.recommendations[0].background.file
  );
});

test("a site-derived background is not repeated as the foreground product", () => {
  const backgroundImagePath = "https://cdn.example.com/detail-1.jpg";
  const result = resolveCurrentProductImagePaths({
    selectedAdImages: {
      selectedImagePaths: [
        "https://cdn.example.com/hero.jpg",
        backgroundImagePath,
        "https://cdn.example.com/detail-2.jpg",
      ],
      primaryImagePath: "https://cdn.example.com/hero.jpg",
      source: "detail",
      updatedAt: new Date().toISOString(),
    },
    productInfo: {
      productName: "테스트 상품",
      category: "식품",
      price: "",
      discountInfo: "",
      mainBenefit: "",
      targetCustomer: "",
      landingUrl: "https://example.com/product",
      productImagePath: "https://cdn.example.com/hero.jpg",
      backgroundImagePath: "",
    },
    backgroundImagePath,
  });

  assert.deepEqual(result.productImagePaths, [
    "https://cdn.example.com/hero.jpg",
    "https://cdn.example.com/detail-2.jpg",
  ]);
});

test("an automatically selected cutout replaces the original primary image", () => {
  const originalImagePath = "https://cdn.example.com/product-original.jpg";
  const cutoutImagePath = "/processed-products/product-cutout.png";
  const secondaryImagePath = "https://cdn.example.com/product-detail.jpg";
  const result = resolveCurrentProductImagePaths({
    selectedAdImages: {
      selectedImagePaths: [originalImagePath, secondaryImagePath],
      primaryImagePath: originalImagePath,
      secondaryImagePath,
      source: "detail",
      updatedAt: new Date().toISOString(),
    },
    productInfo: {
      productName: "테스트 상품",
      category: "생활용품",
      price: "",
      discountInfo: "",
      mainBenefit: "",
      targetCustomer: "",
      landingUrl: "https://example.com/product",
      productImagePath: originalImagePath,
      productImagePaths: [originalImagePath, secondaryImagePath],
      backgroundImagePath: "",
    },
    productImageState: {
      originalImagePath,
      cutoutImagePath,
      selectedImageMode: "cutout",
      cutoutApplied: true,
      effectPreset: "none",
    },
  });

  assert.deepEqual(result.productImagePaths, [cutoutImagePath, secondaryImagePath]);
  assert.equal(result.productImagePath, cutoutImagePath);
});

test("cutout quality rejects a nearly full-frame foreground", async () => {
  const validCutout = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="60" height="80"><rect width="60" height="80" fill="#d71920"/></svg>'
        ),
        left: 20,
        top: 10,
      },
    ])
    .png()
    .toBuffer();
  const fullFrameForeground = await sharp({
    create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="95" height="100"><rect width="95" height="100" fill="#d71920"/></svg>'
        ),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();

  assert.equal((await inspectCutoutQuality(validCutout)).usable, true);
  assert.equal((await inspectCutoutQuality(fullFrameForeground)).usable, false);
});
