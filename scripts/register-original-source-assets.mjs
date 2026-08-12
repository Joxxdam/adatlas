import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const libraryPath = path.join(root, "data", "background-library.json");
const catalogPath = path.join(root, "data", "original-source-product-assets.json");
const generatedAt = "2026-08-13T00:00:00.000Z";

const products = [
  {
    id: "mint-tea-tree",
    name: "오리지널소스 민트 티트리 쿨링 샤워젤 · 바디워시 250ml",
    productId: "65",
    url: "https://originalsource.co.kr/product/오리지널소스-민트-티트리-쿨링-샤워젤-·-바디워시-250ml/65/category/91/display/1/",
    cutout: "/product-cutouts/original-source/mint-tea-tree-250ml.png",
    cutoutReferenceFiles: ["민트젤 01 (1).jpg"],
    keywords: ["민트", "민트티트리", "mintteatree", "7927"],
    colors: ["teal", "navy", "cyan", "green"],
  },
  {
    id: "lemon-tea-tree",
    name: "오리지널소스 레몬 티트리 상쾌 샤워젤 · 바디워시 250ml",
    productId: "77",
    url: "https://originalsource.co.kr/product/오리지널소스-레몬-티트리-상쾌-샤워젤-·-바디워시-250ml/77/category/91/display/1/",
    cutout: "/product-cutouts/original-source/lemon-tea-tree-250ml.png",
    cutoutReferenceFiles: ["755128586_880033851848590_6295451492637865095_n.jpg"],
    keywords: ["레몬", "레몬티트리", "lemonteatree", "시칠리아"],
    colors: ["yellow", "orange", "blue", "white"],
  },
  {
    id: "coconut-shea-butter",
    name: "오리지널소스 코코넛 시어버터 보습 샤워젤 · 바디워시 250ml",
    productId: "80",
    url: "https://originalsource.co.kr/product/오리지널소스-코코넛-시어버터-보습-샤워젤-·-바디워시-250ml/80/category/91/display/1/",
    cutout: "/product-cutouts/original-source/coconut-shea-butter-250ml.png",
    cutoutReferenceFiles: ["02.jpg"],
    keywords: ["코코넛", "코코넛시어버터", "coconutsheabutter", "보습", "7872"],
    colors: ["ivory", "cream", "brown", "sand"],
  },
  {
    id: "lime",
    name: "오리지널소스 라임 생기 샤워젤 · 바디워시 250ml",
    productId: "82",
    url: "https://originalsource.co.kr/product/오리지널소스-라임-생기-샤워젤-·-바디워시-250ml/82/category/91/display/1/",
    cutout: "/product-cutouts/original-source/lime-250ml.png",
    cutoutReferenceFiles: ["03.jpg"],
    keywords: ["라임", "zingylime", "생기"],
    colors: ["lime", "green", "black", "white"],
  },
  {
    id: "rhubarb-raspberry",
    name: "오리지널소스 루바브 라즈베리 진정 샤워젤 · 바디워시 250ml",
    productId: "84",
    url: "https://originalsource.co.kr/product/오리지널소스-루바브-라즈베리-진정-샤워젤-·-바디워시-250ml/84/category/91/display/1/",
    cutout: "/product-cutouts/original-source/rhubarb-raspberry-250ml.png",
    cutoutReferenceFiles: ["03.jpg"],
    keywords: ["루바브", "루바브라즈베리", "rhubarbraspberry", "진정", "4essentialoils"],
    colors: ["coral", "pink", "raspberry", "burgundy"],
  },
];

const scenes = [
  "ingredient premium stage",
  "shower room",
  "ingredient splash",
  "editorial studio",
  "problem situation person",
  "lifestyle person",
  "ingredient flatlay",
  "outdoor origin scene",
  "premium dark stage",
  "clean bathroom",
  "review ugc cards",
  "problem solution abstract",
  "daily routine space",
  "seasonal lifestyle",
  "sensory macro",
  "ritual spa",
  "target audience person",
  "ingredient editorial",
  "promotion stage",
  "sensory atmosphere",
];

const hookTypes = [
  ["usp_proof", "premium"],
  ["situation", "freshness"],
  ["sensory", "freshness"],
  ["premium", "usp_proof"],
  ["problem_solution", "situation"],
  ["situation", "review_ugc"],
  ["usp_proof", "sensory"],
  ["origin_story", "freshness"],
  ["premium", "sensory"],
  ["convenience", "freshness"],
  ["review_ugc", "social-proof"].filter((value) => value !== "social-proof"),
  ["problem_solution", "sensory"],
  ["situation", "convenience"],
  ["situation", "origin_story"],
  ["sensory", "usp_proof"],
  ["premium", "situation"],
  ["situation", "review_ugc"],
  ["usp_proof", "origin_story"],
  ["price_offer", "urgency"],
  ["sensory", "freshness"],
];

function placement(index) {
  const productPosition = index % 3 === 0 ? "center" : index % 2 === 0 ? "center-left" : "center-right";
  const textSafeArea = productPosition === "center-right" ? "top-left" : productPosition === "center-left" ? "top-right" : "top-left";
  return { productPosition, textSafeArea };
}

const current = JSON.parse(await fs.readFile(libraryPath, "utf8"));
const next = current.filter((item) => !String(item.id || "").startsWith("original-source-"));
const productCatalog = [];

for (const product of products) {
  const backgrounds = [];
  for (let index = 1; index <= 20; index += 1) {
    const number = String(index).padStart(2, "0");
    const id = `original-source-${product.id}-${number}`;
    const file = `/background-library/beauty/original-source/${product.id}/${number}.webp`;
    const absolute = path.join(root, "public", file.replace(/^\//, ""));
    const buffer = await fs.readFile(absolute);
    const metadata = await sharp(buffer).metadata();
    const people = [5, 6, 17].includes(index);
    const ugc = index === 11;
    const { productPosition, textSafeArea } = placement(index);
    const generationPrompt = `Product-specific text-free ad background for ${product.name}; ${scenes[index - 1]}; no product, package, logo, text, letters, numbers, signage, or watermark; clear copy and product safe zones.`;
    next.push({
      id,
      file,
      enabled: true,
      category: "beauty",
      subcategories: ["shower-gel", "body-wash", product.id],
      industries: ["beauty", "personal-care", "body-care"],
      assetType: people ? "people_photo" : ugc ? "designed_asset" : [3, 7, 15, 18].includes(index) ? "ingredient_scene" : [1, 4, 9, 19].includes(index) ? "product_set" : "ai_generated",
      hookTypes: hookTypes[index - 1],
      ageGroups: people ? ["twenties", "thirties", "forties"] : ["no_people"],
      peopleType: people ? [index === 5 ? "office_worker" : index === 6 ? "athlete" : "woman"] : ["no_people"],
      peopleCount: people ? 1 : 0,
      includesPerson: people,
      personPosition: people ? "left" : "none",
      personGaze: people ? "right" : "none",
      personEmotion: people ? "상품 후킹에 맞는 상황 감정" : "",
      personAction: people ? scenes[index - 1] : "",
      scene: `${product.name} 전용 ${scenes[index - 1]}`,
      mood: ["광고용", "검수 완료", ...product.colors.slice(0, 2)],
      elements: [product.id, ...product.keywords.slice(0, 4)],
      colors: product.colors,
      productPosition,
      textSafeArea,
      focalArea: productPosition,
      brightness: [9, 12, 20].includes(index) ? "dark" : [1, 2, 4, 10, 13].includes(index) ? "bright" : "medium",
      contrast: [8, 9, 12, 19, 20].includes(index) ? "high" : "medium",
      orientation: "square",
      recommendedLayouts: productPosition === "center" ? ["centered-product-promotion", "premium-minimal"] : productPosition === "center-right" ? ["text-left-product-right", "product-grounded"] : ["text-right-product-left", "ingredient-story"],
      advertiserAliases: ["오리지널소스", "오리지널 소스", "Original Source", "originalsource.co.kr"],
      productKeywords: product.keywords,
      sourceType: "ai_generated",
      sourceName: "OpenAI image generation",
      sourcePageUrl: product.url,
      originalImageUrl: "",
      licenseUrl: "",
      authorName: "AdAtlas",
      generationModel: "imagegen",
      generationPrompt,
      generatedAt,
      reviewed: true,
      width: metadata.width,
      height: metadata.height,
      fileSize: buffer.length,
      hash: createHash("sha256").update(buffer).digest("hex"),
    });
    backgrounds.push({ id, file, scene: scenes[index - 1] });
  }
  productCatalog.push({
    ...product,
    cutoutSource: "user-supplied-reference-content",
    backgrounds,
  });
}

await fs.writeFile(libraryPath, `${JSON.stringify(next, null, 2)}\n`);
await fs.writeFile(
  catalogPath,
  `${JSON.stringify({ version: 1, generatedAt, sourceStoreUrl: "https://originalsource.co.kr/category/%EC%87%BC%ED%95%91/91/", products: productCatalog }, null, 2)}\n`
);
process.stdout.write(`registered ${productCatalog.length} products / ${productCatalog.reduce((sum, item) => sum + item.backgrounds.length, 0)} backgrounds\n`);
