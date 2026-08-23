import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error("사용법: node scripts/optimize-original-source-background.mjs <input> <output>");
}

await fs.mkdir(path.dirname(output), { recursive: true });
let quality = 84;
let buffer = await sharp(input).rotate().resize(1200, 1200, { fit: "cover", position: "attention" }).webp({ quality, effort: 6 }).toBuffer();

while (buffer.length > 800_000 && quality > 64) {
  quality -= 4;
  buffer = await sharp(input).rotate().resize(1200, 1200, { fit: "cover", position: "attention" }).webp({ quality, effort: 6 }).toBuffer();
}

await fs.writeFile(output, buffer);
await sharp(buffer).metadata();
process.stdout.write(`${output} 1200x1200 ${buffer.length}B q${quality}\n`);
