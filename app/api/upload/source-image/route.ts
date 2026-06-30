import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { NextResponse } from "next/server";
import type { SourceImageCandidate } from "../../../lib/mvp/types";

export const runtime = "nodejs";

const outputDir = path.join(process.cwd(), "public", "uploaded-source-images");
const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

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
      return NextResponse.json({ success: false, error: "업로드할 이미지 파일을 선택해주세요." }, { status: 400 });
    }

    if (!allowedTypes.has(file.type)) {
      return NextResponse.json({ success: false, error: "PNG, JPG, WEBP 이미지만 업로드할 수 있습니다." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > 12 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: "이미지 파일은 12MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }

    await fs.mkdir(outputDir, { recursive: true });
    const createdAt = new Date().toISOString();
    const id = `upload-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const fileName = `${id}.${extensionFromType(file.type)}`;
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
    };

    return NextResponse.json({ success: true, imagePath, candidate });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "업로드 이미지 추가에 실패했습니다." },
      { status: 500 },
    );
  }
}
