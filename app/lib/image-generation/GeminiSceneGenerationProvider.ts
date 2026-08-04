import { generateGeminiImageFromText } from "../mvp/geminiImageClient";
import type { SceneGenerationInput, SceneGenerationResult } from "../creative/types";
import type { SceneGenerationProvider } from "./SceneGenerationProvider";

export class GeminiSceneGenerationProvider implements SceneGenerationProvider {
  readonly id = "gemini" as const;

  isConfigured() {
    return Boolean(
      process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY
    );
  }

  async generateScene(input: SceneGenerationInput): Promise<SceneGenerationResult> {
    if (!this.isConfigured()) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
    const prompt = [
      input.prompt,
      input.negativePrompt ? `Negative constraints: ${input.negativePrompt}` : "",
      "OUTPUT CONTRACT: return only one edge-to-edge, fully opaque 1:1 commercial photography plate. Fill all four corners and every pixel with a continuous environment.",
      "A product-safe zone is a low-detail photographed surface, not a transparent, black, blank, masked, boxed, or cutout area.",
      "Do not render the sold category, a substitute product, food, package, bottle, label, logo, price, readable text, or isolated hero object anywhere.",
    ]
      .filter(Boolean)
      .join("\n\n");
    const result = await generateGeminiImageFromText({ prompt });
    return {
      imageBuffer: result.imageBuffer,
      provider: this.id,
      revisedPrompt: result.promptUsed,
      metadata: { requestedCanvas: "1200x1200", model: result.model },
    };
  }
}
