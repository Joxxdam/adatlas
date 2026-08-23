import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createVideoProjectRepository } from "../app/lib/video-collaboration/repository.server.ts";
import { assignPlanningTimeline, hasVerifiedVideoBenefit, segmentRange, validateConceptDiversity, validateDetailedPlanning } from "../app/lib/video-collaboration/planningValidation.ts";
import { extractVideoTitleMetadata, normalizeVideoProductName } from "../app/lib/video-collaboration/productName.ts";
import { createVideoMaterialCode } from "../app/lib/video-collaboration/workflow.ts";
import { assertStructuredVideoPlanningResponse } from "../app/lib/video-collaboration/structuredSchema.ts";

const beautyAnalysis = {
  productName: "민트 티트리 샤워젤 250ml",
  rawTitle: "[여름특가] 민트 티트리 샤워젤 250ml_후기 1등★무료배송 이벤트 | 오리지널소스",
  brandName: "오리지널소스",
  category: "뷰티·바디케어",
  productUrl: "https://example.com/products/mint",
  price: "12,000원",
  originalPrice: "",
  discountInfo: "무료배송",
  promotion: "무료배송",
  volumeOrOption: "250ml",
  coreUsps: ["민트와 티트리의 상쾌한 사용감"],
  keyFeatures: ["운동 후 샤워 상황에 어울리는 바디워시"],
  targetCustomers: ["운동 후 산뜻한 샤워를 원하는 고객"],
  customerProblems: ["운동 뒤에도 남는 찝찝함"],
  trustSignals: ["상쾌한 사용감이 좋다는 공개 후기"],
  cautionPhrases: ["확인되지 않은 체감 수치를 사용하지 않기"],
  imageUrls: [],
  rawDescription: "민트와 티트리 특징을 소개하는 샤워젤",
  source: "existing-product-extractor",
  analyzedAt: "2026-08-20T00:00:00.000Z",
  verifiedFacts: [
    { id: "fact-product", label: "상품명", value: "민트 티트리 샤워젤 250ml", source: "상품 상세", bucket: "verified" },
    { id: "fact-price", label: "가격", value: "12,000원", source: "상품 상세", bucket: "verified" },
    { id: "fact-usp", label: "특징", value: "민트와 티트리의 상쾌한 사용감", source: "상품 상세", bucket: "verified" },
  ],
  inferredAngles: [],
  unsupportedClaims: [],
  verifiedNumbers: ["250ml", "12,000원"],
};

const foodAnalysis = {
  ...beautyAnalysis,
  productName: "한우 알등심 1kg",
  rawTitle: "[명절한정] 후기1등★한우 알등심 1kg 실속팩_무료배송 사전예약",
  brandName: "국대한우",
  category: "식품·육류",
  productUrl: "https://example.com/products/beef",
  price: "45,000원",
  promotion: "명절 한정 판매",
  volumeOrOption: "1kg",
  coreUsps: ["뼈를 제외한 알등심 구성"],
  keyFeatures: ["가족 식사와 명절 선물에 활용"],
  targetCustomers: ["포장보다 실제 먹는 양을 보는 고객"],
  customerProblems: ["선물 세트에서 포장 비중이 큰 아쉬움"],
  verifiedFacts: [
    { id: "fact-product", label: "상품명", value: "한우 알등심 1kg", source: "상품 상세", bucket: "verified" },
    { id: "fact-price", label: "가격", value: "45,000원", source: "상품 상세", bucket: "verified" },
    { id: "fact-amount", label: "구성", value: "알등심 1kg", source: "상품 상세", bucket: "verified" },
  ],
  verifiedNumbers: ["1kg", "45,000원"],
};

const guideline = {
  toneAndManner: "짧고 구체적인 구어체",
  primaryAudience: "신규 고객",
  coreUsps: "검증된 상품 차이",
  requiredPhrases: [],
  forbiddenPhrases: ["프리미엄 퀄리티"],
  advertiserRequests: "",
  designerNotes: "",
};

const captions = ["씻고도 금방 찝찝했죠", "운동 뒤엔 더 빨랐고요", "문제는 샤워 순서였어요", "익숙한 방식부터 멈춰봐요", "몸에 남은 답답함을 보고", "상쾌한 감각이 필요한 순간", "민트와 티트리가 등장해요", "사용감의 차이를 확인하고", "손에 덜어 질감을 살펴봐요", "거품이 피부 위로 퍼지고", "물과 함께 산뜻해져요", "수건을 들 때 표정이 달라져요", "다시 운동 가방을 챙기고", "다음 샤워가 기다려진다면", "상품 정보를 직접 살펴봐요", "오늘 루틴부터 바꿔봐요", "가볍게 시작해도 좋아요", "지금 필요한 이유를 보세요", "한 번의 선택을 확인해요", "상품 상세 확인"];

const visualEvents = ["젖은 운동복을 내려놓는다", "이마의 땀을 수건으로 닦는다", "샤워기 손잡이를 돌린다", "기존 바디워시를 잠시 내려놓는다", "거울 속 굳은 표정을 바라본다", "민트색 패키지를 선반에서 꺼낸다", "손바닥에 내용물을 덜어낸다", "손가락으로 질감을 천천히 펼친다", "양손으로 거품을 충분히 만든다", "어깨를 따라 거품을 부드럽게 문지른다", "샤워기 물로 거품을 씻어낸다", "수건을 들고 편안하게 웃는다", "깨끗한 운동복을 가방에 넣는다", "현관 앞에서 가볍게 신발을 신는다", "상품 상세 화면을 손가락으로 누른다", "세면대 위 물방울을 닦아낸다", "열린 욕실 문 밖으로 걸어간다", "제품과 운동 가방을 나란히 둔다", "거울 앞에서 고개를 끄덕인다", "화면 아래 구매 정보를 확인한다"];

function makeSummary(analysis, index, hookType) {
  const variants = [
    { problem: "운동 뒤 남는 찝찝함", usp: "민트 사용감", speaker: "운동을 마친 직장인", style: "smartphone-ugc", structure: "불편 고백에서 샤워 루틴 변화로 이어지는 독백", cta: "상품 상세 확인" },
    { problem: "선택 기준을 모르는 답답함", usp: "검증된 구성", speaker: "제품을 비교하는 리뷰어", style: "ad-real", structure: "두 선택지를 대조한 뒤 근거를 확인하는 비교", cta: "구성 직접 확인" },
    { problem: "구매를 미루는 망설임", usp: "확인된 가격 혜택", speaker: "가족 구매를 준비하는 고객", style: "mixed", structure: "망설임과 손해를 짚은 뒤 구매 이유로 닫는 전개", cta: "구매 조건 확인" },
  ];
  const variant = variants[index];
  return {
    id: `concept-${index + 1}`,
    title: `서로 다른 영상 기획 ${index + 1}`,
    hookType,
    coreTarget: `${variant.speaker} 타깃`,
    objective: "new-customer-hook",
    openingHook: `${variant.problem}, 그대로 둘 건가요?`,
    fullScript: "",
    cuts: [],
    requiredSources: [],
    cta: variant.cta,
    productionCautions: [],
    materialCode: createVideoMaterialCode({
      advertiserName: analysis.brandName,
      productName: analysis.productName,
      hookType,
      existingCodes: [],
      createdAt: new Date("2026-08-20T00:00:00.000Z"),
    }),
    generationSource: "codex-local",
    generationWarnings: [],
    revision: 1,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    customerProblem: variant.problem,
    usp: variant.usp,
    creativeStyle: variant.style,
    narrativeSummary: variant.structure,
    recommendationReason: "상품 근거와 고객 상황을 구체적으로 연결할 수 있습니다.",
    claimsToVerify: [],
    evidenceIds: [analysis.verifiedFacts[0].id],
    speaker: variant.speaker,
    narrativeStructure: variant.structure,
    detailStatus: "not-generated",
  };
}

function makeDetailed(summary, analysis, duration, count = segmentRange(duration).preferred) {
  const rows = captions.slice(0, count).map((caption, index) => ({
    caption: index === count - 1 ? summary.cta : caption,
    narration: "",
    sceneDescription: `밝은 욕실과 샤워실 배경에서 운동을 마친 인물이 ${visualEvents[index]} 손의 움직임과 편안해지는 표정을 먼저 보여준다. 화면은 이 행동이 자막의 의미로 이어지는 순간을 가까이 담고 다음 구간의 다른 행동으로 자연스럽게 전환한다.`,
  }));
  const cuts = assignPlanningTimeline(rows, duration).map((row, index) => ({
    id: `cut-${index + 1}`,
    cutNumber: index + 1,
    sceneName: `구간 ${index + 1}`,
    startSecond: row.startSecond,
    endSecond: row.endSecond,
    sceneDescription: row.sceneDescription,
    caption: row.caption,
    narration: row.narration,
    requiredSources: [],
    referenceImages: [],
    productionMemo: "",
  }));
  const concept = {
    ...summary,
    fullScript: cuts.map((cut) => cut.caption).join(" "),
    cuts,
    detailStatus: "ready",
    revision: summary.revision + 1,
  };
  concept.validation = validateDetailedPlanning(concept, analysis, duration);
  return concept;
}

test("SEO 광고 문구를 정식 상품명과 혜택으로 분리한다", () => {
  const normalized = normalizeVideoProductName(foodAnalysis.rawTitle, "국대한우");
  assert.equal(normalized.includes("후기1등"), false);
  assert.equal(normalized.includes("무료배송"), false);
  assert.notEqual(normalized, foodAnalysis.rawTitle);
  const metadata = extractVideoTitleMetadata("오르기전 가격에 추석 사전예약가능_후기1등*찰진등심 선별상품1kg박스(감칠맛 비법숙성*실속도매팩)", "국대한우");
  assert.equal(metadata.productName.includes("후기1등"), false);
  assert.match(metadata.productName, /찰진등심/);
  assert.equal(metadata.volumeOrOption, "1kg박스");
  assert.match(metadata.promotion, /추석 사전예약가능/);
});

test("영상 길이별 구간 수와 빈틈없는 시간이 정확하다", () => {
  for (const [duration, expected] of [
    [15, 15],
    [20, 16],
    [30, 20],
  ]) {
    const concept = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, duration, expected);
    assert.equal(concept.cuts.length, expected);
    assert.equal(concept.cuts.at(-1).endSecond, duration);
    assert.equal(concept.validation.valid, true, JSON.stringify(concept.validation.checks));
  }
});

test("첫 3초는 세 구간과 서로 다른 시각 변화로 구성된다", () => {
  const concept = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, 20);
  assert.deepEqual(
    concept.cuts.slice(0, 3).map((cut) => [cut.startSecond, cut.endSecond]),
    [
      [0, 1],
      [1, 2],
      [2, 3],
    ]
  );
  assert.equal(new Set(concept.cuts.slice(0, 3).map((cut) => cut.sceneDescription)).size, 3);
});

test("SEO 원문과 추상 장면은 품질 검수에서 차단된다", () => {
  const concept = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, 20);
  concept.cuts[0].caption = beautyAnalysis.rawTitle;
  concept.cuts[1].sceneDescription = "고객의 문제 상황을 보여준다.";
  const validation = validateDetailedPlanning(concept, beautyAnalysis, 20);
  assert.equal(validation.valid, false);
  assert.equal(validation.checks.find((check) => check.key === "seo-title").passed, false);
  assert.equal(validation.checks.find((check) => check.key === "scene-specificity").passed, false);
});

test("세 기획안은 후킹·화자·문제·서사 방향이 달라야 한다", () => {
  const concepts = [makeSummary(beautyAnalysis, 0, "problem-solution"), makeSummary(beautyAnalysis, 1, "unexpected-comparison"), makeSummary(beautyAnalysis, 2, "loss-aversion")];
  assert.equal(validateConceptDiversity(concepts).valid, true);
  concepts[2].hookType = concepts[0].hookType;
  assert.equal(validateConceptDiversity(concepts).valid, false);
});

test("상품 사진·참고 파일·디자이너 없이 프로젝트와 요약 기획안을 저장한다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-planning-optional-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const project = await repository.create({
      projectName: "URL 전용 영상 기획",
      advertiserName: "오리지널소스",
      productUrl: beautyAnalysis.productUrl,
      marketerName: "박마케터",
      designerName: "",
      duration: 20,
      format: "short-form",
      objective: "new-customer-hook",
      referenceAssets: [],
      productAnalysis: beautyAnalysis,
      brandGuideline: guideline,
    });
    const concepts = [makeSummary(beautyAnalysis, 0, "problem-solution"), makeSummary(beautyAnalysis, 1, "unexpected-comparison"), makeSummary(beautyAnalysis, 2, "loss-aversion")];
    const saved = await repository.saveConceptSummaries(project.id, concepts);
    assert.equal(saved.concepts.length, 3);
    assert.equal(
      saved.concepts.every((concept) => concept.cuts.length === 0),
      true
    );
    assert.equal(saved.designerName, "디자이너 미지정");
    assert.equal(saved.referenceAssets.length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("선택한 영상 콘셉트 프로젝트는 요약 기획안 한 개만 저장한다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-planning-format-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const project = await repository.create({
      projectName: "게임형 영상 기획",
      advertiserName: "오리지널소스",
      productUrl: beautyAnalysis.productUrl,
      marketerName: "마케터",
      designerName: "",
      duration: 20,
      format: "short-form",
      objective: "new-customer-hook",
      platform: "meta",
      aspectRatio: "9:16",
      creativeStyle: "mixed",
      conceptFormat: "game-quest",
      advancedTarget: "",
      advancedTone: "",
      additionalRequests: "",
      referenceAssets: [],
      productAnalysis: beautyAnalysis,
      brandGuideline: guideline,
    });
    const summary = {
      ...makeSummary(beautyAnalysis, 0, "problem-solution"),
      conceptFormat: "game-quest",
      creativeStyle: "mixed",
    };
    const saved = await repository.saveConceptSummaries(project.id, [summary]);
    assert.equal(saved.conceptFormat, "game-quest");
    assert.equal(saved.concepts.length, 1);
    assert.equal(saved.concepts[0].conceptFormat, "game-quest");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("기존 성공 기획안은 새 AI 단계 실패를 저장해도 보존된다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-planning-failure-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const project = await repository.create({
      projectName: "실패 보존 테스트",
      advertiserName: "국대한우",
      productUrl: foodAnalysis.productUrl,
      marketerName: "박마케터",
      designerName: "",
      duration: 20,
      format: "short-form",
      objective: "purchase",
      referenceAssets: [],
      productAnalysis: foodAnalysis,
      brandGuideline: guideline,
    });
    const concepts = [makeSummary(foodAnalysis, 0, "problem-solution"), makeSummary(foodAnalysis, 1, "unexpected-comparison"), makeSummary(foodAnalysis, 2, "loss-aversion")];
    await repository.saveConceptSummaries(project.id, concepts);
    await repository.saveGenerationFailure(
      project.id,
      {
        stage: "detailed-script",
        code: "AI_TIMEOUT",
        message: "상세 대본 응답 시간 초과",
        retryable: true,
        attempts: 3,
        failedAt: "2026-08-20T01:00:00.000Z",
      },
      { conceptId: concepts[0].id }
    );
    const reloaded = await repository.get(project.id);
    assert.equal(reloaded.concepts.length, 3);
    assert.equal(reloaded.concepts[0].detailStatus, "failed");
    assert.equal(reloaded.concepts[1].title, concepts[1].title);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("수동 수정 뒤 품질 검수를 다시 계산하고 불합격 대본의 제작 요청을 차단한다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-planning-qa-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const project = await repository.create({
      projectName: "수동 수정 QA",
      advertiserName: "오리지널소스",
      productUrl: beautyAnalysis.productUrl,
      marketerName: "박마케터",
      designerName: "김디자이너",
      duration: 20,
      format: "short-form",
      objective: "purchase",
      referenceAssets: [],
      productAnalysis: beautyAnalysis,
      brandGuideline: guideline,
    });
    const summaries = [makeSummary(beautyAnalysis, 0, "problem-solution"), makeSummary(beautyAnalysis, 1, "unexpected-comparison"), makeSummary(beautyAnalysis, 2, "loss-aversion")];
    await repository.saveConceptSummaries(project.id, summaries);
    const detailed = makeDetailed(summaries[0], beautyAnalysis, 20);
    assert.equal(detailed.validation.valid, true);
    await repository.saveGeneratedConcepts(project.id, [detailed], { conceptId: detailed.id });
    const broken = structuredClone(detailed);
    broken.cuts[0].sceneDescription = "고객의 문제 상황을 보여준다.";
    const saved = await repository.saveScript(project.id, detailed.id, broken, "박마케터", { createRevision: true });
    assert.equal(saved.concepts.find((concept) => concept.id === detailed.id).validation.valid, false);
    await assert.rejects(
      repository.requestProduction({
        projectId: project.id,
        conceptId: detailed.id,
        deadline: "2026-08-30",
        actor: "박마케터",
      }),
      /자동 품질 검수/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("내부 제작 주의사항은 광고 금지 문구의 공개 카피 검사 대상이 아니다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-planning-cautions-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const caution = "상세페이지에서 확인되지 않은 효능·수치·판매 성과를 추가하지 않습니다.";
    const project = await repository.create({
      projectName: "내부 제작 주의사항 저장",
      advertiserName: "오리지널소스",
      productUrl: beautyAnalysis.productUrl,
      marketerName: "박마케터",
      designerName: "",
      duration: 20,
      format: "short-form",
      objective: "purchase",
      referenceAssets: [],
      productAnalysis: beautyAnalysis,
      brandGuideline: { ...guideline, forbiddenPhrases: [caution] },
    });
    const summary = makeSummary(beautyAnalysis, 0, "problem-solution");
    summary.productionCautions = [caution];
    await repository.saveConceptSummaries(project.id, [summary]);
    const detailed = makeDetailed(summary, beautyAnalysis, 20);
    detailed.productionCautions = [caution];
    const saved = await repository.saveGeneratedConcepts(project.id, [detailed], {
      conceptId: detailed.id,
    });
    assert.equal(saved.concepts[0].productionCautions[0], caution);
    assert.equal(saved.concepts[0].cuts.length, 16);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("디자이너 지정 후에만 제작 기준 버전과 요청 이력을 저장한다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-planning-request-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const project = await repository.create({
      projectName: "제작 요청 테스트",
      advertiserName: "오리지널소스",
      productUrl: beautyAnalysis.productUrl,
      marketerName: "박마케터",
      designerName: "",
      duration: 20,
      format: "short-form",
      objective: "purchase",
      referenceAssets: [],
      productAnalysis: beautyAnalysis,
      brandGuideline: guideline,
    });
    const summaries = [makeSummary(beautyAnalysis, 0, "problem-solution"), makeSummary(beautyAnalysis, 1, "unexpected-comparison"), makeSummary(beautyAnalysis, 2, "loss-aversion")];
    await repository.saveConceptSummaries(project.id, summaries);
    const detailed = makeDetailed(summaries[0], beautyAnalysis, 20);
    await repository.saveGeneratedConcepts(project.id, [detailed], { conceptId: detailed.id });
    await assert.rejects(repository.requestProduction({ projectId: project.id, conceptId: detailed.id, deadline: "2026-08-30", actor: "박마케터" }), /담당 디자이너/);
    await repository.updateDetails(project.id, { designerName: "김디자이너", marketerName: "박마케터" });
    const requested = await repository.requestProduction({
      projectId: project.id,
      conceptId: detailed.id,
      deadline: "2026-08-30",
      actor: "박마케터",
      requestNote: "제품 근거를 유지해 주세요.",
    });
    assert.equal(requested.status, "production_requested");
    assert.equal(requested.productionRequest.designerName, "김디자이너");
    assert.equal(requested.finalScript.cuts.length, 16);
    assert.equal(requested.designerAssignmentHistory.at(-1).nextDesigner, "김디자이너");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("영상 기획은 유형 선택 없이 네 콘셉트를 만들고 선택한 안의 자막·장면안만 보여준다", async () => {
  const [navigation, listPage, newWorkspace, detailPage, detailWorkspace, productionPage, typesSource] = await Promise.all([readFile("app/components/AppFeatureNavigation.tsx", "utf8"), readFile("app/video-planning/page.tsx", "utf8"), readFile("app/components/video-collaboration/NewVideoProjectWorkspace.tsx", "utf8"), readFile("app/video-planning/[projectId]/concept/[conceptId]/page.tsx", "utf8"), readFile("app/components/video-planning/VideoPlanningConceptWorkspace.tsx", "utf8"), readFile("app/video-planning/[projectId]/production/page.tsx", "utf8"), readFile("app/lib/video-collaboration/types.ts", "utf8")]);
  assert.match(navigation, /VIDEO_PLANNING_FEATURE[\s\S]*label: "영상 기획"/);
  assert.match(navigation, /VIDEO CONTENT[\s\S]*영상 콘텐츠/);
  assert.match(
    navigation,
    /IMAGE_CONTENT_FEATURES[\s\S]*index: "03"[\s\S]*label: "카테고리 이미지"/,
  );
  assert.match(listPage, /VideoPlanningList/);
  assert.match(detailPage, /VideoPlanningConceptWorkspace/);
  assert.match(newWorkspace, /4개 콘셉트 생성/);
  assert.match(newWorkspace, /planningMode: "four-concepts"/);
  assert.match(newWorkspace, /패러디 · 리얼 사용\/후기 · USP 집중 · 시크릿 혜택/);
  assert.doesNotMatch(newWorkspace, /VIDEO_CONCEPT_FORMAT_OPTIONS\.map|타깃 설정|목표 설정|플랫폼 설정/);
  assert.match(typesSource, /드라마·영화 패러디/);
  assert.match(typesSource, /게임·퀘스트 형식/);
  assert.match(typesSource, /인플루언서 상품소개/);
  assert.match(typesSource, /홈쇼핑 상품소개/);
  assert.match(typesSource, /업계 관계자 형식/);
  assert.match(typesSource, /상품 USP 형식/);
  assert.match(typesSource, /클레이 애니메이션/);
  assert.match(detailWorkspace, /자막과 영상 장면안/);
  assert.match(detailWorkspace, /scenePlanList/);
  assert.match(detailWorkspace, /이미지 생성 없음/);
  assert.match(detailWorkspace, /제작·검수 화면 열기/);
  assert.match(productionPage, /VideoProjectWorkspace/);
  assert.doesNotMatch(detailWorkspace, /이미지 프롬프트|장면 이미지|visualBible|productLockedAsset|coreTarget|customerProblem|recommendationReason/);
});

test("육류와 바디케어 상품 모두 같은 품질 규칙을 통과한다", () => {
  const beauty = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, 20);
  const food = makeDetailed(makeSummary(foodAnalysis, 0, "problem-solution"), foodAnalysis, 20);
  assert.equal(beauty.validation.valid, true);
  assert.equal(food.validation.valid, true);
});

test("45초와 60초 대본은 최소 22개 행을 요구한다", () => {
  assert.deepEqual(segmentRange(45), { min: 22, max: 30, preferred: 24 });
  assert.deepEqual(segmentRange(60), { min: 22, max: 34, preferred: 26 });
});

test("네 콘셉트는 고정 유형과 서로 다른 사건·화자·화면 스타일을 가져야 한다", () => {
  const archetypes = ["parody", "real-review", "usp-focus", "secret-benefit"];
  const hookTypes = ["unexpected-comparison", "review-trust", "feature-usp", "price-benefit"];
  const concepts = archetypes.map((archetype, index) => ({
    ...makeSummary(beautyAnalysis, index % 3, hookTypes[index]),
    conceptArchetype: archetype,
    openingHook: [`누가 이 가격표 붙였어요?`, `처음엔 광고인 줄 알았죠`, `민트잎 수가 왜 적혀 있죠?`, `이 구성, 공개해도 돼요?`][index],
    centralIncident: [`담당자와 판매자가 가격표를 두고 실랑이한다`, `운동 후 사용자가 냄새를 의심하며 직접 써본다`, `원료 수치를 추적하는 실험을 시작한다`, `감춰진 배송 구성을 하나씩 공개한다`][index],
    speakerPointOfView: [`가격 담당자 1인칭`, `실사용자 셀프카메라`, `원료를 확인하는 진행자`, `구성을 공개하는 판매자`][index],
    recommendedVisualStyle: [`뉴스 속보 상황극`, `스마트폰 UGC`, `원료 매크로 다큐`, `가격 협상 라이브`][index],
  }));
  assert.equal(validateConceptDiversity(concepts).valid, true);
});

test("확인된 가격·구성·배송이 없는 상품은 시크릿 혜택 근거가 없다", () => {
  const noBenefit = { ...beautyAnalysis, price: "", originalPrice: "", discountInfo: "", promotion: "", verifiedFacts: beautyAnalysis.verifiedFacts.filter((fact) => fact.label !== "가격") };
  assert.equal(hasVerifiedVideoBenefit(noBenefit), false);
  assert.equal(hasVerifiedVideoBenefit(beautyAnalysis), true);
});

test("구조화 AI 응답은 누락·잘림·잘못된 배열 길이를 성공으로 처리하지 않는다", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["concepts"],
    properties: {
      concepts: {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "archetype"],
          properties: {
            title: { type: "string", minLength: 4 },
            archetype: { type: "string", enum: ["parody", "real-review", "usp-focus", "secret-benefit"] },
          },
        },
      },
    },
  };
  const valid = ["parody", "real-review", "usp-focus", "secret-benefit"].map((archetype) => ({ title: `${archetype} 콘셉트`, archetype }));
  assert.doesNotThrow(() => assertStructuredVideoPlanningResponse({ concepts: valid }, schema));
  assert.throws(() => assertStructuredVideoPlanningResponse({ concepts: valid.slice(0, 3) }, schema), /too few items/);
  assert.throws(() => assertStructuredVideoPlanningResponse({ concepts: [...valid, { title: "초과", archetype: "parody" }] }, schema), /too many items/);
  assert.throws(() => assertStructuredVideoPlanningResponse({ concepts: valid.map(({ archetype }) => ({ archetype })) }, schema), /title is required/);
});
