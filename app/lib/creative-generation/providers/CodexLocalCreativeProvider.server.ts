import "server-only";
import { readFile, stat } from "node:fs/promises";
import { Codex, type Input, type Thread, type TurnOptions } from "@openai/codex-sdk";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "../codexLocalRuntime.server.ts";
import { buildNativeGroupValidationPrompt, buildNativeStagePrompt, buildNativeValidationPrompt, nativeReferenceRequiresComparisonSemantics, nativeReferenceRequiresHumanReplacement, nativeReferenceRequiresSourceBrandRegionClear } from "../nativeCreativePrompt.ts";
import type { NativeCreativeValidation, NativeGroupValidation } from "../types.ts";
import type { CreativeGenerationProvider, NativeCreativeSession, NativeGenerationInput, NativeValidationInput, ProviderStatus } from "./CreativeGenerationProvider.ts";
import { resolveFastCreativeRuntime } from "../fastCreativeRuntime";
import { codexCreativeGate } from "../asyncConcurrencyGate";
import { resolveRuntimeTimeout } from "../fastCreativeRuntime";
import { normalizeNativeCreativeValidation } from "../nativeCreativeValidation";

const DEFAULT_IMAGE_GENERATION_IDLE_TIMEOUT_MS = 12 * 60 * 1000;

type StreamedTurnResult = {
  finalResponse: string;
};

/**
 * Codex image turns can legitimately take longer than the configured limit
 * while still making progress through tool calls and file writes. A single
 * AbortSignal.timeout() measures the whole turn and can therefore kill a turn
 * after its output file has already been written. Keep the same safety bound,
 * but apply it only when the event stream has been completely idle.
 */
async function runThreadWithIdleTimeout(
  thread: Thread,
  input: Input,
  options: Omit<TurnOptions, "signal">,
  idleTimeoutMs: number
): Promise<StreamedTurnResult> {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimedOut = false;
  let finalResponse = "";
  let completed = false;
  let lastStreamError = "";

  const armIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };

  armIdleTimer();
  try {
    const { events } = await thread.runStreamed(input, { ...options, signal: controller.signal });
    for await (const event of events) {
      armIdleTimer();
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        finalResponse = event.item.text;
      } else if (event.type === "turn.failed") {
        throw new Error(event.error.message);
      } else if (event.type === "error") {
        // Codex emits recoverable transport notices such as "Reconnecting
        // 2/5" as error events. Match the SDK's run() behavior: keep waiting
        // for turn.completed or turn.failed while the idle watchdog remains
        // the final protection against a permanently stalled stream.
        lastStreamError = event.message;
      } else if (event.type === "turn.completed") {
        completed = true;
      }
    }
    if (!completed) throw new Error(lastStreamError || "Codex 작업이 완료 이벤트 없이 종료되었습니다.");
    return { finalResponse };
  } catch (error) {
    if (!idleTimedOut) throw error;
    const timeoutError = new Error(`Codex 작업이 ${Math.round(idleTimeoutMs / 1000)}초 동안 진행 이벤트 없이 멈춰 중단되었습니다.`);
    timeoutError.name = "TimeoutError";
    throw timeoutError;
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }
}

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
  required: ["hookAlignment", "productIdentity", "factualAccuracy", "koreanTextAccuracy", "readability", "composition", "diversity", "commercialQuality", "exportCompliance", "productVisibility", "humanNaturalness", "categoryFit", "foodAppetiteAppeal", "sensoryExpression", "mobileReadability", "observedKoreanText", "standaloneLogoDetected", "standaloneLogoFindings", "sourcePersonDetected", "sourcePersonReplaced", "humanCompositionChanged", "humanSceneBackgroundRebuilt", "humanSceneBackgroundFindings", "targetAudienceFit", "humanReplacementFindings", "humanCopyAligned", "humanCopyAlignmentFindings", "sourceAnimalDetected", "sourceAnimalReplaced", "animalReplacementFindings", "sourceContextualBackgroundDetected", "contextualBackgroundRebuilt", "contextualBackgroundFindings", "sceneProductInteractionAligned", "sceneProductInteractionFindings", "unrelatedFoodOrIngredientDetected", "unrelatedFoodOrIngredientFindings", "sourceBrandRegionCleared", "sourceBrandRegionFindings", "comparisonSemanticAligned", "comparisonSemanticFindings", "failures", "recommendation"],
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
    standaloneLogoDetected: { type: "boolean" },
    standaloneLogoFindings: { type: "array", items: { type: "string" } },
    sourcePersonDetected: { type: "boolean" },
    sourcePersonReplaced: { type: "boolean" },
    humanCompositionChanged: { type: "boolean" },
    humanSceneBackgroundRebuilt: { type: "boolean" },
    humanSceneBackgroundFindings: { type: "array", items: { type: "string" } },
    targetAudienceFit: { type: "integer", minimum: 0, maximum: 100 },
    humanReplacementFindings: { type: "array", items: { type: "string" } },
    humanCopyAligned: { type: "boolean" },
    humanCopyAlignmentFindings: { type: "array", items: { type: "string" } },
    sourceAnimalDetected: { type: "boolean" },
    sourceAnimalReplaced: { type: "boolean" },
    animalReplacementFindings: { type: "array", items: { type: "string" } },
    sourceContextualBackgroundDetected: { type: "boolean" },
    contextualBackgroundRebuilt: { type: "boolean" },
    contextualBackgroundFindings: { type: "array", items: { type: "string" } },
    sceneProductInteractionAligned: { type: "boolean" },
    sceneProductInteractionFindings: { type: "array", items: { type: "string" } },
    unrelatedFoodOrIngredientDetected: { type: "boolean" },
    unrelatedFoodOrIngredientFindings: { type: "array", items: { type: "string" } },
    sourceBrandRegionCleared: { type: "boolean" },
    sourceBrandRegionFindings: { type: "array", items: { type: "string" } },
    comparisonSemanticAligned: { type: "boolean" },
    comparisonSemanticFindings: { type: "array", items: { type: "string" } },
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

  async status(): Promise<ProviderStatus> {
    // Do not keep a positive/negative login result across a CLI account switch.
    const authenticated = await codexLocalAuthenticated({ force: true });
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
    const codex = new Codex({
      env: codexLocalEnvironment(),
      codexPathOverride: resolveCodexLocalExecutable(),
    });
    const runtime = resolveFastCreativeRuntime();
    let thread: Thread | undefined = codex.startThread({
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
      await codexCreativeGate.run(() =>
        runThreadWithIdleTimeout(
          activeThread(),
          content,
          {},
          resolveRuntimeTimeout(process.env.ADATLAS_CODEX_IMAGE_TIMEOUT_MS, DEFAULT_IMAGE_GENERATION_IDLE_TIMEOUT_MS, 60_000)
        )
      );
      // ImageGen 하위 작업이 최종 응답 직전에 파일을 복사·리사이즈할 수 있다.
      // 존재 여부만 한 번 확인하지 않고 크기가 안정된 완성 파일까지 기다린다.
      await waitForStableGeneratedOutput(input.outputPath);
      return { outputPath: input.outputPath };
    };

    const validate = async (input: NativeValidationInput) => {
      const validationReferences = [input.adReferencePath, ...input.referencePaths].filter((file, index, files): file is string => Boolean(file) && files.indexOf(file) === index).slice(0, 5);
      const content = [{ type: "text" as const, text: buildNativeValidationPrompt(input.job, input.result) }, { type: "local_image" as const, path: input.imagePath }, ...validationReferences.map((file) => ({ type: "local_image" as const, path: file }))];
      const response = await codexCreativeGate.run(() =>
        runThreadWithIdleTimeout(
          activeThread(),
          content,
          { outputSchema: validationSchema },
          resolveRuntimeTimeout(process.env.ADATLAS_CODEX_VALIDATION_TIMEOUT_MS, 150_000, 30_000)
        )
      );
      const parsed = JSON.parse(response.finalResponse) as Omit<NativeCreativeValidation, "checkedAt">;
      return normalizeNativeCreativeValidation(
        { ...parsed, checkedAt: new Date().toISOString() },
        {
          category: input.job.creativePlan.categoryCreativeProfile?.category || "general",
          exportComplianceVerified: input.exportComplianceVerified,
          requiresHumanReplacement: nativeReferenceRequiresHumanReplacement(input.result),
          requiresHumanSceneBackgroundRebuild: nativeReferenceRequiresHumanReplacement(input.result),
          requiresSourceBrandRegionClear: nativeReferenceRequiresSourceBrandRegionClear(input.result),
          requiresComparisonSemanticAlignment: nativeReferenceRequiresComparisonSemantics(input.result),
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
    const codex = new Codex({
      env: codexLocalEnvironment(),
      codexPathOverride: resolveCodexLocalExecutable(),
    });
    const groupThread = codex.startThread({
      workingDirectory: process.cwd(),
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: false,
      model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol",
      modelReasoningEffort: "high",
    });
    const response = await codexCreativeGate.run(() =>
      runThreadWithIdleTimeout(
        groupThread,
        [
          { type: "text" as const, text: buildNativeGroupValidationPrompt(input.job) },
          { type: "local_image" as const, path: input.contactSheetPath },
        ],
        { outputSchema: groupValidationSchema },
        resolveRuntimeTimeout(process.env.ADATLAS_CODEX_VALIDATION_TIMEOUT_MS, 150_000, 30_000)
      )
    );
    return {
      ...(JSON.parse(response.finalResponse) as Omit<NativeGroupValidation, "checkedAt">),
      checkedAt: new Date().toISOString(),
    };
  }
}
