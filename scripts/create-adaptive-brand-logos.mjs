import { promises as fs } from "node:fs";
import path from "node:path";

import { makeLightLogoVariant, normalizeTransparentLogo } from "../app/lib/mvp/adaptiveLogo.server.ts";

const root = process.cwd();
const logoRoot = path.join(root, "public", "brand-logos");
const logos = ["gukdae-hanwoo-logo-exact.png", "original-source-logo.png", "ririnco-logo.png"];

for (const file of logos) {
  const sourcePath = path.join(logoRoot, file);
  const source = await fs.readFile(sourcePath);
  const normalized = await normalizeTransparentLogo(source);
  const light = await makeLightLogoVariant(normalized);
  const lightPath = path.join(logoRoot, file.replace(/\.png$/i, "-light.png"));
  await fs.writeFile(lightPath, light);
  process.stdout.write(`${path.relative(root, lightPath)}\n`);
}
