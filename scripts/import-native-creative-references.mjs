import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const [sourceDirectory, projectRoot = process.cwd()] = process.argv.slice(2);
if (!sourceDirectory) {
  throw new Error("사용법: node scripts/import-native-creative-references.mjs <압축 해제 폴더> [프로젝트 루트]");
}

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const layoutFamilies = [
  "problem-objection",
  "price-offer",
  "situation-story",
  "usp-evidence",
  "social-proof",
  "sensory-editorial",
];
const verifiedPackagedFoodProfiles = new Map([
  [2, { productForm: "bundle", compositionType: "product-lineup", productSlotCount: 3, supportsMultipleProducts: true }],
  [9, { productForm: "pouch", compositionType: "product-lineup", productSlotCount: 3, supportsMultipleProducts: true }],
  [15, { productForm: "pouch", compositionType: "product-lineup", productSlotCount: 2, supportsMultipleProducts: true }],
  [20, { productForm: "pouch", compositionType: "product-lineup", productSlotCount: 3, supportsMultipleProducts: true }],
  [24, { productForm: "bottle", compositionType: "price-card", productSlotCount: 1, supportsMultipleProducts: false }],
  [25, { productForm: "pouch", compositionType: "product-lineup", productSlotCount: 3, supportsMultipleProducts: true }],
]);

function compatibilityFor(categoryGroup, ordinal, layoutFamily) {
  const packagedProfile = categoryGroup === "food" ? verifiedPackagedFoodProfiles.get(ordinal) : undefined;
  const packagedFood = Boolean(packagedProfile);
  const naturalFood = categoryGroup === "food" && !packagedFood;
  const compositionType = naturalFood
    ? (["sensory-editorial", "situation-story"].includes(layoutFamily) ? "natural-food-scene" : layoutFamily === "price-offer" ? "price-card" : "product-packshot")
    : layoutFamily === "price-offer" ? "price-card"
      : layoutFamily === "social-proof" ? "review-card"
        : layoutFamily === "situation-story" ? "lifestyle-scene"
          : layoutFamily === "sensory-editorial" ? "sensory-closeup"
            : "product-packshot";
  return {
    productForm: categoryGroup === "fashion" ? "fashion-item" : naturalFood ? "meat-cut" : packagedProfile?.productForm || "universal-packshot",
    compositionType: packagedProfile?.compositionType || compositionType,
    productSlotCount: packagedProfile?.productSlotCount || 1,
    productSlotShape: naturalFood ? "wide" : categoryGroup === "fashion" ? "tall" : "flexible",
    photographyType: naturalFood ? "natural-food" : compositionType === "lifestyle-scene" ? "lifestyle" : "packshot",
    textDensity: ["price-offer", "usp-evidence", "social-proof"].includes(layoutFamily) ? "dense" : "medium",
    supportsPackagedProduct: !naturalFood,
    supportsNaturalFood: naturalFood,
    supportsHumanModel: categoryGroup === "fashion",
    supportsMultipleProducts: packagedProfile?.supportsMultipleProducts || false,
    compatibilityConfidence: categoryGroup === "food" ? "high" : "medium",
  };
}

// 사용자 제공 ZIP을 육안 검수해 분류한 상품군입니다. 파일명이 숫자뿐이라
// 재가져오기 때도 같은 자연 정렬 순번을 기준으로 카테고리를 보존합니다.
function categoryGroupForSource(sourcePath, ordinal) {
  if (/패션|의류|옷|원피스|상의|하의|신발|가방|fashion|apparel|dress|shoes|bag/i.test(sourcePath)) {
    return "fashion";
  }
  if (
    [2, 4, 7, 9, 44].includes(ordinal) ||
    (ordinal >= 11 && ordinal <= 36) ||
    (ordinal >= 50 && ordinal <= 66)
  ) return "food";
  return "beauty";
}

async function collectImages(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "__MACOSX" || entry.name.startsWith("._")) continue;
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectImages(resolved));
    else if (imageExtensions.has(path.extname(entry.name).toLowerCase())) files.push(resolved);
  }
  return files;
}

function naturalCompare(left, right) {
  return left.localeCompare(right, "ko", { numeric: true, sensitivity: "base" });
}

const sources = (await collectImages(path.resolve(sourceDirectory))).sort(naturalCompare);
if (!sources.length) throw new Error("등록할 광고 레퍼런스 이미지가 없습니다.");

const outputDirectory = path.join(projectRoot, "public", "creative-references", "reference-copy");
const manifestPath = path.join(projectRoot, "data", "native-creative-reference-library.json");
await fs.mkdir(outputDirectory, { recursive: true });
await fs.mkdir(path.dirname(manifestPath), { recursive: true });

const items = [];
for (let index = 0; index < sources.length; index += 1) {
  const ordinal = index + 1;
  const fileName = `reference-${String(ordinal).padStart(3, "0")}.jpg`;
  const outputPath = path.join(outputDirectory, fileName);
  await sharp(sources[index])
    .rotate()
    .resize(1200, 1200, { fit: "contain", background: "#ffffff", withoutEnlargement: false })
    .flatten({ background: "#ffffff" })
    .toColorspace("srgb")
    .jpeg({ quality: 88, progressive: true, mozjpeg: true })
    .toFile(outputPath);
  const categoryGroup = categoryGroupForSource(sources[index], ordinal);
  const layoutFamily = layoutFamilies[index % layoutFamilies.length];
  items.push({
    id: `reference-copy-${String(ordinal).padStart(3, "0")}`,
    publicPath: `/creative-references/reference-copy/${fileName}`,
    sourceFile: path.basename(sources[index]),
    layoutFamily,
    categoryGroup,
    ...compatibilityFor(categoryGroup, ordinal, layoutFamily),
    ordinal,
    classificationMethod: "imported",
  });
}

await fs.writeFile(manifestPath, `${JSON.stringify({
  version: "native-creative-reference-library-v6-compatible",
  importedAt: new Date().toISOString(),
  sourceLabel: "이미지참고복사용.zip을 초기 데이터로 등록한 관리형 제작 레퍼런스",
  selectionPolicy: "레퍼런스 관리 화면에 현재 등록된 패션·식품·화장품 세 그룹 중 상품군·상품 형태·구도·슬롯 호환 점수를 통과한 후보에서 중복 없이 6장을 무작위 선택하고 작업에 고정한다. 건강·웰니스와 퍼스널케어는 화장품에 포함하며 삭제된 항목은 즉시 제외한다. 후보가 부족해도 타 상품군이나 비호환 항목으로 보충하지 않는다.",
  usagePolicy: "선택한 광고 원본을 01-structure로 바이트 동일 복사한 뒤 URL 상품과 ProductTruth 문구로 단계별 교체한다. 재시도·복구·문구 수정은 같은 레퍼런스를 유지하고 명시적인 6장 전체 새로 만들기에서만 다시 추첨한다.",
  items,
}, null, 2)}\n`, "utf8");

console.log(`Imported ${items.length} references into ${outputDirectory}`);
