import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const metadataPath = path.join(root, "data/background-library.json");
const reportPath = path.join(root, "data/background-library-validation.json");
const minimumCounts = { fashion: 12, beauty: 12, health: 12, agriculture: 8, meat: 12, seafood: 6, "processed-food": 8, "food-mall": 8, living: 6, kids: 4, pet: 4, promotion: 4 };
const minimumTotal = 96;
const assetTypes = new Set(["lifestyle_photo","people_photo","product_set","pattern_texture","ingredient_scene","ai_generated","designed_asset","user_uploaded"]);
const sourceTypes = new Set(["stock_photo","ai_generated","designed_asset","user_uploaded"]);
const items = JSON.parse(await fs.readFile(metadataPath, "utf8"));
const errors = [];
const warnings = [];
const seenIds = new Set();
const seenFiles = new Set();
const seenHashes = new Map();
const seenPerceptualHashes = new Map();
let totalBytes = 0;

function hammingDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    let xor = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

for (const item of items) {
  if (seenIds.has(item.id)) errors.push(`${item.id}: 중복 id`);
  if (seenFiles.has(item.file)) errors.push(`${item.id}: 중복 file`);
  seenIds.add(item.id);
  seenFiles.add(item.file);
  if (!/^[a-z0-9-]+$/.test(item.id)) errors.push(`${item.id}: 안전하지 않은 id`);
  if (!item.file.startsWith(`/background-library/${item.category}/`)) errors.push(`${item.id}: 카테고리 폴더 불일치`);
  if (!assetTypes.has(item.assetType)) errors.push(`${item.id}: assetType 오류`);
  if (!sourceTypes.has(item.sourceType)) errors.push(`${item.id}: sourceType 오류`);
  if (!item.scene || !item.hookTypes?.length || !item.textSafeArea || !item.productPosition) errors.push(`${item.id}: 추천 메타데이터 누락`);
  if (item.includesPerson && (!item.ageGroups?.length || !item.peopleType?.length || !item.peopleCount)) errors.push(`${item.id}: 인물 메타데이터 누락`);
  if (item.sourceType === "stock_photo") {
    if (!/^https:\/\/www\.pexels\.com\/photo\//.test(item.sourcePageUrl || "")) errors.push(`${item.id}: 원본 페이지 URL 누락`);
    if (!/^https:\/\/images\.pexels\.com\//.test(item.originalImageUrl || "")) errors.push(`${item.id}: 원본 이미지 URL 누락`);
    if (!item.licenseUrl || !item.authorName) errors.push(`${item.id}: 라이선스/작가 정보 누락`);
  }
  if (item.sourceType === "ai_generated" && (!item.generationPrompt || item.reviewed !== true)) errors.push(`${item.id}: AI 생성/검수 정보 누락`);
  const file = path.join(root, "public", item.file.replace(/^\//, ""));
  try {
    const [stats, buffer] = await Promise.all([fs.stat(file), fs.readFile(file)]);
    const metadata = await sharp(buffer).metadata();
    totalBytes += stats.size;
    if (metadata.format !== "webp") errors.push(`${item.id}: WebP 아님`);
    if (metadata.width !== metadata.height) errors.push(`${item.id}: 정사각형 아님`);
    if (Math.min(metadata.width || 0, metadata.height || 0) < 1200) errors.push(`${item.id}: 최소 1200px 미달`);
    if (stats.size > 1_200_000) errors.push(`${item.id}: 1.2MB 초과`);
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (hash !== item.hash) errors.push(`${item.id}: SHA-256 불일치`);
    if (seenHashes.has(hash)) errors.push(`${item.id}: ${seenHashes.get(hash)}와 동일 파일`);
    seenHashes.set(hash, item.id);
    if (item.perceptualHash) {
      for (const [previousHash, previousId] of seenPerceptualHashes) {
        if (hammingDistance(item.perceptualHash, previousHash) <= 2) {
          errors.push(`${item.id}: ${previousId}와 거의 같은 구도`);
          break;
        }
      }
      seenPerceptualHashes.set(item.perceptualHash, item.id);
    }
    if (stats.size !== item.fileSize || metadata.width !== item.width || metadata.height !== item.height) errors.push(`${item.id}: 파일 속성과 메타데이터 불일치`);
  } catch (error) {
    errors.push(`${item.id}: 파일 열기 실패 (${error.message})`);
  }
}

const categoryCounts = Object.fromEntries(Object.keys(minimumCounts).map((category) => [category, items.filter((item) => item.category === category).length]));
for (const [category, minimum] of Object.entries(minimumCounts)) {
  if (categoryCounts[category] < minimum) errors.push(`${category}: ${categoryCounts[category]}/${minimum}개 미만`);
}
if (items.length < minimumTotal) errors.push(`전체 수량: ${items.length}/${minimumTotal}개 미만`);
const assetTypeCounts = Object.fromEntries([...assetTypes].map((type) => [type, items.filter((item) => item.assetType === type).length]));
const ageGroups = ["teens","twenties","thirties","forties","fifties","senior","kids","family","couple","friends","no_people"];
const ageCounts = Object.fromEntries(ageGroups.map((age) => [age, items.filter((item) => item.includesPerson && item.ageGroups.includes(age)).length]));
if (items.some((item) => /plain|gradient|placeholder/i.test(`${item.id} ${item.scene}`))) warnings.push("단색/그라데이션 후보가 있어 수동 검수가 필요합니다.");
const report = { valid: errors.length === 0, checkedAt: new Date().toISOString(), total: items.length, totalBytes, categoryCounts, assetTypeCounts, peopleTotal: items.filter((item) => item.includesPerson).length, ageCounts, errors, warnings };
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${report.valid ? "PASS" : "FAIL"} ${items.length}개 · ${(totalBytes / 1024 / 1024).toFixed(1)}MB · 인물 ${report.peopleTotal}개\n`);
process.stdout.write(`${JSON.stringify({ categoryCounts, assetTypeCounts, ageCounts }, null, 2)}\n`);
if (warnings.length) process.stderr.write(`WARN ${warnings.join("\n")}`);
if (errors.length) {
  process.stderr.write(`${errors.join("\n")}\n`);
  process.exitCode = 1;
}
