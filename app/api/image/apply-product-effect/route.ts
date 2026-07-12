import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  applyProductEffectToPng,
  imageSourceToBuffer,
  saveProcessedProductImage,
} from "../../../lib/mvp/imageEffects";
import type { ProductImageEffectPreset } from "../../../lib/mvp/types";

export const runtime = "nodejs";

type Body = {
  cutoutImagePath?: string;
  effectPreset?: ProductImageEffectPreset;
  outlineWidth?: number;
  glowBlur?: number;
  shadowBlur?: number;
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
    const cutoutImagePath = String(body.cutoutImagePath || "").trim();
    const effectPreset = effectPresets.has(body.effectPreset || "outline-glow-shadow")
      ? body.effectPreset || "outline-glow-shadow"
      : "outline-glow-shadow";

    if (!cutoutImagePath) {
      return NextResponse.json(
        { success: false, error: "cutoutImagePath is required." },
        { status: 400 }
      );
    }

    const cutoutBuffer = await imageSourceToBuffer(cutoutImagePath);
    const styledBuffer = await applyProductEffectToPng(cutoutBuffer, effectPreset);
    const styledCutoutImagePath = await saveProcessedProductImage(
      styledBuffer,
      `cutout-effect-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`
    );

    return NextResponse.json({
      success: true,
      styledCutoutImagePath,
      effectPreset,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "효과 적용에 실패했습니다. 다른 이미지를 선택해 주세요.",
      },
      { status: 500 }
    );
  }
}
