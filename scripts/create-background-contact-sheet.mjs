import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const root = process.cwd();
const outputRoot = path.join(root, "docs", "background-library-contact-sheets");
const items = JSON.parse(await fs.readFile(path.join(root, "data/background-library.json"), "utf8"));
const categories = [...new Set(items.map((item) => item.category))].sort();

function escapeXml(value) {
  return String(value).replace(/[<>&'\"]/g, (character) => ({ "<":"&lt;", ">":"&gt;", "&":"&amp;", "'":"&apos;", "\"":"&quot;" })[character]);
}

async function cell(item, size) {
  const imageHeight = size - 52;
  const source = path.join(root, "public", item.file.replace(/^\//, ""));
  const image = await sharp(source).resize(size, imageHeight, { fit: "cover", position: "attention" }).png().toBuffer();
  const label = Buffer.from(`<svg width="${size}" height="52"><rect width="${size}" height="52" fill="#111827"/><text x="10" y="20" fill="#ffffff" font-family="Arial,sans-serif" font-size="13" font-weight="700">${escapeXml(item.id)}</text><text x="10" y="40" fill="#9fd1ff" font-family="Arial,sans-serif" font-size="11">${escapeXml(item.assetType)} · ${escapeXml(item.textSafeArea)}</text></svg>`);
  return sharp({ create: { width: size, height: size, channels: 3, background: "#111827" } }).composite([{ input: image, top: 0, left: 0 }, { input: label, top: imageHeight, left: 0 }]).png().toBuffer();
}

async function createSheet(name, sheetItems, columns, cellSize) {
  const rows = Math.ceil(sheetItems.length / columns);
  const cells = await Promise.all(sheetItems.map((item) => cell(item, cellSize)));
  const output = path.join(outputRoot, `${name}.webp`);
  await sharp({ create: { width: columns * cellSize, height: rows * cellSize, channels: 3, background: "#e5e7eb" } })
    .composite(cells.map((input, index) => ({ input, left: (index % columns) * cellSize, top: Math.floor(index / columns) * cellSize })))
    .webp({ quality: 82, effort: 5 })
    .toFile(output);
  process.stdout.write(`${path.relative(root, output)} ${sheetItems.length}개\n`);
}

await fs.mkdir(outputRoot, { recursive: true });
for (const category of categories) await createSheet(category, items.filter((item) => item.category === category), 4, 300);
for (const productId of [
  "mint-tea-tree",
  "lemon-tea-tree",
  "coconut-shea-butter",
  "lime",
  "rhubarb-raspberry",
]) {
  await createSheet(
    `original-source-${productId}`,
    items.filter((item) => item.id.startsWith(`original-source-${productId}-`)),
    5,
    240
  );
}
await createSheet("all-backgrounds", items, 8, 220);
