import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createIdempotentJobRunner } from "../app/lib/creative-generation/jobRunnerCore.ts";
import { cancelGenerationJob, resumeGenerationJob, selectRunnableResult, selectRunnableResults, staleRunningResultIds } from "../app/lib/creative-generation/jobRunnerPolicy.ts";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

function result(id, status, attempts = 0) {
  return { id, status, attempts, hookPlan: { hookCode: id.toUpperCase() } };
}

function job(statuses = ["pending", "pending", "pending"]) {
  const sixStatuses = [...statuses, ...Array(Math.max(0, 6 - statuses.length)).fill("success")].slice(0, 6);
  return {
    id: "creative-job-runner-test-12345678",
    status: "pending",
    engine: "codex_local",
    version: "generation-job-v6-ai-native-final",
    results: sixStatuses.map((status, index) => result(`h0${index + 1}`, status)),
    retryLimit: 2,
    updatedAt: "2026-08-19T00:00:00.000Z",
    createdAt: "2026-08-19T00:00:00.000Z",
    timing: { planningMs: 1 },
    errors: [],
  };
}

test("1. 작업 생성 API는 저장 직후 서버 runner를 자동 시작하고 202를 반환한다", async () => {
  const [route, service] = await Promise.all([read("app/api/creative-generation/jobs/route.ts"), read("app/lib/creative-generation/createNativeGenerationJob.server.ts")]);
  assert.match(route, /createNativeGenerationJob\(body\)/);
  assert.match(service, /enqueueGenerationJob\(job\.id, \{ priority: job\.sourceType === "manual" \}\)/);
  assert.match(service, /supersedeActiveForProduct\(job\.productTruth\.product\.landingUrl, undefined, "manual"\)/);
  assert.match(service, /cancelQueuedGenerationJob/);
  assert.match(route, /status: 202/);
});

test("1-1. 활성 작업 조회는 같은 상품의 최신 작업만 재개하고 전체 조회가 과거 큐를 다시 실행하지 않는다", async () => {
  const active = await read("app/api/creative-generation/jobs/active/route.ts");
  assert.match(active, /selectedCandidates = requestedProductUrl \? candidates\.slice\(0, 1\) : candidates/);
  assert.match(active, /candidate\.sourceType !== "auto-production"/);
  assert.match(active, /supersedeActiveForProduct\(requestedProductUrl, selectedCandidates\[0\]\.id, "manual"\)/);
  assert.match(active, /cancelQueuedGenerationJob/);
  assert.match(active, /enqueueGenerationJob\(job\.id, \{ priority: true \}\)/);
});

test("2. 클라이언트는 runPending이나 workerCount로 H01~H06을 지휘하지 않는다", async () => {
  const client = await read("app/components/features/creative-generation/SixCreativeGenerator.tsx");
  assert.doesNotMatch(client, /function runPending/);
  assert.doesNotMatch(client, /workerCount/);
  assert.match(client, /setInterval[\s\S]*2500/);
});

test("3. idempotent server runner는 호출자가 기다리지 않아도 등록된 작업을 끝낸다", async () => {
  const completed = [];
  const runner = createIdempotentJobRunner(async (jobId) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    completed.push(jobId);
  });
  assert.equal(runner.enqueue("job-a"), true);
  await runner.wait("job-a");
  assert.deepEqual(completed, ["job-a"]);
});

test("4. 동일 jobId를 두 번 enqueue해도 실행은 한 번뿐이다", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const runner = createIdempotentJobRunner(async () => {
    calls += 1;
    await gate;
  });
  assert.equal(runner.enqueue("job-a"), true);
  assert.equal(runner.enqueue("job-a"), false);
  release();
  await runner.wait("job-a");
  assert.equal(calls, 1);
});

test("4-1. 취소된 중복 대기 작업을 제거하고 최신 작업을 우선 실행한다", async () => {
  const started = [];
  const releases = new Map();
  const runner = createIdempotentJobRunner(async (jobId) => {
    started.push(jobId);
    await new Promise((resolve) => releases.set(jobId, resolve));
  }, 1);
  runner.enqueue("running-old");
  runner.enqueue("queued-old");
  runner.enqueue("latest", { priority: true });
  assert.equal(runner.cancelQueued("queued-old"), true);
  assert.equal(runner.isActive("queued-old"), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  releases.get("running-old")();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ["running-old", "latest"]);
  releases.get("latest")();
  await runner.wait("latest");
});

test("5. 완료된 후킹은 재실행하지 않고 pending/허용된 failed만 선택한다", () => {
  const current = job(["success", "approved", "pending", "failed"]);
  assert.equal(selectRunnableResult(current, new Set())?.id, "h03");
  assert.equal(selectRunnableResult(current, new Set(["h03"]))?.id, "h04");
});

test("6. 한 장 실패를 attempted로 기록하면 다음 pending 후킹이 계속 선택된다", () => {
  const current = job(["failed", "pending"]);
  const attempted = new Set(["h01"]);
  assert.equal(selectRunnableResult(current, attempted)?.id, "h02");
});

test("7. cancelled 작업에서는 다음 결과를 시작하지 않는다", () => {
  const current = cancelGenerationJob(job(["running", "pending", "success"]));
  assert.equal(current.results[0].status, "running");
  assert.equal(current.results[1].status, "cancelled");
  assert.equal(selectRunnableResult(current, new Set()), undefined);
});

test("7-1. 고속 제작은 서로 다른 후킹 세 개를 동시에 선택하고 상한을 넘지 않는다", () => {
  const current = job(["pending", "pending", "pending"]);
  current.concurrency = 3;
  assert.deepEqual(
    selectRunnableResults(current, new Set()).map((item) => item.id),
    ["h01", "h02", "h03"]
  );
  assert.deepEqual(
    selectRunnableResults(current, new Set(["h01"])).map((item) => item.id),
    ["h02", "h03"]
  );
  assert.equal(selectRunnableResults(current, new Set(), 9).length, 3);
});

test("7-2. 빠른 로컬 합성 v7 작업도 서버 runner가 복구·실행할 수 있다", () => {
  const current = job(["pending", "pending", "pending"]);
  current.version = "generation-job-v7-fast-local-composition";
  current.concurrency = 3;
  assert.deepEqual(
    selectRunnableResults(current, new Set()).map((item) => item.id),
    ["h01", "h02", "h03"]
  );
});

test("8. resume은 완료 결과를 유지하고 미완료 결과만 pending으로 되돌린다", () => {
  const current = job(["success", "approved", "cancelled", "failed", "running"]);
  current.status = "cancelled";
  const resumed = resumeGenerationJob(current, false);
  assert.deepEqual(
    resumed.results.map((item) => item.status),
    ["success", "approved", "pending", "pending", "pending", "success"]
  );
});

test("9. runner가 없고 일정 시간 멈춘 running 결과만 stale 복구 대상으로 잡는다", () => {
  const current = job(["success", "running", "pending"]);
  current.status = "running";
  const now = new Date(current.updatedAt).getTime() + 13 * 60 * 1000;
  assert.deepEqual(staleRunningResultIds(current, now, 12 * 60 * 1000, false), ["h02"]);
  assert.deepEqual(staleRunningResultIds(current, now, 12 * 60 * 1000, true), []);
});

test("10. active API는 진행률·현재 후킹·완료·실패 결과를 공개한다", async () => {
  const active = await read("app/api/creative-generation/jobs/active/route.ts");
  const publicJob = await read("app/lib/creative-generation/publicJob.server.ts");
  assert.match(active, /activeJobs/);
  for (const field of ["currentHookCode", "generatedCount", "runnerActive"]) {
    assert.match(publicJob, new RegExp(field));
  }
  assert.doesNotMatch(publicJob, /completedResults:/);
  assert.doesNotMatch(publicJob, /failedResults:/);
});

test("11. 입력 폼이 비어도 저장 jobId와 ProductTruth로 작업을 복원한다", async () => {
  const client = await read("app/components/features/creative-generation/SixCreativeGenerator.tsx");
  const storage = await read("app/lib/creative-generation/activeCreativeJob.client.ts");
  const dashboard = await read("app/components/MvpDashboard.tsx");
  assert.match(client, /ACTIVE_CREATIVE_JOB_STORAGE_KEY/);
  assert.match(storage, /daywiz-active-creative-job-id/);
  assert.match(client, /진행 중이던 광고 콘텐츠 작업을 불러왔습니다/);
  assert.match(client, /shouldPersistGenerationJob/);
  assert.match(client, /creative-generation\/jobs\/recent\?limit=10/);
  assert.doesNotMatch(client, /sameProduct|samePlan/);
  assert.match(dashboard, /productLoaded=\{currentProductLoaded\}/);
});

test("11-1. 다른 메뉴에서도 백그라운드 제작 진행률을 전역으로 표시한다", async () => {
  const layout = await read("app/layout.tsx");
  const indicator = await read("app/components/features/creative-generation/CreativeJobStatusIndicator.tsx");
  const client = await read("app/components/features/creative-generation/SixCreativeGenerator.tsx");
  const storage = await read("app/lib/creative-generation/activeCreativeJob.client.ts");
  const css = await read("app/components/features/creative-generation/CreativeJobStatusIndicator.module.css");
  assert.match(layout, /CreativeJobStatusIndicator/);
  assert.match(indicator, /광고 제작 백그라운드 진행 중/);
  assert.match(indicator, /currentHookCode/);
  assert.match(indicator, /진행 상황 보기/);
  assert.match(indicator, /activeJobs\.find/);
  assert.match(indicator, /activeJobs\.find\(\(item\) => item\.runnerActive\)/);
  assert.match(indicator, /localStorage\.removeItem\(ACTIVE_CREATIVE_JOB_STORAGE_KEY\)/);
  assert.match(indicator, /generatedCount/);
  assert.match(indicator, /\?summary=1/);
  assert.doesNotMatch(indicator, /광고 제작 결과 확인/);
  assert.match(storage, /daywiz-creative-job-completed-notified/);
  assert.match(indicator, /광고 제작이 완료됐습니다/);
  assert.match(indicator, /완성 결과 확인/);
  assert.match(indicator, /\?step=product&jobId=/);
  assert.match(indicator, /storedSummary\.generatedCount < storedSummary\.totalCount/);
  assert.match(indicator, /\["pending", "running"\]\.includes\(storedSummary\.status\)/);
  assert.match(client, /globalStoredJobId/);
  assert.match(client, /restoringGlobalWithoutProduct/);
  assert.match(client, />\s*진행 취소\s*</);
  assert.match(client, /dismissedJobIds\.current\.add\(cancelledJobId\)/);
  assert.match(client, /currentLocation\.searchParams\.delete\("jobId"\)/);
  assert.match(client, /window\.localStorage\.removeItem\(ACTIVE_CREATIVE_JOB_STORAGE_KEY\)/);
  const jobRoute = await read("app/api/creative-generation/jobs/[jobId]/route.ts");
  assert.match(jobRoute, /cancelQueuedGenerationJob\(job\.id\)/);
  assert.match(css, /\.indicator \{[\s\S]*position: fixed/);
});

test("12. native 생성 분기는 레거시 템플릿 렌더러를 정적 import하지 않는다", async () => {
  const route = await read("app/api/creative-generation/jobs/[jobId]/results/[resultId]/route.ts");
  assert.doesNotMatch(route, /^import .*renderer\.server/m);
  assert.match(route, /if \(job\.engine\)[\s\S]*handleNativeResultGeneration/);
  assert.match(route, /import\("\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/lib\/creative-generation\/renderer\.server"\)/);
});

test("13. native 최종 파일은 1200×1200 JPEG와 800KB 제한을 계속 검증한다", async () => {
  const storage = await read("app/lib/creative-generation/nativeCreativeStorage.server.ts");
  const download = await read("app/api/creative-generation/jobs/[jobId]/results/[resultId]/download/route.ts");
  assert.match(storage, /MAX_FINAL_BYTES\s*=\s*800 \* 1024/);
  assert.match(storage, /width:\s*1200/);
  assert.match(download, /metadata\.format !== "jpeg"/);
});

test("14. Codex 로컬 실패는 유료 API로 자동 전환되지 않고 생성 API는 localhost로 제한된다", async () => {
  const provider = await read("app/lib/creative-generation/providers/providerFactory.server.ts");
  const access = await read("app/lib/creative-generation/localGenerationAccess.server.ts");
  const publicJob = await read("app/lib/creative-generation/publicJob.server.ts");
  assert.doesNotMatch(provider, /catch[\s\S]{0,200}openai_api/);
  assert.match(access, /loopbackHosts/);
  assert.match(access, /headers\.get\("host"\)/);
  assert.match(access, /ADATLAS_INTERNAL_GENERATION_TOKEN/);
  assert.doesNotMatch(publicJob, /codexThreadId/);
  assert.match(publicJob, /finalPath:\s*undefined/);
});
