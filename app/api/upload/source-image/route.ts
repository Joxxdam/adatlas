import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import type { SourceImageCandidate } from "../../../lib/mvp/types";

export const runtime = "nodejs";

const outputDir = path.join(process.cwd(), "public", "uploaded-source-images");
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxImagePixels = 40_000_000;

function detectRasterImageType(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return "";
}

function extensionFromType(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "업로드할 이미지 파일을 선택해주세요." },
        { status: 400 }
      );
    }

    if (!allowedTypes.has(file.type)) {
      return NextResponse.json(
        { success: false, error: "PNG, JPG, WEBP 이미지만 업로드할 수 있습니다." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 12 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "이미지 파일은 12MB 이하만 업로드할 수 있습니다." },
        { status: 400 }
      );
    }
    const actualType = detectRasterImageType(buffer);
    if (!actualType || actualType !== file.type) {
      return NextResponse.json(
        { success: false, error: "파일 내용과 MIME 형식이 일치하지 않는 이미지입니다." },
        { status: 400 }
      );
    }
    const metadata = await sharp(buffer).metadata().catch(() => null);
    const width = metadata?.width || 0;
    const height = metadata?.height || 0;
    if (!width || !height || width > 10_000 || height > 10_000 || width * height > maxImagePixels) {
      return NextResponse.json(
        { success: false, error: "이미지 해상도는 최대 10,000px, 총 4천만 픽셀까지 지원합니다." },
        { status: 400 }
      );
    }

    await fs.mkdir(outputDir, { recursive: true });
    const createdAt = new Date().toISOString();
    const id = `upload-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const fileName = `${id}.${extensionFromType(actualType)}`;
    const filePath = path.join(outputDir, fileName);
    await fs.writeFile(filePath, buffer);

    const imagePath = `/uploaded-source-images/${fileName}`;
    const candidate: SourceImageCandidate = {
      id,
      type: "upload",
      imagePath,
      label: file.name ? `직접 업로드: ${file.name}` : "직접 업로드 이미지",
      selected: false,
      createdAt,
      width,
      height,
      sourceType: "upload",
      sourceImageQualityScore: Math.min(1, Math.min(width, height) / 900),
      salesUnitMatchScore: 0.6,
      recommendationScore: 0.65,
      analysisReason: "사용자가 직접 업로드한 검증된 원본 이미지입니다.",
    };

    return NextResponse.json({ success: true, imagePath, candidate });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "업로드 이미지 추가에 실패했습니다.",
      },
      { status: 500 }
    );
  }
}
