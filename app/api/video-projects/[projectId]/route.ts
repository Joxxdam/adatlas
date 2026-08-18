import { NextResponse } from "next/server";
import { videoProjectRepository } from "../../../lib/video-collaboration/repository.server";
import type {
  BrandGuideline,
  ProductAnalysisSnapshot,
  VideoConcept,
} from "../../../lib/video-collaboration/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const project = await videoProjectRepository.get(projectId);
    if (!project) {
      return NextResponse.json(
        { ok: false, error: "프로젝트를 찾지 못했습니다." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "프로젝트 조회 실패" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      actor?: string;
      conceptId?: string;
      concept?: VideoConcept;
      deadline?: string;
      requestNote?: string;
      versionId?: string;
      commentId?: string;
      changes?: Partial<{
        projectName: string;
        advertiserName: string;
        marketerName: string;
        designerName: string;
        additionalRequests: string;
        productionNotes: string;
        deadline: string;
        productAnalysis: ProductAnalysisSnapshot;
        brandGuideline: BrandGuideline;
      }>;
    };
    const actor = String(body.actor || "사용자")
      .trim()
      .slice(0, 80);
    let project;
    if (body.action === "update-details") {
      project = await videoProjectRepository.updateDetails(projectId, body.changes || {});
    } else if (body.action === "update-concept") {
      if (!body.conceptId || !body.concept) throw new Error("수정할 기획안을 확인해 주세요.");
      project = await videoProjectRepository.updateConcept(
        projectId,
        body.conceptId,
        body.concept,
        actor
      );
    } else if (body.action === "save-script") {
      if (!body.conceptId || !body.concept) throw new Error("저장할 제작 대본을 확인해 주세요.");
      project = await videoProjectRepository.saveScript(
        projectId,
        body.conceptId,
        body.concept,
        actor,
        { productionNotes: body.changes?.productionNotes }
      );
    } else if (body.action === "request-production") {
      if (!body.conceptId) throw new Error("제작 요청할 기획안을 선택해 주세요.");
      project = await videoProjectRepository.requestProduction({
        projectId,
        conceptId: body.conceptId,
        deadline: String(body.deadline || ""),
        actor,
        requestNote: body.requestNote,
      });
    } else if (body.action === "select-concept") {
      if (!body.conceptId) throw new Error("선택할 기획안을 확인해 주세요.");
      project = await videoProjectRepository.selectConcept(projectId, body.conceptId);
    } else if (body.action === "start-production") {
      project = await videoProjectRepository.startProduction(projectId, actor);
    } else if (body.action === "resolve-comment") {
      if (!body.commentId) throw new Error("해결 처리할 피드백을 선택해 주세요.");
      project = await videoProjectRepository.resolveComment(projectId, body.commentId, actor);
    } else if (body.action === "approve-version") {
      if (!body.versionId) throw new Error("최종 승인할 영상 버전을 선택해 주세요.");
      project = await videoProjectRepository.approveVersion(projectId, body.versionId, actor);
    } else if (body.action === "duplicate-approved") {
      project = await videoProjectRepository.duplicateApproved(projectId, actor);
    } else {
      throw new Error("지원하지 않는 프로젝트 수정 요청입니다.");
    }
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "프로젝트 수정 실패";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("찾지 못") ? 404 : 400 }
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params;
    const project = await videoProjectRepository.delete(projectId);
    return NextResponse.json({ ok: true, project });
  } catch (error) {
    const message = error instanceof Error ? error.message : "프로젝트 삭제 실패";
    return NextResponse.json(
      { ok: false, error: message },
      { status: message.includes("찾지 못") ? 404 : 400 }
    );
  }
}
