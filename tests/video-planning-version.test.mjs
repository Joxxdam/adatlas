import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createVideoProjectRepository } from "../app/lib/video-collaboration/repository.server.ts";
import {
  CURRENT_VIDEO_PLANNING_ENGINE_VERSION,
  currentVideoCreativePremiseIssue,
  isCurrentVideoPlanningConcept,
} from "../app/lib/video-collaboration/videoPlanningVersion.ts";

const analysis = {
  productName: "민트 티트리 샤워젤 250ml",
  brandName: "Original Source",
  category: "생활·뷰티",
  productUrl: "https://example.com/products/mint",
  price: "12,000원",
  originalPrice: "",
  discountInfo: "",
  coreUsps: ["민트와 티트리의 상쾌한 사용감"],
  keyFeatures: [],
  targetCustomers: [],
  customerProblems: [],
  trustSignals: [],
  cautionPhrases: [],
  imageUrls: [],
  rawDescription: "",
  source: "test",
  analyzedAt: "2026-09-02T00:00:00.000Z",
};

const guideline = {
  toneAndManner: "짧고 구체적인 구어체",
  primaryAudience: "신규 고객",
  coreUsps: "민트와 티트리",
  requiredPhrases: [],
  forbiddenPhrases: [],
  advertiserRequests: "",
  designerNotes: "",
};

test("최신 기획 계약은 구체적 창작 인물·세계·사건·상품 사실 경계를 모두 요구한다", () => {
  const latest = {
    conceptArchetype: "usp-focus",
    distinctiveCharacter: "막차 전 오래된 동네 체육관에서 마지막으로 샤워하는 야근 많은 직장인",
    socialWorld: "밤 10시 막차를 앞둔 20년 된 동네 체육관의 습기 찬 공동 샤워실",
    storyTrigger: "막차까지 12분 남은 순간 쓰던 샤워젤이 비어 가방 속 새 상품을 꺼낸다.",
    truthBridge: "검증된 민트와 티트리 특징을 급한 운동 후 샤워 장면의 선택 이유로 연결한다.",
    dramatizationBoundary: "직장인과 체육관 사건은 창작 상황극이며 민트와 티트리는 검증된 상품 사실이다.",
  };
  assert.equal(isCurrentVideoPlanningConcept(latest), true);
  assert.equal(currentVideoCreativePremiseIssue({ ...latest, distinctiveCharacter: "일반 사용자" }).length > 0, true);
  assert.equal(currentVideoCreativePremiseIssue({ ...latest, socialWorld: "욕실" }).length > 0, true);
});

test("가상의 의사 가족 추천은 창작 경계를 명시하면 최신 기획으로 허용한다", () => {
  const fictionalDoctor = {
    conceptArchetype: "real-review",
    distinctiveCharacter: "성분표부터 읽는 가상의 의사 남편과 신제품을 먼저 써 보는 아내",
    socialWorld: "야간 진료를 마치고 돌아온 부부가 욕실 선반을 정리하는 늦은 저녁",
    storyTrigger: "가상의 의사 남편이 향을 맡아 보고 이번에는 자기가 먼저 쓰겠다고 추천한다.",
    truthBridge: "검증된 민트와 티트리 특징을 남편이 개인적으로 고른 이유와 연결한다.",
    dramatizationBoundary: "의사 남편과 부부의 추천 장면은 광고용 가상 상황극이며 민트와 티트리만 검증된 상품 사실이다.",
  };
  assert.equal(isCurrentVideoPlanningConcept(fictionalDoctor), true);
  assert.match(
    currentVideoCreativePremiseIssue({
      ...fictionalDoctor,
      dramatizationBoundary: "부부의 추천 장면은 창작 상황극이며 상품 원료만 검증된 사실이다.",
    }),
    /의사 가족 추천/
  );
});

test("새 프로젝트는 외부 입력과 무관하게 최신 4안 엔진으로 고정된다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-version-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const project = await repository.create({
      projectName: "최신 엔진 테스트",
      advertiserName: "오리지널소스",
      productUrl: analysis.productUrl,
      marketerName: "마케터",
      designerName: "",
      duration: 30,
      planningMode: "legacy",
      format: "short-form",
      objective: "new-customer-hook",
      additionalRequests: "",
      referenceAssets: [],
      productAnalysis: analysis,
      brandGuideline: guideline,
    });
    assert.equal(project.planningMode, "four-concepts");
    assert.equal(project.videoPlanningEngineVersion, CURRENT_VIDEO_PLANNING_ENGINE_VERSION);

    const storePath = path.join(directory, "projects.json");
    const store = JSON.parse(await readFile(storePath, "utf8"));
    store.projects[0].planningMode = "legacy";
    delete store.projects[0].videoPlanningEngineVersion;
    store.projects[0].hookCandidates = [{ id: "old-generic-hook" }];
    await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

    const migrated = await createVideoProjectRepository({ dataDirectory: directory }).get(project.id);
    assert.equal(migrated.planningMode, "four-concepts");
    assert.equal(migrated.videoPlanningEngineVersion, "legacy");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("구형 규칙 생성기 파일과 활성 import 연결은 남지 않는다", async () => {
  for (const file of [
    "app/lib/video-collaboration/scriptGenerator.ts",
    "app/lib/video-collaboration/planningPipeline.ts",
    "app/lib/video-collaboration/prompts.ts",
  ]) {
    await assert.rejects(access(file));
  }
  const [generatorParts, conceptsRoute, detailRoute] = await Promise.all([
    Promise.all([
      "videoPlanningGenerator.server.ts",
      "videoPlanningPromptSupport.ts",
      "videoConceptGenerator.server.ts",
      "videoScriptGenerator.server.ts",
    ].map((file) => readFile(`app/lib/video-collaboration/${file}`, "utf8"))),
    readFile("app/api/video-projects/[projectId]/concepts/route.ts", "utf8"),
    readFile("app/api/video-projects/[projectId]/concepts/[conceptId]/route.ts", "utf8"),
  ]);
  const generator = generatorParts.join("\n");
  assert.doesNotMatch(generator, /fourConceptMode|planningMode|request\(undefined\)|buildVideoHookCandidates/);
  assert.match(generator, /requestFourVideoConcepts/);
  assert.match(generator, /currentVideoCreativePremiseIssue/);
  assert.match(conceptsRoute, /CURRENT_VIDEO_PLANNING_ENGINE_VERSION/);
  assert.match(conceptsRoute, /project\.concepts\.filter\(isCurrentVideoPlanningConcept\)/);
  assert.match(detailRoute, /isCurrentVideoPlanningConcept/);
});
