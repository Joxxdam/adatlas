import type { GenerationJob, GenerationResult, NativeCreativeValidation, NativeGroupValidation } from "../types.ts";

export type ProviderStatus = { engine: "codex_local" | "openai_api"; available: boolean; authenticated: boolean; paidApiUsed: boolean; detail: string };
export type NativeCreativeGenerationStage = "structure-recreation" | "product-replacement" | "copy-replacement" | "qa-repair";
export type NativeGenerationInput = {
  job: GenerationJob;
  result: GenerationResult;
  outputPath: string;
  /** Backward-compatible aggregate product reference list. */
  referencePaths: string[];
  productReferencePaths?: string[];
  adReferencePath?: string;
  goldenReferencePaths?: string[];
  feedback?: string;
  /** Previous stage raster. It is always the first edit source after structure recreation. */
  sourceImagePath?: string;
  stage?: NativeCreativeGenerationStage;
};

export interface CreativeGenerationProvider {
  readonly engine: "codex_local" | "openai_api";
  status(): Promise<ProviderStatus>;
  generate(input: NativeGenerationInput): Promise<{ outputPath: string; threadId?: string }>;
  validate(input: { job: GenerationJob; result: GenerationResult; imagePath: string; referencePaths: string[]; adReferencePath?: string; exportComplianceVerified?: boolean }): Promise<NativeCreativeValidation>;
  validateGroup(input: { job: GenerationJob; contactSheetPath: string }): Promise<NativeGroupValidation>;
}
