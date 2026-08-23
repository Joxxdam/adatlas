import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();

test("자동 광고문구 파이프라인은 정확히 6개를 생성하고 첫 문구를 적용한다", async () => {
  const [strategySource, apiSource, copyApiSource, workflowSource, dashboardSource] = await Promise.all([readFile(path.join(projectRoot, "app/lib/mvp/creativeStrategy.ts"), "utf8"), readFile(path.join(projectRoot, "app/api/strategy/generate-directions/route.ts"), "utf8"), readFile(path.join(projectRoot, "app/api/strategy/generate-copy/route.ts"), "utf8"), readFile(path.join(projectRoot, "app/components/features/creative-workflow/useCreativeWorkflow.ts"), "utf8"), readFile(path.join(projectRoot, "app/components/MvpDashboard.tsx"), "utf8")]);

  assert.match(strategySource, /const unique = ordered\.slice\(0, 6\)/);
  assert.match(apiSource, /strategies\.slice\(0, 6\)/);
  assert.match(apiSource, /정확히 6개 만드세요/);
  assert.match(workflowSource, /hooks\.length !== 6/);
  assert.match(workflowSource, /setSelectedStrategyId\(hooks\[0\]\?\.id \|\| ""\)/);
  assert.match(copyApiSource, /creativeStrategies\?: CreativeStrategy\[\]/);
  assert.match(copyApiSource, /copies,/);
  assert.match(dashboardSource, /creativeWorkflow\.strategies\.slice\(0, 6\)/);
  assert.match(dashboardSource, /setCreativeGenerationMode\("hook-based"\)/);
});
