import "server-only";

import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { readCreativeRasterAsset } from "./assets.server";
import { AI_GENERATED_IMAGE_DISCLOSURE, findAdvertiserLogo, type DeliveryBrandingSelection } from "./deliveryBranding";
import { nativeJobDirectory, optimizeNativeFinalImage, resolveValidatedNativeOriginal } from "./nativeCreativeStorage.server";
import type { DeliveryBranding, GenerationJob } from "./types";

function disclosureSvg() {
  return Buffer.from(`
    <svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg">
      <rect x="794" y="1120" width="370" height="44" rx="14" fill="rgba(255,255,255,0.46)"/>
      <text x="1146" y="1149" text-anchor="end" fill="rgba(21,28,38,0.52)"
        font-family="Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
        font-size="21" font-weight="500">${AI_GENERATED_IMAGE_DISCLOSURE}</text>
    </svg>
  `);
}

async function logoComposite(logoId: string) {
  const logo = findAdvertiserLogo(logoId);
  if (!logo) throw new Error("선택한 업체 로고를 찾지 못했습니다.");
  const trimmed = await sharp(await readCreativeRasterAsset(logo.imagePath))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: 214, height: 76, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const metadata = await sharp(trimmed).metadata();
  const width = metadata.width || 214;
  const height = metadata.height || 76;
  const panelWidth = width + 28;
  const panelHeight = height + 22;
  const panel = Buffer.from(`
    <svg width="${panelWidth}" height="${panelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${panelWidth}" height="${panelHeight}" rx="16" fill="rgba(255,255,255,0.82)"/>
    </svg>
  `);
  const container = await sharp(panel)
    .composite([{ input: trimmed, left: 14, top: 11 }])
    .png()
    .toBuffer();
  return {
    input: container,
    left: 1200 - panelWidth - 34,
    top: 34,
  };
}

export async function renderDeliveryBranding(job: GenerationJob, resultId: string, input: DeliveryBrandingSelection): Promise<DeliveryBranding> {
  const result = job.results.find((item) => item.id === resultId);
  if (!result?.nativeCreative?.finalPath || !result.imagePath) {
    throw new Error("후처리를 적용할 완성 이미지가 없습니다.");
  }
  const source = resolveValidatedNativeOriginal(job, resultId);
  const output = path.join(nativeJobDirectory(job.advertiserId || "unknown-advertiser", job.id), "delivery", `${result.id}.jpg`);
  await renderDeliveryBrandedRaster(source, output, input);
  return {
    logoId: input.logoId,
    aiDisclosure: input.aiDisclosure,
    imagePath: output,
    sourceImagePath: result.nativeCreative.finalPath,
    updatedAt: new Date().toISOString(),
  };
}

export async function renderDeliveryBrandedRaster(source: string | Buffer, output: string, input: DeliveryBrandingSelection) {
  const composites: OverlayOptions[] = [];
  if (input.logoId) composites.push(await logoComposite(input.logoId));
  if (input.aiDisclosure) composites.push({ input: disclosureSvg(), left: 0, top: 0 });
  if (!composites.length) throw new Error("적용할 로고 또는 AI 생성 이미지 고지를 선택해 주세요.");

  const directory = path.dirname(output);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.branding-${process.pid}-${Date.now()}.png`);
  try {
    await sharp(source).rotate().resize(1200, 1200, { fit: "cover", position: "centre" }).composite(composites).png().toFile(temporary);
    await optimizeNativeFinalImage(temporary, output);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
