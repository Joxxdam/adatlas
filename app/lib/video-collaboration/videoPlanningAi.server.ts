import "server-only";

import { Codex } from "@openai/codex-sdk";
import { codexLocalEnvironment, requireFreshCodexLocalChatGptLogin } from "../creative-generation/codexLocalRuntime.server";
import type { VideoGenerationStage } from "./types.ts";
import { assertStructuredVideoPlanningResponse } from "./structuredSchema.ts";
import { createOpenAiVideoPlanningRunner, resolveVideoPlanningProvider, resolveVideoPlanningStageConfig, sanitizeVideoPlanningErrorMessage, videoPlanningFailureMessage, VideoPlanningGenerationError, type VideoPlanningAiInput } from "./videoPlanningAiCore.ts";

export { sanitizeVideoPlanningErrorMessage, VideoPlanningGenerationError, videoPlanningFailureHttpStatus } from "./videoPlanningAiCore.ts";

function safeMessage(error: unknown) {
  return sanitizeVideoPlanningErrorMessage(error);
}

function logStage(input: { stage: VideoGenerationStage; event: "start" | "retry" | "success" | "failure"; attempt: number; model: string; effort: string; startedAt: string; endedAt?: string; durationMs?: number; code?: string }) {
  if (process.env.NODE_ENV === "production" && process.env.VIDEO_PLANNING_LOGS !== "true") return;
  console.info(`[video-planning-ai] stage=${input.stage} provider=codex-local model=${input.model} effort=${input.effort}` + ` startedAt=${input.startedAt}` + (input.endedAt ? ` endedAt=${input.endedAt}` : "") + ` event=${input.event} attempt=${input.attempt}` + (input.durationMs === undefined ? "" : ` durationMs=${input.durationMs}`) + (input.code ? ` code=${input.code}` : ""));
}

function failureCode(error: unknown) {
  const message = safeMessage(error).toLowerCase();
  if (/timeout|timed out|abort/.test(message)) return "VIDEO_PLANNING_TIMEOUT";
  if (/json|parse|schema|validation/.test(message)) return "VIDEO_PLANNING_INVALID_RESPONSE";
  if (/login|authenticated|로그인|실행 파일/.test(message)) return "VIDEO_PLANNING_AUTH_ERROR";
  return "VIDEO_PLANNING_MODEL_ERROR";
}

async function runCodexVideoPlanningAi<T>(input: VideoPlanningAiInput): Promise<T> {
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  const maxAttempts = 2;
  let attempts = 0;
  let lastError: unknown;
  const config = resolveVideoPlanningStageConfig(input);
  const model = process.env.VIDEO_PLANNING_CODEX_MODEL?.trim() || process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    logStage({
      stage: input.stage,
      event: attempt === 1 ? "start" : "retry",
      attempt,
      model,
      effort: config.effort,
      startedAt: startedIso,
    });
    try {
      const executable = await requireFreshCodexLocalChatGptLogin();
      const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: executable });
      const thread = codex.startThread({
        workingDirectory: process.cwd(),
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        model,
        modelReasoningEffort: config.effort,
      });
      const response = await thread.run(input.prompt, {
        outputSchema: input.outputSchema,
        signal: AbortSignal.timeout(input.timeoutMs || Number(process.env.VIDEO_PLANNING_CODEX_TIMEOUT_MS || 180_000)),
      });
      let parsed: T;
      try {
        parsed = JSON.parse(response.finalResponse) as T;
      } catch (error) {
        throw new Error(`JSON parsing failed: ${safeMessage(error)}`);
      }
      assertStructuredVideoPlanningResponse(parsed, input.outputSchema);
      logStage({
        stage: input.stage,
        event: "success",
        attempt,
        model,
        effort: config.effort,
        startedAt: startedIso,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
      });
      return parsed;
    } catch (error) {
      lastError = error;
      const code = failureCode(error);
      logStage({
        stage: input.stage,
        event: attempt === maxAttempts ? "failure" : "retry",
        attempt,
        model,
        effort: config.effort,
        startedAt: startedIso,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        code,
      });
      if (code === "VIDEO_PLANNING_AUTH_ERROR") break;
    }
  }
  const code = failureCode(lastError);
  throw new VideoPlanningGenerationError(
    {
      stage: input.stage,
      code,
      message: videoPlanningFailureMessage(code, "codex-local"),
      retryable: code !== "VIDEO_PLANNING_AUTH_ERROR",
      attempts,
      failedAt: new Date().toISOString(),
    },
    lastError
  );
}

const runOpenAiVideoPlanning = createOpenAiVideoPlanningRunner();

export function getVideoPlanningProvider() {
  return resolveVideoPlanningProvider();
}

export async function runVideoPlanningAi<T>(input: VideoPlanningAiInput): Promise<T> {
  const provider = resolveVideoPlanningProvider();
  if (provider === "codex-local") return runCodexVideoPlanningAi<T>(input);
  return runOpenAiVideoPlanning<T>(input);
}
