import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { ALLOWED_SCENE_REFERENCE_TYPES, detectSceneReferenceType, extensionForSceneReference, MAX_SCENE_REFERENCE_BYTES } from "../../../../lib/video-collaboration/referenceImage";
import { videoProjectRepository } from "../../../../lib/video-collaboration/repository.server";
import type { VideoSceneReferenceImage } from "../../../../lib/video-collaboration/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const safeProjectId = /^video-[0-9a-f-]{36}$/i;

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  let writtenPath = "";
  try {
    const { projectId } = await context.params;
    if (!safeProjectId.test(projectId)) throw new Error("프로젝트 식별자가 올바르지 않습니다.");
    const project = await videoProjectRepository.get(projectId);
    if (!project) throw new Error("영상 프로젝트를 찾지 못했습니다.");
    if (project.status === "approved") throw new Error("완료된 대본은 복제한 뒤 참고 이미지를 수정해 주세요.");
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("업로드할 참고 이미지를 선택해 주세요.");
    if (!ALLOWED_SCENE_REFERENCE_TYPES.has(file.type)) throw new Error("JPG, JPEG, PNG, WEBP 이미지만 업로드할 수 있습니다.");
    if (file.size <= 0 || file.size > MAX_SCENE_REFERENCE_BYTES) throw new Error("장면 참고 이미지는 10MB 이하만 업로드할 수 있습니다.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedType = detectSceneReferenceType(buffer);
    if (!detectedType || detectedType !== file.type) throw new Error("파일 내용과 이미지 형식이 일치하지 않습니다.");
    const id = crypto.randomUUID();
    const storedFileName = `${id}.${extensionForSceneReference(detectedType)}`;
    const outputDirectory = path.join(process.cwd(), "public", "video-collaboration", "script-references", projectId);
    await fs.mkdir(outputDirectory, { recursive: true });
    writtenPath = path.join(outputDirectory, storedFileName);
    await fs.writeFile(writtenPath, buffer, { flag: "wx" });
    const image: VideoSceneReferenceImage = {
      id,
      source: "upload",
      filePath: `/video-collaboration/script-references/${projectId}/${storedFileName}`,
      name: file.name.slice(0, 220),
      mimeType: detectedType,
      size: buffer.length,
      description: "",
      required: false,
      createdAt: new Date().toISOString(),
    };
    return NextResponse.json({ ok: true, image }, { status: 201 });
  } catch (error) {
    if (writtenPath) await fs.unlink(writtenPath).catch(() => undefined);
    const message = error instanceof Error ? error.message : "장면 참고 이미지 업로드 실패";
    return NextResponse.json({ ok: false, error: message }, { status: message.includes("찾지 못") ? 404 : 400 });
  }
}
