import type { GenerationJob, GenerationResult, NativeCreativeValidation } from "../types.ts";

export type ProviderStatus = { engine: "codex_local" | "openai_api"; available: boolean; authenticated: boolean; paidApiUsed: boolean; detail: string };
export type NativeGenerationInput = { job: GenerationJob; result: GenerationResult; outputPath: string; referencePaths: string[]; feedback?: string; sourceImagePath?: string };

export interface CreativeGenerationProvider {
  readonly engine: "codex_local" | "openai_api";
  status(): Promise<ProviderStatus>;
  generate(input: NativeGenerationInput): Promise<{ outputPath: string; threadId?: string }>;
  validate(input: { job: GenerationJob; result: GenerationResult; imagePath: string; referencePaths: string[] }): Promise<NativeCreativeValidation>;
}
