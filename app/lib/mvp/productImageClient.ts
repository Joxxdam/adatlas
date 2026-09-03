"use client";

import type { ProductCutoutQuality, ProductExtractionScope, ProductImageEffectPreset, ProductRepresentationType } from "./types";

type ProductCutoutApiResult = {
  success?: boolean;
  error?: string;
  fallbackMessage?: string;
  message?: string;
  processedImagePath?: string;
  cutoutImagePath?: string;
  styledCutoutImagePath?: string;
  originalImagePath?: string;
  requestedImagePath?: string;
  autoSelectedAlternative?: boolean;
  attemptedImageCount?: number;
  debug?: { cacheHit?: boolean };
  quality?: ProductCutoutQuality;
  retryCount?: number;
  croppedImagePath?: string;
};

type ProductCutoutRequestOptions = {
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
  selectedObjectIds?: string[];
  selectedObjectBoxes?: Array<{ x: number; y: number; width: number; height: number }>;
  cropBox?: { x: number; y: number; width: number; height: number };
  expectedUnitCount?: number;
};

export async function requestProductCutout(imagePath: string, effectPreset: ProductImageEffectPreset, candidateImagePaths: string[] = [], options: ProductCutoutRequestOptions = {}): Promise<ProductCutoutApiResult> {
  const response = await fetch("/api/image/remove-background", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imagePath,
      sourceImagePath: imagePath,
      candidateImagePaths,
      provider: "removebg",
      effectPreset,
      ...options,
    }),
  });
  const result = (await response.json()) as ProductCutoutApiResult;
  if (!response.ok) {
    throw new Error(result.error || "누끼 적용에 실패했습니다. 다른 이미지를 선택해 주세요.");
  }
  return result;
}
