import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { loadSafeProductImageBuffer } from "../../../lib/mvp/backgroundRemoval";
import { inspectCutoutQuality } from "../../../lib/mvp/cutoutQuality";
import { prepareProductSourceBuffer, saveProcessedProductImage } from "../../../lib/mvp/imageEffects";
import type { NormalizedImageBox, ProductExtractionScope, ProductRepresentationType } from "../../../lib/mvp/types";

export const runtime = "nodejs";

type MaskStroke = {
  id?: string;
  mode: "erase" | "restore";
  x: number;
  y: number;
  radius: number;
};

type Body = {
  cutoutImagePath?: string;
  originalImagePath?: string;
  cropBox?: NormalizedImageBox;
  strokes?: MaskStroke[];
  representationType?: ProductRepresentationType;
  extractionScope?: ProductExtractionScope;
};

function processedFilePath(value: string) {
  const relative = value.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!relative.startsWith("processed-products/") || relative.includes("..")) {
    throw new Error("수정할 누끼 이미지 경로가 올바르지 않습니다.");
  }
  const publicDir = path.resolve(process.cwd(), "public");
  const absolute = path.resolve(publicDir, relative);
  if (!absolute.startsWith(`${publicDir}${path.sep}`)) throw new Error("잘못된 이미지 경로입니다.");
  return absolute;
}

function normalizedStroke(stroke: MaskStroke): MaskStroke | null {
  if (!stroke || !["erase", "restore"].includes(stroke.mode)) return null;
  const x = Number(stroke.x);
  const y = Number(stroke.y);
  const radius = Number(stroke.radius);
  if (![x, y, radius].every(Number.isFinite)) return null;
  return {
    id: stroke.id || crypto.randomUUID(),
    mode: stroke.mode,
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    radius: Math.max(0.002, Math.min(0.25, radius)),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const cutoutImagePath = String(body.cutoutImagePath || "").trim();
    const originalImagePath = String(body.originalImagePath || "").trim();
    const strokes = (Array.isArray(body.strokes) ? body.strokes : [])
      .slice(0, 300)
      .map(normalizedStroke)
      .filter((stroke): stroke is MaskStroke => Boolean(stroke));
    if (!cutoutImagePath || !originalImagePath || !strokes.length) {
      return NextResponse.json(
        { success: false, error: "누끼 이미지, 원본 이미지, 수정 브러시가 필요합니다." },
        { status: 400 }
      );
    }
    const cutoutBuffer = await fs.readFile(processedFilePath(cutoutImagePath));
    const cutout = await sharp(cutoutBuffer).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const preparedOriginal = await prepareProductSourceBuffer(
      await loadSafeProductImageBuffer(originalImagePath),
      body.cropBox
    );
    const original = await sharp(preparedOriginal)
      .resize(cutout.info.width, cutout.info.height, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const width = cutout.info.width;
    const height = cutout.info.height;

    for (const stroke of strokes) {
      const centerX = stroke.x * width;
      const centerY = stroke.y * height;
      const pixelRadius = Math.max(1, stroke.radius * Math.min(width, height));
      const minX = Math.max(0, Math.floor(centerX - pixelRadius));
      const maxX = Math.min(width - 1, Math.ceil(centerX + pixelRadius));
      const minY = Math.max(0, Math.floor(centerY - pixelRadius));
      const maxY = Math.min(height - 1, Math.ceil(centerY + pixelRadius));
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
          if (distance > pixelRadius) continue;
          const strength = Math.max(0, Math.min(1, (pixelRadius - distance) / Math.max(1, pixelRadius * 0.32)));
          const index = (y * width + x) * 4;
          if (stroke.mode === "erase") {
            cutout.data[index + 3] = Math.round(cutout.data[index + 3] * (1 - strength));
          } else {
            cutout.data[index] = Math.round(cutout.data[index] * (1 - strength) + original[index] * strength);
            cutout.data[index + 1] = Math.round(
              cutout.data[index + 1] * (1 - strength) + original[index + 1] * strength
            );
            cutout.data[index + 2] = Math.round(
              cutout.data[index + 2] * (1 - strength) + original[index + 2] * strength
            );
            const restoreAlpha = original[index + 3] || 255;
            cutout.data[index + 3] = Math.max(
              cutout.data[index + 3],
              Math.round(restoreAlpha * strength)
            );
          }
          if (cutout.data[index + 3] <= 3) {
            cutout.data[index] = 0;
            cutout.data[index + 1] = 0;
            cutout.data[index + 2] = 0;
            cutout.data[index + 3] = 0;
          }
        }
      }
    }
    const output = await sharp(cutout.data, {
      raw: { width, height, channels: 4 },
    })
      .png()
      .toBuffer();
    const quality = await inspectCutoutQuality(output, {
      representationType: body.representationType,
      extractionScope: body.extractionScope,
    });
    const resultImagePath = await saveProcessedProductImage(
      output,
      `mask-edit-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.png`
    );
    return NextResponse.json({
      success: true,
      resultImagePath,
      quality,
      manualEdited: true,
      strokeCount: strokes.length,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "마스크 수정에 실패했습니다.",
      },
      { status: 500 }
    );
  }
}
