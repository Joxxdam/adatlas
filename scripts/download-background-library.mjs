import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import sharp from "sharp";

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, "data", "background-library.sources.json");
const metadataPath = path.join(projectRoot, "data", "background-library.json");
const licenseUrl = "https://www.pexels.com/license/";
const force = process.argv.includes("--force");
const verifyOnly = process.argv.includes("--verify");
const categoryArgIndex = process.argv.indexOf("--category");
const categoryFilter = categoryArgIndex >= 0 ? process.argv[categoryArgIndex + 1] : "";

function imageUrl(photoId) {
  return `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=2400`;
}

async function readJson(file, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function validateFile(file) {
  const stats = await fs.stat(file);
  const metadata = await sharp(file).metadata();
  if (metadata.format !== "webp" || metadata.width !== 1600 || metadata.height !== 1600) {
    throw new Error(`invalid output: ${metadata.format} ${metadata.width}x${metadata.height}`);
  }
  if (stats.size > 1_200_000) throw new Error(`file too large: ${stats.size} bytes`);
  return stats.size;
}

async function downloadOne(source, previous) {
  const relativeFile = `/background-library/${source.category}/${source.id}.webp`;
  const outputFile = path.join(projectRoot, "public", relativeFile.slice(1));
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  let downloadedAt = previous?.downloadedAt || new Date().toISOString();
  if (!verifyOnly && (force || !(await fs.stat(outputFile).catch(() => null)))) {
    const response = await fetch(imageUrl(source.photoId), {
      redirect: "follow",
      headers: { "User-Agent": "AdAtlas background library builder/1.0" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) throw new Error(`unexpected content-type: ${contentType}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > 24_000_000) throw new Error("source image exceeds 24MB");
    await sharp(buffer)
      .rotate()
      .resize(1600, 1600, { fit: "cover", position: "attention" })
      .webp({ quality: 82, effort: 5 })
      .toFile(outputFile);
    downloadedAt = new Date().toISOString();
  }
  const size = await validateFile(outputFile);
  return {
    ...source,
    file: relativeFile,
    orientation: "square",
    width: 1600,
    height: 1600,
    sourceType: "royalty_free",
    sourceName: "Pexels",
    downloadUrl: imageUrl(source.photoId),
    licenseUrl,
    downloadedAt,
    enabled: true,
    size,
  };
}

const sources = await readJson(sourcePath);
const selected = sources.filter((item) => !categoryFilter || item.category === categoryFilter);
if (!selected.length) throw new Error("처리할 배경 소스가 없습니다.");
const current = await readJson(metadataPath);
const previousById = new Map(current.map((item) => [item.id, item]));
const failures = [];
const results = await mapPool(selected, 3, async (source) => {
  try {
    const item = await downloadOne(source, previousById.get(source.id));
    process.stdout.write(`OK ${source.id} ${Math.round(item.size / 1024)}KB\n`);
    const metadata = { ...item };
    delete metadata.size;
    delete metadata.photoId;
    return metadata;
  } catch (error) {
    failures.push({ id: source.id, error: error.message });
    process.stderr.write(`FAIL ${source.id} ${error.message}\n`);
    return null;
  }
});

if (!verifyOnly) {
  const completedById = new Map(results.filter(Boolean).map((item) => [item.id, item]));
  const otherRoyaltyFree = current.filter(
    (item) => item.sourceType === "royalty_free" && !selected.some((source) => source.id === item.id)
  );
  const aiGenerated = current.filter((item) => item.sourceType === "ai_generated");
  const next = [...otherRoyaltyFree, ...completedById.values(), ...aiGenerated].sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  await fs.writeFile(metadataPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

if (failures.length) {
  process.stderr.write(`${failures.length}개 배경 처리 실패\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${selected.length}개 배경 ${verifyOnly ? "검증" : "다운로드·최적화"} 완료\n`);
}
