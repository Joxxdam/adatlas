import type { SceneGenerationInput, SceneGenerationResult } from "../creative/types.ts";

export type ImageGenerationFeature = "scene" | "reference-image" | "custom-square";

export interface SceneGenerationProvider {
  readonly id: SceneGenerationResult["provider"];
  isConfigured(): boolean;
  supports(feature: ImageGenerationFeature): boolean;
  generateScene(input: SceneGenerationInput): Promise<SceneGenerationResult>;
  generateReferenceImage(input: SceneGenerationInput): Promise<SceneGenerationResult>;
}

export function isPaidImageGenerationEnabled(env: Record<string, string | undefined> = process.env) {
  const serverExplicitlyEnabled = String(env.ADATLAS_PAID_API_EXPLICIT_ENABLED || "false").toLowerCase() === "true";
  const legacyImageRouteEnabled = [env.ADATLAS_IMAGE_GENERATION_ENABLED, env.PAID_IMAGE_GENERATION_ENABLED].some((value) => String(value || "false").toLowerCase() === "true");

  // A key or one of the old image flags must never turn paid generation on by itself.
  // These legacy providers are reachable only after the future paid-provider UI records
  // per-request consent and the server operator enables the paid API switch as well.
  return serverExplicitlyEnabled && legacyImageRouteEnabled;
}
