import type { SceneGenerationInput, SceneGenerationResult } from "../creative/types.ts";

export type ImageGenerationFeature = "scene" | "reference-image" | "custom-square";

export interface SceneGenerationProvider {
  readonly id: SceneGenerationResult["provider"];
  isConfigured(): boolean;
  supports(feature: ImageGenerationFeature): boolean;
  generateScene(input: SceneGenerationInput): Promise<SceneGenerationResult>;
  generateReferenceImage(input: SceneGenerationInput): Promise<SceneGenerationResult>;
}

export function isPaidImageGenerationEnabled() {
  return [
    process.env.ADATLAS_IMAGE_GENERATION_ENABLED,
    process.env.PAID_IMAGE_GENERATION_ENABLED,
  ].some((value) => String(value || "false").toLowerCase() === "true");
}
