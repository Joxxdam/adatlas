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
  items.push({
    id: `reference-copy-${String(ordinal).padStart(3, "0")}`,
    publicPath: `/creative-references/reference-copy/${fileName}`,
    sourceFile: path.basename(sources[index]),
    layoutFamily: layoutFamilies[index % layoutFamilies.length],
    categoryGroup: categoryGroupForSource(sources[index], ordinal),
    ordinal,
    classificationMethod: "imported",
  });
}

await fs.writeFile(manifestPath, `${JSON.stringify({
  version: "native-creative-reference-library-v5-managed",
  importedAt: new Date().toISOString(),
  sourceLabel: "이미지참고복사용.zip을 초기 데이터로 등록한 관리형 제작 레퍼런스",
  selectionPolicy: "레퍼런스 관리 화면에 현재 등록된 패션·식품·화장품 세 그룹 중 상품과 같은 풀에서 중복 없이 6장을 무작위 선택하고 작업에 고정한다. 건강·웰니스와 퍼스널케어는 화장품에 포함하며, 삭제된 항목은 즉시 선택 대상에서 제외한다. 같은 그룹이 6장보다 적을 때만 가까운 풀에서 보충하고 패션은 식품 레퍼런스로 보충하지 않는다.",
  usagePolicy: "선택한 광고의 디자인을 작업용 마스터로 재현한 뒤 URL 상품과 ProductTruth 문구로 단계별 교체하며, 최종 결과에는 원본 브랜드·상품·문구·가격·로고를 남기지 않는다.",
  items,
}, null, 2)}\n`, "utf8");

console.log(`Imported ${items.length} references into ${outputDirectory}`);
