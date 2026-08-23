import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { inferAudienceProfile, inferBackgroundCategory, recommendBackgrounds } from "../app/lib/background-library/recommender.ts";
import { generateAdaptiveCreativePlans } from "../app/lib/background-library/adaptiveCreative.ts";
import { buildAdaptiveCreativeSvg } from "../app/lib/mvp/adaptiveCreativeSvg.ts";
import { contrastRatio } from "../app/lib/mvp/colorUtils.ts";
import { applyKnownProductAssets, matchKnownProductAsset } from "../app/lib/creative/knownProductAssets.ts";

const projectRoot = process.cwd();
const library = JSON.parse(await readFile(path.join(projectRoot, "data", "background-library.json"), "utf8"));
const minimumCounts = {
  fashion: 12,
  beauty: 12,
  health: 12,
  agriculture: 8,
  meat: 12,
  seafood: 6,
  "processed-food": 8,
  "food-mall": 8,
  living: 6,
  kids: 4,
  pet: 4,
  promotion: 4,
};

const hook = (overrides = {}) => ({
  hookType: "feature-usp",
  backgroundHookType: "usp_proof",
  sceneDescription: "자연광이 있는 실제 사용 공간",
  mood: ["정돈된", "신뢰감"],
  backgroundTags: ["natural-light", "negative-space"],
  textSafeArea: "top-left",
  productPosition: "bottom-right",
  ...overrides,
});

test("library preserves the baseline categories and unique assets as it grows", () => {
  assert.ok(library.length >= 96);
  assert.equal(new Set(library.map((item) => item.id)).size, library.length);
  assert.equal(new Set(library.map((item) => item.file)).size, library.length);
  for (const [category, minimum] of Object.entries(minimumCounts)) {
    assert.ok(library.filter((item) => item.category === category).length >= minimum, `${category} requires at least ${minimum} backgrounds`);
  }
});

test("Original Source has twenty registered backgrounds and one cutout per 250ml product", async () => {
  const catalog = JSON.parse(await readFile(path.join(projectRoot, "data", "original-source-product-assets.json"), "utf8"));
  assert.equal(catalog.products.length, 5);
  for (const product of catalog.products) {
    assert.equal(product.backgrounds.length, 20, product.id);
    assert.equal(new Set(product.backgrounds.map((item) => item.id)).size, 20, product.id);
    await stat(path.join(projectRoot, "public", product.cutout.replace(/^\//, "")));
    for (const background of product.backgrounds) {
      assert.ok(
        library.some((item) => item.id === background.id),
        background.id
      );
    }
  }
});

test("Original Source product handoff mapping and recommendations use matching assets", async () => {
  const catalog = JSON.parse(await readFile(path.join(projectRoot, "data", "original-source-product-assets.json"), "utf8"));
  for (const product of catalog.products) {
    const rawProduct = {
      productName: product.name,
      category: "뷰티",
      price: "",
      discountInfo: "",
      mainBenefit: product.name,
      targetCustomer: "",
      landingUrl: product.url,
      productImagePath: "https://example.com/store-product.jpg",
      productImagePaths: ["https://example.com/store-product.jpg"],
      backgroundImagePath: "",
      brandName: "오리지널소스",
      advertiserName: "오리지널소스",
    };
    assert.equal(matchKnownProductAsset(rawProduct)?.cutoutPath, product.cutout, product.id);
    const enriched = applyKnownProductAssets(rawProduct);
    assert.equal(enriched.productImagePath, product.cutout, product.id);
    assert.equal(enriched.productImagePaths[0], product.cutout, product.id);
    assert.equal(enriched.sourceImageCandidates[0].imagePath, product.cutout, product.id);
    const recommendation = recommendBackgrounds(library, {
      product: {
        productName: product.name,
        category: "뷰티",
        landingUrl: product.url,
        brandName: "오리지널소스",
        advertiserName: "오리지널소스",
      },
      hook: hook({
        hookType: "sensory",
        backgroundHookType: "sensory",
        sceneDescription: "원료와 사용감을 보여주는 샤워 장면",
      }),
      limit: 8,
    });
    assert.ok(
      recommendation.recommendations.slice(0, 3).some((item) => item.background.id.startsWith(`original-source-${product.id}-`)),
      `${product.id} should surface a dedicated scene in the first three recommendations`
    );
    assert.ok(recommendation.recommendations.filter((item) => item.background.id.startsWith(`original-source-${product.id}-`)).length >= 5, product.id);
  }
});

test("all registered backgrounds are valid square WebP files with complete metadata", async () => {
  await Promise.all(
    library.map(async (item) => {
      const file = path.join(projectRoot, "public", item.file.replace(/^\//, ""));
      const [metadata, fileStats] = await Promise.all([sharp(file).metadata(), stat(file)]);
      assert.equal(metadata.format, "webp", item.id);
      assert.ok(metadata.width >= 1200, item.id);
      assert.equal(metadata.width, metadata.height, item.id);
      assert.ok(fileStats.size > 0 && fileStats.size <= 1_200_000, item.id);
      assert.equal(item.width, metadata.width, item.id);
      assert.equal(item.height, metadata.height, item.id);
      assert.equal(item.fileSize, fileStats.size, item.id);
      assert.match(item.hash, /^[a-f0-9]{64}$/, item.id);
      assert.ok(item.subcategories.length, item.id);
      assert.ok(item.industries.length, item.id);
      assert.ok(item.hookTypes.length, item.id);
      assert.ok(item.ageGroups.length, item.id);
      assert.ok(item.peopleType.length, item.id);
      assert.ok(item.scene, item.id);
      assert.ok(item.mood.length, item.id);
      assert.ok(item.elements.length, item.id);
      assert.ok(item.colors.length, item.id);
      assert.ok(item.textSafeArea, item.id);
      assert.ok(item.productPosition, item.id);
      if (item.sourceType === "stock_photo") {
        assert.match(item.sourcePageUrl, /^https:\/\/www\.pexels\.com\/photo\//, item.id);
        assert.match(item.originalImageUrl, /^https:\/\/images\.pexels\.com\/photos\//, item.id);
        assert.equal(item.licenseUrl, "https://www.pexels.com/license/", item.id);
        assert.ok(item.authorName, item.id);
      }
      if (item.sourceType === "ai_generated") {
        assert.ok(item.generationModel, item.id);
        assert.ok(item.generationPrompt, item.id);
        assert.equal(item.reviewed, true, item.id);
      }
    })
  );
});

test("person, non-person and content asset variants coexist", () => {
  assert.ok(library.filter((item) => item.includesPerson).length >= 40);
  assert.ok(library.filter((item) => !item.includesPerson).length >= 56);
  assert.ok(library.some((item) => item.assetType === "people_photo"));
  assert.ok(library.some((item) => item.assetType === "lifestyle_photo"));
  assert.ok(library.some((item) => item.assetType === "product_set"));
  assert.ok(library.some((item) => item.assetType === "pattern_texture"));
  assert.ok(library.some((item) => item.assetType === "ingredient_scene"));
  assert.ok(library.some((item) => item.assetType === "ai_generated"));
});

test("product category and explicit target ages are normalized", () => {
  assert.equal(inferBackgroundCategory({ productName: "한우 등심 선물세트" }), "meat");
  assert.equal(inferBackgroundCategory({ productName: "민트 티트리 샤워젤" }), "beauty");
  assert.equal(inferBackgroundCategory({ productName: "산지직송 제철 과일" }), "agriculture");
  const profile = inferAudienceProfile({
    category: "건강기능식품",
    productName: "활력 건강 제품",
    targetCustomer: "40대와 50대 부모님",
  });
  assert.equal(profile.category, "health");
  assert.deepEqual(profile.ageGroups, ["forties", "fifties", "family"]);
  assert.equal(profile.confidence, "explicit");
});

test("hook and target age change background ranking and attach an automatic layout", () => {
  const product = {
    category: "건강기능식품",
    productName: "아침 활력 건강 제품",
    targetCustomer: "40대 직장인과 부모님",
  };
  const problem = recommendBackgrounds(library, {
    product,
    hook: hook({
      hookType: "problem-solution",
      backgroundHookType: "problem_solution",
      targetAgeGroups: ["forties"],
      preferredAssetTypes: ["people_photo", "lifestyle_photo"],
    }),
    limit: 3,
  });
  const premium = recommendBackgrounds(library, {
    product,
    hook: hook({
      backgroundHookType: "premium",
      preferredAssetTypes: ["product_set", "ingredient_scene"],
    }),
    limit: 3,
  });
  assert.equal(problem.recommendations.length, 3);
  assert.equal(problem.recommendations[0].background.category, "health");
  assert.ok(problem.recommendations.some((item) => item.background.includesPerson));
  assert.ok(problem.recommendations.every((item) => item.automaticLayout));
  assert.notEqual(problem.recommendations[0].background.id, premium.recommendations[0].background.id);
});

test("six recommendations preserve fit while diversifying scene, people, color and asset type", () => {
  const result = recommendBackgrounds(library, {
    product: {
      category: "뷰티",
      productName: "민트 티트리 샤워젤",
      targetCustomer: "20대와 30대",
      targetAgeGroups: ["twenties", "thirties"],
      productColors: ["mint", "white"],
      ingredients: ["mint", "tea-tree"],
      price: "19,000원",
    },
    hook: hook({
      hookType: "sensory",
      backgroundHookType: "sensory",
      sceneDescription: "민트 원료와 물, 얼음이 있는 청량한 사용 장면",
      mood: ["청량함", "깨끗함"],
      backgroundTags: ["mint", "water", "ice", "bathroom"],
      preferredColors: ["mint", "white"],
      preferredAssetTypes: ["ingredient_scene", "product_set", "ai_generated", "lifestyle_photo", "people_photo"],
    }),
    limit: 6,
  });
  const backgrounds = result.recommendations.map((item) => item.background);
  assert.equal(backgrounds.length, 6);
  assert.equal(new Set(backgrounds.map((item) => item.id)).size, 6);
  assert.ok(new Set(backgrounds.map((item) => item.assetType)).size >= 3);
  assert.ok(new Set(backgrounds.map((item) => item.textSafeArea)).size >= 2);
  assert.ok(backgrounds.some((item) => item.includesPerson));
  assert.ok(backgrounds.some((item) => !item.includesPerson));
  assert.ok(result.recommendations.every((item) => item.matchScore > 0));
  assert.ok(result.recommendations.some((item) => item.diversityScore < 0));
  assert.ok(backgrounds.slice(0, 3).some((item) => item.colors.some((color) => /mint|ice/i.test(color))));
});

test("adaptive layouts produce three different visual hierarchies with readable colors", () => {
  const background = library.find((item) => item.id === "beauty-09");
  assert.ok(background);
  const plans = generateAdaptiveCreativePlans({
    background,
    hookType: "sensory",
    product: {
      productName: "민트 티트리 샤워젤",
      landingUrl: "https://example.com/product",
      price: "19,000원",
    },
    copy: {
      headline: "샤워 한 번에 상쾌함을",
      bodyCopy: "민트와 티트리의 청량한 사용감",
      cta: "지금 확인",
    },
    palette: {
      primaryColor: "#426c67",
      secondaryColor: "#183331",
      accentColor: "#18c9a2",
      backgroundColor: "#dcebe8",
      surfaceColor: "#f4fbf9",
      textDarkColor: "#151515",
      textLightColor: "#ffffff",
      mutedColor: "#758b87",
      highlightColor: "#8ff5d9",
      dangerColor: "#d83c54",
    },
    productAspectRatio: 0.55,
    now: "2026-08-07T00:00:00.000Z",
  });
  assert.equal(plans.length, 3);
  assert.equal(new Set(plans.map((plan) => plan.layoutVariant)).size, 3);
  assert.equal(new Set(plans.map((plan) => plan.layoutType)).size, 3);
  assert.deepEqual(
    plans.map((plan) => plan.productComposition.mode),
    ["repeat-overlap", "single", "scale-contrast"]
  );
  assert.deepEqual(
    plans.map((plan) => plan.productComposition.count),
    [3, 1, 2]
  );
  assert.ok(plans.every((plan) => plan.productPlacement.groundY <= 1120));
  assert.ok(plans.every((plan) => plan.textPlacement.maxLines === 2));
  assert.ok(plans.every((plan) => plan.bodyPlacement.maxLines === 3));
  assert.ok(plans.every((plan) => contrastRatio(plan.colorPalette.headline, background.brightness === "dark" ? "#183331" : "#dcebe8") >= 4.5));
  assert.ok(plans.every((plan) => contrastRatio(plan.colorPalette.accent, background.brightness === "dark" ? "#181818" : "#dcebe8") >= 3.2));
});

test("adaptive template keeps product, brand logo and AI disclosure overlays", () => {
  const background = library.find((item) => item.id === "beauty-09");
  assert.ok(background);
  const [plan] = generateAdaptiveCreativePlans({
    background,
    hookType: "sensory",
    product: { productName: "민트 티트리 샤워젤", price: "19,000원" },
    copy: { headline: "샤워 한 번에 상쾌함을", cta: "지금 확인" },
    palette: {
      primaryColor: "#426c67",
      secondaryColor: "#183331",
      accentColor: "#18c9a2",
      backgroundColor: "#dcebe8",
      surfaceColor: "#f4fbf9",
      textDarkColor: "#151515",
      textLightColor: "#ffffff",
      mutedColor: "#758b87",
      highlightColor: "#8ff5d9",
      dangerColor: "#d83c54",
    },
    productAspectRatio: 0.55,
    now: "2026-08-07T00:00:00.000Z",
  });
  const svg = buildAdaptiveCreativeSvg({
    plan,
    copy: {
      headline: "샤워 한 번에 상쾌함을",
      bodyCopy: "민트와 티트리의 청량한 사용감",
      highlightCopy: "상쾌한 민트 쿨링",
      bottomBarCopy: "오늘의 샤워를 더 산뜻하게",
      cta: "지금 확인",
      price: "19,000원",
    },
    backgroundDataUrl: "data:image/png;base64,BACKGROUND",
    productDataUrl: "data:image/png;base64,PRODUCT",
    logoDataUrl: "data:image/png;base64,LOGO",
    aiDisclosureText: "AI 활용 콘텐츠입니다.",
  });
  assert.match(svg, /data:image\/png;base64,PRODUCT/);
  assert.equal((svg.match(/data:image\/png;base64,PRODUCT/g) || []).length, 3);
  assert.match(svg, /data:image\/png;base64,LOGO/);
  assert.match(svg, /AI 활용 콘텐츠입니다\./);
});

test("opaque product photos keep adaptive layouts in single-product mode", () => {
  const background = library.find((item) => item.id === "beauty-09");
  assert.ok(background);
  const plans = generateAdaptiveCreativePlans({
    background,
    hookType: "sensory",
    product: { productName: "민트 티트리 샤워젤" },
    palette: {
      primaryColor: "#426c67",
      secondaryColor: "#183331",
      accentColor: "#18c9a2",
      backgroundColor: "#dcebe8",
      surfaceColor: "#f4fbf9",
      textDarkColor: "#151515",
      textLightColor: "#ffffff",
      mutedColor: "#758b87",
      highlightColor: "#8ff5d9",
      dangerColor: "#d83c54",
    },
    productHasTransparency: false,
  });
  assert.ok(plans.every((plan) => plan.productComposition.mode === "single"));
  assert.ok(plans.every((plan) => plan.productComposition.count === 1));
});

test("dark backgrounds force readable copy and keep all adaptive boxes inside the canvas", () => {
  const background = library.find((item) => item.id === "beauty-07");
  assert.ok(background);
  const plans = generateAdaptiveCreativePlans({
    background,
    hookType: "problem_solution",
    product: {
      productName: "민트 티트리 샤워젤",
      landingUrl: "https://example.com/mint",
      price: "12,000원",
    },
    copy: {
      headline: "운동 후 땀냄새, 민트 샤워로 싹",
      bodyCopy: "확인된 상품 정보 안에서 상쾌한 사용 이유를 설명합니다",
      cta: "상품 보러가기",
    },
    palette: {
      primaryColor: "#155f53",
      secondaryColor: "#d8eee9",
      accentColor: "#24b596",
      backgroundColor: "#202624",
      surfaceColor: "#2f3835",
      textDarkColor: "#111111",
      textLightColor: "#111111",
      mutedColor: "#768480",
      highlightColor: "#ffd6e6",
      dangerColor: "#d83c54",
    },
    productAspectRatio: 0.56,
    now: "2026-08-07T00:00:00.000Z",
  });
  for (const plan of plans) {
    assert.ok(contrastRatio(plan.colorPalette.headline, "#181818") >= 4.5);
    assert.ok(contrastRatio(plan.colorPalette.body, "#181818") >= 4.5);
    assert.ok(contrastRatio(plan.colorPalette.price, "#181818") >= 4.5);
    assert.ok(contrastRatio(plan.colorPalette.ctaText, plan.colorPalette.ctaBackground) >= 4.5);
    for (const box of [plan.productPlacement, plan.textPlacement, plan.bodyPlacement, plan.pricePlacement, plan.ctaPlacement]) {
      assert.ok(box.x >= 0 && box.y >= 0, `${plan.layoutType} starts outside the canvas`);
      assert.ok(box.x + box.width <= 1200, `${plan.layoutType} exceeds canvas width`);
      assert.ok(box.y + box.height <= 1200, `${plan.layoutType} exceeds canvas height`);
    }
  }
});

test("changing the selected background recalculates layout, placement and colors", () => {
  const dark = library.find((item) => item.id === "beauty-07");
  const bright = library.find((item) => item.id === "beauty-08");
  assert.ok(dark && bright);
  const common = {
    hookType: "sensory",
    product: { productName: "민트 티트리 샤워젤", price: "12,000원" },
    copy: { headline: "민트 쿨링 샤워", bodyCopy: "상쾌한 사용감", cta: "구매하기" },
    palette: {
      primaryColor: "#247461",
      secondaryColor: "#92cbbb",
      accentColor: "#2ec9a3",
      backgroundColor: "#e9f7f3",
      surfaceColor: "#f7fbfa",
      textDarkColor: "#161616",
      textLightColor: "#ffffff",
      mutedColor: "#78928b",
      highlightColor: "#ffe3eb",
      dangerColor: "#d93a5f",
    },
    productAspectRatio: 0.56,
    now: "2026-08-07T00:00:00.000Z",
  };
  const darkPlans = generateAdaptiveCreativePlans({ ...common, background: dark });
  const brightPlans = generateAdaptiveCreativePlans({ ...common, background: bright });
  assert.notDeepEqual(
    darkPlans.map((plan) => plan.layoutType),
    brightPlans.map((plan) => plan.layoutType)
  );
  assert.notDeepEqual(darkPlans[0].textPlacement, brightPlans[0].textPlacement);
  assert.notEqual(darkPlans[0].colorPalette.headline, brightPlans[0].colorPalette.headline);
  assert.notEqual(darkPlans[0].contrastAdjustments.gradientDirection, brightPlans[0].contrastAdjustments.gradientDirection);
});

test("price and CTA regions are hidden when those facts are unavailable", () => {
  const background = library.find((item) => item.id === "beauty-08");
  assert.ok(background);
  const plans = generateAdaptiveCreativePlans({
    background,
    hookType: "usp_proof",
    product: { productName: "민트 티트리 샤워젤" },
    copy: { headline: "민트 티트리의 상쾌함" },
    palette: {
      primaryColor: "#27765f",
      secondaryColor: "#83c7b3",
      accentColor: "#22bc91",
      backgroundColor: "#eaf7f3",
      surfaceColor: "#f7fbfa",
      textDarkColor: "#171717",
      textLightColor: "#ffffff",
      mutedColor: "#779189",
      highlightColor: "#c8f6e8",
      dangerColor: "#d83c54",
    },
  });
  assert.ok(plans.every((plan) => !plan.pricePlacement.visible));
  assert.ok(plans.every((plan) => !plan.ctaPlacement.visible));
});

test("another-background flow excludes recent files without duplicates", () => {
  const input = {
    product: { category: "패션", productName: "여성 데일리 재킷" },
    hook: hook({
      hookType: "lifestyle",
      backgroundHookType: "styling",
      sceneDescription: "유럽 거리와 자연광 카페",
      preferredAssetTypes: ["lifestyle_photo", "people_photo"],
    }),
    limit: 3,
  };
  const first = recommendBackgrounds(library, input);
  const second = recommendBackgrounds(library, {
    ...input,
    excludeIds: first.recommendations.map((item) => item.background.id),
  });
  assert.equal(first.recommendations.length, 3);
  assert.equal(second.recommendations.length, 3);
  assert.equal(new Set(first.recommendations.map((item) => item.background.file)).size, 3);
  assert.ok(second.recommendations.every((item) => item.background.category === "fashion"));
  assert.ok(second.recommendations.every((item) => !first.recommendations.some((previous) => previous.background.id === item.background.id)));
});

test("unknown products fall back to promotion assets", () => {
  const result = recommendBackgrounds(library, {
    product: { category: "분류되지 않은 상품", productName: "새로운 상품" },
    hook: hook({ hookType: "curiosity", backgroundHookType: "urgency" }),
    limit: 3,
  });
  assert.equal(result.category, "promotion");
  assert.equal(result.recommendations.length, 3);
  assert.equal(result.recommendations[0].background.category, "promotion");
});
