import {
  editImageFromSource,
  generateImageFromText,
  getOpenAIImageModel,
} from "../mvp/openaiImageClient";
import type { SceneGenerationInput, SceneGenerationResult } from "../creative/types";
import {
  isPaidImageGenerationEnabled,
  type ImageGenerationFeature,
  type SceneGenerationProvider,
} from "./SceneGenerationProvider";

export class OpenAISceneGenerationProvider implements SceneGenerationProvider {
  readonly id = "openai" as const;

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY) && isPaidImageGenerationEnabled();
  }

  supports(feature: ImageGenerationFeature) {
    if (feature === "custom-square") return getOpenAIImageModel().startsWith("gpt-image-2");
    return feature === "scene" || feature === "reference-image";
  }

  async generateScene(input: SceneGenerationInput): Promise<SceneGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "OPENAI_API_KEY와 PAID_IMAGE_GENERATION_ENABLED=true가 모두 설정되어야 합니다."
      );
    }
    const prompt = [
      input.prompt,
      input.negativePrompt ? `Negative constraints: ${input.negativePrompt}` : "",
      "OUTPUT CONTRACT: one edge-to-edge, fully opaque square commercial photography plate. Fill all four corners and every pixel with the continuous environment.",
      "A product-safe zone means a low-detail photographed surface with coherent perspective and light. It must never be transparent, black, blank, masked, boxed, or cut out.",
      "Do not render the sold category, a replacement product, food, package, bottle, label, logo, price, text, or isolated hero object anywhere. Preserve every specified safe zone.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const model = getOpenAIImageModel();
    const supportsCustomSquare = model.startsWith("gpt-image-2");
    const result = await generateImageFromText({
      prompt,
      size: supportsCustomSquare ? "1200x1200" : "1024x1024",
      quality: "high",
      background: "opaque",
      outputFormat: "png",
    });
    return {
      imageBuffer: result.imageBuffer,
      provider: this.id,
      revisedPrompt: result.promptUsed,
      metadata: {
        requestedCanvas: "1200x1200",
        sourceCanvas: supportsCustomSquare ? "1200x1200" : "1024x1024",
        quality: "high",
        background: "opaque",
        model,
      },
    };
  }

  async generateReferenceImage(input: SceneGenerationInput): Promise<SceneGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "OPENAI_API_KEY와 PAID_IMAGE_GENERATION_ENABLED=true가 모두 설정되어야 합니다."
      );
    }
    const [sourceImagePath, ...referenceImagePaths] = input.referenceImages || [];
    if (!sourceImagePath) throw new Error("참조 이미지 생성에는 source image가 필요합니다.");
    const result = await editImageFromSource({
      sourceImagePath,
      referenceImagePaths,
      prompt: [input.prompt, input.negativePrompt].filter(Boolean).join("\n\n"),
      size: this.supports("custom-square") ? "1200x1200" : "1024x1024",
      quality: "high",
    });
    return {
      imageBuffer: result.imageBuffer,
      provider: this.id,
      revisedPrompt: result.promptUsed,
      metadata: {
        requestedCanvas: "1200x1200",
        model: getOpenAIImageModel(),
        inputFidelity: "provider-default-high",
      },
    };
  }
}
