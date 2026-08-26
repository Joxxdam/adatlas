import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { detectLogoSurfaceTone, makeLightLogoVariant, normalizeTransparentLogo, prepareLogoForSurface } from "../app/lib/mvp/adaptiveLogo.server.ts";

const root = process.cwd();
const lightVariantLogoPaths = ["public/brand-logos/gukdae-hanwoo-logo-exact.png", "public/brand-logos/original-source-logo.png", "public/brand-logos/ririnco-logo.png"];
const transparentLogoPaths = [...lightVariantLogoPaths, "public/brand-logos/advertisers/daehan-hanwoo.png", "public/brand-logos/advertisers/himnaera-farm.png"];

async function pixelStats(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let visible = 0;
  let transparent = 0;
  let luminance = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3];
    if (alpha <= 8) {
      transparent += 1;
      continue;
    }
    visible += 1;
    luminance += data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
  }
  return {
    visible,
    transparent,
    meanVisibleLuminance: visible ? luminance / visible : 0,
  };
}

test("registered advertiser logos keep a real transparent background", async () => {
  for (const relativePath of transparentLogoPaths) {
    const source = await readFile(path.join(root, relativePath));
    const normalized = await normalizeTransparentLogo(source);
    const stats = await pixelStats(normalized);
    assert.ok(stats.visible > 1_000, `${relativePath}: visible logo pixels are missing`);
    assert.ok(stats.transparent > 1_000, `${relativePath}: transparent area is missing`);
  }
});

test("dark surfaces receive readable light logo variants without adding a tile", async () => {
  for (const relativePath of lightVariantLogoPaths) {
    const source = await readFile(path.join(root, relativePath));
    const variant = await makeLightLogoVariant(source);
    const stats = await pixelStats(variant);
    assert.ok(stats.transparent > 1_000, `${relativePath}: light variant lost transparency`);
    assert.ok(stats.meanVisibleLuminance > 210, `${relativePath}: light variant is too dark (${stats.meanVisibleLuminance})`);
  }
});

test("surface luminance selects a contrasting logo variant", async () => {
  const darkSurface = await sharp({
    create: { width: 1200, height: 1200, channels: 3, background: "#111827" },
  })
    .png()
    .toBuffer();
  const lightSurface = await sharp({
    create: { width: 1200, height: 1200, channels: 3, background: "#f8fafc" },
  })
    .png()
    .toBuffer();
  assert.equal(await detectLogoSurfaceTone(darkSurface), "dark");
  assert.equal(await detectLogoSurfaceTone(lightSurface), "light");

  const source = await readFile(path.join(root, lightVariantLogoPaths[1]));
  const darkPrepared = await prepareLogoForSurface({
    logoBuffer: source,
    surfaceBuffer: darkSurface,
  });
  const lightPrepared = await prepareLogoForSurface({
    logoBuffer: source,
    surfaceBuffer: lightSurface,
  });
  assert.equal(darkPrepared.surfaceTone, "dark");
  assert.equal(lightPrepared.surfaceTone, "light");
  assert.ok((await pixelStats(darkPrepared.buffer)).meanVisibleLuminance > (await pixelStats(lightPrepared.buffer)).meanVisibleLuminance);
});
