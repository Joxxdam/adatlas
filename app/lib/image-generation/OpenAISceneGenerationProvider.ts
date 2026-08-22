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
  private readonly explicitPaidApiAuthorization: boolean;

  constructor(options: { explicitPaidApiAuthorization?: boolean } = {}) {
    this.explicitPaidApiAuthorization = options.explicitPaidApiAuthorization === true;
  }

  isConfigured() {
    return Boolean(
      this.explicitPaidApiAuthorization &&
        process.env.OPENAI_API_KEY &&
        isPaidImageGenerationEnabled()
    );
  }

  supports(feature: ImageGenerationFeature) {
    if (feature === "custom-square") return false;
    return feature === "scene" || feature === "reference-image";
  }

  async generateScene(input: SceneGenerationInput): Promise<SceneGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error(
        "유료 OpenAI 이미지 공급자 선택, 작업별 동의, 서버 허용이 모두 필요합니다. 기본 제작은 Codex·ChatGPT 로그인으로 실행됩니다."
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
      explicitPaidApiAuthorization: true,
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
        "유료 OpenAI 이미지 공급자 선택, 작업별 동의, 서버 허용이 모두 필요합니다. 기본 제작은 Codex·ChatGPT 로그인으로 실행됩니다."
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
      explicitPaidApiAuthorization: true,
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
