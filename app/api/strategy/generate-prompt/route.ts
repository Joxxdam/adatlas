import { NextResponse } from "next/server";
import { buildImageGenerationPrompt } from "../../../lib/mvp/imagePromptBuilder";
import type {
  AdImageLabel,
  GeneratedAdCopy,
  GptImageGenerationMode,
  GptImagePreservationMode,
  GptImageSourceMode,
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
  templateId?: string;
  templateSummary?: string;
  productImagePath?: string;
  productImagePaths?: string[];
  selectedSourceImagePath?: string;
  selectedSourceImageType?: string;
  selectedSourceImageLabel?: string;
  imageGenerationMode?: GptImageGenerationMode;
  imageSourceMode?: GptImageSourceMode;
  preservationMode?: GptImagePreservationMode;
  customPrompt?: string;
  finalPrompt?: string;
  promptMode?: "auto" | "custom";
};

function normalizeMode(value?: string): GptImageGenerationMode {
  return value === "text-in-image" ? "text-in-image" : "visual-only";
}

function normalizeSourceMode(
  value: string | undefined,
  selectedSourceImagePath: string
): GptImageSourceMode {
  if (value === "text-to-image") return "text-to-image";
  if (value === "image-edit") return "image-edit";
  return selectedSourceImagePath ? "image-edit" : "text-to-image";
}

function normalizePreservationMode(
  value: string | undefined,
  selectedSourceImagePath: string
): GptImagePreservationMode {
  if (value === "free-generate") return "free-generate";
  if (value === "preserve-product") return "preserve-product";
  return selectedSourceImagePath ? "preserve-product" : "free-generate";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const productInfo = body.productInfo ?? {};
    const imageGenerationMode = normalizeMode(body.imageGenerationMode);
    const selectedSourceImagePath =
      body.selectedSourceImagePath ||
      productInfo.selectedSourceImagePath ||
      body.productImagePath ||
      productInfo.productImagePath ||
      body.productImagePaths?.[0] ||
      productInfo.productImagePaths?.[0] ||
      "";
    const imageSourceMode = normalizeSourceMode(body.imageSourceMode, selectedSourceImagePath);
    const preservationMode = normalizePreservationMode(
      body.preservationMode,
      selectedSourceImagePath
    );
    const selectedReferenceLabels = Array.isArray(body.selectedReferenceLabels)
      ? body.selectedReferenceLabels.slice(0, 3)
      : Array.isArray(body.referenceLabels)
        ? body.referenceLabels.slice(0, 3)
        : [];

    const { prompt: autoPrompt, creativeDirection } = buildImageGenerationPrompt({
      mode: imageGenerationMode,
      productInfo,
      productName: body.productName,
      category: body.category,
      mainBenefit: body.mainBenefit,
      targetCustomer: body.targetCustomer,
      landingUrl: body.landingUrl,
      selectedReferenceLabels,
      generatedCopy: body.generatedCopy,
      templateId: body.templateId,
      templateSummary: body.templateSummary,
      productImagePath: body.productImagePath,
      productImagePaths: body.productImagePaths,
      selectedSourceImagePath,
      selectedSourceImageType: body.selectedSourceImageType,
      selectedSourceImageLabel: body.selectedSourceImageLabel,
      imageSourceMode,
      preservationMode,
    });
    const finalPrompt =
      typeof body.finalPrompt === "string" && body.finalPrompt.trim()
        ? body.finalPrompt.trim()
        : typeof body.customPrompt === "string" && body.customPrompt.trim()
          ? body.customPrompt.trim()
          : autoPrompt;

    return NextResponse.json({
      success: true,
      ok: true,
      imageGenerationMode,
      imageSourceMode,
      preservationMode,
      imageGenerationPrompt: finalPrompt,
      autoPrompt,
      finalPrompt,
      promptMode:
        body.promptMode === "custom" && (body.customPrompt || body.finalPrompt) ? "custom" : "auto",
      creativeDirection,
      selectedSourceImagePath,
      strategy: {
        imageGenerationPrompt: finalPrompt,
        creativeDirection,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        ok: false,
        error: error instanceof Error ? error.message : "이미지 생성 프롬프트 생성 실패",
      },
      { status: 500 }
    );
  }
}
