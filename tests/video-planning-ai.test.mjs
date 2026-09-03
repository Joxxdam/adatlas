import assert from "node:assert/strict";
import test from "node:test";

import { createOpenAiVideoPlanningRunner, resolveVideoPlanningProvider, resolveVideoPlanningStageConfig, sanitizeVideoPlanningErrorMessage, videoPlanningRateLimitDelayMs, VideoPlanningGenerationError } from "../app/lib/video-collaboration/videoPlanningAiCore.ts";
import { hasExactVideoConceptArchetypes, requestFourVideoConcepts, VideoConceptBatchValidationError } from "../app/lib/video-collaboration/videoPlanningConceptBatch.ts";
import { runWithSingleVideoPlanningCorrection } from "../app/lib/video-collaboration/videoPlanningCorrection.ts";
import { compactPlanningCta, hasFinalPlanningCta, hasStrongDetailedPlanningOpening, missingSceneSignals, repairDetailedPlanningCommercialRestraint, repairDetailedPlanningCta, repairDetailedPlanningOpeningHook, repairDetailedPlanningSceneDescriptions } from "../app/lib/video-collaboration/planningValidation.ts";
import { failVideoPlanningPipeline, hasReusableDetailedVideoPlan, withVideoPlanningGenerationLock } from "../app/lib/video-collaboration/videoPlanningRequestGuards.ts";

const simpleSchema = {
  type: "object",
  additionalProperties: false,
  required: ["value"],
  properties: { value: { type: "string" } },
};

test("정상 자막이 특정 후킹 단어를 빠뜨려도 전체 생성을 실패시키지 않는다", () => {
  const concept = {
    conceptArchetype: "usp-focus",
    fullScript: "마블링을 먼저 봅니다 이름보다 고기부터 봅니다",
    cuts: [
      { id: "cut-1", startSecond: 0, endSecond: 1.2, caption: "마블링을 먼저 봅니다", narration: "" },
      { id: "cut-2", startSecond: 1.2, endSecond: 3, caption: "이름보다 고기부터 봅니다", narration: "" },
    ],
  };
  assert.equal(hasStrongDetailedPlanningOpening(concept), false);
  const repaired = repairDetailedPlanningOpeningHook(concept);
  assert.equal(hasStrongDetailedPlanningOpening(repaired), true);
  assert.match(repaired.cuts[1].caption, /!$/);
  assert.equal(repaired.cuts[0].caption, concept.cuts[0].caption);
  assert.match(repaired.fullScript, /이름보다 고기부터 봅니다!/);
});

test("15개 자막에서 가격·할인·구성 수치는 최대 두 장면에만 비연속으로 남긴다", () => {
  const analysis = { price: "49,800원", originalPrice: "148,000원", discountInfo: "66% 할인", volumeOrOption: "1kg 박스", composition: [] };
  const concept = {
    conceptArchetype: "usp-focus",
    fullScript: "",
    cuts: [
      { id: "cut-1", cutNumber: 1, startSecond: 0, endSecond: 1.2, caption: "왜 마블링부터 볼까요?", narration: "" },
      { id: "cut-2", cutNumber: 2, startSecond: 1.2, endSecond: 3, caption: "1kg 박스를 열어봐요", narration: "" },
      { id: "cut-3", cutNumber: 3, startSecond: 3, endSecond: 5, caption: "49,800원에 66% 할인", narration: "지금 1kg 박스는 49,800원, 66% 할인으로 볼 수 있습니다." },
      { id: "cut-4", cutNumber: 4, startSecond: 5, endSecond: 7, caption: "66% 할인도 확인했어요", narration: "" },
      { id: "cut-5", cutNumber: 5, startSecond: 7, endSecond: 9, caption: "1kg 박스를 확인하세요", narration: "" },
    ],
  };
  const repaired = repairDetailedPlanningCommercialRestraint(concept, analysis);
  const exactCommercialCuts = repaired.cuts.filter((cut) => /49,800원|148,000원|66%\s*할인|1kg\s*박스/.test(`${cut.caption} ${cut.narration}`));
  assert.deepEqual(exactCommercialCuts.map((cut) => cut.cutNumber), [2, 5]);
  assert.equal(repaired.cuts[2].caption, "가격·할인 조건을 확인해요");
  assert.equal(repaired.cuts[2].narration, "상품 구성과 가격·할인 조건을 함께 확인해보세요.");
  assert.match(repaired.cuts[3].caption, /할인 조건/);
});

test("실패한 영상 기획 파이프라인은 생성 중으로 남지 않는다", () => {
  const failedAt = "2026-08-25T10:48:44.393Z";
  const progress = failVideoPlanningPipeline(
    [
      { stage: "productAnalysis", status: "complete", message: "완료", updatedAt: "before" },
      { stage: "hookCandidates", status: "complete", message: "완료", updatedAt: "before" },
      { stage: "conceptCandidates", status: "running", message: "생성 중", updatedAt: "before" },
      { stage: "validation", status: "pending", message: "대기", updatedAt: "before" },
    ],
    "4안 차별성 검사 실패",
    failedAt
  );
  assert.equal(progress[2].status, "failed");
  assert.equal(progress[2].message, "4안 차별성 검사 실패");
  assert.equal(progress[2].updatedAt, failedAt);
  assert.equal(progress[3].status, "warning");
  assert.equal(progress[3].message, "이전 단계 실패로 중단");
});

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

test("영상기획 provider 기본값은 OpenAI Responses API다", () => {
  assert.equal(resolveVideoPlanningProvider({}), "openai-api");
  assert.equal(resolveVideoPlanningProvider({ VIDEO_PLANNING_PROVIDER: "codex-local" }), "codex-local");
  assert.equal(resolveVideoPlanningProvider({ VIDEO_PLANNING_PROVIDER: "openai-api" }), "openai-api");
});

test("인증 오류는 키 앞뒤 조각과 플랫폼 안내 URL을 공개하지 않는다", async () => {
  const run = createOpenAiVideoPlanningRunner({
    env: { OPENAI_API_KEY: "test-key" },
    client: {
      responses: {
        async create() {
          throw Object.assign(new Error("401 Incorrect API key provided: sk-proj-secretsecretXDoA. You can find your API key at https://platform.openai.com/account/api-keys."), { status: 401 });
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
  assert.equal(sanitizeVideoPlanningErrorMessage("Incorrect API key provided: [비공개]****************XDoA. You can find your API key at https://platform.openai.com/account/api-keys."), "OpenAI API 인증에 실패했습니다.");
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
    (error) => error instanceof VideoPlanningGenerationError && error.failure.code === "VIDEO_PLANNING_API_KEY_MISSING" && error.failure.attempts === 0
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
    (error) => error instanceof VideoPlanningGenerationError && error.failure.code === "VIDEO_PLANNING_MODEL_ERROR"
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
  assert.deepEqual(resolveVideoPlanningStageConfig({ stage: "product-analysis", prompt: "", outputSchema: {} }, env), { purpose: "analysis", model: "analysis-model", effort: "low", verbosity: "low", timeoutMs: 45_000 });
  assert.deepEqual(resolveVideoPlanningStageConfig({ stage: "concept-summaries", purpose: "concept", prompt: "", outputSchema: {} }, env), { purpose: "concept", model: "concept-model", effort: "low", verbosity: "medium", timeoutMs: 90_000 });
  assert.deepEqual(resolveVideoPlanningStageConfig({ stage: "detailed-script", purpose: "script", prompt: "", outputSchema: {} }, env), { purpose: "script", model: "script-model", effort: "medium", verbosity: "high", timeoutMs: 90_000 });
  assert.deepEqual(resolveVideoPlanningStageConfig({ stage: "automatic-revision", purpose: "correction", prompt: "", outputSchema: {} }, env), { purpose: "correction", model: "script-model", effort: "low", verbosity: "high", timeoutMs: 90_000 });

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
  assert.equal(calls[0].body.text.verbosity, "medium");
  assert.equal(calls[0].options.timeout, 90_000);
});

test("정지 광고 레퍼런스는 Responses API의 실제 이미지 입력으로 전달한다", async () => {
  const calls = [];
  const run = createOpenAiVideoPlanningRunner({
    env: { OPENAI_API_KEY: "test-key" },
    client: successfulClient(calls),
    logger: () => undefined,
  });
  const imageDataUrl = "data:image/jpeg;base64,dGVzdA==";
  await run({
    stage: "reference-analysis",
    purpose: "analysis",
    prompt: "레퍼런스를 분석하세요",
    imageDataUrls: [imageDataUrl],
    outputSchema: simpleSchema,
  });
  assert.deepEqual(calls[0].body.input, [
    {
      role: "user",
      content: [
        { type: "input_text", text: "레퍼런스를 분석하세요" },
        { type: "input_image", image_url: imageDataUrl, detail: "high" },
      ],
    },
  ]);
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
    (error) => error instanceof VideoPlanningGenerationError && error.failure.code === "VIDEO_PLANNING_TIMEOUT" && error.failure.attempts === 2
  );
  assert.equal(calls, 2);
});

test("API 크레딧 소진 429는 요청 폭주와 구분하고 재시도하지 않는다", async () => {
  let calls = 0;
  const run = createOpenAiVideoPlanningRunner({
    env: { OPENAI_API_KEY: "test-key" },
    client: {
      responses: {
        create: async () => {
          calls += 1;
          throw Object.assign(new Error("You have no credits remaining."), {
            status: 429,
            code: "credit_balance_exhausted",
            type: "insufficient_quota",
          });
        },
      },
    },
    logger: () => undefined,
  });
  await assert.rejects(
    () => run({ stage: "product-analysis", prompt: "test", outputSchema: simpleSchema }),
    (error) => error instanceof VideoPlanningGenerationError && error.failure.code === "VIDEO_PLANNING_QUOTA_EXHAUSTED" && error.failure.retryable === false && error.failure.attempts === 1
  );
  assert.equal(calls, 1);
});

test("일시적 429는 Retry-After를 지킨 뒤 한 번 재시도한다", async () => {
  let calls = 0;
  const waits = [];
  const run = createOpenAiVideoPlanningRunner({
    env: { OPENAI_API_KEY: "test-key" },
    client: {
      responses: {
        create: async () => {
          calls += 1;
          if (calls === 1) {
            throw Object.assign(new Error("rate limit reached"), {
              status: 429,
              code: "rate_limit_exceeded",
              headers: new Headers({ "retry-after": "2" }),
            });
          }
          return { status: "completed", output_text: JSON.stringify({ value: "ok" }) };
        },
      },
    },
    logger: () => undefined,
    random: () => 0,
    sleep: async (milliseconds) => { waits.push(milliseconds); },
  });
  assert.deepEqual(await run({ stage: "product-analysis", prompt: "test", outputSchema: simpleSchema }), { value: "ok" });
  assert.equal(calls, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(videoPlanningRateLimitDelayMs({ headers: new Headers({ "retry-after": "3" }) }, 1, () => 0), 3000);
});

test("API 오류 로그는 상위 오류 코드와 요청 ID를 남기되 키나 원문을 남기지 않는다", async () => {
  const logs = [];
  const run = createOpenAiVideoPlanningRunner({
    env: { OPENAI_API_KEY: "test-key" },
    client: {
      responses: {
        create: async () => {
          throw Object.assign(new Error("sensitive upstream detail"), {
            status: 429,
            code: "credit_balance_exhausted",
            request_id: "req_safe_trace_id",
          });
        },
      },
    },
    logger: (message) => logs.push(message),
  });
  await assert.rejects(() => run({ stage: "product-analysis", prompt: "test", outputSchema: simpleSchema }));
  assert.match(logs.at(-1), /upstreamCode=credit_balance_exhausted/);
  assert.match(logs.at(-1), /requestId=req_safe_trace_id/);
  assert.doesNotMatch(logs.join("\n"), /sensitive upstream detail|test-key/);
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

test("안정 생성 모드는 네 유형을 최대 2개씩 만들고 성공 슬롯을 즉시 보고한다", async () => {
  let active = 0;
  let peak = 0;
  let batchCalls = 0;
  const completed = [];
  const progress = [];
  const activeWhenSaved = [];
  const result = await requestFourVideoConcepts({
    requestBatch: async () => {
      batchCalls += 1;
      return [];
    },
    requestOne: async (conceptArchetype) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) =>
        setTimeout(resolve, conceptArchetype === "real-review" ? 25 : 5)
      );
      completed.push(conceptArchetype);
      active -= 1;
      return { conceptArchetype };
    },
    initialStrategy: "per-archetype",
    concurrency: 2,
    onProgress: async (state) => {
      progress.push(state);
      activeWhenSaved.push(active);
    },
  });
  assert.equal(batchCalls, 0);
  assert.equal(peak, 2);
  assert.deepEqual(completed.sort(), [...archetypes].sort());
  assert.equal(hasExactVideoConceptArchetypes(result), true);
  assert.equal(progress.some((state) => state.preservedRows.length > 0), true);
  assert.equal(activeWhenSaved.some((count) => count > 0), true);
  assert.equal(progress.at(-1).unresolvedArchetypes.length, 0);
});

test("안정 생성 모드는 실패한 유형만 다시 만들고 먼저 성공한 유형을 보존한다", async () => {
  const calls = new Map();
  const progress = [];
  const result = await requestFourVideoConcepts({
    requestBatch: async () => [],
    requestOne: async (conceptArchetype) => {
      const count = (calls.get(conceptArchetype) || 0) + 1;
      calls.set(conceptArchetype, count);
      if (conceptArchetype === "real-review" && count === 1) {
        throw new Error("temporary timeout");
      }
      return { conceptArchetype, marker: `${conceptArchetype}-${count}` };
    },
    initialStrategy: "per-archetype",
    concurrency: 2,
    onProgress: async (state) => progress.push(state),
  });
  assert.equal(calls.get("parody"), 1);
  assert.equal(calls.get("real-review"), 2);
  assert.equal(calls.get("usp-focus"), 1);
  assert.equal(calls.get("secret-benefit"), 1);
  assert.equal(result.find((item) => item.conceptArchetype === "parody").marker, "parody-1");
  assert.equal(progress.some((state) => state.preservedRows.some((item) => item.conceptArchetype === "parody")), true);
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
    findInvalidArchetypes: (rows) => rows.filter((item) => !item.valid).map((item) => item.conceptArchetype),
  });
  assert.equal(batchCalls, 1);
  assert.deepEqual(regenerated, ["usp-focus"]);
  assert.equal(
    result.every((item) => item.valid),
    true
  );
});

test("여러 콘셉트가 부적합해도 통과한 유형은 보존하고 실패 유형만 재생성한다", async () => {
  const regenerated = [];
  const preserved = [];
  const concepts = archetypes.map((conceptArchetype) => ({
    conceptArchetype,
    marker: `original-${conceptArchetype}`,
    valid: !["real-review", "secret-benefit"].includes(conceptArchetype),
  }));
  const result = await requestFourVideoConcepts({
    requestBatch: async () => concepts,
    requestOne: async (conceptArchetype, _correction, preservedRows) => {
      regenerated.push(conceptArchetype);
      preserved.push(...preservedRows.map((row) => row.conceptArchetype));
      return {
        conceptArchetype,
        marker: `repaired-${conceptArchetype}`,
        valid: true,
      };
    },
    findInvalidArchetypes: (rows) => rows.filter((item) => !item.valid).map((item) => item.conceptArchetype),
  });
  assert.deepEqual(regenerated.sort(), ["real-review", "secret-benefit"]);
  assert.equal(result.find((item) => item.conceptArchetype === "parody"), concepts[0]);
  assert.equal(result.find((item) => item.conceptArchetype === "usp-focus"), concepts[2]);
  assert.equal(preserved.length, 4);
});

test("필수 유형이 여러 개 누락돼도 중복 결과를 버리고 누락 유형만 채운다", async () => {
  const regenerated = [];
  const result = await requestFourVideoConcepts({
    requestBatch: async () => [
      { conceptArchetype: "parody", marker: "keep-parody" },
      { conceptArchetype: "parody", marker: "drop-duplicate" },
      { conceptArchetype: "real-review", marker: "keep-review" },
      { conceptArchetype: "real-review", marker: "drop-duplicate" },
    ],
    requestOne: async (conceptArchetype) => {
      regenerated.push(conceptArchetype);
      return { conceptArchetype, marker: `filled-${conceptArchetype}` };
    },
  });
  assert.deepEqual(regenerated, ["usp-focus", "secret-benefit"]);
  assert.equal(hasExactVideoConceptArchetypes(result), true);
  assert.equal(result[0].marker, "keep-parody");
  assert.equal(result[1].marker, "keep-review");
});

test("표적 보정을 두 번 통과하지 못하면 실패 유형 진단을 남긴다", async () => {
  const concepts = archetypes.map((conceptArchetype) => ({
    conceptArchetype,
    valid: conceptArchetype !== "usp-focus",
  }));
  await assert.rejects(
    () =>
      requestFourVideoConcepts({
        requestBatch: async () => concepts,
        requestOne: async (conceptArchetype) => ({ conceptArchetype, valid: false }),
        findInvalidArchetypes: (rows) => rows.filter((item) => !item.valid).map((item) => item.conceptArchetype),
      }),
    (error) => {
      assert.equal(error instanceof VideoConceptBatchValidationError, true);
      assert.deepEqual(error.invalidArchetypes, ["usp-focus"]);
      assert.equal(error.repairRounds, 2);
      return true;
    }
  );
});

test("일부 유형 재생성이 계속 실패해도 통과한 기획안과 진행 상태를 돌려준다", async () => {
  const progress = [];
  const concepts = archetypes.map((conceptArchetype) => ({
    conceptArchetype,
    valid: conceptArchetype !== "usp-focus",
  }));
  await assert.rejects(
    () =>
      requestFourVideoConcepts({
        requestBatch: async () => concepts,
        requestOne: async () => {
          throw new Error("temporary model failure");
        },
        findInvalidArchetypes: (rows) =>
          rows.filter((item) => !item.valid).map((item) => item.conceptArchetype),
        onProgress: async (state) => progress.push(state),
      }),
    (error) => {
      assert.equal(error instanceof VideoConceptBatchValidationError, true);
      assert.deepEqual(error.invalidArchetypes, ["usp-focus"]);
      assert.deepEqual(
        error.preservedRows.map((item) => item.conceptArchetype),
        ["parody", "real-review", "secret-benefit"]
      );
      return true;
    }
  );
  assert.equal(progress.length, 3);
  assert.deepEqual(progress.at(-1).unresolvedArchetypes, ["usp-focus"]);
  assert.equal(progress.at(-1).preservedRows.length, 3);
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

test("관찰 반응만 빠진 구체 장면에는 체크리스트 문장을 강제로 덧붙이지 않는다", () => {
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
  const scene = "첫 화면은 밝은 주방 조리대 중앙의 고기와 제품 패키지 클로즈업으로 시작한다. 손이 고기를 들어 팬 위에 놓고 카메라는 라벨과 원물을 번갈아 비춘 뒤 다음 구간의 식탁 화면으로 매치컷 전환한다.";
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
  assert.equal(repaired, concept);
  assert.deepEqual(missingSceneSignals(repaired.cuts[0]), ["reaction"]);
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
    sceneDescription: "첫 화면은 욕실 세면대 중앙의 샤워젤 제품 클로즈업으로 시작한다. 인물이 손으로 용기를 들어 거품을 내고 상쾌한 표정으로 고개를 끄덕인다. 카메라는 물방울이 맺힌 라벨을 비춘 뒤 다음 샤워부스 화면으로 매치컷 전환한다.",
  };
  const concept = { cuts: [cut] };
  assert.deepEqual(missingSceneSignals(cut), []);
  assert.equal(repairDetailedPlanningSceneDescriptions(concept, analysis), concept);
});

test("마지막 구간에 누락된 CTA는 전체 재생성 없이 자동 보완한다", () => {
  const concept = {
    objective: "benefit",
    cta: "추석 선물 가격 조건을 상세페이지에서 확인하세요",
    fullScript: "선물 가격을 비교해 보세요.",
    cuts: [
      { id: "cut-1", startSecond: 0, endSecond: 1, caption: "가격이 왜 다르지?" },
      { id: "cut-2", startSecond: 29, endSecond: 30, caption: "선물 준비 끝" },
    ],
  };
  assert.equal(hasFinalPlanningCta(concept), false);
  const repaired = repairDetailedPlanningCta(concept);
  assert.equal(hasFinalPlanningCta(repaired), true);
  assert.equal(repaired.cuts[1].caption, repaired.cta);
  assert.ok(repaired.cuts[1].caption.length <= 34);
  assert.match(repaired.fullScript, new RegExp(repaired.cta));
});

test("CTA가 앞 구간에만 있으면 마지막 CTA로 오인하지 않는다", () => {
  const concept = {
    objective: "purchase",
    cta: "구매 조건을 확인하세요",
    cuts: [
      { id: "cut-1", startSecond: 0, endSecond: 1, caption: "구매 조건을 확인하세요" },
      { id: "cut-2", startSecond: 29, endSecond: 30, caption: "마지막 제품 화면" },
    ],
  };
  assert.equal(hasFinalPlanningCta(concept), false);
});

test("긴 CTA는 단어를 자르지 않고 자막 길이에 맞춘다", () => {
  const cta = compactPlanningCta("지금 상세페이지에서 추석 선물 가격과 배송 조건을 빠짐없이 직접 확인해 보세요", "구매 조건을 확인하세요");
  assert.ok(cta.replace(/\s/g, "").length <= 34);
  assert.doesNotMatch(cta, /빠짐없$/);
  assert.match(cta, /확인|구매|주문|예약/);
});

test("행동이 없는 CTA는 읽을 수 있는 길이의 완결된 행동 문장으로 보완한다", () => {
  const cta = compactPlanningCta("기름파도 담백파도 멈췄다면 추석 사전예약 찰진등심 1kg", "상품 정보를 지금 확인하세요", 24);
  assert.ok(cta.replace(/\s/g, "").length <= 24);
  assert.match(cta, /확인하세요|구매하세요|예약하세요/);
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
    (error) => error instanceof VideoPlanningGenerationError && error.failure.code === "GENERATION_ALREADY_RUNNING"
  );
  release();
  assert.equal(await first, "done");
  assert.equal(executions, 1);
});

test("유효한 저장 상세안은 자동 재생성 대상이 아니다", () => {
  const concept = {
    conceptArchetype: "usp-focus",
    detailStatus: "ready",
    cuts: Array.from({ length: 15 }, (_, index) => ({ id: `cut-${index}` })),
    validation: { valid: true },
    distinctiveCharacter: "매일 막차 직전 오래된 동네 체육관에서 마지막으로 샤워하는 야근 많은 직장인",
    socialWorld: "밤 10시 막차를 앞둔 20년 된 동네 체육관의 습기 찬 공동 샤워실",
    storyTrigger: "막차까지 12분 남은 순간 쓰던 샤워젤이 비어 가방 속 새 상품을 꺼낸다.",
    truthBridge: "검증된 민트와 티트리 특징을 급한 운동 후 샤워 장면의 선택 이유로 연결한다.",
    dramatizationBoundary: "직장인과 체육관 사건은 창작 상황극이며 민트와 티트리는 검증된 상품 사실이다.",
  };
  assert.equal(hasReusableDetailedVideoPlan(concept, 15), true);
  assert.equal(hasReusableDetailedVideoPlan({ ...concept, validation: { valid: false } }, 15), false);
  assert.equal(
    hasReusableDetailedVideoPlan({
      ...concept,
      distinctiveCharacter: undefined,
      socialWorld: undefined,
      storyTrigger: undefined,
      truthBridge: undefined,
      dramatizationBoundary: undefined,
    }, 15),
    false
  );
});
