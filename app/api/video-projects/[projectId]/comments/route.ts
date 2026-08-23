import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../../lib/video-collaboration/repository.server";
import type { ReviewComment } from "../../../../lib/video-collaboration/types";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      versionId?: string;
      body?: string;
      author?: string;
      timecodeSeconds?: number | null;
      requestRevision?: boolean;
    };
    const project = await videoProjectRepository.get(projectId);
    if (!project) throw new Error("영상 프로젝트를 찾지 못했습니다.");
    const text = String(body.body || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 5000);
    const author = String(body.author || "마케터")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!body.versionId) throw new Error("피드백을 남길 영상 버전을 선택해 주세요.");
    if (!text) throw new Error("피드백 내용을 입력해 주세요.");
    const timecode = body.timecodeSeconds;
    if (timecode !== null && timecode !== undefined && (!Number.isFinite(timecode) || timecode < 0 || timecode > project.duration)) {
      throw new Error(`피드백 시간은 0초부터 ${project.duration}초 사이로 입력해 주세요.`);
    }
    const comment: ReviewComment = {
      id: crypto.randomUUID(),
      versionId: body.versionId,
      body: text,
      author: author || "마케터",
      timecodeSeconds: timecode === null || timecode === undefined ? undefined : timecode,
      createdAt: new Date().toISOString(),
      resolved: false,
    };
    const updated = await videoProjectRepository.addComment(projectId, comment, {
      requestRevision: Boolean(body.requestRevision),
      actor: comment.author,
    });
    return NextResponse.json({ ok: true, project: updated, comment }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "피드백 저장 실패";
    return NextResponse.json({ ok: false, error: message }, { status: message.includes("찾지 못") ? 404 : 400 });
  }
}
