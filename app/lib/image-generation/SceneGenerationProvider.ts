import type { SceneGenerationInput, SceneGenerationResult } from "../creative/types";

export type ImageGenerationFeature = "scene" | "reference-image" | "custom-square";

export interface SceneGenerationProvider {
  readonly id: SceneGenerationResult["provider"];
  isConfigured(): boolean;
  supports(feature: ImageGenerationFeature): boolean;
  generateScene(input: SceneGenerationInput): Promise<SceneGenerationResult>;
  generateReferenceImage(input: SceneGenerationInput): Promise<SceneGenerationResult>;
}

export function isPaidImageGenerationEnabled() {
  return String(process.env.PAID_IMAGE_GENERATION_ENABLED || "false").toLowerCase() === "true";
}
