import "server-only";
import { readFile, stat } from "node:fs/promises";
import { Codex, type Thread } from "@openai/codex-sdk";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "../codexLocalRuntime.server.ts";
import { buildNativeGroupValidationPrompt, buildNativeStagePrompt, buildNativeValidationPrompt } from "../nativeCreativePrompt.ts";
import type { NativeCreativeValidation, NativeGroupValidation } from "../types.ts";
import type { CreativeGenerationProvider, NativeCreativeSession, NativeGenerationInput, NativeValidationInput, ProviderStatus } from "./CreativeGenerationProvider.ts";
import { resolveFastCreativeRuntime } from "../fastCreativeRuntime";
import { createAsyncConcurrencyGate, resolveCodexCreativeParallelLimit } from "../asyncConcurrencyGate";
import { normalizeNativeCreativeValidation } from "../nativeCreativeValidation";

const DEFAULT_IMAGE_GENERATION_TIMEOUT_MS = 12 * 60 * 1000;
const creativeGateKey = Symbol.for("daywiz.codex-local-creative-gate-v1");
const creativeGateGlobal = globalThis as typeof globalThis & {
  [creativeGateKey]?: ReturnType<typeof createAsyncConcurrencyGate>;
};
const creativeGate = creativeGateGlobal[creativeGateKey] ?? createAsyncConcurrencyGate(resolveCodexCreativeParallelLimit());
creativeGateGlobal[creativeGateKey] = creativeGate;

async function waitForStableGeneratedOutput(file: string) {
  const deadline = Date.now() + 15_000;
  let previousSize = -1;
  let stableReads = 0;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const info = await stat(file);
      const buffer = info.isFile() && info.size >= 1024 ? await readFile(file) : Buffer.alloc(0);
      if (buffer.length === info.size && info.size === previousSize) stableReads += 1;
      else stableReads = 0;
      previousSize = info.size;
      if (stableReads >= 1) return;
    } catch (error) {
      lastError = error;
      stableReads = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError instanceof Error ? lastError : new Error("AI 생성 이미지 파일 저장이 완료되지 않았습니다.");
}
const validationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["hookAlignment", "productIdentity", "factualAccuracy", "koreanTextAccuracy", "readability", "composition", "diversity", "commercialQuality", "exportCompliance", "productVisibility", "humanNaturalness", "categoryFit", "foodAppetiteAppeal", "sensoryExpression", "mobileReadability", "observedKoreanText", "failures", "recommendation"],
  properties: {
    hookAlignment: { type: "integer", minimum: 0, maximum: 100 },
    productIdentity: { type: "integer", minimum: 0, maximum: 100 },
    factualAccuracy: { type: "integer", minimum: 0, maximum: 100 },
    koreanTextAccuracy: { type: "integer", minimum: 0, maximum: 100 },
    readability: { type: "integer", minimum: 0, maximum: 100 },
    composition: { type: "integer", minimum: 0, maximum: 100 },
    diversity: { type: "integer", minimum: 0, maximum: 100 },
    commercialQuality: { type: "integer", minimum: 0, maximum: 100 },
    exportCompliance: { type: "integer", minimum: 0, maximum: 100 },
    productVisibility: { type: "integer", minimum: 0, maximum: 100 },
    humanNaturalness: { type: "integer", minimum: 0, maximum: 100 },
    categoryFit: { type: "integer", minimum: 0, maximum: 100 },
    foodAppetiteAppeal: { type: "integer", minimum: 0, maximum: 100 },
    sensoryExpression: { type: "integer", minimum: 0, maximum: 100 },
    mobileReadability: { type: "integer", minimum: 0, maximum: 100 },
    observedKoreanText: { type: "array", items: { type: "string" } },
    failures: { type: "array", items: { type: "string" } },
    recommendation: { type: "string", enum: ["approve", "revise", "manual-review"] },
  },
};
const groupValidationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sceneDiversity", "productPlacementDiversity", "cameraDiversity", "colorMoodDiversity", "messageSeparation", "hookSceneAlignment", "typographyDiversity", "visualArchetypeDiversity", "categoryFit", "duplicatePairs", "reviseHookCodes", "failures", "recommendation"],
  properties: {
    sceneDiversity: { type: "integer", minimum: 0, maximum: 100 },
    productPlacementDiversity: { type: "integer", minimum: 0, maximum: 100 },
    cameraDiversity: { type: "integer", minimum: 0, maximum: 100 },
    colorMoodDiversity: { type: "integer", minimum: 0, maximum: 100 },
    messageSeparation: { type: "integer", minimum: 0, maximum: 100 },
    hookSceneAlignment: { type: "integer", minimum: 0, maximum: 100 },
    typographyDiversity: { type: "integer", minimum: 0, maximum: 100 },
    visualArchetypeDiversity: { type: "integer", minimum: 0, maximum: 100 },
    categoryFit: { type: "integer", minimum: 0, maximum: 100 },
    duplicatePairs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["leftHookCode", "rightHookCode", "reason"],
        properties: {
          leftHookCode: { type: "string", enum: ["H01", "H02", "H03", "H04", "H05", "H06"] },
          rightHookCode: { type: "string", enum: ["H01", "H02", "H03", "H04", "H05", "H06"] },
          reason: { type: "string" },
        },
      },
    },
    reviseHookCodes: {
      type: "array",
      items: { type: "string", enum: ["H01", "H02", "H03", "H04", "H05", "H06"] },
    },
    failures: { type: "array", items: { type: "string" } },
    recommendation: { type: "string", enum: ["approve", "revise", "manual-review"] },
  },
};

export class CodexLocalCreativeProvider implements CreativeGenerationProvider {
  readonly engine = "codex_local" as const;
  private codex = new Codex({
    env: codexLocalEnvironment(),
    codexPathOverride: resolveCodexLocalExecutable(),
  });
  private authenticated?: Promise<boolean>;

  async status(): Promise<ProviderStatus> {
    this.authenticated ??= codexLocalAuthenticated();
    const authenticated = await this.authenticated;
    return {
      engine: this.engine,
      available: authenticated,
      authenticated,
      paidApiUsed: false,
      detail: authenticated ? "로컬 Codex · ChatGPT 로그인 연결됨" : "Codex CLI를 찾지 못했거나 로컬 로그인이 필요합니다.",
    };
  }

  async openSession(): Promise<NativeCreativeSession> {
    const state = await this.status();
    if (!state.available) throw new Error(`codex_local 사용 불가: ${state.detail} 유료 API로 자동 전환하지 않았습니다.`);
    const runtime = resolveFastCreativeRuntime();
    let thread: Thread | undefined = this.codex.startThread({
      workingDirectory: process.cwd(),
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol",
      modelReasoningEffort: runtime.imageReasoning,
    });

    const activeThread = () => {
      if (!thread) throw new Error("이미 종료된 Codex 이미지 제작 세션입니다.");
      return thread;
    };

    const generate = async (input: NativeGenerationInput) => {
      const stage = input.stage || "copy-replacement";
      const productReferences = input.productReferencePaths || input.referencePaths;
      const stageSource = stage === "structure-recreation" ? input.adReferencePath || input.sourceImagePath : input.sourceImagePath;
      if (!stageSource) throw new Error(`${stage} 단계의 첫 번째 편집 소스가 없습니다.`);
      const attachments = [stageSource, ...(stage === "structure-recreation" ? [] : productReferences.slice(0, 4)), ...(stage === "structure-recreation" || !input.adReferencePath ? [] : [input.adReferencePath])].filter((file, index, files) => Boolean(file) && files.indexOf(file) === index).slice(0, 6);
      const prompt = buildNativeStagePrompt(stage, input.job, input.result, input.outputPath, input.feedback);
      const content = [{ type: "text" as const, text: prompt }, ...attachments.map((file) => ({ type: "local_image" as const, path: file }))];
      await creativeGate.run(() =>
        activeThread().run(content, {
          signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_IMAGE_TIMEOUT_MS || DEFAULT_IMAGE_GENERATION_TIMEOUT_MS)),
        })
      );
      // ImageGen 하위 작업이 최종 응답 직전에 파일을 복사·리사이즈할 수 있다.
      // 존재 여부만 한 번 확인하지 않고 크기가 안정된 완성 파일까지 기다린다.
      await waitForStableGeneratedOutput(input.outputPath);
      return { outputPath: input.outputPath };
    };

    const validate = async (input: NativeValidationInput) => {
      const validationReferences = [input.adReferencePath, ...input.referencePaths].filter((file, index, files): file is string => Boolean(file) && files.indexOf(file) === index).slice(0, 5);
      const content = [{ type: "text" as const, text: buildNativeValidationPrompt(input.job, input.result) }, { type: "local_image" as const, path: input.imagePath }, ...validationReferences.map((file) => ({ type: "local_image" as const, path: file }))];
      const response = await creativeGate.run(() =>
        activeThread().run(content, {
          outputSchema: validationSchema,
          signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_VALIDATION_TIMEOUT_MS || 150_000)),
        })
      );
      const parsed = JSON.parse(response.finalResponse) as Omit<NativeCreativeValidation, "checkedAt">;
      return normalizeNativeCreativeValidation(
        { ...parsed, checkedAt: new Date().toISOString() },
        {
          category: input.job.creativePlan.categoryCreativeProfile?.category || "general",
          exportComplianceVerified: input.exportComplianceVerified,
        }
      );
    };

    return {
      generate,
      validate,
      async close() {
        // The current SDK exposes no archive/delete API. Dropping the only
        // in-memory reference prevents accidental reuse after this H result.
        thread = undefined;
      },
    };
  }

  async validateGroup(input: { job: NativeGenerationInput["job"]; contactSheetPath: string }): Promise<NativeGroupValidation> {
    const state = await this.status();
    if (!state.available) throw new Error(`codex_local 사용 불가: ${state.detail}`);
    const groupThread = this.codex.startThread({
      workingDirectory: process.cwd(),
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol",
      modelReasoningEffort: "high",
    });
    const response = await creativeGate.run(() =>
      groupThread.run(
        [
          { type: "text" as const, text: buildNativeGroupValidationPrompt(input.job) },
          { type: "local_image" as const, path: input.contactSheetPath },
        ],
        {
          outputSchema: groupValidationSchema,
          signal: AbortSignal.timeout(Number(process.env.ADATLAS_CODEX_VALIDATION_TIMEOUT_MS || 150_000)),
        }
      )
    );
    return {
      ...(JSON.parse(response.finalResponse) as Omit<NativeGroupValidation, "checkedAt">),
      checkedAt: new Date().toISOString(),
    };
  }
}
