import { generateImageFromText, getOpenAIImageModel } from "../mvp/openaiImageClient";
import type { SceneGenerationInput, SceneGenerationResult } from "../creative/types";
import type { SceneGenerationProvider } from "./SceneGenerationProvider";

export class OpenAISceneGenerationProvider implements SceneGenerationProvider {
  readonly id = "openai" as const;

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async generateScene(input: SceneGenerationInput): Promise<SceneGenerationResult> {
    if (!this.isConfigured()) throw new Error("OPENAI_API_KEY가 설정되지 않았습니다.");
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
}
