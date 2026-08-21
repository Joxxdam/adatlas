import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Codex } from "@openai/codex-sdk";
import type { VideoGenerationFailure, VideoGenerationStage } from "./types.ts";

const execFileAsync = promisify(execFile);
let authenticatedExecutablePromise: Promise<string> | undefined;

export class VideoPlanningGenerationError extends Error {
  readonly failure: VideoGenerationFailure;

  constructor(failure: VideoGenerationFailure, cause?: unknown) {
    super(failure.message, cause ? { cause } : undefined);
    this.name = "VideoPlanningGenerationError";
    this.failure = failure;
  }
}

function safeEnvironment() {
  const secretNames = new Set([
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "REMOVE_BG_API_KEY",
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(([key, value]) => value !== undefined && !secretNames.has(key))
  ) as Record<string, string>;
}

function codexExecutable() {
  const explicit = process.env.CODEX_CLI_PATH?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, process.platform === "win32" ? "codex.exe" : "codex");
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function assertAuthenticated() {
  if (authenticatedExecutablePromise) return authenticatedExecutablePromise;
  authenticatedExecutablePromise = (async () => {
  const executable = codexExecutable();
  if (!executable) throw new Error("로컬 Codex 실행 파일을 찾지 못했습니다.");
  const { stdout, stderr } = await execFileAsync(executable, ["login", "status"], {
    timeout: 10_000,
    env: safeEnvironment() as NodeJS.ProcessEnv,
  });
  if (!/logged in/i.test(`${stdout}\n${stderr}`)) {
    throw new Error("로컬 Codex 로그인이 필요합니다.");
  }
  return executable;
  })();
  try {
    return await authenticatedExecutablePromise;
  } catch (error) {
    authenticatedExecutablePromise = undefined;
    throw error;
  }
}

function safeMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "AI 응답을 받지 못했습니다.");
  return raw
    .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]+/g, "[비공개]")
    .replace(/(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s]+/g, "로컬 파일")
    .slice(0, 280);
}

function logStage(input: {
  stage: VideoGenerationStage;
  event: "start" | "retry" | "success" | "failure";
  attempt: number;
  durationMs?: number;
  code?: string;
}) {
  if (process.env.NODE_ENV === "production" && process.env.VIDEO_PLANNING_LOGS !== "true") return;
  console.info(
    `[video-planning] stage=${input.stage} event=${input.event} attempt=${input.attempt}` +
      (input.durationMs === undefined ? "" : ` durationMs=${input.durationMs}`) +
      (input.code ? ` code=${input.code}` : "")
  );
}

function failureCode(error: unknown) {
  const message = safeMessage(error).toLowerCase();
  if (/timeout|timed out|abort/.test(message)) return "AI_TIMEOUT";
  if (/json|parse|schema|validation/.test(message)) return "AI_SCHEMA_INVALID";
  if (/login|authenticated/.test(message)) return "AI_NOT_AUTHENTICATED";
  if (/model/.test(message)) return "AI_MODEL_INVALID";
  return "AI_GENERATION_FAILED";
}

export async function runVideoPlanningAi<T>(input: {
  stage: VideoGenerationStage;
  prompt: string;
  outputSchema: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<T> {
  const startedAt = Date.now();
  const maxAttempts = 3;
  let attempts = 0;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    logStage({ stage: input.stage, event: attempt === 1 ? "start" : "retry", attempt });
    try {
      const executable = await assertAuthenticated();
      const codex = new Codex({ env: safeEnvironment(), codexPathOverride: executable });
      const thread = codex.startThread({
        workingDirectory: process.cwd(),
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: false,
        model: process.env.VIDEO_PLANNING_CODEX_MODEL?.trim() ||
          process.env.ADATLAS_CODEX_MODEL?.trim() ||
          "gpt-5.6-sol",
        modelReasoningEffort: "high",
      });
      const response = await thread.run(input.prompt, {
        outputSchema: input.outputSchema,
        signal: AbortSignal.timeout(
          input.timeoutMs || Number(process.env.VIDEO_PLANNING_CODEX_TIMEOUT_MS || 180_000)
        ),
      });
      let parsed: T;
      try {
        parsed = JSON.parse(response.finalResponse) as T;
      } catch (error) {
        throw new Error(`JSON parsing failed: ${safeMessage(error)}`);
      }
      logStage({
        stage: input.stage,
        event: "success",
        attempt,
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
        durationMs: Date.now() - startedAt,
        code,
      });
      if (code === "AI_NOT_AUTHENTICATED" || code === "AI_MODEL_INVALID") break;
    }
  }
  const code = failureCode(lastError);
  throw new VideoPlanningGenerationError(
    {
      stage: input.stage,
      code,
      message: `AI 영상 기획 생성에 실패했습니다. ${safeMessage(lastError)}`,
      retryable: !["AI_NOT_AUTHENTICATED", "AI_MODEL_INVALID"].includes(code),
      attempts,
      failedAt: new Date().toISOString(),
    },
    lastError
  );
}
