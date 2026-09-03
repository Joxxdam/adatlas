import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("AdAtlas 이미지 세션만 2일 보관 후 공식 Codex 삭제 명령으로 정리한다", async () => {
  const source = await read("app/lib/creative-generation/codexImageSessionRetention.server.ts");
  assert.match(source, /const RETENTION_DAYS = 2/);
  assert.match(source, /THREAD_ID_PATTERN/);
  assert.match(source, /path\.basename\(candidate\)\.endsWith\(`-\$\{threadId\}\.jsonl`\)/);
  assert.match(source, /\["delete", "--force", record\.threadId\]/);
  assert.match(source, /resolveCodexLocalExecutable\(\)/);
  assert.match(source, /activeThreadIds\.has\(record\.threadId\)/);
  assert.doesNotMatch(source, /unlink\(|rm\(|rmdir\(|\.data["', ]*,["', ]*"generated"/);
});

test("생성 공급자는 성공·실패 모두 세션을 등록하고 닫으며 정리 실패가 제작을 막지 않는다", async () => {
  const provider = await read("app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts");
  assert.match(provider, /trackCodexImageSession/);
  assert.match(provider, /closeCodexImageSession/);
  assert.match(provider, /finally \{\s+await syncThreadTracking\(\)/);
  assert.match(provider, /closeCodexImageSession\(threadId\)\.catch\(\(\) => undefined\)/);
});

test("서버 자동 점검과 이미지 제작 관리 화면은 세션 ID나 로컬 경로를 공개하지 않는다", async () => {
  const [instrumentation, route, workspace] = await Promise.all([
    read("instrumentation.ts"),
    read("app/api/admin/codex-sessions/route.ts"),
    read("app/components/codex-sessions/CodexSessionCleanupWorkspace.tsx"),
  ]);
  assert.match(instrumentation, /ensureCodexImageSessionCleanupScheduler\(\)/);
  assert.match(route, /getCodexImageSessionRetentionStatus/);
  assert.match(route, /verifyLocalGenerationAccess\(request\)/);
  assert.doesNotMatch(route, /threadId|sessionPath|codexSessionRoot/);
  assert.match(workspace, /Codex 세션 정리/);
  assert.match(workspace, /완성 이미지, 아카이브와 제작 작업은 삭제하지 않습니다/);
  assert.match(workspace, /기존의 다른 Codex 대화는 자동 삭제하지 않습니다/);
});

test("아카이브 삭제는 연결된 종료 세션만 즉시 정리하고 활성 세션은 보존한다", async () => {
  const [retention, archiveService, navigation, autoWorkspace] = await Promise.all([
    read("app/lib/creative-generation/codexImageSessionRetention.server.ts"),
    read("app/lib/creative-archive/service.server.ts"),
    read("app/components/AppFeatureNavigation.tsx"),
    read("app/components/auto-production/AutoProductionWorkspace.tsx"),
  ]);
  assert.match(retention, /deleteClosedCodexImageSessionsForResults/);
  assert.match(retention, /record\.state === "active" \|\| activeThreadIds\.has\(record\.threadId\)/);
  assert.match(archiveService, /entry\.jobId && entry\.resultId/);
  assert.match(archiveService, /deleteClosedCodexImageSessionsForResults/);
  assert.match(navigation, /href: "\/admin\/codex-sessions", label: "Codex 세션 정리"/);
  assert.ok(navigation.indexOf('label: "Codex 세션 정리"') > navigation.indexOf('label: "레퍼런스 관리"'));
  assert.doesNotMatch(autoWorkspace, /Codex 이미지 세션 정리|\/api\/auto-production\/codex-sessions/);
});

test("과거 세션 정리는 exec·프로젝트 경로·생성 결과 경로·정확 UUID를 모두 확인하고 기본값은 검토 전용이다", async () => {
  const source = await read("scripts/cleanup-legacy-adatlas-image-sessions.mjs");
  assert.match(source, /const RETENTION_DAYS = 2/);
  assert.match(source, /metadata\?\.source !== "exec"/);
  assert.match(source, /generatedPathPattern\.test\(userText\)/);
  assert.match(source, /metadataThreadId !== fileThreadId/);
  assert.match(source, /process\.argv\.includes\("--execute"\)/);
  assert.match(source, /\["delete", "--force", candidate\.threadId\]/);
  assert.match(source, /mtimeMs >= cutoff/);
  assert.doesNotMatch(source, /unlink\(|rm\(|rmdir\(/);
});
