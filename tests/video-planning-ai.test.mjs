import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiVideoPlanningRunner,
  resolveVideoPlanningProvider,
  resolveVideoPlanningStageConfig,
  sanitizeVideoPlanningErrorMessage,
  VideoPlanningGenerationError,
} from "../app/lib/video-collaboration/videoPlanningAiCore.ts";
import {
  hasExactVideoConceptArchetypes,
  requestFourVideoConcepts,
} from "../app/lib/video-collaboration/videoPlanningConceptBatch.ts";
import { runWithSingleVideoPlanningCorrection } from "../app/lib/video-collaboration/videoPlanningCorrection.ts";
import {
  missingSceneSignals,
  repairDetailedPlanningSceneDescriptions,
} from "../app/lib/video-collaboration/planningValidation.ts";
import {
  hasReusableDetailedVideoPlan,
  withVideoPlanningGenerationLock,
} from "../app/lib/video-collaboration/videoPlanningRequestGuards.ts";

const simpleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value"],
  properties: { value: { type: "string" } },
};

function successfulClient(calls) {
  return {
    responses: {
      async create(body, options) {
        calls.push({ body, options });
        return {
          status: "completed",
          output_text: JSON.stringify({ value: "ok" }),
          usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
        };
      },
    },
  };
}

test("영상기획 provider 기본값은 로그인된 로컬 Codex다", () => {
  assert.equal(resolveVideoPlanningProvider({}), "codex-local");
  assert.equal(
    resolveVideoPlanningProvider({ VIDEO_PLANNING_PROVIDER: "codex-local" }),
    "codex-local"
  );
  assert.equal(
    resolveVideoPlanningProvider({
      VIDEO_PLANNING_PROVIDER: "openai-api",
      ADATLAS_PAID_API_EXPLICIT_ENABLED: "true",
    }),
    "openai-api"
  );
});

test("유료 API provider는 서버에서 명시적으로 활성화해야 한다", () => {
  assert.throws(
    () => resolveVideoPlanningProvider({ VIDEO_PLANNING_PROVIDER: "openai-api" }),
    (error) =>
      error instanceof VideoPlanningGenerationError &&
      error.failure.code === "VIDEO_PLANNING_PAID_API_DISABLED"
  );
});

test("인증 오류는 키 앞뒤 조각과 플랫폼 안내 URL을 공개하지 않는다", async () => {
  const run = createOpenAiVideoPlanningRunner({
    env: { OPENAI_API_KEY: "test-key" },
    client: {
      responses: {
        async create() {
          throw Object.assign(
            new Error(
              "401 Incorrect API key provided: sk-proj-secretsecretXDoA. You can find your API key at https://platform.openai.com/account/api-keys."
            ),
            { status: 401 }
          );
        },
      },
    },
    logger: () => undefined,
  });
  await assert.rejects(
    () => run({ stage: "product-analysis", prompt: "test", outputSchema: simpleSchema }),
    (error) => {
      assert.ok(error instanceof VideoPlanningGenerationError);
      assert.equal(error.failure.code, "VIDEO_PLANNING_AUTH_ERROR");
      assert.doesNotMatch(error.failure.message, /secret|XDoA|api-keys/i);
      return true;
    }
  );
  assert.equal(
    sanitizeVideoPlanningErrorMessage(
      "Incorrect API key provided: [비공개]****************XDoA. You can find your API key at https://platform.openai.com/account/api-keys."
    ),
    "OpenAI API 인증에 실패했습니다."
  );
});

test("OPENAI_API_KEY가 없으면 API 호출이나 로컬 fallback 없이 명확히 실패한다", async () => {
  let calls = 0;
  const run = createOpenAiVideoPlanningRunner({
    env: {},
    client: {
      responses: {
        create: async () => {
          calls += 1;
          return {};
        },
      },
    },
    logger: () => undefined,
  });
  await assert.rejects(
    () => run({ stage: "product-analysis", prompt: "test", outputSchema: simpleSchema }),
    (error) =>
      error instanceof VideoPlanningGenerationError &&
      error.failure.code === "VIDEO_PLANNING_API_KEY_MISSING" &&
      error.failure.attempts === 0
  );
  assert.equal(calls, 0);
});

test("OpenAI API 실패는 로컬 Codex로 fallback하지 않는다", async () => {
  let apiCalls = 0;
  const run = createOpenAiVideoPlanningRunner({
    env: { OPENAI_API_KEY: "test-key", VIDEO_PLANNING_PROVIDER: "openai-api" },
    client: {
      responses: {
        async create() {
          apiCalls += 1;
          throw new Error("invalid model configuration");
        },
      },
    },
    logger: () => undefined,
  });
  await assert.rejects(
    () =>
      run({
        stage: "concept-summaries",
        purpose: "concept",
        prompt: "test",
        outputSchema: simpleSchema,
      }),
    (error) =>
      error instanceof VideoPlanningGenerationError &&
      error.failure.code === "VIDEO_PLANNING_MODEL_ERROR"
  );
  assert.equal(apiCalls, 1);
});

test("단계별 모델·reasoning·timeout과 Responses API 보안 옵션을 적용한다", async () => {
  const env = {
    OPENAI_API_KEY: "test-key",
    VIDEO_PLANNING_ANALYSIS_MODEL: "analysis-model",
    VIDEO_PLANNING_CONCEPT_MODEL: "concept-model",
    VIDEO_PLANNING_SCRIPT_MODEL: "script-model",
  };
  assert.deepEqual(
    resolveVideoPlanningStageConfig(
      { stage: "product-analysis", prompt: "", outputSchema: {} },
      env
    ),
    { purpose: "analysis", model: "analysis-model", effort: "low", timeoutMs: 45_000 }
  );
  assert.deepEqual(
    resolveVideoPlanningStageConfig(
      { stage: "concept-summaries", purpose: "concept", prompt: "", outputSchema: {} },
      env
    ),
    { purpose: "concept", model: "concept-model", effort: "low", timeoutMs: 60_000 }
  );
  assert.deepEqual(
    resolveVideoPlanningStageConfig(
      { stage: "detailed-script", purpose: "script", prompt: "", outputSchema: {} },
      env
    ),
    { purpose: "script", model: "script-model", effort: "medium", timeoutMs: 90_000 }
  );
  assert.deepEqual(
    resolveVideoPlanningStageConfig(
      { stage: "automatic-revision", purpose: "correction", prompt: "", outputSchema: {} },
      env
    ),
    { purpose: "correction", model: "script-model", effort: "low", timeoutMs: 90_000 }
  );

  const calls = [];
  const run = createOpenAiVideoPlanningRunner({
    env,
    client: successfulClient(calls),
    logger: () => undefined,
  });
  await run({
    stage: "concept-summaries",
    purpose: "concept",
    prompt: "private prompt",
    outputSchema: simpleSchema,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "concept-model");
  assert.deepEqual(calls[0].body.reasoning, { effort: "low" });
  assert.equal(calls[0].body.store, false);
  assert.deepEqual(calls[0].body.tools, []);
  assert.equal(calls[0].body.text.format.type, "json_schema");
  assert.equal(calls[0].body.text.format.strict, true);
  assert.equal(calls[0].options.timeout, 60_000);
});

test("일시 오류 전송 재시도는 최초 포함 최대 2회다", async () => {
  let calls = 0;
  const run = createOpenAiVideoPlanningRunner({
    env: { OPENAI_API_KEY: "test-key" },
    client: {
      responses: {
        create: async () => {
          calls += 1;
          throw new Error("request timed out");
        },
      },
    },
    logger: () => undefined,
  });
  await assert.rejects(
    () =>
      run({
        stage: "detailed-script",
        purpose: "script",
        prompt: "test",
        outputSchema: simpleSchema,
      }),
    (error) =>
      error instanceof VideoPlanningGenerationError &&
      error.failure.code === "VIDEO_PLANNING_TIMEOUT" &&
      error.failure.attempts === 2
  );
  assert.equal(calls, 2);
});

const archetypes = ["parody", "real-review", "usp-focus", "secret-benefit"];

test("4개 콘셉트는 기본 한 번의 호출로 유형을 정확히 하나씩 받는다", async () => {
  let batchCalls = 0;
  let singleCalls = 0;
  const concepts = archetypes.map((conceptArchetype) => ({ conceptArchetype }));
  const result = await requestFourVideoConcepts({
    requestBatch: async () => {
      batchCalls += 1;
      return concepts;
    },
    requestOne: async (conceptArchetype) => {
      singleCalls += 1;
      return { conceptArchetype };
    },
  });
  assert.equal(batchCalls, 1);
  assert.equal(singleCalls, 0);
  assert.equal(hasExactVideoConceptArchetypes(result), true);
  assert.deepEqual(
    result.map((item) => item.conceptArchetype),
    archetypes
  );
});

test("특정 콘셉트 하나만 부적합하면 그 유형만 한 번 재생성한다", async () => {
  let batchCalls = 0;
  const regenerated = [];
  const concepts = archetypes.map((conceptArchetype) => ({
    conceptArchetype,
    valid: conceptArchetype !== "usp-focus",
  }));
  const result = await requestFourVideoConcepts({
    requestBatch: async () => {
      batchCalls += 1;
      return concepts;
    },
    requestOne: async (conceptArchetype) => {
      regenerated.push(conceptArchetype);
      return { conceptArchetype, valid: true };
    },
    findInvalidArchetypes: (rows) =>
      rows.filter((item) => !item.valid).map((item) => item.conceptArchetype),
  });
  assert.equal(batchCalls, 1);
  assert.deepEqual(regenerated, ["usp-focus"]);
  assert.equal(
    result.every((item) => item.valid),
    true
  );
});

test("상세 대본 자동 보정은 검증 실패 때 최대 한 번만 요청한다", async () => {
  let initialCalls = 0;
  let correctionCalls = 0;
  const result = await runWithSingleVideoPlanningCorrection({
    requestInitial: async () => {
      initialCalls += 1;
      return { valid: false };
    },
    isValid: (value) => value.valid,
    requestCorrection: async () => {
      correctionCalls += 1;
      return { valid: false };
    },
  });
  assert.equal(initialCalls, 1);
  assert.equal(correctionCalls, 1);
  assert.equal(result.correctionCount, 1);
  assert.equal(result.value.valid, false);
});

test("장면별 누락 신호는 전체 AI 재생성 없이 제품 맥락에 맞게 보완한다", () => {
  const analysis = {
    productName: "마블링 한우 선물세트",
    brandName: "테스트",
    category: "축산·육류",
    productUrl: "https://example.com/product",
    price: "",
    originalPrice: "",
    discountInfo: "",
    coreUsps: [],
    keyFeatures: [],
    targetCustomers: [],
    customerProblems: [],
    trustSignals: [],
    cautionPhrases: [],
    imageUrls: [],
    rawDescription: "",
    source: "manual",
    analyzedAt: "2026-08-22T00:00:00.000Z",
  };
  const scene =
    "첫 화면은 밝은 주방 조리대 중앙의 고기와 제품 패키지 클로즈업으로 시작한다. 손이 고기를 들어 팬 위에 놓고 카메라는 라벨과 원물을 번갈아 비춘 뒤 다음 구간의 식탁 화면으로 매치컷 전환한다.";
  const concept = {
    cuts: [
      {
        id: "cut-11",
        cutNumber: 11,
        sceneName: "구간 11",
        startSecond: 15,
        endSecond: 16,
        caption: "굽자마자 달라져요",
        narration: "",
        sceneDescription: scene,
        requiredSources: [],
        referenceImages: [],
        productionMemo: "",
      },
    ],
  };
  assert.deepEqual(missingSceneSignals(concept.cuts[0]), ["reaction"]);
  const repaired = repairDetailedPlanningSceneDescriptions(concept, analysis);
  assert.deepEqual(missingSceneSignals(repaired.cuts[0]), []);
  assert.match(repaired.cuts[0].sceneDescription, /윤기.*색감|색감.*윤기/);
  assert.match(repaired.cuts[0].sceneDescription, /반응/);
});

test("이미 구체적인 장면은 자동 보완기가 변경하지 않는다", () => {
  const analysis = {
    productName: "샤워젤",
    brandName: "테스트",
    category: "뷰티",
  };
  const cut = {
    id: "cut-1",
    cutNumber: 1,
    caption: "씻자마자 개운해",
    sceneDescription:
      "첫 화면은 욕실 세면대 중앙의 샤워젤 제품 클로즈업으로 시작한다. 인물이 손으로 용기를 들어 거품을 내고 상쾌한 표정으로 고개를 끄덕인다. 카메라는 물방울이 맺힌 라벨을 비춘 뒤 다음 샤워부스 화면으로 매치컷 전환한다.",
  };
  const concept = { cuts: [cut] };
  assert.deepEqual(missingSceneSignals(cut), []);
  assert.equal(repairDetailedPlanningSceneDescriptions(concept, analysis), concept);
});

test("동일 상세 생성 요청은 서버 in-flight lock에서 한 번만 실행된다", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  let executions = 0;
  const first = withVideoPlanningGenerationLock({
    key: "project:concept:generate-detail",
    stage: "detailed-script",
    run: async () => {
      executions += 1;
      await pending;
      return "done";
    },
  });
  await assert.rejects(
    () =>
      withVideoPlanningGenerationLock({
        key: "project:concept:generate-detail",
        stage: "detailed-script",
        run: async () => "duplicate",
      }),
    (error) =>
      error instanceof VideoPlanningGenerationError &&
      error.failure.code === "GENERATION_ALREADY_RUNNING"
  );
  release();
  assert.equal(await first, "done");
  assert.equal(executions, 1);
});

test("유효한 저장 상세안은 자동 재생성 대상이 아니다", () => {
  const concept = {
    detailStatus: "ready",
    cuts: Array.from({ length: 15 }, (_, index) => ({ id: `cut-${index}` })),
    validation: { valid: true },
  };
  assert.equal(hasReusableDetailedVideoPlan(concept, 15), true);
  assert.equal(
    hasReusableDetailedVideoPlan({ ...concept, validation: { valid: false } }, 15),
    false
  );
});
