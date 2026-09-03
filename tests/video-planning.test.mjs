import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createVideoProjectRepository } from "../app/lib/video-collaboration/repository.server.ts";
import { assignPlanningTimeline, compactPlanningCta, hasVerifiedVideoBenefit, repairDetailedPlanningAudienceCopy, segmentRange, validateConceptDiversity, validateDetailedPlanning } from "../app/lib/video-collaboration/planningValidation.ts";
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

const captions = ["왜 또 찝찝하죠?", "운동 뒤 더 심해요!", "샤워 순서 봐요", "익숙함은 잠깐", "답답함이 남아요", "상쾌함이 필요해요", "민트와 티트리예요", "사용감부터 봐요", "손에 덜어 봐요", "거품이 퍼져요", "물로 씻어내요", "표정이 풀려요", "운동복도 챙겨요", "다음 샤워 전엔", "상품 정보를 봐요", "오늘 루틴 바꿔요", "가볍게 시작해요", "필요한 이유를 봐요", "선택을 확인해요", "상품 상세 확인하세요"];

const visualEvents = ["젖은 운동복을 내려놓는다", "이마의 땀을 수건으로 닦는다", "샤워기 손잡이를 돌린다", "기존 바디워시를 잠시 내려놓는다", "거울 속 굳은 표정을 바라본다", "민트색 패키지를 선반에서 꺼낸다", "손바닥에 내용물을 덜어낸다", "손가락으로 질감을 천천히 펼친다", "양손으로 거품을 충분히 만든다", "어깨를 따라 거품을 부드럽게 문지른다", "샤워기 물로 거품을 씻어낸다", "수건을 들고 편안하게 웃는다", "깨끗한 운동복을 가방에 넣는다", "현관 앞에서 가볍게 신발을 신는다", "상품 상세 화면을 손가락으로 누른다", "세면대 위 물방울을 닦아낸다", "열린 욕실 문 밖으로 걸어간다", "제품과 운동 가방을 나란히 둔다", "거울 앞에서 고개를 끄덕인다", "화면 아래 구매 정보를 확인한다"];

function makeSummary(analysis, index, hookType) {
  const variants = [
    { problem: "운동 뒤 남는 찝찝함", usp: "민트 사용감", speaker: "운동을 마친 직장인", style: "smartphone-ugc", structure: "불편 고백에서 샤워 루틴 변화로 이어지는 독백", cta: "상품 상세 확인하세요" },
    { problem: "선택 기준을 모르는 답답함", usp: "검증된 구성", speaker: "제품을 비교하는 리뷰어", style: "ad-real", structure: "두 선택지를 대조한 뒤 근거를 확인하는 비교", cta: "구성을 직접 확인하세요" },
    { problem: "구매를 미루는 망설임", usp: "확인된 가격 혜택", speaker: "가족 구매를 준비하는 고객", style: "mixed", structure: "망설임과 손해를 짚은 뒤 구매 이유로 닫는 전개", cta: "구매 조건을 확인하세요" },
    { problem: "상품 차이를 한눈에 모르는 답답함", usp: "검증된 핵심 USP", speaker: "새벽 시장을 다니는 상품 감별사", style: "ad-real", structure: "오래된 감별 습관이 상품의 한 가지 근거를 발견하는 사건", cta: "상품 근거를 확인하세요" },
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
    distinctiveCharacter: `${variant.speaker}이면서 새벽 6시마다 같은 골목 가게를 확인하는 15년 차 단골`,
    socialWorld: `첫차가 다니기 전 오래된 시장 골목과 문을 막 연 작은 가게의 아침 풍경 ${index + 1}`,
    storyTrigger: `늘 같은 상품만 고르던 인물이 진열대에서 이전과 다른 한 가지 단서를 발견하고 주인에게 직접 확인한다 ${index + 1}.`,
    truthBridge: `${variant.usp}라는 검증된 상품 사실을 그 발견의 이유와 구매 판단 근거로 연결한다.`,
    dramatizationBoundary: `시장 인물과 발견 사건은 창작 상황극이며 ${variant.usp}는 검증된 상품 사실이다.`,
  };
}

function makeFourSummaries(analysis) {
  return [
    makeSummary(analysis, 0, "problem-solution"),
    makeSummary(analysis, 1, "unexpected-comparison"),
    makeSummary(analysis, 2, "loss-aversion"),
    makeSummary(analysis, 3, "feature-usp"),
  ].map((concept, index) => ({
    ...concept,
    conceptArchetype: ["parody", "real-review", "usp-focus", "secret-benefit"][index],
  }));
}

function makeDetailed(summary, analysis, duration, count = segmentRange(duration).preferred) {
  const rows = captions.slice(0, count).map((caption, index) => ({
    caption: index === count - 1 ? summary.cta : caption,
    narration: index < Math.min(8, count) ? caption : "",
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
    [20, 15],
    [30, 15],
  ]) {
    const concept = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, duration, expected);
    assert.equal(concept.cuts.length, expected);
    assert.equal(concept.cuts.at(-1).endSecond, duration);
    assert.equal(concept.validation.valid, true, JSON.stringify(concept.validation.checks));
  }
});

test("첫 3초는 두 개의 의미 있는 구간과 서로 다른 시각 변화로 구성된다", () => {
  const concept = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, 20);
  assert.deepEqual(
    concept.cuts.slice(0, 2).map((cut) => [cut.startSecond, cut.endSecond]),
    [
      [0, 1.2],
      [1.2, 3],
    ]
  );
  assert.equal(new Set(concept.cuts.slice(0, 2).map((cut) => cut.sceneDescription)).size, 2);
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

test("새 AI 대본은 충분한 자막 분량을 요구하고 내부 기획 메모를 차단한다", () => {
  const concept = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, 20);
  concept.conceptArchetype = "real-review";
  const richerCaptions = [
    "형님들 땀냄새 남았죠..?",
    "샤워했는데 왜 또 찝찝함;;",
    "이 루틴부터 한번 까볼게요",
    "운동 끝나자마자 씻었는데도 금방 답답해지더라고요",
    "향으로 덮는 방식 말고 씻는 순간의 사용감부터 봤어요",
    "민트와 티트리가 들어간 이유가 여기서 딱 느껴집니다",
    "손에 덜어보니 질감부터 평소 쓰던 것과 꽤 달랐고요",
    "거품이 퍼지는 장면 보니까 괜히 손이 가는 게 아님ㅎㅎ",
    "물로 씻어낼 때 남는 느낌까지 솔직하게 확인해봤어요",
    "운동 가방 챙길 때 이 샤워 루틴이 먼저 생각나더라고요",
    "땀 줄줄 흐르는 날엔 복잡한 설명보다 이 장면이면 됨",
    "샤워 후에도 찝찝했던 분들은 이 사용감부터 보세요",
    "향만 세게 남기는 방식이 부담이었다면 더 궁금할걸요",
    "씻는 순간을 산뜻하게 바꾸고 싶은 형님들 여기입니다",
    "다음 운동 뒤 샤워가 기다려지는 이유를 직접 봐주세요",
    concept.cta,
  ];
  concept.cuts = concept.cuts.map((cut, index) => ({
    ...cut,
    caption: index === concept.cuts.length - 1 ? concept.cta : richerCaptions[index],
  }));
  let validation = validateDetailedPlanning(concept, beautyAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "natural-copy").passed, true);

  concept.cuts[4].caption = "담당자: 확인부터요";
  validation = validateDetailedPlanning(concept, beautyAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "natural-copy").passed, false);

  concept.cuts[4].caption = "상세페이지 구성 표기는 250ml로 보입니다";
  validation = validateDetailedPlanning(concept, beautyAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "natural-copy").passed, false);

  concept.cuts[4].caption = "가격 보고 멈칫한 분들, 71% 할인 표기에요";
  validation = validateDetailedPlanning(concept, beautyAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "natural-copy").passed, false);
});

test("상세페이지 검수 말투는 저장 전에 시청자용 자막으로 바꾼다", () => {
  const concept = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, 20);
  concept.cuts[5].caption = "상세페이지 구성 표기는 250ml로 보입니다";
  concept.cuts[6].caption = "가격 보고 멈칫한 분들, 71% 할인 표기에요";

  const repaired = repairDetailedPlanningAudienceCopy(concept);

  assert.doesNotMatch(repaired.cuts[5].caption, /상세페이지|표기|보입니다/);
  assert.doesNotMatch(repaired.cuts[6].caption, /표기(?:예요|에요|입니다)/);
  assert.match(repaired.cuts[5].caption, /250ml/);
  assert.match(repaired.cuts[6].caption, /71%/);
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
    const concepts = makeFourSummaries(beautyAnalysis);
    const saved = await repository.saveConceptSummaries(project.id, concepts);
    assert.equal(saved.concepts.length, 4);
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

test("4개 중 통과한 콘셉트는 먼저 저장하고 실패 슬롯만 별도로 재생성할 수 있다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-planning-slots-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const project = await repository.create({
      projectName: "부분 성공 영상 기획",
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
    const summaries = makeFourSummaries(beautyAnalysis);
    await repository.beginConceptSlotGeneration(project.id, [
      "parody",
      "real-review",
      "usp-focus",
      "secret-benefit",
    ]);
    const partial = await repository.saveConceptSlotProgress(project.id, summaries.slice(0, 3), {
      unresolvedArchetypes: ["secret-benefit"],
    });
    assert.equal(partial.concepts.length, 3);
    assert.equal(partial.status, "script_review");
    assert.deepEqual(
      partial.conceptSlots.map((slot) => slot.status),
      ["ready", "ready", "ready", "generating"]
    );

    const failure = {
      stage: "schema-validation",
      code: "CONCEPTS_NOT_DISTINCT",
      message: "시크릿 혜택형만 검수를 통과하지 못했습니다.",
      retryable: true,
      attempts: 3,
      failedAt: "2026-09-02T00:00:00.000Z",
    };
    const failed = await repository.saveConceptSlotProgress(project.id, [], {
      failedArchetypes: ["secret-benefit"],
      failure,
    });
    assert.equal(failed.concepts.length, 3);
    assert.equal(failed.conceptSlots[3].status, "failed");
    assert.equal(failed.conceptSlots[3].failure.code, "CONCEPTS_NOT_DISTINCT");

    await repository.beginConceptSlotGeneration(project.id, ["secret-benefit"]);
    const finalBatch = makeFourSummaries(beautyAnalysis);
    const completed = await repository.saveConceptSlotProgress(project.id, finalBatch, {
      completeSet: true,
    });
    assert.equal(completed.concepts.length, 4);
    assert.deepEqual(
      completed.concepts.slice(0, 3).map((concept) => concept.id),
      partial.concepts.map((concept) => concept.id)
    );
    assert.deepEqual(completed.conceptSlots.map((slot) => slot.status), [
      "ready",
      "ready",
      "ready",
      "ready",
    ]);
    assert.equal(completed.generationFailure, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("서로 다른 콘셉트에 중복 ID와 소재코드가 들어와도 저장 시 고유하게 복구한다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-planning-duplicate-ids-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const project = await repository.create({
      projectName: "중복 식별자 복구",
      advertiserName: "국대한우",
      productUrl: foodAnalysis.productUrl,
      marketerName: "마케터",
      designerName: "",
      duration: 20,
      format: "short-form",
      objective: "new-customer-hook",
      referenceAssets: [],
      productAnalysis: foodAnalysis,
      brandGuideline: guideline,
    });
    const summaries = makeFourSummaries(foodAnalysis);
    summaries[3] = {
      ...summaries[3],
      id: summaries[0].id,
      materialCode: summaries[0].materialCode,
    };
    const saved = await repository.saveConceptSlotProgress(project.id, summaries, {
      completeSet: true,
    });
    assert.equal(new Set(saved.concepts.map((concept) => concept.id)).size, 4);
    assert.equal(new Set(saved.concepts.map((concept) => concept.materialCode)).size, 4);
    assert.equal(new Set(saved.conceptSlots.map((slot) => slot.conceptId)).size, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("서버가 중단되어 오래 멈춘 영상기획은 생성 중 대신 재시도 가능한 실패 상태로 복구한다", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-video-planning-stale-"));
  try {
    const repository = createVideoProjectRepository({ dataDirectory: directory });
    const project = await repository.create({
      projectName: "중단 작업 복구",
      advertiserName: "국대한우",
      productUrl: foodAnalysis.productUrl,
      marketerName: "마케터",
      designerName: "",
      duration: 20,
      format: "short-form",
      objective: "new-customer-hook",
      referenceAssets: [],
      productAnalysis: foodAnalysis,
      brandGuideline: guideline,
    });
    await repository.beginConceptSlotGeneration(project.id, [
      "parody",
      "real-review",
      "usp-focus",
      "secret-benefit",
    ]);
    const storePath = path.join(directory, "projects.json");
    const store = JSON.parse(await readFile(storePath, "utf8"));
    const storedProject = store.projects.find((item) => item.id === project.id);
    const staleAt = "2026-01-01T00:00:00.000Z";
    storedProject.pipelineProgress = [
      { stage: "conceptCandidates", status: "running", message: "생성 중", updatedAt: staleAt },
      { stage: "validation", status: "pending", message: "검수 대기", updatedAt: staleAt },
    ];
    storedProject.conceptSlots = storedProject.conceptSlots.map((slot) => ({
      ...slot,
      status: "generating",
      updatedAt: staleAt,
    }));
    await writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");

    const recovered = await repository.get(project.id);
    assert.equal(recovered.pipelineProgress[0].status, "failed");
    assert.equal(recovered.pipelineProgress[1].status, "warning");
    assert.equal(recovered.conceptSlots.every((slot) => slot.status === "failed"), true);
    assert.equal(recovered.generationFailure.code, "STALE_GENERATION_INTERRUPTED");

    const persisted = JSON.parse(await readFile(storePath, "utf8")).projects.find(
      (item) => item.id === project.id
    );
    assert.equal(persisted.conceptSlots.every((slot) => slot.status === "failed"), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("과거 형식 선택값이 남아 있어도 요약 기획안 한 개 저장으로 회귀하지 않는다", async () => {
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
    await assert.rejects(
      repository.saveConceptSummaries(project.id, [summary]),
      /최신 4안 유형|서로 다른 기획안 4개/
    );
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
    const concepts = makeFourSummaries(foodAnalysis);
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
    assert.equal(reloaded.concepts.length, 4);
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
    const summaries = makeFourSummaries(beautyAnalysis);
    await repository.saveConceptSummaries(project.id, summaries);
    const detailed = makeDetailed(summaries[2], beautyAnalysis, 20);
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
    const summaries = makeFourSummaries(beautyAnalysis);
    const summary = summaries[0];
    summary.productionCautions = [caution];
    await repository.saveConceptSummaries(project.id, summaries);
    const detailed = makeDetailed(summary, beautyAnalysis, 20);
    detailed.productionCautions = [caution];
    const saved = await repository.saveGeneratedConcepts(project.id, [detailed], {
      conceptId: detailed.id,
    });
    assert.equal(saved.concepts[0].productionCautions[0], caution);
    assert.equal(saved.concepts[0].cuts.length, segmentRange(20).preferred);
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
    const summaries = makeFourSummaries(beautyAnalysis);
    await repository.saveConceptSummaries(project.id, summaries);
    const detailed = makeDetailed(summaries[2], beautyAnalysis, 20);
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
    assert.equal(requested.finalScript.cuts.length, segmentRange(20).preferred);
    assert.equal(requested.designerAssignmentHistory.at(-1).nextDesigner, "김디자이너");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("영상 기획은 유형 선택 없이 네 콘셉트를 만들고 선택한 안의 자막·장면안만 보여준다", async () => {
  const [navigation, listPage, newWorkspace, detailPage, detailWorkspace, productionPage, typesSource, generatorSource] = await Promise.all([readFile("app/components/AppFeatureNavigation.tsx", "utf8"), readFile("app/video-planning/page.tsx", "utf8"), readFile("app/components/video-collaboration/NewVideoProjectWorkspace.tsx", "utf8"), readFile("app/video-planning/[projectId]/concept/[conceptId]/page.tsx", "utf8"), readFile("app/components/video-planning/VideoPlanningConceptWorkspace.tsx", "utf8"), readFile("app/video-planning/[projectId]/production/page.tsx", "utf8"), readFile("app/lib/video-collaboration/types.ts", "utf8"), readFile("app/lib/video-collaboration/videoPlanningGenerator.server.ts", "utf8")]);
  assert.match(navigation, /VIDEO_PLANNING_FEATURE[\s\S]*label: "영상 기획"/);
  assert.match(navigation, /VIDEO CONTENT[\s\S]*영상 콘텐츠/);
  assert.match(
    navigation,
    /IMAGE_CONTENT_FEATURES[\s\S]*index: "03"[\s\S]*label: "카테고리 이미지"/,
  );
  assert.match(listPage, /VideoPlanningList/);
  assert.match(detailPage, /VideoPlanningConceptWorkspace/);
  assert.match(newWorkspace, /4개 콘셉트 생성/);
  assert.doesNotMatch(newWorkspace, /planningMode/);
  assert.match(newWorkspace, /특정 인물·세계관 · 관계 경험담 · 비교·발견 · 상품 의인화/);
  assert.match(typesSource, /VIDEO_DESIGNER_OPTIONS = \["조이", "애니"\]/);
  assert.doesNotMatch(newWorkspace, /VIDEO_DESIGNER_OPTIONS\.map|durationOptions|durationChoice|영상 길이\s*<select|담당 디자이너 선택|제작 마감일/);
  assert.match(newWorkspace, /automaticDuration\(referenceAssets\)/);
  assert.match(newWorkspace, /durationMode: "auto"/);
  assert.match(newWorkspace, /designerName: ""/);
  assert.match(newWorkspace, /참고 이미지·영상·PDF/);
  assert.match(newWorkspace, /필요할 때만 추가 요청 입력/);
  assert.match(newWorkspace, /aria-label="업체명"/);
  assert.match(newWorkspace, /setAdvertiserName\(event\.target\.value\)/);
  assert.match(newWorkspace, /if \(!advertiserName\.trim\(\)\)/);
  assert.match(newWorkspace, /advertiserName: advertiserName\.trim\(\)/);
  assert.match(newWorkspace, /disabled=\{busy \|\| !advertiserName\.trim\(\)\}/);
  assert.match(detailWorkspace, /VIDEO_DESIGNER_OPTIONS\.map/);
  assert.doesNotMatch(newWorkspace, /VIDEO_CONCEPT_FORMAT_OPTIONS\.map|타깃 설정|목표 설정|플랫폼 설정/);
  assert.match(typesSource, /드라마·영화 패러디/);
  assert.match(typesSource, /게임·퀘스트 형식/);
  assert.match(typesSource, /인플루언서 상품소개/);
  assert.match(typesSource, /홈쇼핑 상품소개/);
  assert.match(typesSource, /업계 관계자 형식/);
  assert.match(typesSource, /상품 USP 형식/);
  assert.match(typesSource, /클레이 애니메이션/);
  assert.match(detailWorkspace, /자막과 영상 장면안/);
  assert.match(detailWorkspace, /콘셉트 요약/);
  assert.match(detailWorkspace, /01 · 상황/);
  assert.match(detailWorkspace, /02 · 상품 역할/);
  assert.match(detailWorkspace, /03 · 마무리/);
  assert.match(detailWorkspace, /<span>화자<\/span>/);
  assert.match(detailWorkspace, /자막 말투/);
  assert.match(detailWorkspace, /타깃 호명/);
  assert.match(generatorSource, /인터넷 유행어를 억지로 흉내 내지 않는다/);
  assert.match(generatorSource, /ㅎㅎ, \.\.\., \.\.\?, ;;/);
  assert.match(generatorSource, /copyVoiceDirection/);
  assert.match(generatorSource, /targetCallout/);
  assert.match(generatorSource, /땀 줄줄 흐르는 형님들/);
  assert.match(generatorSource, /고기 사러 마장동까지 가는 분들/);
  assert.match(generatorSource, /정육점 가도 이것보다 싼 거 없어요/);
  assert.match(generatorSource, /생활 비교를 막연한 ‘합리적인 가격’으로 일반화하지/);
  assert.match(generatorSource, /배송·배송비·도서산간·배송지 안내는 자막과 내레이션에서 완전히 제외/);
  assert.match(generatorSource, /체크리스트가 아니다/);
  assert.match(generatorSource, /3번째부터 마지막 직전까지는 공백 제외 7~\$\{bodyCaptionMax\}자/);
  assert.match(generatorSource, /narration은 한 명의 주 화자가 카메라 너머 시청자에게 경험과 정보를 들려주는 실제 구어체/);
  assert.match(generatorSource, /가격·할인·구성은 기획안의 중심 사건이 가격일 때만/);
  assert.match(generatorSource, /asset\.mimeType\.startsWith\("image\/"\)/);
  assert.match(generatorSource, /마지막 CTA는 약 \$\{ctaDuration\}초/);
  assert.match(detailWorkspace, /광고 집행 품질검사/);
  assert.match(generatorSource, /‘담당자:’, ‘제작자:’, ‘정보 부족’/);
  assert.match(generatorSource, /상황극의 ‘진행자:’, ‘친구 A:’ 같은 실제 화자 표기는 narration에서만 허용/);
  assert.match(detailWorkspace, /scenePlanList/);
  assert.match(detailWorkspace, /이미지 생성 없음/);
  assert.match(detailWorkspace, /제작·검수 화면 열기/);
  assert.match(productionPage, /VideoProjectWorkspace/);
  assert.doesNotMatch(detailWorkspace, /이미지 프롬프트|장면 이미지|visualBible|productLockedAsset|coreTarget|customerProblem|recommendationReason/);
});

test("광고 집행 품질검사는 과속 자막·촬영 지시문·행동 없는 CTA를 차단한다", () => {
  const concept = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, 20);
  concept.conceptArchetype = "real-review";
  concept.cuts[0].caption = "형님들 씻었는데도 왜 이렇게 계속 찝찝한 건가요";
  concept.cuts[4].caption = "한 사람이 제품을 집습니다";
  concept.cuts[5].caption = "250ml 12,000원 먼저 공개";
  concept.cta = "민트 티트리 샤워젤 250ml";
  concept.cuts.at(-1).caption = concept.cta;
  const validation = validateDetailedPlanning(concept, beautyAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "caption-readability").passed, false);
  assert.equal(validation.checks.find((check) => check.key === "audience-value-copy").passed, false);
  assert.equal(validation.checks.find((check) => check.key === "cta-action").passed, false);
});

test("광고 집행 품질검사는 붙여 쓴 자막과 중간에 끊긴 문장을 차단한다", () => {
  const concept = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, 20);
  concept.conceptArchetype = "real-review";
  concept.cuts[4].caption = "국내산설록우등심";
  concept.cuts[5].caption = "제주도는 추가비 안내될 수";
  concept.cuts[6].caption = "이름보다 먼저 볼 건";
  const validation = validateDetailedPlanning(concept, beautyAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "caption-spacing").passed, false);
  assert.equal(validation.checks.find((check) => check.key === "sentence-completion").passed, false);
  assert.match(validation.checks.find((check) => check.key === "sentence-completion").message, /6번, 7번/);
});

test("완결된 내레이션이 있으면 중간에 끊긴 자막만 결정적으로 복구한다", () => {
  const concept = makeDetailed(makeSummary(foodAnalysis, 0, "unexpected-comparison"), foodAnalysis, 20);
  concept.conceptArchetype = "parody";
  concept.cuts[0].caption = "둘 중 하나가 될 수";
  concept.cuts[0].narration = "어느 국물이 더 당기세요?";

  const repaired = repairDetailedPlanningAudienceCopy(concept);

  assert.equal(repaired.cuts[0].caption, "어느 국물이 더 당기세요?");
  assert.equal(repaired.validation, concept.validation);
  assert.equal(validateDetailedPlanning(repaired, foodAnalysis, 20).checks.find((check) => check.key === "sentence-completion").passed, true);
});

test("바로 다음 자막과 한 문장으로 완결되는 의도적 대화 체인은 보존한다", () => {
  const concept = makeDetailed(makeSummary(foodAnalysis, 0, "unexpected-comparison"), foodAnalysis, 20);
  concept.conceptArchetype = "real-review";
  concept.cuts[4].caption = "팬에 올리면";
  concept.cuts[5].caption = "치익 소리부터 달라요";
  concept.cuts[4].narration = "팬에 올리면 치익 소리부터 달라요.";

  const repaired = repairDetailedPlanningAudienceCopy(concept);

  assert.equal(repaired.cuts[4].caption, "팬에 올리면");
  assert.equal(validateDetailedPlanning(repaired, foodAnalysis, 20).checks.find((check) => check.key === "sentence-completion").passed, true);
});

test("자동수정 뒤 반복된 자막은 각 장면의 내레이션으로 분리한다", () => {
  const concept = makeDetailed(makeSummary(foodAnalysis, 0, "unexpected-comparison"), foodAnalysis, 20);
  concept.conceptArchetype = "parody";
  concept.cuts[4].caption = "어느 국물이 더 당겨요?";
  concept.cuts[4].narration = "왼쪽 국물부터 향을 볼게요.";
  concept.cuts[5].caption = "어느 국물이 더 당겨요?";
  concept.cuts[5].narration = "오른쪽은 색부터 더 진하네요.";

  const repaired = repairDetailedPlanningAudienceCopy(concept);

  assert.notEqual(repaired.cuts[4].caption, repaired.cuts[5].caption);
  assert.equal(validateDetailedPlanning(repaired, foodAnalysis, 20).checks.find((check) => check.key === "copy-repetition").passed, true);
});

test("블라인드 테스트의 선택 번호는 상품 수치로 오인하지 않는다", () => {
  const concept = makeDetailed(makeSummary(foodAnalysis, 0, "unexpected-comparison"), foodAnalysis, 20);
  concept.conceptArchetype = "parody";
  concept.parodyGenre = "blind-test";
  concept.cuts[4].caption = "1번 국물부터 볼까요?";
  concept.cuts[4].narration = "1번 국물부터 향을 볼게요.";
  concept.cuts[5].caption = "2번 국물이 더 진해요";
  concept.cuts[5].narration = "진행자: 2개의 냄비 중 이 국물이 더 진하네요.";

  let validation = validateDetailedPlanning(concept, foodAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "unsupported-numbers").passed, true);
  assert.equal(validation.checks.find((check) => check.key === "claim-scene-alignment").passed, true);
  assert.equal(validation.checks.find((check) => check.key === "natural-copy").passed, true);

  concept.cuts[6].caption = "999원이라고요?";
  validation = validateDetailedPlanning(concept, foodAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "unsupported-numbers").passed, false);

  concept.cuts[5].caption = "진행자: 이쪽입니다";
  validation = validateDetailedPlanning(concept, foodAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "natural-copy").passed, false);
});

test("배송 정보는 영상 자막에서 제외하고 배송만으로 판매 혜택을 충족하지 않는다", () => {
  const shippingOnly = {
    ...beautyAnalysis,
    price: "",
    originalPrice: "",
    discountInfo: "무료배송",
    promotion: "무료배송",
    composition: [],
    shippingConditions: ["제주 및 도서산간 추가 배송비"],
    verifiedFacts: [
      { id: "fact-shipping", label: "배송", value: "제주 추가 배송비", source: "상품 상세", bucket: "verified" },
    ],
  };
  assert.equal(hasVerifiedVideoBenefit(shippingOnly), false);

  const concept = makeDetailed(makeSummary(foodAnalysis, 0, "problem-solution"), foodAnalysis, 20);
  concept.conceptArchetype = "real-review";
  concept.cuts[4].caption = "제주 배송은 추가 비용이 있어요";
  const validation = validateDetailedPlanning(concept, foodAnalysis, 20);
  assert.equal(validation.checks.find((check) => check.key === "delivery-copy").passed, false);
});

test("내부 검수 말투 CTA는 소비자가 바로 이해하는 행동 문장으로 바꾼다", () => {
  assert.equal(compactPlanningCta("확인된 혜택은 66% 지금 확인하세요", "상품 정보를 확인하세요"), "66% 할인, 지금 확인하세요");
  assert.equal(
    compactPlanningCta("냉동실에 두고, 먹고 싶은 날 해동 없이 바로 끓여보세요.", "상품 정보를 확인하세요", 30),
    "냉동실에 두고, 먹고 싶은 날 해동 없이 바로 끓여보세요."
  );
});

test("육류와 바디케어 상품 모두 같은 품질 규칙을 통과한다", () => {
  const beauty = makeDetailed(makeSummary(beautyAnalysis, 0, "problem-solution"), beautyAnalysis, 20);
  const food = makeDetailed(makeSummary(foodAnalysis, 0, "problem-solution"), foodAnalysis, 20);
  assert.equal(beauty.validation.valid, true);
  assert.equal(food.validation.valid, true);
});

test("45초와 60초 대본도 읽기 시간을 확보한 구간 수를 사용한다", () => {
  assert.deepEqual(segmentRange(45), { min: 18, max: 23, preferred: 20 });
  assert.deepEqual(segmentRange(60), { min: 22, max: 28, preferred: 24 });
});

test("네 콘셉트는 고정 유형과 서로 다른 사건·화자·화면 스타일을 가져야 한다", () => {
  const archetypes = ["parody", "real-review", "usp-focus", "secret-benefit"];
  const hookTypes = ["unexpected-comparison", "review-trust", "feature-usp", "price-benefit"];
  const concepts = archetypes.map((archetype, index) => ({
    ...makeSummary(beautyAnalysis, index, hookTypes[index]),
    conceptArchetype: archetype,
    openingHook: [`누가 이 가격표 붙였어요?`, `처음엔 광고인 줄 알았죠`, `민트잎 수가 왜 적혀 있죠?`, `이 구성, 공개해도 돼요?`][index],
    centralIncident: [`담당자와 판매자가 가격표를 두고 실랑이한다`, `운동 후 사용자가 냄새를 의심하며 직접 써본다`, `원료 수치를 추적하는 실험을 시작한다`, `감춰진 선택 구성을 하나씩 공개한다`][index],
    speakerPointOfView: [`가격 담당자 1인칭`, `실사용자 셀프카메라`, `원료를 확인하는 진행자`, `구성을 공개하는 판매자`][index],
    recommendedVisualStyle: [`뉴스 속보 상황극`, `스마트폰 UGC`, `원료 매크로 다큐`, `가격 협상 라이브`][index],
  }));
  assert.equal(validateConceptDiversity(concepts).valid, true);
});

test("네 콘셉트의 사용자 표시 분류는 이야기 작동 방식으로 구분한다", async () => {
  const { VIDEO_CONCEPT_ARCHETYPE_OPTIONS } = await import("../app/lib/video-collaboration/types.ts");
  assert.deepEqual(
    VIDEO_CONCEPT_ARCHETYPE_OPTIONS.map(({ label }) => label),
    ["특정 인물·세계관형", "관계·생활 경험 전달형", "비교·실험·발견형", "상품 의인화·비밀 공개형"]
  );
  const relationship = VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find(({ id }) => id === "real-review");
  assert.match(relationship?.direction || "", /팀장님, 진짜 이거 싸게 팔아요/);
  const reveal = VIDEO_CONCEPT_ARCHETYPE_OPTIONS.find(({ id }) => id === "secret-benefit");
  assert.match(reveal?.direction || "", /가격 혜택의 유무와 관계없이/);
});

test("관계형 상세 대본은 가족끼리 번갈아 말하는 각본을 차단하고 시청자 전달형을 허용한다", () => {
  const directToAudience = makeDetailed(makeSummary(foodAnalysis, 0, "review-trust"), foodAnalysis, 20);
  directToAudience.conceptArchetype = "real-review";
  directToAudience.cuts = directToAudience.cuts.map((cut, index) => ({
    ...cut,
    narration:
      index === 0
        ? "아니 여러분, 명절마다 고깃값을 비교하는 저희 아버지가 찾은 곳인데요."
        : cut.narration,
  }));
  assert.equal(
    validateDetailedPlanning(directToAudience, foodAnalysis, 20).checks.find((check) => check.key === "audience-narrator")?.passed,
    true
  );

  const screenplay = {
    ...directToAudience,
    cuts: directToAudience.cuts.map((cut, index) => ({
      ...cut,
      narration: index === 0 ? "아버지: 이 고기 어디서 샀니?" : index === 1 ? "딸: 제가 찾은 곳이에요." : cut.narration,
    })),
  };
  assert.equal(
    validateDetailedPlanning(screenplay, foodAnalysis, 20).checks.find((check) => check.key === "audience-narrator")?.passed,
    false
  );
});

test("확인된 가격·구성 혜택이 없는 상품은 시크릿 혜택 근거가 없다", () => {
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
