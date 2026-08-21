import "server-only";
import { access } from "node:fs/promises";
import { Codex } from "@openai/codex-sdk";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "../codexLocalRuntime.server.ts";
import { buildNativeFinalCreativePrompt, buildNativeGroupValidationPrompt, buildNativeValidationPrompt } from "../nativeCreativePrompt.ts";
import type { NativeCreativeValidation, NativeGroupValidation } from "../types.ts";
import type { CreativeGenerationProvider, NativeGenerationInput, ProviderStatus } from "./CreativeGenerationProvider.ts";
import { resolveFastCreativeRuntime } from "../fastCreativeRuntime";

const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 12 * 60 * 1000;
const validationSchema = {
  type: "object", additionalProperties: false,
  required: ["hookAlignment","productIdentity","factualAccuracy","koreanTextAccuracy","readability","composition","diversity","commercialQuality","exportCompliance","productVisibility","humanNaturalness","categoryFit","foodAppetiteAppeal","sensoryExpression","mobileReadability","observedKoreanText","failures","recommendation"],
  properties: {
    hookAlignment:{type:"integer",minimum:0,maximum:100}, productIdentity:{type:"integer",minimum:0,maximum:100}, factualAccuracy:{type:"integer",minimum:0,maximum:100}, koreanTextAccuracy:{type:"integer",minimum:0,maximum:100}, readability:{type:"integer",minimum:0,maximum:100}, composition:{type:"integer",minimum:0,maximum:100}, diversity:{type:"integer",minimum:0,maximum:100}, commercialQuality:{type:"integer",minimum:0,maximum:100}, exportCompliance:{type:"integer",minimum:0,maximum:100},
    productVisibility:{type:"integer",minimum:0,maximum:100}, humanNaturalness:{type:"integer",minimum:0,maximum:100}, categoryFit:{type:"integer",minimum:0,maximum:100}, foodAppetiteAppeal:{type:"integer",minimum:0,maximum:100}, sensoryExpression:{type:"integer",minimum:0,maximum:100}, mobileReadability:{type:"integer",minimum:0,maximum:100},
    observedKoreanText:{type:"array",items:{type:"string"}}, failures:{type:"array",items:{type:"string"}}, recommendation:{type:"string",enum:["approve","revise","manual-review"]}
  }
};
const groupValidationSchema = {
  type: "object", additionalProperties: false,
  required: ["sceneDiversity","productPlacementDiversity","cameraDiversity","colorMoodDiversity","messageSeparation","hookSceneAlignment","typographyDiversity","visualArchetypeDiversity","categoryFit","duplicatePairs","reviseHookCodes","failures","recommendation"],
  properties: {
    sceneDiversity:{type:"integer",minimum:0,maximum:100}, productPlacementDiversity:{type:"integer",minimum:0,maximum:100}, cameraDiversity:{type:"integer",minimum:0,maximum:100}, colorMoodDiversity:{type:"integer",minimum:0,maximum:100}, messageSeparation:{type:"integer",minimum:0,maximum:100}, hookSceneAlignment:{type:"integer",minimum:0,maximum:100},
    typographyDiversity:{type:"integer",minimum:0,maximum:100}, visualArchetypeDiversity:{type:"integer",minimum:0,maximum:100}, categoryFit:{type:"integer",minimum:0,maximum:100},
    duplicatePairs:{type:"array",items:{type:"object",additionalProperties:false,required:["leftHookCode","rightHookCode","reason"],properties:{leftHookCode:{type:"string",enum:["H01","H02","H03","H04","H05","H06"]},rightHookCode:{type:"string",enum:["H01","H02","H03","H04","H05","H06"]},reason:{type:"string"}}}},
    reviseHookCodes:{type:"array",items:{type:"string",enum:["H01","H02","H03","H04","H05","H06"]}}, failures:{type:"array",items:{type:"string"}}, recommendation:{type:"string",enum:["approve","revise","manual-review"]}
  }
};

export class CodexLocalCreativeProvider implements CreativeGenerationProvider {
  readonly engine = "codex_local" as const;
  private codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: resolveCodexLocalExecutable() });
  private authenticated?: Promise<boolean>;

  async status(): Promise<ProviderStatus> {
    this.authenticated ??= codexLocalAuthenticated();
    const authenticated = await this.authenticated;
    return { engine: this.engine, available: authenticated, authenticated, paidApiUsed: false, detail: authenticated ? "로컬 Codex · ChatGPT 로그인 연결됨" : "Codex CLI를 찾지 못했거나 로컬 로그인이 필요합니다." };
  }

  async generate(input: NativeGenerationInput) {
    const state = await this.status();
    if (!state.available) throw new Error(`codex_local 사용 불가: ${state.detail} 유료 API로 자동 전환하지 않았습니다.`);
    const runtime = resolveFastCreativeRuntime();
    const thread = this.codex.startThread({
      workingDirectory: process.cwd(),
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol",
      modelReasoningEffort: runtime.imageReasoning,
    });
    const prompt = buildNativeFinalCreativePrompt(input.job, input.result, input.outputPath, input.feedback);
    await thread.run(prompt, { signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_IMAGE_TIMEOUT_MS || DEFAULT_IMAGE_GENERATION_TIMEOUT_MS)) });
    await access(input.outputPath);
    return { outputPath: input.outputPath };
  }

  async validate(input: { job: NativeGenerationInput["job"]; result: NativeGenerationInput["result"]; imagePath: string; referencePaths: string[] }) {
    const state = await this.status();
    if (!state.available) throw new Error(`codex_local 사용 불가: ${state.detail}`);
    const qaThread = this.codex.startThread({ workingDirectory: process.cwd(), sandboxMode: "workspace-write", approvalPolicy: "never", networkAccessEnabled: false, model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", modelReasoningEffort: "high" });
    const content = [{ type: "text" as const, text: buildNativeValidationPrompt(input.job, input.result) }, { type: "local_image" as const, path: input.imagePath }, ...input.referencePaths.slice(0, 4).map((file) => ({ type: "local_image" as const, path: file }))];
    const response = await qaThread.run(content, { outputSchema: validationSchema, signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_VALIDATION_TIMEOUT_MS || 150_000)) });
    const parsed = JSON.parse(response.finalResponse) as Omit<NativeCreativeValidation, "checkedAt">;
    return { ...parsed, checkedAt: new Date().toISOString() };
  }

  async validateGroup(input: { job: NativeGenerationInput["job"]; contactSheetPath: string }): Promise<NativeGroupValidation> {
    const state = await this.status();
    if (!state.available) throw new Error(`codex_local 사용 불가: ${state.detail}`);
    const qaThread = this.codex.startThread({ workingDirectory: process.cwd(), sandboxMode: "workspace-write", approvalPolicy: "never", networkAccessEnabled: false, model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol", modelReasoningEffort: "high" });
    const response = await qaThread.run([
      { type: "text" as const, text: buildNativeGroupValidationPrompt(input.job) },
      { type: "local_image" as const, path: input.contactSheetPath },
    ], { outputSchema: groupValidationSchema, signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_VALIDATION_TIMEOUT_MS || 150_000)) });
    return { ...(JSON.parse(response.finalResponse) as Omit<NativeGroupValidation, "checkedAt">), checkedAt: new Date().toISOString() };
  }
}
