import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createVideoProjectRepository } from "../app/lib/video-collaboration/repository.server.ts";
import { resequenceVideoCuts, videoScriptCsv } from "../app/lib/video-collaboration/script.ts";
import { buildCurrentProductSelfIntroductionHook } from "../app/lib/video-collaboration/videoPlanningHookFallback.ts";
import { isCurrentVideoPlanningConcept } from "../app/lib/video-collaboration/videoPlanningVersion.ts";
import { detectSceneReferenceType } from "../app/lib/video-collaboration/referenceImage.ts";
import { detectVideoType } from "../app/lib/video-collaboration/videoFile.ts";
import { canTransitionVideoProject, createVideoMaterialCode, validateVideoMaterialCode } from "../app/lib/video-collaboration/workflow.ts";
import { validateDetailedPlanning } from "../app/lib/video-collaboration/planningValidation.ts";

const analysis = {
  productName: "민트 티트리 샤워젤 250ml",
  brandName: "Original Source",
  category: "생활·뷰티",
  productUrl: "https://example.com/products/mint",
  price: "12,000원",
  originalPrice: "",
  discountInfo: "무료배송",
  coreUsps: ["민트와 티트리의 상쾌한 사용감"],
  keyFeatures: ["샤워 후 산뜻한 마무리"],
  targetCustomers: ["운동 후 샤워하는 고객"],
  customerProblems: ["샤워 후에도 남는 찝찝함"],
  trustSignals: ["상쾌한 사용감이 좋다는 공개 후기"],
  cautionPhrases: ["확인되지 않은 체감 수치를 사용하지 않기"],
  imageUrls: ["/fixture/mint.webp"],
  rawDescription: "민트와 티트리 특징을 소개하는 샤워젤",
  source: "existing-product-extractor",
  analyzedAt: "2026-08-18T00:00:00.000Z",
};

const guideline = {
  toneAndManner: "짧고 선명하게",
  primaryAudience: "운동을 즐기는 고객",
  coreUsps: "상쾌한 사용감",
  requiredPhrases: ["상품 상세 확인"],
  forbiddenPhrases: ["무조건 1위"],
  advertiserRequests: "첫 3초에 제품 노출",
  designerNotes: "세로형 안전 영역 준수",
};

function buildTestVideoConcepts(input) {
  const hookTypes = input.hookTypes || ["problem-solution", "feature-usp", "sensory-scene"];
  const times = input.duration === 20
    ? [[0, 3], [3, 7], [7, 12], [12, 18], [18, 20]]
    : [[0, 3], [3, 6], [6, 9], [9, 12], [12, 15]];
  const existingCodes = (input.existingConcepts || []).map((item) => item.materialCode);
  return hookTypes.map((hookType, conceptIndex) => {
    const previous = input.existingConcepts?.find((item) => item.hookType === hookType);
    const cta = "상품 상세 확인하세요";
    const cuts = times.map(([startSecond, endSecond], index) => ({
      id: previous?.cuts[index]?.id || crypto.randomUUID(),
      cutNumber: index + 1,
      sceneName: `장면 ${index + 1}`,
      startSecond,
      endSecond,
      sceneDescription: `운동을 마친 인물이 오래된 동네 체육관 샤워실에서 민트 티트리 샤워젤을 꺼내는 구체적인 장면 ${index + 1}`,
      caption: index === times.length - 1 ? cta : `민트와 티트리 사용 장면 ${index + 1}`,
      narration: `민트와 티트리의 산뜻한 사용감을 보여주는 설명 ${index + 1}`,
      requiredSources: [],
      referenceImages: previous?.cuts[index]?.referenceImages || [],
      productionMemo: previous?.cuts[index]?.productionMemo || "",
      cameraComposition: "세로형 근접 촬영",
      motionDirection: "왼쪽에서 오른쪽",
      transition: "행동 매치컷",
      generationPrompt: "오래된 동네 체육관 샤워실의 실제 사용 장면",
      productLockInstruction: {
        useOriginalComposite: index >= 2,
        position: "중앙",
        size: "화면 높이 35%",
        cameraAngle: "정면",
        handInteraction: "손으로 든다",
        labelVisibility: "라벨 전체 노출",
        matchCut: "동일 방향",
        editMargin: "좌우 8%",
      },
    }));
    const materialCode = previous?.materialCode || createVideoMaterialCode({
      advertiserName: input.advertiserName,
      productName: input.analysis.productName,
      hookType,
      existingCodes,
      createdAt: input.now,
    });
    existingCodes.push(materialCode);
    return {
      id: previous?.id || crypto.randomUUID(),
      title: `체육관 샤워실 사건 ${conceptIndex + 1}`,
      hookType,
      coreTarget: "퇴근 뒤 오래된 동네 체육관에서 운동하는 직장인",
      objective: input.objective,
      openingHook: "퇴근 뒤 체육관 샤워실에서 늘 마지막까지 남는 사람이라면?",
      fullScript: cuts.map((cut) => cut.narration).join(" "),
      cuts,
      requiredSources: [],
      cta,
      productionCautions: [],
      materialCode,
      generationSource: "codex-local",
      generationWarnings: [],
      conceptArchetype: "usp-focus",
      revision: (previous?.revision || 0) + 1,
      createdAt: previous?.createdAt || input.now.toISOString(),
      updatedAt: input.now.toISOString(),
      distinctiveCharacter: "퇴근 뒤 20년 된 동네 체육관에서 마지막 순서로 샤워하는 야근 많은 직장인",
      socialWorld: "밤 10시, 오래된 동네 체육관의 습기 찬 공동 샤워실과 막차를 앞둔 퇴근 동선",
      storyTrigger: "막차까지 12분 남은 순간 익숙한 샤워젤이 비어 있어 가방 속 민트 티트리 샤워젤을 꺼낸다.",
      truthBridge: "민트와 티트리라는 검증된 상품 특징을 급한 운동 후 샤워 장면의 선택 이유로 연결한다.",
      dramatizationBoundary: "체육관과 직장인은 창작 상황극이며 민트와 티트리는 검증된 상품 사실이다.",
    };
  });
}

test("영상 소재코드는 지정 형식과 프로젝트 내 순번을 지킨다", () => {
  const first = createVideoMaterialCode({
    advertiserName: "Original Source",
    productName: "Mint Shower Gel",
    hookType: "feature-usp",
    createdAt: new Date("2026-08-18T00:00:00.000Z"),
  });
  const second = createVideoMaterialCode({
    advertiserName: "Original Source",
    productName: "Mint Shower Gel",
    hookType: "feature-usp",
    createdAt: new Date("2026-08-18T00:00:00.000Z"),
    existingCodes: [first],
  });
  assert.equal(validateVideoMaterialCode(first), true);
  assert.match(first, /^VIDEO_ORIGINAL_SOURCE_MINT_SHOWER_GEL_USP_20260818_01$/);
  assert.equal(second.endsWith("_02"), true);
});

test("영상 소재코드 날짜는 서버 위치와 관계없이 Asia/Seoul 기준이다", () => {
  const code = createVideoMaterialCode({
    advertiserName: "Original Source",
    productName: "Mint Shower Gel",
    hookType: "feature-usp",
    createdAt: new Date("2026-08-18T15:30:00.000Z"),
  });
  assert.match(code, /_20260819_01$/);
});

test("저장용 최신 기획안 fixture는 구체적 인물·세계·사건 계약을 지킨다", () => {
  const concepts = buildTestVideoConcepts({
    advertiserName: "오리지널소스",
    analysis,
    guideline,
    duration: 15,
    objective: "purchase",
    now: new Date("2026-08-18T00:00:00.000Z"),
  });
  assert.equal(concepts.length, 3);
  assert.equal(new Set(concepts.map((item) => item.hookType)).size, 3);
  assert.equal(new Set(concepts.map((item) => item.materialCode)).size, 3);
  assert.equal(
    concepts.every((item) => item.cuts.at(-1)?.endSecond === 15),
    true
  );
  assert.equal(
    concepts.some((item) => JSON.stringify(item).includes("무조건 1위")),
    false
  );
  assert.equal(concepts.every(isCurrentVideoPlanningConcept), true);
});

test("최신 자기소개형 보완 후킹은 검증 사실과 ‘나 ~인데’ 구조를 유지한다", () => {
  const grounded = {
    ...analysis,
    verifiedFacts: [
      { id: "fact-price", label: "가격", value: "12,000원", source: "상품 상세페이지", bucket: "verified" },
      { id: "fact-usp", label: "USP", value: "민트와 티트리의 상쾌한 사용감", source: "상품 상세페이지", bucket: "verified" },
    ],
    verifiedNumbers: ["12,000원"],
    unsupportedClaims: [{ id: "unsupported-1", label: "사용 금지", value: "체감온도 -8.9도", source: "검증 규칙", bucket: "unsupported" }],
  };
  const candidate = buildCurrentProductSelfIntroductionHook(grounded);
  assert.equal(candidate.hookType, "product-self-introduction");
  assert.match(candidate.hook, /^나\s/u);
  assert.match(candidate.hook, /인데!/u);
  assert.doesNotMatch(candidate.hook, /체감온도 -8\.9도/u);
});

test("20초 기획은 후킹→문제→제품→근거→CTA가 빈 시간 없이 이어진다", () => {
  const concept = buildTestVideoConcepts({
    advertiserName: "오리지널소스",
    analysis,
    guideline,
    duration: 20,
    objective: "purchase",
    now: new Date("2026-08-18T00:00:00.000Z"),
  })[0];
  assert.deepEqual(
    concept.cuts.map((cut) => [cut.startSecond, cut.endSecond]),
    [
      [0, 3],
      [3, 7],
      [7, 12],
      [12, 18],
      [18, 20],
    ]
  );
  assert.equal(
    concept.cuts.every((cut) => cut.cameraComposition && cut.motionDirection && cut.transition && cut.generationPrompt),
    true
  );
  assert.equal(
    concept.cuts.slice(2).every((cut) => cut.productLockInstruction?.useOriginalComposite),
    true
  );
  const csv = videoScriptCsv({
    projectName: "CSV 테스트",
    advertiserName: "오리지널소스",
    productAnalysis: analysis,
    concepts: [concept],
    selectedConceptId: concept.id,
  });
  assert.match(csv, /카메라·구도/);
  assert.match(csv, /생성 프롬프트/);
});

test("상태 전이는 제작 시작과 업로드 검수를 건너뛰지 않는다", () => {
  assert.equal(canTransitionVideoProject("script_review", "production_requested"), true);
  assert.equal(canTransitionVideoProject("production_requested", "marketer_review"), false);
  assert.equal(canTransitionVideoProject("production_requested", "in_production"), true);
  assert.equal(canTransitionVideoProject("marketer_review", "approved"), true);
  assert.equal(canTransitionVideoProject("approved", "revision_requested"), false);
});

test("엑셀형 제작 대본처럼 15개 장면을 순서와 시간에 맞게 재배치한다", () => {
  const base = buildTestVideoConcepts({
    advertiserName: "오리지널소스",
    analysis,
    guideline,
    duration: 15,
    objective: "purchase",
    now: new Date("2026-08-18T00:00:00.000Z"),
  })[0].cuts[0];
  const cuts = Array.from({ length: 15 }, (_, index) => ({
    ...structuredClone(base),
    id: crypto.randomUUID(),
    cutNumber: index + 1,
    sceneName: `장면 ${index + 1}`,
    caption: `자막 ${index + 1}`,
  }));
  const ordered = resequenceVideoCuts(cuts.reverse(), 15);
  assert.equal(ordered.length, 15);
  assert.deepEqual(
    ordered.map((cut) => [cut.cutNumber, cut.startSecond, cut.endSecond]),
    Array.from({ length: 15 }, (_, index) => [index + 1, index, index + 1])
  );
});

test("장면별 참고 이미지와 메모가 재조회와 대본 재생성 후에도 유지된다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-script-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const created = await repository.create({
      projectName: "엑셀형 대본 저장 테스트",
      advertiserName: "오리지널소스",
      productUrl: analysis.productUrl,
      marketerName: "박마케팅",
      designerName: "김디자인",
      duration: 15,
      format: "short-form",
      objective: "purchase",
      additionalRequests: "참고 이미지 의도 유지",
      referenceAssets: [],
      productAnalysis: analysis,
      brandGuideline: guideline,
    });
    const concepts = buildTestVideoConcepts({
      advertiserName: created.advertiserName,
      analysis,
      guideline,
      duration: 15,
      objective: "purchase",
      now: new Date("2026-08-18T00:00:00.000Z"),
    });
    await repository.saveGeneratedConcepts(created.id, concepts);
    const edited = structuredClone(concepts[0]);
    edited.cuts[0].referenceImages = [
      {
        id: crypto.randomUUID(),
        source: "upload",
        filePath: `/video-collaboration/script-references/${created.id}/scene-1.png`,
        name: "scene-1.png",
        mimeType: "image/png",
        size: 2048,
        description: "제품이 중앙에 보이는 구도",
        required: true,
        createdAt: "2026-08-18T01:00:00.000Z",
      },
    ];
    edited.cuts[0].productionMemo = "라벨이 가려지지 않게 제작";
    await repository.saveScript(created.id, edited.id, edited, "박마케팅", {
      productionNotes: "전체 장면에서 제품 색상 유지",
    });

    const reloadedRepository = createVideoProjectRepository({ dataDirectory: directory });
    const reloaded = await reloadedRepository.get(created.id);
    assert.equal(reloaded?.concepts[0].cuts[0].referenceImages[0].required, true);
    assert.equal(reloaded?.concepts[0].cuts[0].productionMemo, "라벨이 가려지지 않게 제작");
    assert.equal(reloaded?.productionNotes, "전체 장면에서 제품 색상 유지");

    const regenerated = buildTestVideoConcepts({
      advertiserName: created.advertiserName,
      analysis,
      guideline,
      duration: 15,
      objective: "purchase",
      hookTypes: [edited.hookType],
      existingConcepts: [reloaded.concepts[0]],
      now: new Date("2026-08-19T00:00:00.000Z"),
    });
    await reloadedRepository.saveGeneratedConcepts(created.id, regenerated, {
      conceptId: edited.id,
      actor: "박마케팅",
    });
    const afterRegeneration = await reloadedRepository.get(created.id);
    assert.equal(afterRegeneration?.concepts[0].cuts[0].referenceImages.length, 1);
    assert.equal(afterRegeneration?.concepts[0].cuts[0].referenceImages[0].description, "제품이 중앙에 보이는 구도");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("수동 저장 버전은 이전 내용을 덮어쓰지 않고 복원할 수 있다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-revision-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const created = await repository.create({
      projectName: "대본 버전 복원 테스트",
      advertiserName: "오리지널소스",
      productUrl: analysis.productUrl,
      marketerName: "박마케팅",
      designerName: "",
      duration: 20,
      format: "short-form",
      objective: "purchase",
      additionalRequests: "",
      referenceAssets: [],
      productAnalysis: analysis,
      brandGuideline: guideline,
    });
    const [concept] = buildTestVideoConcepts({
      advertiserName: created.advertiserName,
      analysis,
      guideline,
      duration: 20,
      objective: "purchase",
      now: new Date("2026-08-20T00:00:00.000Z"),
    });
    await repository.saveGeneratedConcepts(created.id, [concept]);

    const second = structuredClone(concept);
    second.openingHook = "운동 뒤에도 남는 찝찝함, 샤워 순서부터 보세요";
    second.cuts[0].caption = second.openingHook;
    await repository.saveScript(created.id, concept.id, second, "박마케팅", {
      createRevision: true,
    });
    const third = structuredClone(second);
    third.openingHook = "운동복 입기 전, 이 샤워 장면을 확인하세요";
    third.cuts[0].caption = third.openingHook;
    await repository.saveScript(created.id, concept.id, third, "박마케팅", {
      createRevision: true,
    });

    const saved = await repository.get(created.id);
    const secondRevision = saved?.scriptRevisions.find((revision) => revision.snapshot.openingHook === second.openingHook);
    assert.ok(secondRevision);
    await repository.restoreScriptRevision(created.id, secondRevision.id, "박마케팅");
    const restored = await createVideoProjectRepository({ dataDirectory: directory }).get(created.id);
    assert.equal(restored?.concepts[0].openingHook, second.openingHook);
    assert.equal(restored?.concepts[0].revision, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("프로젝트·버전·피드백·승인 이력이 재조회 후에도 유지된다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const created = await repository.create({
      projectName: "민트 샤워젤 여름 영상",
      advertiserName: "오리지널소스",
      productUrl: analysis.productUrl,
      designerName: "김디자인",
      duration: 15,
      format: "short-form",
      objective: "purchase",
      additionalRequests: "제품을 첫 장면에 노출",
      referenceAssets: [],
      productAnalysis: analysis,
      brandGuideline: guideline,
    });
    const concepts = buildTestVideoConcepts({
      advertiserName: created.advertiserName,
      analysis,
      guideline,
      duration: 15,
      objective: "purchase",
      now: new Date("2026-08-18T00:00:00.000Z"),
    });
    await repository.saveGeneratedConcepts(created.id, concepts);
    await assert.rejects(repository.updateConcept(created.id, concepts[0].id, { ...concepts[0], openingHook: "무조건 1위 상품" }, "마케터"), /금지 문구/);
    const detailed = structuredClone(concepts[0]);
    const actions = ["젖은 운동복을 내려놓는다", "이마의 땀을 닦는다", "샤워기 손잡이를 돌린다", "거울 속 표정을 바라본다", "선반 문을 천천히 연다", "상품을 손으로 꺼낸다", "손바닥에 내용물을 덜어낸다", "손가락으로 질감을 펼친다", "양손으로 거품을 만든다", "어깨를 따라 거품을 문지른다", "샤워기 물로 씻어낸다", "수건을 들고 웃는다", "깨끗한 옷을 가방에 넣는다", "현관에서 신발을 신는다", "상세 화면을 손으로 누른다"];
    const captions = ["왜 또 찝찝하죠?", "운동 뒤 더 심해요!", "샤워 순서 봐요", "익숙함은 잠깐", "답답함이 남아요", "상쾌함이 필요해요", "민트와 티트리예요", "사용감부터 봐요", "손에 덜어 봐요", "거품이 퍼져요", "물로 씻어내요", "표정이 풀려요", "운동복도 챙겨요", "다음 샤워 전엔", concepts[0].cta];
    detailed.cuts = actions.map((action, index) => ({
      ...structuredClone(concepts[0].cuts[0]),
      id: crypto.randomUUID(),
      cutNumber: index + 1,
      sceneName: `구간 ${index + 1}`,
      startSecond: index,
      endSecond: index + 1,
      caption: captions[index],
      narration: index < 8 ? captions[index] : "",
      sceneDescription: `밝은 욕실과 샤워실 배경에서 운동을 마친 인물이 ${action} 손의 움직임과 편안해지는 표정을 먼저 보여준다. 화면은 이 행동이 자막의 의미로 이어지는 순간을 가까이 담고 다음 구간의 다른 행동으로 자연스럽게 전환한다.`,
      referenceImages: [],
      requiredSources: [],
      productionMemo: "",
    }));
    detailed.fullScript = detailed.cuts.map((cut) => cut.caption).join(" ");
    detailed.validation = validateDetailedPlanning(detailed, analysis, 15);
    assert.equal(detailed.validation.valid, true);
    await repository.saveGeneratedConcepts(created.id, [detailed], {
      conceptId: detailed.id,
      actor: "마케터",
    });
    await repository.requestProduction({
      projectId: created.id,
      conceptId: detailed.id,
      deadline: "2026-08-25",
      actor: "마케터",
    });
    await assert.rejects(
      repository.addVersion(
        created.id,
        {
          id: crypto.randomUUID(),
          versionNumber: 1,
          filePath: "/video-collaboration/videos/test/skip.mp4",
          originalFileName: "skip.mp4",
          storedFileName: `${concepts[0].materialCode}_v1.mp4`,
          mimeType: "video/mp4",
          size: 1200,
          uploadedBy: "김디자인",
          uploadedAt: "2026-08-19T00:00:00.000Z",
          reviewStatus: "pending",
        },
        "김디자인"
      ),
      /현재 상태/
    );
    await repository.startProduction(created.id, "김디자인");
    const firstVersion = {
      id: crypto.randomUUID(),
      versionNumber: 1,
      filePath: "/video-collaboration/videos/test/v1.mp4",
      originalFileName: "draft.mp4",
      storedFileName: `${concepts[0].materialCode}_v1.mp4`,
      mimeType: "video/mp4",
      size: 1200,
      uploadedBy: "김디자인",
      uploadedAt: "2026-08-20T00:00:00.000Z",
      reviewStatus: "pending",
    };
    await repository.addVersion(created.id, firstVersion, "김디자인");
    await repository.addComment(
      created.id,
      {
        id: crypto.randomUUID(),
        versionId: firstVersion.id,
        body: "5초 자막을 더 크게",
        author: "마케터",
        timecodeSeconds: 5,
        createdAt: "2026-08-21T00:00:00.000Z",
        resolved: false,
      },
      { requestRevision: true, actor: "마케터" }
    );
    const secondVersion = {
      ...firstVersion,
      id: crypto.randomUUID(),
      versionNumber: 2,
      storedFileName: `${concepts[0].materialCode}_v2.mp4`,
      uploadedAt: "2026-08-22T00:00:00.000Z",
    };
    await repository.addVersion(created.id, secondVersion, "김디자인");
    await repository.approveVersion(created.id, secondVersion.id, "마케터");

    const reloaded = await createVideoProjectRepository({ dataDirectory: directory }).get(created.id);
    assert.equal(reloaded?.status, "approved");
    assert.equal(reloaded?.versions.length, 2);
    assert.equal(reloaded?.comments[0].timecodeSeconds, 5);
    assert.equal(reloaded?.approvedVersionId, secondVersion.id);
    assert.equal(reloaded?.statusHistory.at(-1)?.to, "approved");
    assert.equal(Boolean(reloaded?.milestones.productionStartedAt), true);
    assert.equal(Boolean(reloaded?.milestones.videoUploadedAt), true);
    assert.equal(Boolean(reloaded?.milestones.revisionRequestedAt), true);
    assert.equal(Boolean(reloaded?.milestones.approvedAt), true);

    const duplicated = await repository.duplicateApproved(created.id, "마케터");
    assert.equal(duplicated.status, "script_review");
    assert.equal(duplicated.sourceProjectId, created.id);
    assert.equal(duplicated.versions.length, 0);
    assert.equal(duplicated.comments.length, 0);
    assert.equal(Boolean(duplicated.finalScript), false);
    assert.notEqual(duplicated.concepts[0].materialCode, concepts[0].materialCode);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("업로드 파일 시그니처에서 MP4와 WEBM을 식별한다", () => {
  const mp4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(detectVideoType(mp4), "video/mp4");
  assert.equal(detectVideoType(webm), "video/webm");
  assert.equal(detectVideoType(Buffer.from("not-video")), "");
});

test("장면 참고 이미지의 PNG·JPEG·WEBP 시그니처를 검증한다", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  const webp = Buffer.from("RIFF0000WEBP", "ascii");
  assert.equal(detectSceneReferenceType(png), "image/png");
  assert.equal(detectSceneReferenceType(jpeg), "image/jpeg");
  assert.equal(detectSceneReferenceType(webp), "image/webp");
  assert.equal(detectSceneReferenceType(Buffer.from("svg")), "");
});

test("같은 저장 경로를 쓰는 repository 동시 갱신도 JSON 데이터를 잃지 않는다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-concurrent-"));
  try {
    const first = createVideoProjectRepository({ dataDirectory: directory });
    const second = createVideoProjectRepository({ dataDirectory: directory });
    const created = await first.create({
      projectName: "동시 저장 테스트",
      advertiserName: "오리지널소스",
      productUrl: analysis.productUrl,
      designerName: "김디자인",
      duration: 15,
      format: "short-form",
      objective: "purchase",
      additionalRequests: "",
      referenceAssets: [],
      productAnalysis: analysis,
      brandGuideline: guideline,
    });
    await Promise.all([first.updateDetails(created.id, { marketerName: "박마케팅" }), second.updateDetails(created.id, { productionNotes: "동시 저장 메모" })]);
    const reloaded = await first.get(created.id);
    assert.equal(reloaded?.marketerName, "박마케팅");
    assert.equal(reloaded?.productionNotes, "동시 저장 메모");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
