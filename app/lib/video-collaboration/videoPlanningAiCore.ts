import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import type { VideoGenerationFailure, VideoGenerationStage } from "./types.ts";
import { assertStructuredVideoPlanningResponse } from "./structuredSchema.ts";

export type VideoPlanningProvider = "openai-api" | "codex-local";
export type VideoPlanningAiPurpose = "analysis" | "concept" | "script" | "correction" | "segment";
export type VideoPlanningReasoningEffort = "low" | "medium";

export type VideoPlanningAiInput = {
  stage: VideoGenerationStage;
  prompt: string;
  outputSchema: Record<string, unknown>;
  timeoutMs?: number;
  purpose?: VideoPlanningAiPurpose;
  reasoningEffort?: VideoPlanningReasoningEffort;
};

type OpenAiResponseLike = {
  status?: string;
  output_text?: string;
  error?: { message?: string } | null;
  incomplete_details?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } | null;
};

export type VideoPlanningResponsesClient = {
  responses: {
    create: (
      body: Record<string, unknown>,
      options?: Record<string, unknown>
    ) => Promise<OpenAiResponseLike>;
  };
};

type VideoPlanningEnvironment = Record<string, string | undefined>;

export class VideoPlanningGenerationError extends Error {
  readonly failure: VideoGenerationFailure;

  constructor(failure: VideoGenerationFailure, cause?: unknown) {
    super(failure.message, cause ? { cause } : undefined);
    this.name = "VideoPlanningGenerationError";
    this.failure = failure;
  }
}

class IncompleteStructuredOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncompleteStructuredOutputError";
  }
}

export function sanitizeVideoPlanningErrorMessage(error: unknown) {
  const raw =
    error instanceof Error ? error.message : String(error || "AI 응답을 받지 못했습니다.");
  return raw
    .replace(
      /incorrect api key provided:[\s\S]*?(?=(?:\.?\s*you can find your api key)|$)/gi,
      "OpenAI API 인증에 실패했습니다"
    )
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [비공개]")
    .replace(/sk-[A-Za-z0-9.*_-]+/gi, "[비공개]")
    .replace(/\[비공개\][A-Za-z0-9.*_-]{4,}/g, "[비공개]")
    .replace(/you can find your api key at\s+https?:\/\/[^\s]+/gi, "")
    .replace(/(?:\/Users|\/private|\/tmp|[A-Z]:\\)[^\s]+/g, "로컬 파일")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function safeMessage(error: unknown) {
  return sanitizeVideoPlanningErrorMessage(error);
}

export function videoPlanningFailureMessage(code: string, provider?: VideoPlanningProvider) {
  if (code === "VIDEO_PLANNING_API_KEY_MISSING") {
    return "영상 기획 API 키가 설정되지 않았습니다. 서버 환경변수를 확인해 주세요.";
  }
  if (code === "VIDEO_PLANNING_PAID_API_DISABLED") {
    return "유료 OpenAI API 사용이 비활성화되어 있습니다. 기본 로컬 Codex 방식으로 다시 시도해 주세요.";
  }
  if (code === "VIDEO_PLANNING_AUTH_ERROR") {
    return provider === "codex-local"
      ? "로컬 Codex 인증을 확인해 주세요. 터미널에서 Codex 로그인 상태를 다시 확인할 수 있습니다."
      : "영상 기획 API 인증에 실패했습니다. 서버의 API 키가 유효한지 확인해 주세요.";
  }
  if (code === "VIDEO_PLANNING_RATE_LIMITED") {
    return "영상 기획 요청이 일시적으로 많습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (code === "VIDEO_PLANNING_TIMEOUT") {
    return "영상 기획 응답 시간이 초과되었습니다. 입력 내용은 유지되었으니 다시 시도해 주세요.";
  }
  if (code === "VIDEO_PLANNING_INVALID_RESPONSE") {
    return "영상 기획 응답 형식을 확인하지 못했습니다. 입력 내용은 유지되었으니 다시 시도해 주세요.";
  }
  return "영상 기획 AI 호출에 실패했습니다. 서버 로그의 오류 코드로 설정을 확인해 주세요.";
}

function purposeFor(input: VideoPlanningAiInput): VideoPlanningAiPurpose {
  if (input.purpose) return input.purpose;
  if (input.stage === "concept-summaries") return "concept";
  if (input.stage === "detailed-script") return "script";
  if (input.stage === "automatic-revision" || input.stage === "quality-review") return "correction";
  return "analysis";
}

function timeoutFromEnvironment(value: string | undefined, fallback: number, variableName: string) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new VideoPlanningGenerationError({
      stage: "product-analysis",
      code: "VIDEO_PLANNING_MODEL_ERROR",
      message: `${variableName}은 0보다 큰 밀리초 숫자여야 합니다.`,
      retryable: false,
      attempts: 0,
      failedAt: new Date().toISOString(),
    });
  }
  return parsed;
}

export function resolveVideoPlanningProvider(env: VideoPlanningEnvironment = process.env) {
  const raw = env.VIDEO_PLANNING_PROVIDER?.trim() || "codex-local";
  if (raw === "codex-local") return raw;
  if (raw === "openai-api") {
    if (env.ADATLAS_PAID_API_EXPLICIT_ENABLED?.trim().toLowerCase() !== "true") {
      throw new VideoPlanningGenerationError({
        stage: "product-analysis",
        code: "VIDEO_PLANNING_PAID_API_DISABLED",
        message: videoPlanningFailureMessage("VIDEO_PLANNING_PAID_API_DISABLED", raw),
        retryable: false,
        attempts: 0,
        failedAt: new Date().toISOString(),
      });
    }
    return raw;
  }
  throw new VideoPlanningGenerationError({
    stage: "product-analysis",
    code: "VIDEO_PLANNING_MODEL_ERROR",
    message: "VIDEO_PLANNING_PROVIDER는 openai-api 또는 codex-local이어야 합니다.",
    retryable: false,
    attempts: 0,
    failedAt: new Date().toISOString(),
  });
}

export function resolveVideoPlanningStageConfig(
  input: VideoPlanningAiInput,
  env: VideoPlanningEnvironment = process.env
) {
  const purpose = purposeFor(input);
  const analysisModel = env.VIDEO_PLANNING_ANALYSIS_MODEL?.trim() || "gpt-5.6-luna";
  const conceptModel = env.VIDEO_PLANNING_CONCEPT_MODEL?.trim() || "gpt-5.6-terra";
  const scriptModel = env.VIDEO_PLANNING_SCRIPT_MODEL?.trim() || "gpt-5.6-terra";
  if (purpose === "analysis") {
    return {
      purpose,
      model: analysisModel,
      effort: input.reasoningEffort || ("low" as VideoPlanningReasoningEffort),
      timeoutMs:
        input.timeoutMs ||
        timeoutFromEnvironment(
          env.VIDEO_PLANNING_ANALYSIS_TIMEOUT_MS,
          45_000,
          "VIDEO_PLANNING_ANALYSIS_TIMEOUT_MS"
        ),
    };
  }
  if (purpose === "concept") {
    return {
      purpose,
      model: conceptModel,
      effort: input.reasoningEffort || ("low" as VideoPlanningReasoningEffort),
      timeoutMs:
        input.timeoutMs ||
        timeoutFromEnvironment(
          env.VIDEO_PLANNING_CONCEPT_TIMEOUT_MS,
          60_000,
          "VIDEO_PLANNING_CONCEPT_TIMEOUT_MS"
        ),
    };
  }
  return {
    purpose,
    model: scriptModel,
    effort:
      input.reasoningEffort ||
      ((purpose === "script" ? "medium" : "low") as VideoPlanningReasoningEffort),
    timeoutMs:
      input.timeoutMs ||
      timeoutFromEnvironment(
        env.VIDEO_PLANNING_SCRIPT_TIMEOUT_MS,
        90_000,
        "VIDEO_PLANNING_SCRIPT_TIMEOUT_MS"
      ),
  };
}

function failureInfo(error: unknown) {
  const apiError = error instanceof APIError ? error : undefined;
  const status =
    apiError?.status ||
    (typeof error === "object" && error && "status" in error && typeof error.status === "number"
      ? error.status
      : undefined);
  const apiCode = apiError?.code || "";
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError ||
    status === 401 ||
    status === 403
  ) {
    return { code: "VIDEO_PLANNING_AUTH_ERROR", retryable: false };
  }
  if (error instanceof RateLimitError || status === 429) {
    return { code: "VIDEO_PLANNING_RATE_LIMITED", retryable: true };
  }
  if (
    error instanceof APIConnectionTimeoutError ||
    /timeout|timed out|abort/i.test(safeMessage(error))
  ) {
    return { code: "VIDEO_PLANNING_TIMEOUT", retryable: true };
  }
  if (
    error instanceof IncompleteStructuredOutputError ||
    /json parsing|schema validation|incomplete structured/i.test(safeMessage(error))
  ) {
    return { code: "VIDEO_PLANNING_INVALID_RESPONSE", retryable: true };
  }
  if (
    status === 404 ||
    /model.*not.*found|invalid.*model/i.test(`${apiCode} ${safeMessage(error)}`)
  ) {
    return { code: "VIDEO_PLANNING_MODEL_ERROR", retryable: false };
  }
  if (error instanceof APIConnectionError || (typeof status === "number" && status >= 500)) {
    return { code: "VIDEO_PLANNING_MODEL_ERROR", retryable: true };
  }
  return { code: "VIDEO_PLANNING_MODEL_ERROR", retryable: false };
}

function logCall(
  input: {
    stage: VideoGenerationStage;
    provider: VideoPlanningProvider;
    model: string;
    effort: string;
    startedAt: string;
    endedAt?: string;
    durationMs?: number;
    attempt: number;
    success?: boolean;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    errorCode?: string;
  },
  logger: (message: string) => void
) {
  logger(
    `[video-planning-ai] ${Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${typeof value === "object" ? JSON.stringify(value) : value}`)
      .join(" ")}`
  );
}

export function createOpenAiVideoPlanningRunner(
  options: {
    env?: VideoPlanningEnvironment;
    client?: VideoPlanningResponsesClient;
    logger?: (message: string) => void;
  } = {}
) {
  const env = options.env || process.env;
  const logger = options.logger || console.info;
  let sharedClient = options.client;
  return async function runOpenAiVideoPlanning<T>(input: VideoPlanningAiInput): Promise<T> {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new VideoPlanningGenerationError({
        stage: input.stage,
        code: "VIDEO_PLANNING_API_KEY_MISSING",
        message: "영상기획용 OPENAI_API_KEY가 설정되지 않았습니다.",
        retryable: false,
        attempts: 0,
        failedAt: new Date().toISOString(),
      });
    }
    const config = resolveVideoPlanningStageConfig(input, env);
    sharedClient ||= new OpenAI({
      apiKey,
      maxRetries: 0,
    }) as unknown as VideoPlanningResponsesClient;
    const client = sharedClient;
    let lastError: unknown;
    let attempts = 0;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      attempts = attempt;
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      logCall(
        {
          stage: input.stage,
          provider: "openai-api",
          model: config.model,
          effort: config.effort,
          startedAt,
          attempt,
        },
        logger
      );
      try {
        const response = await client.responses.create(
          {
            model: config.model,
            input: input.prompt,
            store: false,
            tools: [],
            reasoning: { effort: config.effort },
            text: {
              format: {
                type: "json_schema",
                name: `video_planning_${input.stage.replace(/[^a-z0-9]+/gi, "_")}`.slice(0, 64),
                strict: true,
                schema: input.outputSchema,
              },
            },
          },
          { timeout: config.timeoutMs, maxRetries: 0 }
        );
        if (response.status && response.status !== "completed") {
          throw new IncompleteStructuredOutputError(
            `Incomplete structured output: ${response.status} ${JSON.stringify(response.incomplete_details || response.error || {})}`
          );
        }
        if (!response.output_text?.trim())
          throw new IncompleteStructuredOutputError("Incomplete structured output: empty output");
        let parsed: T;
        try {
          parsed = JSON.parse(response.output_text) as T;
        } catch (error) {
          throw new IncompleteStructuredOutputError(`JSON parsing failed: ${safeMessage(error)}`);
        }
        try {
          assertStructuredVideoPlanningResponse(parsed, input.outputSchema);
        } catch (error) {
          throw new IncompleteStructuredOutputError(safeMessage(error));
        }
        logCall(
          {
            stage: input.stage,
            provider: "openai-api",
            model: config.model,
            effort: config.effort,
            startedAt,
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - startedMs,
            attempt,
            success: true,
            inputTokens: response.usage?.input_tokens,
            outputTokens: response.usage?.output_tokens,
            totalTokens: response.usage?.total_tokens,
          },
          logger
        );
        return parsed;
      } catch (error) {
        lastError = error;
        const info = failureInfo(error);
        logCall(
          {
            stage: input.stage,
            provider: "openai-api",
            model: config.model,
            effort: config.effort,
            startedAt,
            endedAt: new Date().toISOString(),
            durationMs: Date.now() - startedMs,
            attempt,
            success: false,
            errorCode: info.code,
          },
          logger
        );
        if (!info.retryable || attempt === 2) break;
      }
    }
    const info = failureInfo(lastError);
    throw new VideoPlanningGenerationError(
      {
        stage: input.stage,
        code: info.code,
        message: videoPlanningFailureMessage(info.code, "openai-api"),
        retryable: info.retryable,
        attempts,
        failedAt: new Date().toISOString(),
      },
      lastError
    );
  };
}

export function videoPlanningFailureHttpStatus(code: string) {
  if (code === "GENERATION_ALREADY_RUNNING") return 409;
  if (code === "VIDEO_PLANNING_RATE_LIMITED") return 429;
  if (code === "VIDEO_PLANNING_TIMEOUT") return 504;
  if (
    code === "VIDEO_PLANNING_API_KEY_MISSING" ||
    code === "VIDEO_PLANNING_AUTH_ERROR" ||
    code === "VIDEO_PLANNING_PAID_API_DISABLED"
  ) return 503;
  if (code === "VIDEO_PLANNING_MODEL_ERROR") return 502;
  return 422;
}
