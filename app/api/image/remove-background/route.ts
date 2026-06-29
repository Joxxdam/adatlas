import crypto from "crypto";
import { NextResponse } from "next/server";
import {
  imageSourceToBuffer,
  removeBackgroundToPng,
  saveProcessedProductImage,
} from "../../../lib/mvp/imageEffects";
import type { ProductImageEffectPreset } from "../../../lib/mvp/types";

export const runtime = "nodejs";

type Body = {
  sourceImagePath?: string;
  effectPreset?: ProductImageEffectPreset;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const sourceImagePath = String(body.sourceImagePath || "").trim();

    if (!sourceImagePath) {
      return NextResponse.json(
        { success: false, error: "sourceImagePath is required." },
        { status: 400 },
      );
    }

    const sourceBuffer = await imageSourceToBuffer(sourceImagePath);
    const cutoutBuffer = await removeBackgroundToPng(sourceBuffer);
    const cutoutImagePath = await saveProcessedProductImage(
      cutoutBuffer,
      `cutout-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`,
    );

    return NextResponse.json({
      success: true,
      originalImagePath: sourceImagePath,
      cutoutImagePath,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "누끼 적용에 실패했습니다. 다른 이미지를 선택해 주세요.",
      },
      { status: 500 },
    );
  }
}
