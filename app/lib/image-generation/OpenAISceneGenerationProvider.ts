import {
  editImageFromSource,
  generateImageFromText,
  getOpenAIImageModel,
  getOpenAIImageQuality,
} from "../mvp/openaiImageClient.ts";
import type { SceneGenerationInput, SceneGenerationResult } from "../creative/types.ts";
import {
  isPaidImageGenerationEnabled,
  type ImageGenerationFeature,
  type SceneGenerationProvider,
} from "./SceneGenerationProvider.ts";

export class OpenAISceneGenerationProvider implements SceneGenerationProvider {
  readonly id = "openai" as const;

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY) && isPaidImageGenerationEnabled();
  }

  supports(feature: ImageGenerationFeature) {
    if (feature === "custom-square") return false;
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
      "Do not render the sold product, a lookalike replacement product, package, bottle, label, logo, price, text, or isolated hero object anywhere. Contextual ingredients, water, foam, surfaces, people or usage props are allowed only when the art-direction prompt explicitly requests them, and they must not obstruct the reserved product stage.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const model = getOpenAIImageModel();
    const result = await generateImageFromText({
      prompt,
      size: "1024x1024",
      quality: getOpenAIImageQuality(),
      background: "opaque",
      outputFormat: "png",
    });
    return {
      imageBuffer: result.imageBuffer,
      provider: this.id,
      revisedPrompt: result.promptUsed,
      metadata: {
        requestedCanvas: "1200x1200",
        sourceCanvas: "1024x1024",
        quality: getOpenAIImageQuality(),
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
      size: "1024x1024",
      quality: getOpenAIImageQuality(),
    });
    return {
      imageBuffer: result.imageBuffer,
      provider: this.id,
      revisedPrompt: result.promptUsed,
      metadata: {
        requestedCanvas: "1200x1200",
        model: getOpenAIImageModel(),
        inputFidelity: "high",
        referenceCount: input.referenceImages?.length || 0,
      },
    };
  }
}
