import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { readCreativeRasterAsset } from "./assets.server";
import { advertiserLogoNeedsWhiteOutline, AI_GENERATED_IMAGE_DISCLOSURE, findAdvertiserLogo, type DeliveryBrandingSelection } from "./deliveryBranding";
import { nativeJobDirectory, optimizeNativeFinalImage, resolveValidatedNativeOriginal } from "./nativeCreativeStorage.server";
import type { DeliveryBranding, GenerationJob } from "./types";

function disclosureSvg() {
  return Buffer.from(`
    <svg width="1200" height="1200" xmlns="http://www.w3.org/2000/svg">
      <text x="1170" y="1170" text-anchor="end" fill="rgba(21,28,38,0.46)"
        font-family="Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
        font-size="14" font-weight="500" paint-order="stroke fill"
        stroke="rgba(255,255,255,0.52)" stroke-width="1.2">${AI_GENERATED_IMAGE_DISCLOSURE}</text>
    </svg>
  `);
}

async function addWhiteLogoOutline(input: Buffer) {
  const metadata = await sharp(input).ensureAlpha().metadata();
  const width = metadata.width || 1;
  const height = metadata.height || 1;
  const padding = 2;
  const outlinedWidth = width + padding * 2;
  const outlinedHeight = height + padding * 2;
  const expandedAlpha = await sharp(input)
    .ensureAlpha()
    .extractChannel("alpha")
    .extend({
      top: padding,
      bottom: padding,
      left: padding,
      right: padding,
      // 단일 알파 채널에서 `#000`은 불투명 검정으로 해석되어 흰 사각형을
      // 만들 수 있으므로, 외곽 여백은 반드시 완전 투명으로 확장합니다.
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .blur(1)
    .threshold(18)
    .toBuffer();
  const whiteSilhouette = await sharp({
    create: { width: outlinedWidth, height: outlinedHeight, channels: 3, background: "#fff" },
  })
    .joinChannel(expandedAlpha)
    .png()
    .toBuffer();
  return sharp(whiteSilhouette).composite([{ input, left: padding, top: padding }]).png().toBuffer();
}

async function logoComposite(logoId: string) {
  const logo = findAdvertiserLogo(logoId);
  if (!logo) throw new Error("선택한 업체 로고를 찾지 못했습니다.");
  // 카탈로그의 `/brand-logos/...` 값은 브라우저용 public URL입니다.
  // 그대로 asset loader에 넘기면 macOS 절대경로로 오인되므로, 허용된
  // public 디렉터리 안의 실제 파일 경로로 먼저 변환합니다.
  const logoFile = path.join(process.cwd(), "public", logo.imagePath.replace(/^\/+/, ""));
  const needsWhiteOutline = advertiserLogoNeedsWhiteOutline(logoId);
  const frameWidth = Math.round(1200 * ((logo.frameWidthPercent || 12) / 100));
  const frameHeight = Math.round(1200 * ((logo.frameHeightPercent || 7) / 100));
  const outlineAllowance = needsWhiteOutline ? 4 : 0;
  // 외곽선 2px씩을 포함해 로고별 미리보기와 같은 프레임 영역 안에
  // 들어오도록 합니다. 원본의 투명 여백도 보존해야 CSS object-fit과
  // 다운로드 결과의 실제 위치가 동일해집니다.
  const resized = await sharp(await readCreativeRasterAsset(logoFile))
    .resize({ width: frameWidth - outlineAllowance, height: frameHeight - outlineAllowance, fit: "inside" })
    .png()
    .toBuffer();
  // 한우 로고는 광고 배경에서 묻히기 쉬워 외곽 형태에만 흰색 테두리를
  // 추가합니다. 사각 배경 패널은 만들지 않습니다.
  const renderedLogo = needsWhiteOutline ? await addWhiteLogoOutline(resized) : resized;
  const renderedMetadata = await sharp(renderedLogo).metadata();
  const renderedWidth = renderedMetadata.width || 1;
  const renderedHeight = renderedMetadata.height || 1;
  const framedLogo = await sharp({
    create: { width: frameWidth, height: frameHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: renderedLogo,
        left: Math.max(0, Math.round((frameWidth - renderedWidth) / 2)),
        top: Math.max(0, Math.round((frameHeight - renderedHeight) / 2)),
      },
    ])
    .png()
    .toBuffer();
  return {
    input: framedLogo,
    left: 30,
    top: 696,
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
  // 상품 전체 적용은 두 장씩 병렬 처리됩니다. 시각만 사용하면 같은
  // 밀리초에 시작한 작업이 임시 PNG를 공유해 libpng 오류가 날 수 있습니다.
  const temporary = path.join(directory, `.branding-${process.pid}-${Date.now()}-${randomUUID()}.png`);
  try {
    await sharp(source).rotate().resize(1200, 1200, { fit: "cover", position: "centre" }).composite(composites).png().toFile(temporary);
    await optimizeNativeFinalImage(temporary, output);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
