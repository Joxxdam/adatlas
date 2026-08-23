import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

import sharp from "sharp";

const projectRoot = process.cwd();
const manifestPath = path.join(projectRoot, "data", "background-library-manifest.json");
const metadataPath = path.join(projectRoot, "data", "background-library.json");
const publicRoot = path.join(projectRoot, "public");
const force = process.argv.includes("--force");
const verifyOnly = process.argv.includes("--verify");
const categoryArgIndex = process.argv.indexOf("--category");
const categoryFilter = categoryArgIndex >= 0 ? process.argv[categoryArgIndex + 1] : "";
const idArgIndex = process.argv.indexOf("--id");
const idFilter = idArgIndex >= 0 ? process.argv[idArgIndex + 1] : "";

async function readJson(file, fallback = []) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function publicFile(file) {
  const normalized = `/${String(file || "").replace(/^\/+/, "")}`;
  const resolved = path.resolve(publicRoot, `.${normalized}`);
  if (!resolved.startsWith(`${publicRoot}${path.sep}`)) throw new Error("unsafe public path");
  return resolved;
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

function hammingDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const difference = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    distance += difference.toString(2).replace(/0/g, "").length;
  }
  return distance;
}

async function perceptualHash(buffer) {
  const { data } = await sharp(buffer).resize(9, 8, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits += data[row * 9 + column] > data[row * 9 + column + 1] ? "1" : "0";
    }
  }
  return bits
    .match(/.{4}/g)
    .map((chunk) => Number.parseInt(chunk, 2).toString(16))
    .join("");
}

async function inspectFile(file) {
  const [stats, buffer] = await Promise.all([fs.stat(file), fs.readFile(file)]);
  const metadata = await sharp(buffer).metadata();
  if (metadata.format !== "webp") throw new Error(`WebP 아님: ${metadata.format || "unknown"}`);
  if (metadata.width !== metadata.height) throw new Error(`정사각형 아님: ${metadata.width}x${metadata.height}`);
  if (Math.min(metadata.width || 0, metadata.height || 0) < 1200) throw new Error(`최소 해상도 미달: ${metadata.width}x${metadata.height}`);
  if (stats.size <= 0) throw new Error("0바이트 파일");
  if (stats.size > 1_200_000) throw new Error(`파일 용량 초과: ${stats.size} bytes`);
  return {
    buffer,
    width: metadata.width,
    height: metadata.height,
    fileSize: stats.size,
    hash: createHash("sha256").update(buffer).digest("hex"),
    perceptualHash: await perceptualHash(buffer),
  };
}

async function fetchSource(item) {
  if (item.localSourceFile) return fs.readFile(publicFile(item.localSourceFile));
  if (!/^https:\/\/images\.pexels\.com\//i.test(item.originalImageUrl || "")) {
    throw new Error("허용된 Pexels 원본 URL이 아닙니다.");
  }
  const response = await fetch(item.originalImageUrl, {
    redirect: "follow",
    headers: { "User-Agent": "AdAtlas background library builder/2.0" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error(`잘못된 Content-Type: ${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 28_000_000) throw new Error(`원본 용량 오류: ${buffer.length}`);
  return buffer;
}

async function optimize(buffer, outputFile) {
  const sourceMetadata = await sharp(buffer).metadata();
  const minSide = Math.min(sourceMetadata.width || 0, sourceMetadata.height || 0);
  if (minSide < 1200) throw new Error(`원본 최소 해상도 미달: ${sourceMetadata.width}x${sourceMetadata.height}`);
  const size = minSide >= 1600 ? 1600 : 1200;
  let output;
  for (const quality of [84, 81, 78, 74]) {
    output = await sharp(buffer).rotate().resize(size, size, { fit: "cover", position: "attention", withoutEnlargement: true }).webp({ quality, effort: 5, smartSubsample: true }).toBuffer();
    if (output.length <= 1_000_000) break;
  }
  if (!output || output.length > 1_200_000) throw new Error(`WebP 최적화 후 용량 초과: ${output?.length || 0}`);
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const temporary = `${outputFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, output);
  await fs.rename(temporary, outputFile);
}

function cleanMetadata(item, inspection, previous) {
  const metadata = { ...item };
  delete metadata.localSourceFile;
  delete metadata.photoId;
  metadata.width = inspection.width;
  metadata.height = inspection.height;
  metadata.fileSize = inspection.fileSize;
  metadata.hash = inspection.hash;
  metadata.perceptualHash = inspection.perceptualHash;
  if (metadata.sourceType === "stock_photo") {
    metadata.downloadedAt = force || !previous?.downloadedAt ? new Date().toISOString() : previous.downloadedAt;
  }
  return metadata;
}

async function buildOne(item, previous) {
  const outputFile = publicFile(item.file);
  const existing = await fs.stat(outputFile).catch(() => null);
  if (!verifyOnly && (force || !existing)) {
    const buffer = await fetchSource(item);
    await optimize(buffer, outputFile);
  }
  const inspection = await inspectFile(outputFile);
  return cleanMetadata(item, inspection, previous);
}

const manifest = await readJson(manifestPath);
const current = await readJson(metadataPath);
const source = verifyOnly ? current : manifest;
const selected = source.filter((item) => (!categoryFilter || item.category === categoryFilter) && (!idFilter || item.id === idFilter));
if (!selected.length) throw new Error("처리할 배경 소스가 없습니다.");
const previousById = new Map(current.map((item) => [item.id, item]));
const failures = [];
const successful = [];
let skipped = 0;

const results = await mapPool(selected, 4, async (item) => {
  try {
    const existed = await fs.stat(publicFile(item.file)).catch(() => null);
    const metadata = await buildOne(item, previousById.get(item.id));
    if (existed && !force && !verifyOnly) skipped += 1;
    successful.push(metadata);
    process.stdout.write(`${verifyOnly ? "PASS" : existed && !force ? "SKIP" : "OK"} ${item.id} ${Math.round(metadata.fileSize / 1024)}KB\n`);
    return metadata;
  } catch (error) {
    const failure = { id: item.id, error: error instanceof Error ? error.message : String(error) };
    failures.push(failure);
    process.stderr.write(`FAIL ${failure.id} ${failure.error}\n`);
    return null;
  }
});

const validResults = results.filter(Boolean);
const duplicateIds = new Set();
for (let left = 0; left < validResults.length; left += 1) {
  for (let right = left + 1; right < validResults.length; right += 1) {
    const a = validResults[left];
    const b = validResults[right];
    if (a.hash === b.hash || hammingDistance(a.perceptualHash, b.perceptualHash) <= 2) {
      duplicateIds.add(b.id);
      failures.push({ id: b.id, error: `중복 이미지: ${a.id}` });
    }
  }
}
const deduplicated = validResults.filter((item) => !duplicateIds.has(item.id));

if (!verifyOnly) {
  const selectedIds = new Set(selected.map((item) => item.id));
  const untouched = categoryFilter || idFilter ? current.filter((item) => !selectedIds.has(item.id)) : [];
  const next = [...untouched, ...deduplicated].sort((a, b) => a.id.localeCompare(b.id));
  const temporary = `${metadataPath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await fs.rename(temporary, metadataPath);
}

const totals = deduplicated.reduce((sum, item) => sum + Number(item.fileSize || 0), 0);
const counts = Object.fromEntries([...new Set(deduplicated.map((item) => item.category))].sort().map((category) => [category, deduplicated.filter((item) => item.category === category).length]));
process.stdout.write(`완료 ${deduplicated.length}개 · 건너뜀 ${skipped}개 · 실패 ${failures.length}개 · ${Math.round(totals / 1024 / 1024)}MB\n`);
process.stdout.write(`카테고리 ${JSON.stringify(counts)}\n`);
if (failures.length) {
  process.stderr.write(`${JSON.stringify(failures, null, 2)}\n`);
  process.exitCode = 1;
}
