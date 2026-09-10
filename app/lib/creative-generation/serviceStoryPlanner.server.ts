import "server-only";

import { Codex, type Input } from "@openai/codex-sdk";
import { creativeGenerationJobStore } from "./jobStore.server";
import { writeNativeManifest } from "./nativeCreativeStorage.server";
import { codexLocalAuthenticated, codexLocalEnvironment, resolveCodexLocalExecutable } from "./codexLocalRuntime.server";
import { closeCodexImageSession, trackCodexImageSession } from "./codexImageSessionRetention.server";
import { buildServiceAnalysisCodexContext, SITE_STORY_SEQUENTIAL_WORKFLOW_VERSION } from "./codexDirectTest";
import { resolveFastCreativeRuntime, resolveRuntimeTimeout } from "./fastCreativeRuntime";
import type { NativeCreativeSession } from "./providers/CreativeGenerationProvider";
import type { GenerationJob, ServiceStoryPlan, ServiceStorySlidePlan } from "./types";

const STORY_SLIDE_COUNT = 6;
const DEFAULT_STORY_PLANNING_TIMEOUT_MS = 5 * 60 * 1000;

export const storyPlanningSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "narrativeArc", "visualContinuity", "slides"],
  properties: {
    title: { type: "string" },
    narrativeArc: { type: "string" },
    visualContinuity: { type: "string" },
    slides: {
      type: "array",
      minItems: STORY_SLIDE_COUNT,
      maxItems: STORY_SLIDE_COUNT,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["order", "purpose", "keyMessage", "visualDirection", "transition"],
        properties: {
          order: { type: "integer", minimum: 1, maximum: STORY_SLIDE_COUNT },
          purpose: { type: "string" },
          keyMessage: { type: "string" },
          visualDirection: { type: "string" },
          transition: { type: "string" },
        },
      },
    },
  },
} as const;

function compact(value: unknown, max: number) {
  const normalized = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  return normalized.slice(0, max);
}

function validStorySlides(value: unknown): ServiceStorySlidePlan[] | undefined {
  if (!Array.isArray(value) || value.length !== STORY_SLIDE_COUNT) return undefined;
  const slides = value.map((candidate, index) => {
    const item = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
    return {
      order: index + 1,
      purpose: compact(item.purpose, 300),
      keyMessage: compact(item.keyMessage, 420),
      visualDirection: compact(item.visualDirection, 500),
      transition: compact(item.transition, 300),
    };
  });
  return slides.every((slide) => slide.purpose && slide.keyMessage && slide.visualDirection) ? slides : undefined;
}

function serviceAnalysisContext(job: GenerationJob) {
  const analysis = job.productTruth.product.siteAnalysis;
  return buildServiceAnalysisCodexContext({
    siteName: analysis?.siteName,
    oneLineSummary: analysis?.oneLineSummary,
    businessModel: analysis?.businessModel,
    offerings: analysis?.offerings,
    coreValueProps: analysis?.coreValueProps,
    customerProblems: analysis?.customerProblems,
    differentiators: analysis?.differentiators,
    trustSignals: analysis?.trustSignals,
    conversionOffers: analysis?.conversionOffers,
    targetPriorities: analysis?.targetPriorities,
    adDirections: analysis?.adDirections,
    cautions: analysis?.cautions,
    selectedVisuals: job.productTruth.product.siteVisualSelections,
  });
}

export function fallbackStoryPlan(job: GenerationJob, error?: string): ServiceStoryPlan {
  const analysis = job.productTruth.product.siteAnalysis;
  const serviceName = compact(analysis?.siteName || job.productTruth.product.productName || "분석한 서비스", 120);
  const problem = compact(analysis?.customerProblems?.[0] || analysis?.targetPriorities?.[0]?.painPoint || "고객이 겪는 불편", 220);
  const value = compact(analysis?.coreValueProps?.[0] || analysis?.oneLineSummary || "서비스가 제공하는 핵심 가치", 240);
  const offering = compact(analysis?.offerings?.slice(0, 3).join(" · ") || analysis?.businessModel || "서비스 이용 방법", 260);
  const difference = compact(analysis?.differentiators?.[0] || analysis?.trustSignals?.[0] || "선택할 이유", 240);
  const conversion = compact(analysis?.conversionOffers?.[0] || "지금 서비스 확인하기", 220);
  const messages = [
    ["고객 문제를 한눈에 보여주는 시작", problem],
    ["문제가 이어지는 실제 상황과 공감", `${problem}이 반복되는 상황을 구체적으로 보여주기`],
    ["분석한 서비스의 등장과 해결 약속", `${serviceName}, ${value}`],
    ["핵심 기능과 이용 흐름 설명", offering],
    ["차별점과 신뢰 근거 제시", difference],
    ["해결된 모습과 행동 유도", conversion],
  ];
  return {
    status: "ready",
    provider: "fallback",
    title: `${serviceName} 6장 스토리`,
    narrativeArc: "고객 문제 인식 → 공감 → 서비스 등장 → 이용 방법 → 선택 근거 → 행동 유도",
    visualContinuity: "한 장의 레퍼런스 구도와 분석한 서비스의 색감·시각 언어를 6장에 일관되게 이어갑니다.",
    slides: messages.map(([purpose, keyMessage], index) => ({
      order: index + 1,
      purpose,
      keyMessage,
      visualDirection: `${index + 1}장의 역할이 즉시 보이도록 핵심 장면과 짧은 문구를 배치하고, 앞뒤 장과 같은 색감과 시각 요소를 유지`,
      transition: index === STORY_SLIDE_COUNT - 1 ? "마지막 CTA로 마무리" : `${index + 2}장의 내용이 궁금해지도록 자연스럽게 연결`,
    })),
    attempts: 1,
    error: error ? compact(error, 500) : undefined,
    updatedAt: new Date().toISOString(),
  };
}

export function storyPlanningPrompt(job: GenerationJob) {
  return [
    "분석한 서비스의 광고용 연속 슬라이드 6장을 먼저 하나의 스토리로 기획하세요.",
    "아직 이미지를 생성하지 마세요. 1장부터 6장까지 순서대로 읽었을 때 서비스가 쉽게 이해되어야 합니다.",
    "첨부한 광고 레퍼런스 한 장은 여섯 장 전체의 공통 구도·문구 뉘앙스 기준입니다. 원문은 복사하지 말고 변형하세요.",
    "선택한 로고·마스코트·기능 이미지는 공통 시각 자산이며 필요할 때만 사용하세요.",
    "각 장마다 역할, 핵심 메시지, 구체적인 화면 방향, 다음 장 연결을 작성하고 정확히 6개를 JSON으로 반환하세요.",
    serviceAnalysisContext(job),
  ].join("\n\n");
}

function storyContinuationPrompt(job: GenerationJob) {
  return [
    "이 작업은 서버 재시작 뒤 같은 스토리 제작을 이어가는 복구 turn입니다.",
    "아래에 이미 확정되어 앞 슬라이드 제작에 사용된 6장 기획을 변경하지 말고 그대로 이해하세요.",
    "아직 이미지를 생성하지 말고, 동일한 기획을 JSON 스키마에 맞춰 그대로 반환하세요. 다음 turn부터 남은 슬라이드를 순서대로 제작합니다.",
    serviceAnalysisContext(job),
    `[확정된 6장 스토리 기획]\n${JSON.stringify(job.serviceStoryPlan)}`,
  ].join("\n\n");
}

export function parseServiceStoryPlanResponse(finalResponse: string, attempts = 1): ServiceStoryPlan {
  const payload = JSON.parse(finalResponse) as Record<string, unknown>;
  const slides = validStorySlides(payload.slides);
  if (!slides) throw new Error("스토리 기획 결과가 6장 형식에 맞지 않습니다.");
  return {
    status: "ready",
    provider: "codex-local",
    title: compact(payload.title, 220),
    narrativeArc: compact(payload.narrativeArc, 700),
    visualContinuity: compact(payload.visualContinuity, 700),
    slides,
    attempts,
    updatedAt: new Date().toISOString(),
  };
}

async function createCodexStoryPlan(job: GenerationJob): Promise<ServiceStoryPlan> {
  if (!(await codexLocalAuthenticated({ force: true }))) throw new Error("로컬 Codex 로그인이 없습니다.");
  const executable = resolveCodexLocalExecutable();
  if (!executable) throw new Error("로컬 Codex 실행 파일을 찾지 못했습니다.");
  const referencePath = job.results[0]?.nativeCreative?.adReference?.path;
  if (!referencePath) throw new Error("스토리 공통 레퍼런스를 읽을 수 없습니다.");
  const codex = new Codex({ env: codexLocalEnvironment(), codexPathOverride: executable });
  const runtime = resolveFastCreativeRuntime();
  const thread = codex.startThread({
    workingDirectory: process.cwd(),
    sandboxMode: "read-only",
    approvalPolicy: "never",
    networkAccessEnabled: false,
    model: process.env.ADATLAS_CODEX_MODEL?.trim() || "gpt-5.6-sol",
    modelReasoningEffort: runtime.plannerReasoning,
  });
  const content: Input = [
    { type: "text", text: storyPlanningPrompt(job) },
    { type: "local_image", path: referencePath },
  ];
  try {
    const response = await thread.run(content, {
      outputSchema: storyPlanningSchema,
      signal: AbortSignal.timeout(resolveRuntimeTimeout(
        process.env.ADATLAS_CODEX_SERVICE_STORY_TIMEOUT_MS,
        DEFAULT_STORY_PLANNING_TIMEOUT_MS,
        30_000
      )),
    });
    return parseServiceStoryPlanResponse(response.finalResponse);
  } finally {
    const threadId = thread.id;
    if (threadId) {
      await trackCodexImageSession({
        threadId,
        jobId: job.id,
        resultId: "service-story-plan",
        purpose: "service-story-planning",
      }).catch(() => undefined);
      await closeCodexImageSession(threadId).catch(() => undefined);
    }
  }
}

export function isServiceStoryGenerationJob(job: GenerationJob) {
  return job.productTruth.product.analysisMode === "site"
    && job.codexDirectTest?.serviceCreativeMode === "story";
}

/** 신규 전용 버튼으로 만든 작업만 하나의 Codex 세션에서 기획과 6장 생성을 이어갑니다. */
export function isSequentialServiceStoryGenerationJob(job: GenerationJob) {
  return isServiceStoryGenerationJob(job)
    && job.codexDirectTest?.serviceStoryWorkflowVersion === SITE_STORY_SEQUENTIAL_WORKFLOW_VERSION;
}

export async function ensureServiceStoryPlanInSession(jobId: string, session: NativeCreativeSession) {
  const initial = await creativeGenerationJobStore.get(jobId);
  if (!initial || !isSequentialServiceStoryGenerationJob(initial)) return initial;
  if (!session.planServiceStory) throw new Error("스토리형 단일 세션 기획을 지원하지 않는 생성기입니다.");
  const referencePath = initial.results[0]?.nativeCreative?.adReference?.path;
  if (!referencePath) throw new Error("스토리 공통 레퍼런스를 읽을 수 없습니다.");
  const hasReadyPlan = initial.serviceStoryPlan?.status === "ready" && initial.serviceStoryPlan.slides.length === STORY_SLIDE_COUNT;
  const attempts = (initial.serviceStoryPlan?.attempts || 0) + (hasReadyPlan ? 0 : 1);
  let planningJob = initial;
  if (!hasReadyPlan) {
    planningJob = await creativeGenerationJobStore.update(jobId, (job) => ({
      ...job,
      serviceStoryPlan: {
        status: "running",
        slides: [],
        attempts,
        updatedAt: new Date().toISOString(),
      },
    }));
  }
  const imagePaths = [
    referencePath,
    ...(planningJob.codexDirectTest?.siteVisualImagePaths || []),
  ].filter((file, index, files) => Boolean(file) && files.indexOf(file) === index).slice(0, 6);
  try {
    const response = await session.planServiceStory({
      jobId,
      prompt: hasReadyPlan ? storyContinuationPrompt(planningJob) : storyPlanningPrompt(planningJob),
      imagePaths,
      outputSchema: storyPlanningSchema,
      idleTimeoutMs: resolveRuntimeTimeout(
        process.env.ADATLAS_CODEX_SERVICE_STORY_TIMEOUT_MS,
        DEFAULT_STORY_PLANNING_TIMEOUT_MS,
        30_000
      ),
      hardTimeoutMs: resolveRuntimeTimeout(
        process.env.ADATLAS_CODEX_SERVICE_STORY_HARD_TIMEOUT_MS,
        10 * 60 * 1000,
        60_000
      ),
    });
    if (hasReadyPlan) return planningJob;
    const plan = parseServiceStoryPlanResponse(response.finalResponse, attempts);
    const ready = await creativeGenerationJobStore.update(jobId, (job) => ({ ...job, serviceStoryPlan: plan }));
    await writeNativeManifest(ready).catch(() => undefined);
    return ready;
  } catch (error) {
    if (hasReadyPlan) throw error;
    const plan = fallbackStoryPlan(planningJob, error instanceof Error ? error.message : "스토리 기획에 실패했습니다.");
    plan.attempts = attempts;
    const ready = await creativeGenerationJobStore.update(jobId, (job) => ({ ...job, serviceStoryPlan: plan }));
    await writeNativeManifest(ready).catch(() => undefined);
    return ready;
  }
}

export async function ensureServiceStoryPlan(jobId: string) {
  const initial = await creativeGenerationJobStore.get(jobId);
  if (!initial || !isServiceStoryGenerationJob(initial)) return initial;
  if (initial.serviceStoryPlan?.status === "ready" && initial.serviceStoryPlan.slides.length === STORY_SLIDE_COUNT) return initial;
  const startedAt = new Date().toISOString();
  const planning = await creativeGenerationJobStore.update(jobId, (job) => ({
    ...job,
    serviceStoryPlan: {
      status: "running",
      slides: [],
      attempts: (job.serviceStoryPlan?.attempts || 0) + 1,
      updatedAt: startedAt,
    },
  }));
  let plan: ServiceStoryPlan;
  try {
    plan = await createCodexStoryPlan(planning);
  } catch (error) {
    plan = fallbackStoryPlan(planning, error instanceof Error ? error.message : "스토리 기획에 실패했습니다.");
  }
  const ready = await creativeGenerationJobStore.update(jobId, (job) => ({ ...job, serviceStoryPlan: plan }));
  await writeNativeManifest(ready).catch(() => undefined);
  return ready;
}
