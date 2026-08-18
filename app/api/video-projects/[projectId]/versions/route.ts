import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { safeVideoFileName } from "../../../../lib/video-collaboration/codes";
import { videoProjectRepository } from "../../../../lib/video-collaboration/repository.server";
import type { VideoVersion } from "../../../../lib/video-collaboration/types";
import {
  ALLOWED_VIDEO_TYPES,
  detectVideoType,
  extensionForVideoType,
  MAX_VIDEO_UPLOAD_BYTES,
} from "../../../../lib/video-collaboration/videoFile";

export const runtime = "nodejs";
export const maxDuration = 120;

const safeProjectId = /^video-[0-9a-f-]{36}$/i;

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  let writtenPath = "";
  try {
    const { projectId } = await context.params;
    if (!safeProjectId.test(projectId)) throw new Error("프로젝트 식별자가 올바르지 않습니다.");
    const project = await videoProjectRepository.get(projectId);
    if (!project) throw new Error("영상 프로젝트를 찾지 못했습니다.");
    if (!["in_production", "revision_requested"].includes(project.status)) {
      throw new Error("영상 제작 중 또는 수정 요청 상태에서만 영상을 업로드할 수 있습니다.");
    }
    if (!project.finalScript) throw new Error("먼저 최종 대본을 확정해 주세요.");
    const formData = await request.formData();
    const file = formData.get("file");
    const uploadedBy = String(formData.get("uploadedBy") || project.designerName)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!(file instanceof File)) throw new Error("업로드할 영상 파일을 선택해 주세요.");
    if (!ALLOWED_VIDEO_TYPES.has(file.type))
      throw new Error("MP4, MOV, WEBM 영상만 업로드할 수 있습니다.");
    if (file.size <= 0 || file.size > MAX_VIDEO_UPLOAD_BYTES)
      throw new Error("영상 파일은 200MB 이하만 업로드할 수 있습니다.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const actualType = detectVideoType(buffer);
    if (!actualType || actualType !== file.type)
      throw new Error("파일 내용과 영상 형식이 일치하지 않습니다.");
    const versionNumber = project.versions.length + 1;
    const extension = extensionForVideoType(actualType);
    const storedFileName = safeVideoFileName(
      project.finalScript.materialCode,
      versionNumber,
      extension
    );
    const directory = path.join(
      process.cwd(),
      "public",
      "video-collaboration",
      "videos",
      projectId
    );
    await fs.mkdir(directory, { recursive: true });
    writtenPath = path.join(directory, storedFileName);
    await fs.writeFile(writtenPath, buffer, { flag: "wx" });
    const version: VideoVersion = {
      id: crypto.randomUUID(),
      versionNumber,
      filePath: `/video-collaboration/videos/${projectId}/${storedFileName}`,
      originalFileName: file.name.slice(0, 220),
      storedFileName,
      mimeType: actualType,
      size: buffer.length,
      uploadedBy: uploadedBy || project.designerName || "디자이너",
      uploadedAt: new Date().toISOString(),
      reviewStatus: "pending",
    };
    const updated = await videoProjectRepository.addVersion(projectId, version, uploadedBy);
    return NextResponse.json({ ok: true, project: updated, version }, { status: 201 });
  } catch (error) {
    if (writtenPath) await fs.unlink(writtenPath).catch(() => undefined);
    const message = error instanceof Error ? error.message : "영상 업로드 실패";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("찾지 못") ? 404 : 400 }
    );
  }
}
