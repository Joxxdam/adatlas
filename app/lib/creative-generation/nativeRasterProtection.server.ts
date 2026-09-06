import path from "node:path";
import { copyFile, unlink } from "node:fs/promises";
import sharp from "sharp";
import type { ReferenceTextRegion } from "./referenceLibraryManagement";
import type { ReferenceAdaptedCopyPlan } from "./types";

export const NATIVE_RASTER_PROTECTION_VERSION = "reference-region-lock-v1" as const;

type NormalizedBox = { x: number; y: number; width: number; height: number };

export type NativeRasterProtectionRegion = {
  id: string;
  box: NormalizedBox;
  action: "replace" | "remove";
  sizeClass?: "small" | "medium" | "large" | "hero";
};

export type NativeRasterProtectionResult = {
  applied: boolean;
  complete: boolean;
  regionCount: number;
  reason?: string;
};

function validBox(value: NormalizedBox | undefined): value is NormalizedBox {
  return Boolean(
    value &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      Number.isFinite(value.width) &&
      Number.isFinite(value.height) &&
      value.width > 0 &&
      value.height > 0 &&
      value.x < 1 &&
      value.y < 1 &&
      value.x + value.width > 0 &&
      value.y + value.height > 0
  );
}

function isEditableReferenceTextRegion(region: ReferenceTextRegion) {
  if (region.sourceType === "source-product-label" || region.sourceType === "decorative") return false;
  if (region.replacePolicy === "product-replacement" || region.replacePolicy === "preserve") return false;
  return (
    region.sourceType === "ad-copy" ||
    region.sourceType === "source-brand" ||
    region.sourceType === "uncertain" ||
    region.replacePolicy === "adapt" ||
    region.replacePolicy === "remove" ||
    region.replacePolicy === "review"
  );
}

function regionKey(region: NativeRasterProtectionRegion) {
  const box = region.box;
  return `${region.id}:${box.x.toFixed(5)}:${box.y.toFixed(5)}:${box.width.toFixed(5)}:${box.height.toFixed(5)}`;
}

/**
 * OCR 좌표를 한 번만 해석해 상품 단계와 문구 단계가 같은 잠금 영역을 쓰게
 * 합니다. copySlots가 있으면 그것이 실행 계약이고, 과거 작업만 nativeCopy의
 * 실제 OCR 영역으로 보충합니다.
 */
export function resolveReferenceCopyRasterRegions(
  plan: ReferenceAdaptedCopyPlan | undefined,
  textRegions: ReferenceTextRegion[] = []
) {
  const slots = plan?.copySlots || [];
  const candidates = slots.length
    ? slots.map((slot) => ({
        id: slot.regionId || `copy-slot-${slot.index}`,
        box: slot.box,
        action: slot.action || (slot.sourceType === "source-brand" || slot.replacePolicy === "remove" ? "remove" as const : "replace" as const),
        sizeClass: slot.sizeClass,
      }))
    : textRegions.filter(isEditableReferenceTextRegion).map((region, index) => ({
        id: region.id || `reference-region-${index}`,
        box: region.box,
        action: region.sourceType === "source-brand" || region.replacePolicy === "remove" ? "remove" as const : "replace" as const,
        sizeClass: region.sizeClass,
      }));
  const relevantCount = candidates.length;
  const invalidCount = candidates.filter((candidate) => !validBox(candidate.box)).length;
  const seen = new Set<string>();
  const regions: NativeRasterProtectionRegion[] = [];
  for (const candidate of candidates) {
    if (!validBox(candidate.box)) continue;
    const region: NativeRasterProtectionRegion = {
      id: candidate.id,
      box: candidate.box,
      action: candidate.action,
      sizeClass: candidate.sizeClass,
    };
    const key = regionKey(region);
    if (seen.has(key)) continue;
    seen.add(key);
    regions.push(region);
  }
  return {
    regions,
    complete: relevantCount > 0 && invalidCount === 0,
    relevantCount,
    invalidCount,
  };
}

function expandedPixelBox(region: NativeRasterProtectionRegion, width: number, height: number) {
  const { box } = region;
  const sizePadding = region.sizeClass === "hero" ? 0.03 : region.sizeClass === "large" ? 0.025 : region.sizeClass === "medium" ? 0.02 : 0.015;
  // 글자 획만이 아니라 외곽선·그림자·캡슐/배지 가장자리까지 같은 편집
  // 영역에 들어가게 합니다. source-brand 제거는 컨테이너 복원 여유를 더 둡니다.
  const extra = region.action === "remove" ? 0.015 : 0;
  const paddingX = Math.min(0.055, Math.max(sizePadding + extra, box.width * 0.1));
  const paddingY = Math.min(0.05, Math.max(sizePadding + extra, box.height * 0.18));
  const left = Math.max(0, Math.floor((box.x - paddingX) * width));
  const top = Math.max(0, Math.floor((box.y - paddingY) * height));
  const right = Math.min(width, Math.ceil((box.x + box.width + paddingX) * width));
  const bottom = Math.min(height, Math.ceil((box.y + box.height + paddingY) * height));
  return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
}

function maskSvg(width: number, height: number, regions: NativeRasterProtectionRegion[]) {
  const rectangles = regions
    .map((region) => expandedPixelBox(region, width, height))
    .map((box) => `<rect x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" fill="#fff"/>`)
    .join("");
  return Buffer.from(`<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="transparent"/>${rectangles}</svg>`);
}

/**
 * 생성 호출을 추가하지 않는 결정적 안전장치입니다.
 * - preserve-regions: 상품 교체 결과에서 원본 OCR 문구 픽셀을 복원
 * - edit-regions-only: 문구 교체 결과 중 OCR 영역 안의 변경만 채택
 */
export async function applyNativeRasterRegionLock(input: {
  sourcePath: string;
  generatedPath: string;
  regions: NativeRasterProtectionRegion[];
  mode: "preserve-regions" | "edit-regions-only";
  requireComplete?: boolean;
  complete?: boolean;
}): Promise<NativeRasterProtectionResult> {
  if (!input.regions.length) {
    return { applied: false, complete: Boolean(input.complete), regionCount: 0, reason: "OCR 좌표가 없어 프롬프트 잠금만 적용" };
  }
  if (input.requireComplete && !input.complete) {
    return { applied: false, complete: false, regionCount: input.regions.length, reason: "일부 문구 슬롯에 OCR 좌표가 없어 부분 마스크 합성을 생략" };
  }

  const generatedMetadata = await sharp(input.generatedPath).metadata();
  const width = generatedMetadata.width || 0;
  const height = generatedMetadata.height || 0;
  if (!width || !height) throw new Error("래스터 잠금을 적용할 생성 이미지 크기를 읽지 못했습니다.");

  const mask = maskSvg(width, height, input.regions);
  const source = await sharp(input.sourcePath).resize(width, height, { fit: "fill" }).ensureAlpha().png().toBuffer();
  const generated = await sharp(input.generatedPath).resize(width, height, { fit: "fill" }).ensureAlpha().png().toBuffer();
  const patchSource = input.mode === "preserve-regions" ? source : generated;
  const baseSource = input.mode === "preserve-regions" ? generated : source;
  const patch = await sharp(patchSource)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  const temporaryPath = path.join(path.dirname(input.generatedPath), `.${path.basename(input.generatedPath)}.${process.pid}.${Date.now()}.region-lock.png`);
  try {
    await sharp(baseSource).composite([{ input: patch, blend: "over" }]).png().toFile(temporaryPath);
    // copyFile은 Windows에서도 기존 목적지를 안전하게 덮어쓸 수 있습니다.
    await copyFile(temporaryPath, input.generatedPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
  return { applied: true, complete: Boolean(input.complete), regionCount: input.regions.length };
}
