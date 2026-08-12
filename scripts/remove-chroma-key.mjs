import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const [input, output] = process.argv.slice(2);

if (!input || !output) {
  throw new Error("사용법: node scripts/remove-chroma-key.mjs <input> <output>");
}

const image = sharp(input).ensureAlpha();
const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
const sampleSize = Math.max(4, Math.min(32, Math.floor(Math.min(info.width, info.height) / 12)));
const corners = [
  [0, 0],
  [info.width - sampleSize, 0],
  [0, info.height - sampleSize],
  [info.width - sampleSize, info.height - sampleSize],
];
const key = [0, 0, 0];
let samples = 0;

for (const [startX, startY] of corners) {
  for (let y = startY; y < startY + sampleSize; y += 1) {
    for (let x = startX; x < startX + sampleSize; x += 1) {
      const offset = (y * info.width + x) * 4;
      key[0] += data[offset];
      key[1] += data[offset + 1];
      key[2] += data[offset + 2];
      samples += 1;
    }
  }
}

key[0] /= samples;
key[1] /= samples;
key[2] /= samples;

const keyIsGreen = key[1] > key[0] && key[1] > key[2];
const opaqueChroma = 28;
const transparentChroma = 88;

for (let offset = 0; offset < data.length; offset += 4) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const chroma = keyIsGreen
    ? green - Math.max(red, blue)
    : Math.min(red, blue) - green;
  const alpha = Math.max(
    0,
    Math.min(1, (transparentChroma - chroma) / (transparentChroma - opaqueChroma))
  );

  if (alpha <= 0.001) {
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
    continue;
  }

  if (alpha < 0.999) {
    data[offset] = Math.max(0, Math.min(255, (red - key[0] * (1 - alpha)) / alpha));
    data[offset + 1] = Math.max(0, Math.min(255, (green - key[1] * (1 - alpha)) / alpha));
    data[offset + 2] = Math.max(0, Math.min(255, (blue - key[2] * (1 - alpha)) / alpha));
  }
  data[offset + 3] = Math.round(alpha * 255);
}

await fs.mkdir(path.dirname(output), { recursive: true });
await sharp(data, {
  raw: { width: info.width, height: info.height, channels: 4 },
})
  .png({ compressionLevel: 9, adaptiveFiltering: true })
  .toFile(output);

process.stdout.write(
  `${output} ${info.width}x${info.height} key=${key.map((value) => Math.round(value)).join(",")}\n`
);
