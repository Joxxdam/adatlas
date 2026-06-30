import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { NextResponse } from "next/server";
import { buildRevisionPromptFromFeedback } from "../../../lib/mvp/gptImageFeedback";
import { appendGptImageCandidates } from "../../../lib/mvp/gptImageFeedbackStore";
import { buildImagePreservationLockPrompt } from "../../../lib/mvp/gptImagePromptLocks";
import { buildImageGenerationPrompt } from "../../../lib/mvp/imagePromptBuilder";
import { getSelectedProductImagePath } from "../../../lib/mvp/imageEffects";
import { editImageFromSource, generateImageFromText } from "../../../lib/mvp/openaiImageClient";
import type {
  AdImageLabel,
  GeneratedAdCopy,
  GptImageCandidate,
  GptImageFailureReason,
  GptImageGenerationMode,
  GptImagePreservationMode,
  GptImageSourceMode,
  GptOutputCanvasPreset,
  GptPromptTemplateMode,
  ProductImageState,
  ProductInfoForPrompt,
} from "../../../lib/mvp/types";

export const runtime = "nodejs";

type Body = {
  productInfo?: Partial<ProductInfoForPrompt>;
  productName?: string;
  category?: string;
  mainBenefit?: string;
  targetCustomer?: string;
  landingUrl?: string;
  selectedReferenceLabels?: AdImageLabel[];
  referenceLabels?: AdImageLabel[];
  generatedCopy?: Partial<GeneratedAdCopy>;
  productImagePath?: string;
  productImagePaths?: string[];
  productImageState?: ProductImageState;
  selectedSourceImagePath?: string;
  referenceImagePaths?: string[];
  selectedSourceImageType?: string;
  selectedSourceImageLabel?: string;
  templateId?: string;
  templateSummary?: string;
  imageGenerationMode?: GptImageGenerationMode;
  imageSourceMode?: GptImageSourceMode;
  preservationMode?: GptImagePreservationMode;
  customPrompt?: string;
  finalPrompt?: string;
  promptMode?: "auto" | "custom";
  promptTemplateMode?: GptPromptTemplateMode;
  canvasPreset?: GptOutputCanvasPreset;
  autoPrompt?: string;
  customPromptNote?: string;
  basePrompt?: string;
  revisionPrompt?: string;
  failureReasons?: GptImageFailureReason[];
  customFeedback?: string;
  parentCandidateId?: string;
  attempt?: number;
  numCandidates?: number;
};

const outputDir = path.join(process.cwd(), "public", "generated-product-images");

function normalizeMode(value?: string): GptImageGenerationMode {
  return value === "text-in-image" ? "text-in-image" : "visual-only";
}

function normalizeSourceMode(value: string | undefined, selectedSourceImagePath: string): GptImageSourceMode {
  if (value === "text-to-image") return "text-to-image";
  if (value === "image-edit") return "image-edit";
  return selectedSourceImagePath ? "image-edit" : "text-to-image";
}

function normalizePreservationMode(value: string | undefined, selectedSourceImagePath: string): GptImagePreservationMode {
  if (value === "free-generate") return "free-generate";
  if (value === "preserve-product") return "preserve-product";
  return selectedSourceImagePath ? "preserve-product" : "free-generate";
}

function outputPrefix(imageSourceMode: GptImageSourceMode, imageGenerationMode: GptImageGenerationMode) {
  if (imageSourceMode === "image-edit") {
    return imageGenerationMode === "text-in-image" ? "gpt-edit-ad" : "gpt-edit-visual";
  }
  return imageGenerationMode === "text-in-image" ? "gpt-text-ad" : "gpt-text-visual";
}

function normalizeCandidateCount(value?: number) {
  const count = Number.isFinite(value) ? Number(value) : 1;
  return Math.max(1, Math.min(4, Math.floor(count)));
}

function normalizePromptTemplateMode(value?: string, imageGenerationMode?: GptImageGenerationMode): GptPromptTemplateMode {
  if (value === "ad-image-with-copy") return "ad-image-with-copy";
  if (value === "visual-only") return "visual-only";
  return imageGenerationMode === "text-in-image" ? "ad-image-with-copy" : "visual-only";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const imageGenerationMode = normalizeMode(body.imageGenerationMode);
    const selectedReferenceLabels = Array.isArray(body.selectedReferenceLabels)
      ? body.selectedReferenceLabels.slice(0, 3)
      : Array.isArray(body.referenceLabels)
        ? body.referenceLabels.slice(0, 3)
        : [];
    const selectedProductImagePath = body.productImageState
      ? getSelectedProductImagePath(body.productImageState)
      : "";
    const fallbackSourceImagePath =
      body.selectedSourceImagePath ||
      body.productInfo?.selectedSourceImagePath ||
      selectedProductImagePath ||
      body.productImagePath ||
      body.productInfo?.productImagePath ||
      body.productImagePaths?.[0] ||
      body.productInfo?.productImagePaths?.[0] ||
      "";
    const imageSourceMode = normalizeSourceMode(body.imageSourceMode, fallbackSourceImagePath);
    const preservationMode = normalizePreservationMode(body.preservationMode, fallbackSourceImagePath);

    if (imageSourceMode === "image-edit" && !fallbackSourceImagePath) {
      return NextResponse.json(
        { success: false, error: "선택 이미지 기준 생성에는 원본 기준 이미지가 필요합니다." },
        { status: 400 },
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "OpenAI API 키를 확인해 주세요." },
        { status: 500 },
      );
    }

    const { prompt: fallbackAutoPrompt, creativeDirection } = buildImageGenerationPrompt({
      mode: imageGenerationMode,
      productInfo: body.productInfo,
      productName: body.productName,
      category: body.category,
      mainBenefit: body.mainBenefit,
      targetCustomer: body.targetCustomer,
      landingUrl: body.landingUrl,
      selectedReferenceLabels,
      generatedCopy: body.generatedCopy,
      templateId: body.templateId,
      templateSummary: body.templateSummary,
      productImagePath: selectedProductImagePath || body.productImagePath,
      productImagePaths: body.productImagePaths,
      selectedSourceImagePath: fallbackSourceImagePath,
      referenceImagePaths: body.referenceImagePaths,
      selectedSourceImageType: body.selectedSourceImageType,
      selectedSourceImageLabel: body.selectedSourceImageLabel,
      imageSourceMode,
      preservationMode,
    });
    const promptTemplateMode = normalizePromptTemplateMode(body.promptTemplateMode, imageGenerationMode);
    const canvasPreset: GptOutputCanvasPreset = "sns-square-1200";
    const autoPrompt = typeof body.autoPrompt === "string" && body.autoPrompt.trim()
      ? body.autoPrompt.trim()
      : fallbackAutoPrompt;
    const customPromptNote = typeof body.customPromptNote === "string" ? body.customPromptNote.trim() : "";
    const basePrompt =
      typeof body.finalPrompt === "string" && body.finalPrompt.trim()
        ? body.finalPrompt.trim()
        : typeof body.basePrompt === "string" && body.basePrompt.trim()
          ? body.basePrompt.trim()
          : typeof body.customPrompt === "string" && body.customPrompt.trim()
            ? body.customPrompt.trim()
            : autoPrompt;
    const failureReasons = Array.isArray(body.failureReasons) ? body.failureReasons : [];
    const revisionPrompt =
      typeof body.revisionPrompt === "string" && body.revisionPrompt.trim()
        ? body.revisionPrompt.trim()
        : failureReasons.length || body.customFeedback?.trim()
          ? buildRevisionPromptFromFeedback({
            failureReasons,
            customFeedback: body.customFeedback,
            category: body.category || body.productInfo?.category,
          })
          : "";
    const lockPrompt = buildImagePreservationLockPrompt({
      imageGenerationMode,
      imageSourceMode,
      preservationMode,
      category: body.category || body.productInfo?.category,
    });
    const additionalDirection =
      customPromptNote && !basePrompt.includes(customPromptNote)
        ? `[Additional user direction]\n${customPromptNote}`
        : "";
    const revisionDirection = revisionPrompt ? `[Revision direction]\n${revisionPrompt}` : "";
    const prompt = [basePrompt, additionalDirection, lockPrompt, revisionDirection].filter(Boolean).join("\n\n");

    await fs.mkdir(outputDir, { recursive: true });
    const prefix = outputPrefix(imageSourceMode, imageGenerationMode);
    const numCandidates = normalizeCandidateCount(body.numCandidates);
    const createdAt = new Date().toISOString();
    const candidates = await Promise.all(Array.from({ length: numCandidates }, async (_, index): Promise<GptImageCandidate> => {
      const { imageBuffer, promptUsed } = imageSourceMode === "image-edit"
        ? await editImageFromSource({
          sourceImagePath: fallbackSourceImagePath,
          referenceImagePaths: body.referenceImagePaths,
          prompt,
        })
        : await generateImageFromText({ prompt });
      const fileName = `${prefix}-${Date.now()}-${index + 1}-${crypto.randomBytes(4).toString("hex")}.png`;
      const filePath = path.join(outputDir, fileName);
      await fs.writeFile(filePath, imageBuffer);
      return {
        id: crypto.randomUUID(),
        imagePath: `/generated-product-images/${fileName}`,
        sourceImagePath: fallbackSourceImagePath,
        imageGenerationMode,
        imageSourceMode,
        preservationMode,
        promptTemplateMode,
        canvasPreset,
        productName: body.productName || body.productInfo?.productName,
        category: body.category || body.productInfo?.category,
        promptUsed,
        autoPrompt,
        customPromptNote,
        basePrompt,
        revisionPrompt: revisionPrompt || undefined,
        failureReasons,
        customFeedback: body.customFeedback?.trim() || undefined,
        selectedSourceImagePath: fallbackSourceImagePath,
        attempt: Math.max(1, Math.floor(body.attempt || 1)),
        parentCandidateId: body.parentCandidateId,
        createdAt,
      };
    }));

    const firstCandidate = candidates[0];
    await appendGptImageCandidates(candidates);

    return NextResponse.json({
      success: true,
      imagePath: firstCandidate.imagePath,
      images: candidates,
      imageGenerationMode,
      imageSourceMode,
      preservationMode,
      promptTemplateMode,
      canvasPreset,
      promptMode: body.finalPrompt || body.customPrompt ? "custom" : "auto",
      promptUsed: firstCandidate.promptUsed,
      autoPrompt,
      customPromptNote,
      basePrompt,
      revisionPrompt,
      failureReasons,
      customFeedback: body.customFeedback?.trim() || "",
      creativeDirection,
      selectedSourceImagePath: fallbackSourceImagePath,
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      savedTo: {
        candidates: "data/gpt-image-candidates.json",
      },
      createdAt,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "GPT 이미지 생성에 실패했습니다." },
      { status: 500 },
    );
  }
}
