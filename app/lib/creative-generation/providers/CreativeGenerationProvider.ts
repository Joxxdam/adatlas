import type { GenerationJob, GenerationResult, NativeCreativeValidation, NativeGroupValidation } from "../types.ts";

export type ProviderStatus = {
  engine: "codex_local" | "openai_api";
  available: boolean;
  authenticated: boolean;
  paidApiUsed: boolean;
  detail: string;
};
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

export type NativeValidationInput = {
  job: GenerationJob;
  result: GenerationResult;
  imagePath: string;
  referencePaths: string[];
  adReferencePath?: string;
  exportComplianceVerified?: boolean;
};

export interface NativeCreativeSession {
  generate(input: NativeGenerationInput): Promise<{ outputPath: string }>;
  validate(input: NativeValidationInput): Promise<NativeCreativeValidation>;
  close(): Promise<void>;
}

export interface CreativeGenerationProvider {
  readonly engine: "codex_local" | "openai_api";
  status(): Promise<ProviderStatus>;
  openSession(): Promise<NativeCreativeSession>;
  validateGroup(input: { job: GenerationJob; contactSheetPath: string }): Promise<NativeGroupValidation>;
}

export async function withNativeCreativeSession<T>(provider: CreativeGenerationProvider, operation: (session: NativeCreativeSession) => Promise<T>) {
  const session = await provider.openSession();
  try {
    return await operation(session);
  } finally {
    await session.close();
  }
}
