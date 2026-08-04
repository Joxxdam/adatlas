import type { SceneGenerationInput, SceneGenerationResult } from "../creative/types";

export interface SceneGenerationProvider {
  readonly id: SceneGenerationResult["provider"];
  isConfigured(): boolean;
  generateScene(input: SceneGenerationInput): Promise<SceneGenerationResult>;
}
