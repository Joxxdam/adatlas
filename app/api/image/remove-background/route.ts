import { NextResponse } from "next/server";
import {
  applyProductEffectToPng,
  imageSourceToBuffer,
  saveProcessedProductImage,
} from "../../../lib/mvp/imageEffects";
import {
  removeProductBackground,
  type BackgroundRemovalProvider,
} from "../../../lib/mvp/backgroundRemoval";
import type { ProductImageEffectPreset } from "../../../lib/mvp/types";

export const runtime = "nodejs";

type Body = {
  imagePath?: string;
  sourceImagePath?: string;
  provider?: BackgroundRemovalProvider;
  effectPreset?: ProductImageEffectPreset;
};

const effectPresets = new Set<ProductImageEffectPreset>([
  "none",
  "clean-outline",
  "soft-glow",
  "commerce-shadow",
  "outline-glow-shadow",
]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const sourceImagePath = String(body.imagePath || body.sourceImagePath || "").trim();
    const provider = body.provider || "removebg";
    const effectPreset = effectPresets.has(body.effectPreset || "outline-glow-shadow")
      ? body.effectPreset || "outline-glow-shadow"
      : "outline-glow-shadow";

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
        { status: 400 },
      );
    }

    const result = await removeProductBackground({
      imagePath: sourceImagePath,
      provider,
    });

    if (!result.success || !result.processedImagePath) {
      return NextResponse.json(result);
    }

    let styledCutoutImagePath: string | undefined;
    if (effectPreset !== "none") {
      const cutoutBuffer = await imageSourceToBuffer(result.processedImagePath);
      const styledBuffer = await applyProductEffectToPng(cutoutBuffer, effectPreset);
      styledCutoutImagePath = await saveProcessedProductImage(
        styledBuffer,
        `removebg-effect-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.png`,
      );
    }

    return NextResponse.json({
      success: true,
      originalImagePath: sourceImagePath,
      processedImagePath: result.processedImagePath,
      cutoutImagePath: result.processedImagePath,
      styledCutoutImagePath,
      provider,
      sourceKind: result.sourceKind,
      debug: result.debug,
      message: "Background removed successfully",
    });
  } catch (error) {
    const errorMessage = error instanceof Error
      ? error.message
      : "Background removal failed.";

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
      { status: 500 },
    );
  }
}
