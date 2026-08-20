import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { VideoReferenceAsset } from "../../../lib/video-collaboration/types";
import { detectVideoType, extensionForVideoType } from "../../../lib/video-collaboration/videoFile";

export const runtime = "nodejs";

const MAX_REFERENCE_BYTES = 100 * 1024 * 1024;
const outputDirectory = path.join(process.cwd(), "public", "video-collaboration", "references");

function detectReferenceType(buffer: Buffer) {
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
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-")
    return "application/pdf";
  return detectVideoType(buffer);
}

function extension(type: string) {
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  if (type === "image/webp") return "webp";
  if (type === "application/pdf") return "pdf";
  return extensionForVideoType(type);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const role = formData.get("role") === "product-original" ? "product-original" : "reference";
    if (!(file instanceof File)) throw new Error("첨부할 참고 파일을 선택해 주세요.");
    if (file.size <= 0 || file.size > MAX_REFERENCE_BYTES)
      throw new Error("참고 파일은 100MB 이하만 업로드할 수 있습니다.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedType = detectReferenceType(buffer);
    if (!detectedType)
      throw new Error("PNG, JPG, WEBP, PDF, MP4, MOV, WEBM 파일만 첨부할 수 있습니다.");
    if (role === "product-original" && !detectedType.startsWith("image/"))
      throw new Error("상품 원본은 PNG, JPG, WEBP 이미지만 업로드할 수 있습니다.");
    const id = crypto.randomUUID();
    const fileName = `${id}.${extension(detectedType)}`;
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(path.join(outputDirectory, fileName), buffer, { flag: "wx" });
    const asset: VideoReferenceAsset = {
      id,
      name: file.name.slice(0, 180),
      filePath: `/video-collaboration/references/${fileName}`,
      mimeType: detectedType,
      size: buffer.length,
      uploadedAt: new Date().toISOString(),
      role,
    };
    return NextResponse.json({ ok: true, asset }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "참고 파일 업로드 실패" },
      { status: 400 }
    );
  }
}
