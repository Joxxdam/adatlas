import { NextResponse } from "next/server";
import { applyProductEffectToPng, imageSourceToBuffer, saveProcessedProductImage } from "../../../lib/mvp/imageEffects";
import { removeProductBackground, type BackgroundRemovalProvider } from "../../../lib/mvp/backgroundRemoval";
import type { NormalizedImageBox, ProductExtractionScope, ProductImageEffectPreset, ProductRepresentationType } from "../../../lib/mvp/types";

export const runtime = "nodejs";

type Body = {
  imagePath?: string;
  sourceImagePath?: string;
  candidateImagePaths?: string[];
  provider?: BackgroundRemovalProvider;
  effectPreset?: ProductImageEffectPreset;
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
  selectedObjectIds?: string[];
  selectedObjectBoxes?: NormalizedImageBox[];
  cropBox?: NormalizedImageBox;
  expectedUnitCount?: number;
  cleanupStrength?: "light" | "balanced" | "strong";
};

const effectPresets = new Set<ProductImageEffectPreset>(["none", "clean-outline", "soft-glow", "commerce-shadow", "outline-glow-shadow"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const sourceImagePath = String(body.imagePath || body.sourceImagePath || "").trim();
    const provider = body.provider || "removebg";
    const effectPreset = effectPresets.has(body.effectPreset || "commerce-shadow") ? body.effectPreset || "commerce-shadow" : "commerce-shadow";

    if (!sourceImagePath) {
      return NextResponse.json(
        {
          success: false,
          originalImagePath: "",
          processedImagePath: null,
          provider,
          error: "imagePath is required.",
          fallbackMessage: "Select a source product image before removing the background.",
        },
        { status: 400 }
      );
    }

    const allowAlternativeSources = !body.cropBox && !body.selectedObjectIds?.length;
    const candidateImagePaths = [sourceImagePath, ...(allowAlternativeSources && Array.isArray(body.candidateImagePaths) ? body.candidateImagePaths : [])]
      .map((value) => String(value || "").trim())
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .slice(0, 8);
    let result = await removeProductBackground({
      imagePath: candidateImagePaths[0],
      provider,
      representationType: body.representationType,
      extractionScope: body.extractionScope,
      selectedObjectIds: body.selectedObjectIds,
      selectedObjectBoxes: body.selectedObjectBoxes,
      cropBox: body.cropBox,
      expectedUnitCount: body.expectedUnitCount,
      cleanupStrength: body.cleanupStrength,
    });

    for (const candidateImagePath of candidateImagePaths.slice(1)) {
      if (result.success && result.processedImagePath) break;
      result = await removeProductBackground({
        imagePath: candidateImagePath,
        provider,
        representationType: body.representationType,
        extractionScope: body.extractionScope,
        selectedObjectIds: body.selectedObjectIds,
        selectedObjectBoxes: body.selectedObjectBoxes,
        expectedUnitCount: body.expectedUnitCount,
        cleanupStrength: body.cleanupStrength,
      });
    }

    if (!result.success || !result.processedImagePath) {
      return NextResponse.json({
        ...result,
        attemptedImageCount: candidateImagePaths.length,
        fallbackMessage: candidateImagePaths.length > 1 ? "상세 이미지에서 상품 단독 컷을 탐색했지만 안전하게 분리할 이미지를 찾지 못해 원본을 유지했습니다." : result.fallbackMessage,
      });
    }

    let styledCutoutImagePath: string | undefined;
    if (effectPreset !== "none") {
      const cutoutBuffer = await imageSourceToBuffer(result.processedImagePath);
      const styledBuffer = await applyProductEffectToPng(cutoutBuffer, effectPreset);
      styledCutoutImagePath = await saveProcessedProductImage(styledBuffer, `removebg-effect-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.png`);
    }

    return NextResponse.json({
      success: true,
      originalImagePath: result.originalImagePath,
      requestedImagePath: sourceImagePath,
      autoSelectedAlternative: result.originalImagePath !== sourceImagePath,
      attemptedImageCount: candidateImagePaths.indexOf(result.originalImagePath) + 1,
      processedImagePath: result.processedImagePath,
      cutoutImagePath: result.processedImagePath,
      styledCutoutImagePath,
      provider,
      sourceKind: result.sourceKind,
      fallbackMessage: result.fallbackMessage,
      debug: result.debug,
      croppedImagePath: result.croppedImagePath,
      quality: result.quality,
      retryCount: result.retryCount,
      cacheKey: result.cacheKey,
      message: result.fallbackMessage || "Background removed successfully",
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Background removal failed.";

    console.error("[remove-background] route failed", {
      message: errorMessage,
    });

    return NextResponse.json(
      {
        success: false,
        originalImagePath: null,
        processedImagePath: null,
        provider: "removebg",
        error: "REMOVE_BG_FAILED",
        detail: process.env.NODE_ENV === "development" ? errorMessage : undefined,
        fallbackMessage: "배경 제거에 실패했습니다. 원본 이미지를 계속 사용하거나 상품 이미지를 직접 업로드해 주세요.",
      },
      { status: 500 }
    );
  }
}
