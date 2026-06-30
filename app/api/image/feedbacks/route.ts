import crypto from "crypto";
import { NextResponse } from "next/server";
import { appendGptImageFeedback, readGptImageFeedbacks } from "../../../lib/mvp/gptImageFeedbackStore";
import type {
  GptImageFailureReason,
  GptImageFeedbackRecord,
  GptImageGenerationMode,
  GptImagePreservationMode,
  GptImageSourceMode,
  GptOutputCanvasPreset,
  GptPromptTemplateMode,
} from "../../../lib/mvp/types";

export const runtime = "nodejs";

type Body = Partial<GptImageFeedbackRecord> & {
  failureReasons?: GptImageFailureReason[];
};

function normalizePromptTemplateMode(value?: string): GptPromptTemplateMode {
  return value === "ad-image-with-copy" ? "ad-image-with-copy" : "visual-only";
}

function normalizeImageGenerationMode(value?: string): GptImageGenerationMode {
  return value === "text-in-image" ? "text-in-image" : "visual-only";
}

function normalizeImageSourceMode(value?: string): GptImageSourceMode {
  return value === "text-to-image" ? "text-to-image" : "image-edit";
}

function normalizePreservationMode(value?: string): GptImagePreservationMode {
  return value === "free-generate" ? "free-generate" : "preserve-product";
}

export async function GET() {
  try {
    const feedbacks = await readGptImageFeedbacks();
    return NextResponse.json({ success: true, feedbacks });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "GPT 이미지 피드백을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const record: GptImageFeedbackRecord = {
      id: body.id || `feedback-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
      sourceImagePath: body.sourceImagePath,
      generatedImagePath: body.generatedImagePath,
      parentCandidateId: body.parentCandidateId,
      candidateId: body.candidateId,
      promptTemplateMode: normalizePromptTemplateMode(body.promptTemplateMode),
      canvasPreset: "sns-square-1200" as GptOutputCanvasPreset,
      imageGenerationMode: normalizeImageGenerationMode(body.imageGenerationMode),
      imageSourceMode: normalizeImageSourceMode(body.imageSourceMode),
      preservationMode: normalizePreservationMode(body.preservationMode),
      productName: body.productName,
      category: body.category,
      failureReasons: Array.isArray(body.failureReasons) ? body.failureReasons : [],
      customFeedback: body.customFeedback || "",
      autoPrompt: body.autoPrompt,
      basePrompt: body.basePrompt,
      revisionPrompt: body.revisionPrompt || "",
      promptUsed: body.promptUsed,
      attempt: Number(body.attempt || 1),
      createdAt: body.createdAt || new Date().toISOString(),
    };

    const feedbacks = await appendGptImageFeedback(record);

    return NextResponse.json({
      success: true,
      feedback: record,
      feedbacks,
      savedTo: {
        feedbacks: "data/gpt-image-feedbacks.json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "GPT 이미지 피드백 저장에 실패했습니다." },
      { status: 500 },
    );
  }
}

