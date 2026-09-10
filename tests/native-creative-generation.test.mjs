import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { findBannedCreativePhrases, hasBannedCreativePhrase, looksLikeGenericOrRepetitiveCopy, repairBannedCreativeSentence } from "../app/lib/creative-generation/bannedCreativePhrases.ts";
import { resolveFastCreativeRuntime } from "../app/lib/creative-generation/fastCreativeRuntime.ts";
import { createAsyncConcurrencyGate, resolveCodexCreativeParallelLimit } from "../app/lib/creative-generation/asyncConcurrencyGate.ts";
import { buildNativeFinalCreativePrompt, buildNativeStagePrompt, buildNativeValidationPrompt, nativePlannedSubjectMode, nativeReferenceContainsPerson, nativeReferenceRequiresComparisonSemantics, nativeReferenceRequiresContextualBackgroundRebuild, nativeReferenceRequiresHumanReplacement } from "../app/lib/creative-generation/nativeCreativePrompt.ts";
import { enforceExactRenderedCopyValidation, enforceNoSourceDisclosureCopy, enforceOriginCopyPolicy, enforceReferenceCopyPlanValidity, enforceReferenceCopySlotCompleteness, isSourceDisclosureCopy, normalizeNativeCreativeValidation } from "../app/lib/creative-generation/nativeCreativeValidation.ts";
import { defaultCompositionTypes, pickCompatibleRandomItems, pickUniqueRandomItems, scoreReferenceCompatibility } from "../app/lib/creative-generation/referenceSelection.ts";
import { inferNativeReferenceFoodSubcategoryFromText, normalizeNativeReferenceCompatibility, normalizeReferenceRawLines, normalizeReferenceTextRegionBrandPolicy, referenceBelongsToSelectionPool } from "../app/lib/creative-generation/referenceLibraryManagement.ts";
import { copyReferenceStructureLosslessly } from "../app/lib/creative-generation/referenceStructureCopy.server.ts";
import { optimizeNativeFinalImage, selectNativeReferenceSources } from "../app/lib/creative-generation/nativeCreativeStorage.server.ts";
import { buildCreativePlanFingerprint } from "../app/lib/creative-generation/creativePlanCache.server.ts";
import { performanceTemplateRegistry, selectPerformanceTemplates, unusedPerformanceTemplates } from "../app/lib/creative-generation/performanceTemplateRegistry.ts";
import { seededHandwritingStyle } from "../app/lib/creative-generation/localPerformanceCreativeComposer.server.ts";
import { creativeFontRegistry, verifyCreativeFontFiles } from "../app/lib/creative-generation/creativeFontRegistry.server.ts";
import { composeAdaptiveNativeCreative } from "../app/lib/creative-generation/adaptiveNativeCreativeComposer.server.ts";
import { validateAdaptiveNativeCreative } from "../app/lib/creative-generation/nativeLocalQa.server.ts";
import { buildAdaptiveLayoutPlan, referenceCreativeGrammars } from "../app/lib/creative-generation/referenceCreativeGrammar.ts";
import { normalizePlannerScoreValues, recomputeHookTotal, selectQualityDiverseHooks } from "../app/lib/creative-generation/hookQuality.ts";
import { buildProductTruth, cleanProductTitle, extractPackOptionCounts } from "../app/lib/creative-generation/productTruth.ts";
import { CURRENT_REFERENCE_EDIT_JOB_VERSION, hasOrphanedRunningResult, isCodexDirectTestGenerationJob, isServerRunnableGenerationJob, migrateActiveJobToPromptVersion, resumeGenerationJob } from "../app/lib/creative-generation/jobRunnerPolicy.ts";
import { resolveMeatPresentationContract, resolveProductRenderingPolicy } from "../app/lib/creative-generation/productRenderingPolicy.ts";
import { isPaidImageGenerationEnabled } from "../app/lib/image-generation/SceneGenerationProvider.ts";
import { hasExplicitPaidApiAuthorization } from "../app/lib/creative-generation/types.ts";
import { withNativeCreativeSession } from "../app/lib/creative-generation/providers/CreativeGenerationProvider.ts";
import { applyReferenceCopyGroupRules } from "../app/lib/creative-generation/referenceCopyDiversity.ts";
import { consumerFacingFactHint, findReferenceCopyNaturalnessErrors } from "../app/lib/creative-generation/referenceCopyNaturalness.ts";
import { downloadSequenceFromCodes, numberedProductImageFileName, productDownloadStem } from "../app/lib/creative-generation/downloadNaming.ts";
import { resolveCategoryCreativeProfile } from "../app/lib/creative-generation/categoryCreativeRouter.ts";
import { assignNativeProductSources, isCookedProductSource, resolveNativeReferenceProductPresentation } from "../app/lib/creative-generation/productSourceAssignment.ts";
import { inspectProductTruthImages } from "../app/lib/creative-generation/productImages.server.ts";
import { applyNativeRasterRegionLock, resolveReferenceCopyRasterRegions } from "../app/lib/creative-generation/nativeRasterProtection.server.ts";
import { hasVerifiedPriceFact } from "../app/lib/creative-generation/referenceCopyAngles.ts";
import { appendCodexGenerationAdditionalInstructions, buildCodexDirectTestExecutionNote, buildDefaultCodexDirectTestPrompt, buildServiceAnalysisCodexContext, buildServiceAnalysisCodexGenerationPrompt, buildServiceStoryCodexContext, buildServiceStoryCodexGenerationPrompt, CODEX_DIRECT_TEST_PIPELINE, CODEX_DIRECT_TEST_PROMPT_VERSION, CODEX_DIRECT_TEST_STAGE_ORDER, CODEX_DIRECT_TEST_WORKFLOW } from "../app/lib/creative-generation/codexDirectTest.ts";

async function readJoinedSource(relativePaths) {
  return (await Promise.all(relativePaths.map((relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8")))).join("\n");
}

function readReferenceAdaptedPlanningSource() {
  return readJoinedSource([
    "../app/lib/creative-generation/referenceAdaptedPlanning.server.ts",
    "../app/lib/creative-generation/referenceCopyProfiles.server.ts",
    "../app/lib/creative-generation/referenceCopyPlanningCore.ts",
    "../app/lib/creative-generation/referenceCopyPlannerRuntime.server.ts",
  ]);
}

const product = {
  productName: "민트 샤워젤",
  category: "뷰티",
  price: "12,000원",
  advertiserName: "오리지널소스",
  brandName: "Original Source",
  discountInfo: "무료배송",
  mainBenefit: "민트 사용감",
  targetCustomer: "운동 후 상쾌한 샤워를 원하는 고객",
  landingUrl: "https://www.originalsource.co.kr/product/detail.html?product_no=65&utm_source=test",
  productImagePath: "/product.png",
};

test("다운로드 파일명은 광고 미사여구와 후킹 코드를 빼고 상품명_순번을 사용한다", () => {
  const noisyName = "20일 숙성한 미친 맛-설록우 안심 스테이크 3인세트팩";
  assert.equal(productDownloadStem(noisyName), "설록우안심스테이크3인세트팩");
  assert.equal(numberedProductImageFileName(noisyName, 1), "설록우안심스테이크3인세트팩_1.jpg");
  assert.equal(numberedProductImageFileName(noisyName, 2, "PNG"), "설록우안심스테이크3인세트팩_2.png");
  assert.equal(productDownloadStem("설록우 안심 스테이크 (3인세트팩)"), "설록우안심스테이크3인세트팩");
  const productionSuffixName = "추석맞이 웻에이징 숙성한 왕도매가격! 암소한우 설꽃등심 500g -당일생산 (선별 숙성등심)";
  assert.equal(cleanProductTitle(productionSuffixName, "대한한우"), "암소한우 설꽃등심 500g");
  assert.equal(productDownloadStem(productionSuffixName), "암소한우설꽃등심500g");
  assert.equal(numberedProductImageFileName(productionSuffixName, 4), "암소한우설꽃등심500g_4.jpg");
  assert.equal(downloadSequenceFromCodes(["problem-solution", "M03", "AT-DAE-T01-H03"]), 3);
});
const facts = [
  { id: "price", key: "price", label: "판매가", value: "12,000원", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: ["12,000원"], evidenceType: "price" },
  { id: "benefit", key: "benefit", label: "사용감", value: "민트 사용감", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: [], evidenceType: "usp" },
  { id: "offer", key: "promotion", label: "혜택", value: "무료배송", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: [], evidenceType: "offer" },
];
const normalized = {
  rawProductTitle: product.productName,
  cleanProductName: product.productName,
  brandName: product.brandName,
  category: product.category,
  price: product.price,
  discountInfo: product.discountInfo,
  promotion: product.discountInfo,
  ingredients: ["민트"],
  verifiedBenefits: [product.mainBenefit],
  uspCandidates: [product.mainBenefit],
  reviewEvidence: [],
  targetCustomer: product.targetCustomer,
  target: product.targetCustomer,
  usageOccasions: ["운동 후"],
  useSituations: ["운동 후"],
};
const truth = {
  productId: "p-1",
  product,
  normalized,
  facts,
  confirmedProductImage: { path: "/product.png", role: "product-packshot", source: "detail-page", verified: true, width: 800, height: 1200, transparent: true, reason: "fixture" },
  imageAssets: [],
  referenceImages: [],
  imagePaths: ["/product.png"],
  verifiedClaims: [],
  unverifiedClaims: [],
  allowedNumericTokens: ["12,000원"],
  blockedClaimPatterns: [],
  completeness: 90,
  createdAt: new Date(0).toISOString(),
};
const grammars = ["PRICE_VALUE", "SEASON_URGENCY", "FEATURE_EVIDENCE", "SENSORY_PROOF", "SITUATION_STORY", "PROBLEM_RELIEF"];
const hooks = ["price-value", "scarcity-urgency", "feature-usp", "sensory-experience", "usage-occasion", "problem-solution"].map((primaryTag, index) => ({
  id: `h${index}`,
  blueprintId: "product-hero",
  hookType: primaryTag,
  title: `후킹 ${index + 1}`,
  hookCode: `H0${index + 1}`,
  primaryTag,
  headline: `후킹 ${index + 1}`,
  body: `설명 ${index + 1}`,
  proof: "",
  offer: index === 0 ? "12,000원" : "",
  cta: "상품 보기",
  audience: product.targetCustomer,
  factIds: ["benefit"],
  numericTokens: [],
  hypothesis: `가설 ${index + 1}`,
  confidence: "high",
  creativeGrammarId: grammars[index],
  creativeBrief: { sceneDescription: `장면 ${index + 1}`, sceneType: `scene-${index + 1}`, heroScene: `장면 ${index + 1}` },
  sceneIntent: `장면 ${index + 1}`,
}));
const results = hooks.map((hookPlan, index) => ({ id: `result-${index + 1}`, order: index + 1, blueprintId: "product-hero", blueprintLabel: "제품", status: "pending", hookPlan, attempts: 0, scenePlan: { sceneAsset: { scene: `장면 ${index + 1}` } } }));

test("서버 러너가 사라진 running 결과는 중단 작업으로 감지하고 pending으로 복구한다", () => {
  const runningResults = results.map((result, index) => (index === 2 ? { ...result, status: "running", startedAt: "2026-08-22T00:00:00.000Z" } : result));
  const job = {
    status: "running",
    startedAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:01:00.000Z",
    results: runningResults,
  };

  assert.equal(hasOrphanedRunningResult(job, false), true);
  assert.equal(hasOrphanedRunningResult(job, true), false);
  assert.equal(hasOrphanedRunningResult(job, false, new Set(["result-3"])), false);

  const resumed = resumeGenerationJob(job, false, "2026-08-22T00:02:00.000Z");
  assert.equal(resumed.status, "running");
  assert.equal(resumed.results[2].status, "pending");
  assert.equal(resumed.results[2].startedAt, undefined);

  const protectedResume = resumeGenerationJob(job, false, "2026-08-22T00:02:00.000Z", false, new Set(["result-3"]));
  assert.equal(protectedResume.results[2].status, "running");
  assert.equal(protectedResume.results[2].startedAt, "2026-08-22T00:00:00.000Z");
});

test("사용자가 실패 작업을 다시 시작하면 소진된 이미지·문구 재시도 횟수를 새로 연다", () => {
  const job = {
    status: "failed",
    referenceCopyPlanning: { status: "retryable", attempts: 3, updatedAt: "2026-08-22T00:00:00.000Z" },
    results: results.map((result) => ({ ...result, status: "failed", attempts: 2, error: "이전 오류" })),
  };
  const resumed = resumeGenerationJob(job, false, "2026-08-22T00:02:00.000Z", true);
  assert.equal(resumed.referenceCopyPlanning.status, "pending");
  assert.equal(resumed.referenceCopyPlanning.attempts, 0);
  assert.ok(resumed.results.every((result) => result.status === "pending" && result.attempts === 0));
});

test("대기 결과만 있는 작업은 유령 running 작업으로 오인하지 않는다", () => {
  const job = { status: "running", updatedAt: "2026-08-22T00:01:00.000Z", results };
  assert.equal(hasOrphanedRunningResult(job, false), false);
});

test("구버전 상품군 ZIP 작업은 조회용으로만 남고 서버 러너가 실행하지 않는다", () => {
  assert.equal(
    isServerRunnableGenerationJob({
      engine: "codex_local",
      version: "generation-job-v12-category-reference-edit",
      results,
    }),
    false
  );
});

test("Codex 테스트 모드는 선택 상품 URL과 첨부 순서를 명시하고 별도 실행 계약으로만 동작한다", () => {
  const landingUrl = "https://shop.example/products/selected-item";
  const prompt = buildDefaultCodexDirectTestPrompt({ landingUrl, hasSupportingImage: true, hasPackagingImage: true });
  const executionNote = buildCodexDirectTestExecutionNote({ landingUrl, outputPath: "/tmp/result.png", hasSupportingImage: true, hasPackagingImage: true });
  assert.match(prompt, /첫번째 첨부사진이 레퍼런스/);
  assert.match(prompt, /두번째사진이 비슷하게 생성원하는이미지/);
  assert.match(prompt, /3번째사진이 라벨이미지로 참고\/라벨이 없다면 분위기 참고이미지/);
  assert.match(prompt, /4번째사진이 포장상품이미지/);
  assert.match(prompt, /화장품의 경우 2번째사진의 원본을 최대한 반영해야함/);
  assert.match(prompt, /새롭게 원본을 훼손해서 생성하는 일 없도록 꼼꼼히 검토할것/);
  assert.match(prompt, /계절성시즌\/상품특성\/사회적특성\/어떤상황에대한가정/);
  assert.match(prompt, /상세페이지에있는 이미지안에도 참고할수있는 문구들이 있다면 이미지도 읽어서 반영해도돼/);
  assert.match(prompt, /조리사진이 있거나 인물사진이 있다면/);
  assert.match(prompt, /카툰\/실사\/손그림\/3d캐릭터\/상품의마스코트캐릭터/);
  assert.match(prompt, /식품의경우 조리사진은 최대한 자연스럽게/);
  assert.match(prompt, /\*참고사항 1 : 레퍼런스에 원본상품\+포장상품도 같이 포함되어있을경우 4번이미지\(포장상품이미지\)를 같이 활용하면된다/);
  assert.match(prompt, /\*참고사항 2 : 전체적인 색감은 상품에 맞게 변형가능함/);
  assert.match(prompt, /\*주의사항 1 : 한우랑 설록우는 다름\. 한우라는 단어는 상품이 한우일때만 콘텐츠에 표기가능함/);
  assert.match(prompt, /설록우는 특별히 강조할 문구나 특징이아니다\. 굳이 표기할 필요없다\./);
  assert.match(prompt, /오히려 상품이름앞에는 상품의 특징정보가 있으면 좋다! 찰진~등심\/고소한등심\/존맛등심 등등/);
  assert.match(prompt, /\*주의사항 2 : 레퍼런스에 인물\/캐릭터가 있을 경우 상품에 맞게 변형해야 된다/);
  assert.doesNotMatch(prompt, /인물\/캐릭터가 있을경우 상품에 맞게 변형가능/);
  assert.match(prompt, new RegExp(landingUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const promptWithAdditionalInstructions = appendCodexGenerationAdditionalInstructions(prompt, "선물용 구성을 가장 먼저 강조해줘.");
  assert.equal(appendCodexGenerationAdditionalInstructions(prompt, "  "), prompt);
  assert.match(promptWithAdditionalInstructions, /\[추가\/강조 사항\]\n선물용 구성을 가장 먼저 강조해줘\.$/);
  assert.ok(promptWithAdditionalInstructions.startsWith(prompt));
  assert.match(executionNote, /1\) 광고 레퍼런스 2\) 선택 상품 이미지 3\) 라벨 또는 추가 참고 이미지 4\) 포장상품 이미지/);
  assert.match(executionNote, /\/tmp\/result\.png/);

  const directJob = {
    version: CURRENT_REFERENCE_EDIT_JOB_VERSION,
    pipeline: CODEX_DIRECT_TEST_PIPELINE,
    engine: "codex_local",
    sourceType: "manual",
    codexDirectTest: { prompt, productImagePath: "/product.jpg", supportingImagePath: "/label.jpg", packagingImagePath: "/package.jpg" },
    results: results.map((result, index) => ({
      ...result,
      nativeCreative: {
        engine: "codex_local",
        workflow: CODEX_DIRECT_TEST_WORKFLOW,
        stageOrder: CODEX_DIRECT_TEST_STAGE_ORDER,
        adReference: { id: `reference-${index}`, path: `/reference-${index}.jpg` },
        promptVersion: CODEX_DIRECT_TEST_PROMPT_VERSION,
        revisionPaths: [],
        revisionCount: 0,
      },
    })),
  };
  assert.equal(isCodexDirectTestGenerationJob(directJob), true);
  assert.equal(isServerRunnableGenerationJob(directJob), true);
  assert.equal(isCodexDirectTestGenerationJob({ ...directJob, sourceType: "auto-production" }), true);
  const storyJob = {
    ...directJob,
    productTruth: { product: { analysisMode: "site" } },
    codexDirectTest: { ...directJob.codexDirectTest, serviceCreativeMode: "story" },
    results: directJob.results.map((result) => ({
      ...result,
      nativeCreative: { ...result.nativeCreative, adReference: { id: "shared-service-reference", path: "/service-reference.jpg" } },
    })),
  };
  assert.equal(isCodexDirectTestGenerationJob(storyJob), true);
  assert.equal(isCodexDirectTestGenerationJob({
    ...storyJob,
    codexDirectTest: { ...storyJob.codexDirectTest, serviceCreativeMode: "independent" },
  }), false);
});

test("사이트 분석은 상품 프롬프트를 바꾸지 않고 별도 서비스 프롬프트와 분석 근거를 전달한다", () => {
  const prompt = buildServiceAnalysisCodexGenerationPrompt();
  assert.equal(prompt, `해당 레퍼런스를 참고해서 서비스분석내용을 바탕으로 분석한 서비스에 맞는 콘텐츠를 ImageGen기능을 활용하여 1200*1200 사이즈로 제작해줘.


*참고사항
1.마스코트/로고/기능이미지는 전달시에 크롭해서 활용할수도있고, 안해도돼.
2.전체적인 색감/캐릭터(카툰/동물/3d/손그림)/인물/배경은 분석한 서비스에 어울리게 구현해줘.

*주의사항
1.문구뉘앙스는 유지해도 좋지만,그대로 쓰면 안되고 변형해줘.`);
  assert.doesNotMatch(prompt, /해당상품으로 상품만 교체|한우랑 설록우/);
  const context = buildServiceAnalysisCodexContext({
    siteName: "메가포스팅",
    oneLineSummary: "블로그 자동 포스팅 서비스",
    offerings: ["AI 포스팅", "원격 지원"],
    coreValueProps: ["업무 시간 절감"],
    targetPriorities: [{ rank: 1, name: "초기 마케터", reason: "반복 업무가 많음" }],
    adDirections: [{ target: "초기 마케터", angle: "자동화", sampleMessage: "반복 작업을 줄이세요" }],
    selectedVisuals: [{ role: "logo", label: "메가포스팅 로고" }],
  });
  assert.match(context, /서비스명: 메가포스팅/);
  assert.match(context, /제공 서비스: AI 포스팅 · 원격 지원/);
  assert.match(context, /선택한 시각 자료: logo: 메가포스팅 로고/);
  const executionNote = buildCodexDirectTestExecutionNote({
    landingUrl: "https://service.example/",
    outputPath: "/tmp/service-result.png",
    hasSupportingImage: false,
    analysisMode: "site",
    siteVisualCount: 3,
  });
  assert.match(executionNote, /1\) 광고 레퍼런스 2~4\) 사이트에서 선택한 로고·마스코트·기능 이미지/);
  assert.match(executionNote, /분석 사이트 URL: https:\/\/service\.example\//);
});

test("스토리형 서비스 제작은 사용자 원문 프롬프트와 6장 공통 기획을 별도 블록으로 유지한다", () => {
  const prompt = buildServiceStoryCodexGenerationPrompt();
  assert.equal(prompt, `해당 레퍼런스를 참고해서 서비스분석내용을 바탕으로 분석한 서비스에 맞는 콘텐츠를 ImageGen기능을 활용하여 1200*1200 사이즈로 제작해줘.

6장에 해당 서비스의 스토리가 잘녹아들면서 순서대로 이해가 쉽도록 기획후 제작해줘.

*참고사항
1.마스코트/로고/기능이미지는 전달시에 크롭해서 활용할수도있고, 안해도돼.
2.전체적인 색감/캐릭터(카툰/동물/3d/손그림)/인물/배경은 분석한 서비스에 어울리게 구현해줘.
*주의사항
1.문구뉘앙스는 유지해도 좋지만,그대로 쓰면 안되고 변형해줘.`);
  const slides = Array.from({ length: 6 }, (_, index) => ({
    order: index + 1,
    purpose: `${index + 1}장 역할`,
    keyMessage: `${index + 1}장 메시지`,
    visualDirection: `${index + 1}장 화면`,
    transition: `${index + 2}장 연결`,
  }));
  const context = buildServiceStoryCodexContext({
    title: "서비스 이야기",
    narrativeArc: "문제에서 해결로",
    visualContinuity: "같은 색감과 캐릭터",
    slides,
    currentSlideOrder: 3,
  });
  assert.match(context, /전체 6장 순서:/);
  assert.match(context, /지금 생성할 장: 3\/6/);
  assert.match(context, /이번 장의 핵심 메시지: 3장 메시지/);
  assert.match(context, /이번 호출에서는 위 순서 중 지금 생성할 장 한 장만 완성하세요/);
});

test("스토리형 서비스 제작은 사용자가 스토리형 버튼을 선택한 경우에만 활성화된다", async () => {
  const uiSource = await readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx", import.meta.url), "utf8");
  const createSource = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const storyRouteSource = await readFile(new URL("../app/api/creative-generation/site-story-jobs/route.ts", import.meta.url), "utf8");

  assert.match(uiSource, /useState<ServiceCreativeMode>\("independent"\)/);
  assert.match(uiSource, /onClick=\{\(\) => setServiceCreativeMode\("story"\)\}/);
  assert.match(uiSource, /serviceCreativeMode: siteAnalysisMode \? serviceCreativeMode : undefined/);
  assert.match(uiSource, /siteAnalysisMode && serviceCreativeMode === "story"[\s\S]*"\/api\/creative-generation\/site-story-jobs"[\s\S]*"\/api\/creative-generation\/jobs"/);
  assert.match(storyRouteSource, /body\.product\?\.analysisMode !== "site" \|\| body\.codexDirectTest\?\.serviceCreativeMode !== "story"/);
  assert.match(storyRouteSource, /serviceStorySequential: true/);
  assert.match(createSource, /const storyModeRequested = siteAnalysisMode && input\.codexDirectTest\?\.serviceCreativeMode === "story"/);
  assert.match(createSource, /if \(storyModeRequested && !options\.serviceStorySequential\)/);
  assert.match(createSource, /serviceStoryWorkflowVersion: serviceCreativeMode === "story"[\s\S]*SITE_STORY_SEQUENTIAL_WORKFLOW_VERSION/);
  assert.match(createSource, /: "independent" as const/);
});

test("신규 사이트 스토리형만 한 Codex 세션에서 기획 후 1~6장을 순차 생성한다", async () => {
  const [runnerSource, providerSource, resultSource, plannerSource] = await Promise.all([
    readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/creative-generation/serviceStoryPlanner.server.ts", import.meta.url), "utf8"),
  ]);

  assert.match(plannerSource, /serviceStoryWorkflowVersion === SITE_STORY_SEQUENTIAL_WORKFLOW_VERSION/);
  assert.match(runnerSource, /withNativeCreativeSession\(provider, async \(session\) =>/);
  assert.match(runnerSource, /ensureServiceStoryPlanInSession\(jobId, session\)/);
  assert.match(runnerSource, /selectRunnableResults\(job, attempted, 1\)/);
  assert.match(runnerSource, /handleNativeResultGeneration\(\{[\s\S]*requestId: `site-story-runner:[\s\S]*session,/);
  assert.match(runnerSource, /if \(!job \|\| !isServerRunnableGenerationJob\(job\) \|\| job\.status === "cancelled" \|\| isSequentialServiceStoryGenerationJob\(job\)\) return/);
  assert.match(runnerSource, /isSequentialServiceStoryGenerationJob\(recovered\)[\s\S]*storyRunner\.enqueue\(jobId/);
  assert.match(providerSource, /const planServiceStory = async/);
  assert.match(providerSource, /return \{[\s\S]*planServiceStory,[\s\S]*generate,[\s\S]*validate/);
  assert.match(providerSource, /previousStoryImagePath/);
  assert.match(resultSource, /if \(input\.session\) await generateWithSession\(input\.session\)/);
  assert.match(resultSource, /else await withNativeCreativeSession\(provider, generateWithSession\)/);
});

test("기본 Codex 제작은 문구 플래너·그룹 QA 없이 첨부를 레퍼런스부터 전달한다", async () => {
  const runnerSource = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  const providerSource = await readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts", import.meta.url), "utf8");
  const resultSource = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  const uiSource = await readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx", import.meta.url), "utf8");
  assert.match(runnerSource, /isDefaultCodexGenerationJob\(recovered\)/);
  assert.doesNotMatch(runnerSource, /ensureReferenceCopyPlanning|planReferenceAdaptedCopies|validateCompletedReferenceGroup/);
  assert.match(providerSource, /productReferences\.slice\(0, siteAnalysisMode \? sequentialStoryMode && previousStoryImagePath \? 4 : 5 : 3\)/);
  assert.match(resultSource, /stage: "codex-direct-test"/);
  assert.match(resultSource, /prepareDefaultCodexGenerationImages/);
  assert.doesNotMatch(resultSource.slice(resultSource.indexOf("async function runDefaultCodexResult"), resultSource.indexOf("async function runNativeResultGeneration")), /session\.validate/);
  assert.doesNotMatch(uiSource, /테스트 모드|기존 수동 제작 흐름/);
  assert.match(uiSource, /수동·자동 공통 기본 방식/);
  assert.match(uiSource, /2번 상품 이미지/);
  assert.match(uiSource, /3번 라벨·추가 참고/);
  assert.match(uiSource, /4번 포장상품/);
  assert.match(uiSource, /product\.landingUrl \|\| props\.analyzedProductUrl/);
  const factorySource = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  assert.match(factorySource, /const currentPathSet = new Set\(resolvedPaths\.allPaths\)/);
  assert.match(factorySource, /const truth = rawTruth/);
  assert.doesNotMatch(factorySource, /inspectProductTruthImages|assertNativeProductReferenceReady|analyzeProductReferences/);
});

test("개발 서버 핫리로드는 체크포인트 복구 러너를 사용한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  const activeRoute = await readFile(new URL("../app/api/creative-generation/jobs/active/route.ts", import.meta.url), "utf8");
  const instrumentation = await readFile(new URL("../instrumentation.ts", import.meta.url), "utf8");
  assert.match(source, /runnerPolicySignature/);
  assert.match(source, /DEFAULT_CODEX_GENERATION_PROMPT_VERSION/);
  assert.match(source, /runnerPolicySignature = DEFAULT_CODEX_GENERATION_PROMPT_VERSION/);
  assert.match(source, /server-runner:\$\{runnerPolicySignature\}/);
  assert.doesNotMatch(source, /server-runner-v\d+[^\n]*copy-v\d+/);
  assert.match(source, /executionTimeoutMs: runnerWatchdogMs\(\)/);
  assert.doesNotMatch(source, /시작 전 v11 작업을 상품군 우선 ZIP 레퍼런스로 재배정/);
  assert.doesNotMatch(source, /ensureReferenceCopyPlanning|planReferenceAdaptedCopies/);
  assert.doesNotMatch(source, /사전 문구 검증 차단을 해제하고 pending으로 복구/);
  assert.match(source, /resolveFastCreativeRuntime\(\)\.concurrency/);
  assert.match(source, /export async function recoverPersistedGenerationJobs/);
  assert.match(source, /hasOrphanedRunningResult\(job, runnerWasActive, activeDirectResultIds\)/);
  assert.match(instrumentation, /recoverPersistedGenerationJobs\(\)/);
  assert.match(activeRoute, /if \(!isGenerationJobRunnerActive\(job\.id\)\)/);
  assert.match(activeRoute, /enqueueGenerationJob\(job\.id/);
});

test("구버전 문구 작업은 이미지 프롬프트만 바꿔 최신 작업으로 오인하지 않는다", () => {
  const oldFinal = "/tmp/old-final.jpg";
  const active = {
    status: "running",
    version: "generation-job-v13-reference-first-adapted-copy",
    pipeline: "reference-first-adapted-copy",
    recoveryLog: [],
    results: results.map((result, index) => ({
      ...result,
      status: index === 0 ? "success" : "pending",
      imagePath: index === 0 ? "/api/old-image" : undefined,
      nativeCreative: {
        promptVersion: index === 0 ? "reference-native-copy-v16-always-render-no-shipping" : "reference-native-copy-v29-shared-context-background-gate",
        finalPath: index === 0 ? oldFinal : undefined,
        stagePaths: index === 0 ? { productPath: "/tmp/old-product.png" } : undefined,
        referencePaths: ["/tmp/product.jpg"],
        revisionPaths: [],
      },
    })),
  };
  const migrated = migrateActiveJobToPromptVersion(active, "reference-native-copy-v29-shared-context-background-gate", "2026-09-02T00:00:00.000Z");
  assert.equal(migrated, active);
  assert.equal(isServerRunnableGenerationJob(active), false);
  assert.equal(migrated.status, "running");
  assert.equal(migrated.results[0].status, "success");
  assert.equal(migrated.results[0].imagePath, "/api/old-image");
  assert.equal(migrated.results[0].nativeCreative.finalPath, oldFinal);
  assert.equal(migrated.results[1].status, "pending");
  assert.deepEqual(migrated.recoveryLog, []);
});

test("고속 모드는 동시 3장·치명 QA 자동 수정 1회·그룹 QA off가 기본이다", () => {
  assert.deepEqual(resolveFastCreativeRuntime({}), { enabled: true, concurrency: 3, autoRevisionLimit: 1, groupQaEnabled: false, plannerReasoning: "medium", imageReasoning: "low", maxCreatives: 6 });
  assert.equal(resolveFastCreativeRuntime({ ADATLAS_CREATIVE_CONCURRENCY: "9" }).concurrency, 3);
  assert.equal(resolveFastCreativeRuntime({ ADATLAS_AUTO_REVISION_LIMIT: "0" }).autoRevisionLimit, 1);
  assert.equal(resolveFastCreativeRuntime({ ADATLAS_CODEX_PLANNER_REASONING: "low" }).plannerReasoning, "medium");
  assert.equal(resolveFastCreativeRuntime({ ADATLAS_CODEX_PLANNER_REASONING: "high" }).plannerReasoning, "high");
});

test("한 상품은 3장씩 처리하되 여러 작업의 로컬 Codex 실행도 전역 3개를 넘지 않는다", async () => {
  assert.equal(resolveCodexCreativeParallelLimit({}), 3);
  assert.equal(resolveCodexCreativeParallelLimit({ ADATLAS_CODEX_MAX_PARALLEL_RUNS: "9" }), 3);
  const gate = createAsyncConcurrencyGate(3);
  let active = 0;
  let maximum = 0;
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });
  const tasks = Array.from({ length: 6 }, () =>
    gate.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await blocker;
      active -= 1;
    })
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(maximum, 3);
  assert.equal(gate.activeCount(), 3);
  assert.equal(gate.pendingCount(), 3);
  release();
  await Promise.all(tasks);
});

test("QA는 10점 척도를 100점으로 정규화하고 로컬 검증된 JPEG 때문에 재생성하지 않는다", () => {
  const validation = normalizeNativeCreativeValidation(
    {
      hookAlignment: 9,
      productIdentity: 9,
      factualAccuracy: 10,
      koreanTextAccuracy: 10,
      readability: 9,
      composition: 9,
      diversity: 8,
      commercialQuality: 9,
      exportCompliance: 0,
      productVisibility: 9,
      humanNaturalness: 9,
      categoryFit: 9,
      foodAppetiteAppeal: 9,
      sensoryExpression: 9,
      mobileReadability: 9,
      observedKoreanText: [],
      failures: ["1200×1200 JPEG 및 800KB 이하인지 확인할 수 없습니다."],
      recommendation: "revise",
      checkedAt: new Date(0).toISOString(),
    },
    { category: "general", exportComplianceVerified: true }
  );
  assert.equal(validation.productIdentity, 90);
  assert.equal(validation.exportCompliance, 100);
  assert.equal(validation.failures.length, 0);
  assert.equal(validation.recommendation, "approve");
});

test("QA는 비치명 문구 경고 이미지를 남기고 사실·정책 오류만 자동 수정한다", () => {
  const base = {
    hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
    composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
    humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
    observedKoreanText: ["19,900원 19,900원"], standaloneLogoDetected: false, standaloneLogoFindings: [],
    sourcePersonDetected: false, sourcePersonReplaced: false, humanCompositionChanged: false, targetAudienceFit: 100,
    humanReplacementFindings: [], humanCopyAligned: true, humanCopyAlignmentFindings: [],
    sceneProductInteractionAligned: true, sceneProductInteractionFindings: [], checkedAt: new Date(0).toISOString(),
  };
  const normalized = normalizeNativeCreativeValidation({ ...base, failures: ["같은 가격 문구가 반복됩니다."], recommendation: "approve" });
  assert.equal(normalized.recommendation, "revise");

  const checked = enforceReferenceCopyPlanValidity({ ...base, failures: [], recommendation: "approve" }, {
    validationStatus: "invalid",
    validationErrors: ["소재 01와 핵심 문구 블록이 반복됩니다."],
  });
  assert.equal(checked.recommendation, "manual-review");
  assert.match(checked.failures.join(" "), /문구 품질 경고가 있어 결과 확인이 필요합니다/);

  const blocked = enforceReferenceCopyPlanValidity({ ...base, failures: [], recommendation: "approve" }, {
    validationStatus: "invalid",
    validationErrors: ["ProductTruth에 없는 수치 또는 차단 표현이 포함됐습니다."],
  });
  assert.equal(blocked.recommendation, "revise");
  assert.match(blocked.failures.join(" "), /치명적인 사실·정책 오류/);
});

test("누끼·스티커형 상품은 점수가 높아도 치명 오류로 재생성한다", () => {
  const validation = normalizeNativeCreativeValidation({
    hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
    composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
    humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
    observedKoreanText: [], standaloneLogoDetected: false, standaloneLogoFindings: [],
    detachedProductCutoutDetected: true, detachedProductCutoutFindings: ["상품 둘레의 흰 테두리와 분리된 그림자"],
    failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
  });
  assert.equal(validation.recommendation, "revise");
  assert.ok(validation.composition <= 35);
  assert.match(validation.failures.join(" "), /누끼·스티커·독립 패널/);
});

test("최종 OCR이 목표 한글을 문자 단위로 확인하지 못하면 자동 수정 대상으로 바꾼다", () => {
  const approved = {
    hookAlignment: 95,
    productIdentity: 95,
    factualAccuracy: 100,
    koreanTextAccuracy: 100,
    readability: 95,
    composition: 95,
    diversity: 90,
    commercialQuality: 95,
    exportCompliance: 100,
    productVisibility: 95,
    humanNaturalness: 95,
    categoryFit: 95,
    foodAppetiteAppeal: 95,
    sensoryExpression: 95,
    mobileReadability: 95,
    observedKoreanText: ["추석엔 넉넉하게 준비하세요", "부드러운 숙성등심 1kg"],
    failures: [],
    recommendation: "approve",
    checkedAt: new Date(0).toISOString(),
  };
  assert.equal(enforceExactRenderedCopyValidation(approved, ["추석엔 넉넉하게 준비하세요"]).recommendation, "approve");

  const broken = enforceExactRenderedCopyValidation(
    { ...approved, observedKoreanText: ["추석엔 [깨짐:판독불가]하게 준비하세요"] },
    ["추석엔 넉넉하게 준비하세요"]
  );
  assert.equal(broken.recommendation, "revise");
  assert.ok(broken.koreanTextAccuracy < 75);
  assert.match(broken.failures.join(" "), /OCR|획이 깨지거나/);
});

test("원본 레퍼런스의 연출·예시·AI 이미지 고지는 최종 OCR에서 자동 수정 대상으로 바꾼다", () => {
  const approved = {
    hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
    composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
    humanNaturalness: 100, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
    observedKoreanText: ["바삭한 전병 한입", "연출 이미지"], standaloneLogoDetected: false, standaloneLogoFindings: [],
    failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
  };
  assert.equal(isSourceDisclosureCopy("이해를 돕기 위한 예시 이미지입니다"), true);
  assert.equal(isSourceDisclosureCopy("AI를 활용한 이미지"), true);
  assert.equal(isSourceDisclosureCopy("바삭한 전병 한입"), false);

  const checked = enforceNoSourceDisclosureCopy(approved);
  assert.equal(checked.recommendation, "revise");
  assert.ok(checked.koreanTextAccuracy < 75);
  assert.ok(checked.commercialQuality < 75);
  assert.match(checked.failures.join(" "), /출처 문구.*연출 이미지/);

  const clean = enforceNoSourceDisclosureCopy({ ...approved, observedKoreanText: ["바삭한 전병 한입"] });
  assert.equal(clean.recommendation, "approve");
});

test("비육류 광고의 원산지 문구는 목표 문구 밖에 남아도 최종 OCR에서 수정 대상으로 바꾼다", () => {
  const approved = {
    hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
    composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
    humanNaturalness: 100, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
    observedKoreanText: ["황궁 얼음골사과", "국내산"], standaloneLogoDetected: false, standaloneLogoFindings: [],
    failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
  };
  const apple = enforceOriginCopyPolicy(approved, { productName: "황궁 얼음골사과", category: "식품/과일" });
  assert.equal(apple.recommendation, "revise");
  assert.match(apple.failures.join(" "), /원산지 문구 사용 정책/);

  const beef = enforceOriginCopyPolicy({ ...approved, observedKoreanText: ["국내산 한우 갈비"] }, { productName: "국내산 한우 갈비", category: "식품/육류" });
  assert.equal(beef.recommendation, "approve");
});

test("사과 옆 팽이버섯처럼 확인되지 않은 먹거리는 별도 치명 오류로 승인하지 않는다", () => {
  const checked = normalizeNativeCreativeValidation({
    hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
    composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
    humanNaturalness: 100, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
    observedKoreanText: ["황궁 얼음골사과"], standaloneLogoDetected: false, standaloneLogoFindings: [],
    unrelatedFoodOrIngredientDetected: true, unrelatedFoodOrIngredientFindings: ["사과 우측에 팽이버섯 다발"],
    failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
  }, { category: "food_fresh", exportComplianceVerified: true });
  assert.equal(checked.recommendation, "revise");
  assert.ok(checked.productIdentity < 75);
  assert.match(checked.failures.join(" "), /팽이버섯/);
});

test("레퍼런스 교체형 QA는 별도 장면을 강요하지 않고 실제 JPEG 규격을 신뢰한다", () => {
  const prompt = buildNativeValidationPrompt({ productTruth: truth }, { hookPlan: hooks[0] });
  assert.doesNotMatch(prompt, /Intended scene:/);
  assert.match(prompt, /reference-driven replacement workflow/);
  assert.match(prompt, /exportCompliance to 100/);
});

test("키나 기존 이미지 플래그만으로 유료 이미지 생성이 열리지 않는다", () => {
  assert.equal(
    isPaidImageGenerationEnabled({
      OPENAI_API_KEY: "sk-test",
      ADATLAS_IMAGE_GENERATION_ENABLED: "true",
    }),
    false
  );
  assert.equal(
    isPaidImageGenerationEnabled({
      ADATLAS_PAID_API_EXPLICIT_ENABLED: "true",
      ADATLAS_IMAGE_GENERATION_ENABLED: "true",
    }),
    true
  );
});

test("native 유료 공급자는 작업별 과거 시점의 명시 승인만 인정한다", () => {
  assert.equal(hasExplicitPaidApiAuthorization(undefined), false);
  assert.equal(hasExplicitPaidApiAuthorization({ explicitlySelected: true, provider: "openai_api", scope: "native-creative", acknowledgedAt: new Date(Date.now() + 60_000).toISOString() }), false);
  assert.equal(hasExplicitPaidApiAuthorization({ explicitlySelected: true, provider: "openai_api", scope: "native-creative", acknowledgedAt: new Date(Date.now() - 1_000).toISOString() }), true);
});

test("레거시 템플릿 레지스트리는 과거 작업 호환용 10개를 유지한다", () => {
  assert.equal(performanceTemplateRegistry.length, 10);
  assert.equal(new Set(performanceTemplateRegistry.map((item) => item.id)).size, 10);
  assert.equal(new Set(performanceTemplateRegistry.map((item) => item.zones.join("|"))).size, 10);
});

test("신규 native 광고 문법은 좌표 템플릿이 아닌 의미 규칙 10개다", () => {
  assert.equal(referenceCreativeGrammars.length, 10);
  assert.equal(new Set(referenceCreativeGrammars.map((item) => item.id)).size, 10);
  assert.ok(referenceCreativeGrammars.every((item) => item.hookPattern && item.scenePattern && item.typographyPattern));
  assert.ok(referenceCreativeGrammars.every((item) => !("productBox" in item)));
});

test("상품 근거에 맞는 서로 다른 6개 문법을 자동 선택하고 나머지만 추가 제안한다", () => {
  const selected = selectPerformanceTemplates(truth, hooks, 6);
  assert.equal(selected.length, 6);
  assert.equal(new Set(selected.map((item) => item.id)).size, 6);
  assert.ok(selected.some((item) => item.id === "T01_PRICE_SHOCK"));
  const unused = unusedPerformanceTemplates(
    selected.map((item) => item.id),
    truth
  );
  assert.ok(unused.every((item) => !selected.some((selectedItem) => selectedItem.id === item.id)));
});

test("가격·혜택·후기·라인업 근거가 없으면 해당 문법을 선택하지 않는다", () => {
  const noSignals = { ...truth, product: { ...product, price: "", discountInfo: "", mainBenefit: "", targetCustomer: "" }, facts: [] };
  const selected = selectPerformanceTemplates(noSignals, hooks, 6).map((item) => item.id);
  assert.ok(!selected.includes("T01_PRICE_SHOCK"));
  assert.ok(!selected.includes("T02_URGENT_OFFER"));
  assert.ok(!selected.includes("T07_SOCIAL_PROOF"));
  assert.ok(!selected.includes("T10_LINEUP_BENEFIT"));
});

test("금지 문구는 띄어쓰기·대소문자·조사 변형까지 탐지하고 문장 단위로 제거한다", () => {
  assert.equal(hasBannedCreativePhrase("상세 페이지 기준으로 보면"), true);
  assert.equal(hasBannedCreativePhrase("usp가 특별한 선택이에요"), true);
  assert.deepEqual(findBannedCreativePhrases("분석해 보니 놓칠 수 없는 상품"), ["분석해보니", "놓칠 수 없는"]);
  assert.equal(repairBannedCreativeSentence("분석 결과입니다. 운동 뒤 산뜻하게 씻어요!"), "운동 뒤 산뜻하게 씻어요!");
  assert.equal(hasBannedCreativePhrase("판매가는 49,800원입니다"), true);
  assert.equal(hasBannedCreativePhrase("1kg 박스 판매가는 49,800원"), true);
  assert.equal(hasBannedCreativePhrase("확인된 판매가 기준"), true);
  assert.equal(looksLikeGenericOrRepetitiveCopy("민트로 씻는 순간", "민트로 씻는 순간"), true);
});

test("사용자에게 노출하는 정상 CTA는 내부 전략 문구로 차단하지 않는다", () => {
  assert.equal(hasBannedCreativePhrase("구매 조건 보기"), false);
  assert.equal(hasBannedCreativePhrase("상품 정보 보기"), false);
  assert.equal(hasBannedCreativePhrase("구성 보기"), false);
});

test("AI 프롬프트는 원본 상품·정확한 한글·검증된 가격을 포함한 완성 광고 전체를 요구한다", () => {
  const job = { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "personal_care" } }, results };
  const prompt = buildNativeFinalCreativePrompt(job, results[0], "/tmp/final.png");
  assert.match(prompt, /FINAL, COMPLETE, READY-TO-RUN Korean square performance advertisement/);
  assert.match(prompt, /MAIN COPY: 후킹 1/);
  assert.match(prompt, /SUB COPY: 설명 1/);
  assert.match(prompt, /OFFER: 12,000원/);
  assert.match(prompt, /CTA: 상품 보기/);
  assert.match(prompt, /PACKAGED PRODUCT POLICY — FULL AI REFERENCE INTEGRATION/);
  assert.match(prompt, /never extract, cut out, paste, locally composite or restore/);
  assert.match(prompt, /A local product cutout is never an allowed repair/);
  assert.doesNotMatch(prompt, /text-free square advertising scene plate|No product package/);
});

test("오리지널소스 시트 문구는 문제·효능·수치의 강도를 유지한 채 이미지 장면과 인물 행동으로 연결한다", () => {
  const originalSourceTruth = {
    ...truth,
    product: {
      ...truth.product,
      vendorResearch: {
        sourceDocument: "오리지널 소스 민트티트리 상세 조사.xlsx",
        facts: [],
        blockedClaims: [],
        allowSheetClaimsInCopy: true,
      },
    },
  };
  const result = {
    ...results[0],
    hookPlan: {
      ...results[0].hookPlan,
      headline: "운동 끝났는데 열기는 그대로?",
      body: "샤워 직후 체감 온도 -8.9°C",
      proof: "한 번 샤워에 민트 잎 약 132장 분량",
    },
  };
  const job = { productTruth: originalSourceTruth, creativePlan: { categoryCreativeProfile: { category: "personal_care" } }, results: [result] };
  const prompt = buildNativeStagePrompt("product-replacement", job, result, "/tmp/02-product.png");
  assert.match(prompt, /ORIGINAL SOURCE RESEARCH-TO-SCENE CONTRACT/);
  assert.match(prompt, /user-provided Original Source research sheet is authorized evidence/);
  assert.match(prompt, /운동 끝났는데 열기는 그대로/);
  assert.match(prompt, /-8\.9°C/);
  assert.match(prompt, /loss-aversion or problem headline needs a visibly understandable problem-to-payoff scene/);
  assert.match(prompt, /remove that identity and follow the explicit planned subject mode/);
});

test("신규 reference-first 작업은 구조를 생성하지 않고 상품·문구·치명 QA만 단계 편집한다", () => {
  const job = { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "personal_care" } }, results };
  const slotResult = {
    ...results[0],
    referenceAdaptedCopyPlan: {
      referenceRawCopy: "2주만에 흑무릎 탈출\n새까만 무릎, 그거 때 아니야\n1+1 흑무릎 탈색 세럼",
      referenceRawLines: ["2주만에 흑무릎 탈출", "새까만 무릎, 그거 때 아니야", "1+1 흑무릎 탈색 세럼"],
      adaptedLines: ["민트 쿨링으로 샤워 고민 탈출", "운동 후 답답함, 상쾌하게 씻어요", "민트 사용감으로 산뜻한 마무리"],
      copySlots: [
        { index: 0, role: "headline", sourceText: "2주만에 흑무릎 탈출", targetText: "민트 쿨링으로 샤워 고민 탈출", emphasis: "strong" },
        { index: 1, role: "support", sourceText: "새까만 무릎, 그거 때 아니야", targetText: "운동 후 답답함, 상쾌하게 씻어요", emphasis: "light" },
        { index: 2, role: "offer", sourceText: "1+1 흑무릎 탈색 세럼", targetText: "민트 사용감으로 산뜻한 마무리", emphasis: "strong" },
      ],
    },
  };
  const structure = buildNativeStagePrompt("structure-recreation", job, results[0], "/tmp/01-structure.png");
  const productReplacement = buildNativeStagePrompt("product-replacement", job, results[0], "/tmp/02-product.png");
  const copyReplacement = buildNativeStagePrompt("copy-replacement", job, slotResult, "/tmp/03-copy.png");
  const qaRepair = buildNativeStagePrompt("qa-repair", job, results[0], "/tmp/04-qa.png", "가격 표기를 다시 확인하세요.");

  assert.match(structure, /STAGE 1 OF 4/);
  assert.match(structure, /byte-for-byte/);
  assert.match(structure, /must never call image generation/);
  assert.doesNotMatch(structure, /neutral proxy product forms/);
  assert.match(productReplacement, /STAGE 2 OF 4/);
  assert.match(productReplacement, /authoritative product-page images/);
  assert.match(productReplacement, /REPLACE THE PRODUCT WITH AUTHORITATIVE PRODUCT REFERENCES/);
  assert.match(productReplacement, /Generate the product, its contact surface, surrounding light, reflections, shadows, hands and occlusions together/);
  assert.match(productReplacement, /Never leave an empty reserved product box/);
  assert.match(productReplacement, /clearly different fictional adult/);
  assert.match(productReplacement, /planned subject mode/);
  assert.match(productReplacement, /change at least two composition attributes/i);
  assert.match(productReplacement, /NON-HUMAN LOCAL SEMANTIC-PROP EDIT MODE/);
  assert.match(productReplacement, /exact local footprint of an incompatible carrier/);
  assert.match(productReplacement, /every already compatible background pixel/);
  assert.match(productReplacement, /every visible animal or animal-like character/);
  assert.match(productReplacement, /SEMANTIC CARRIER AND DECORATIVE-MOTIF REPLACEMENT IS MANDATORY, NOT OPTIONAL/);
  assert.match(productReplacement, /meat frying pan\/grill\/raw-meat tray, kimchi or brine tub/);
  assert.match(productReplacement, /verified current-product-compatible carrier or motif/);
  assert.match(productReplacement, /unrelated product\/ingredient character/);
  assert.match(productReplacement, /emoji-style icon/);
  assert.match(productReplacement, /same footprint with a verified current-product-compatible carrier or motif/);
  assert.match(productReplacement, /If the verified target product is already present but too small, enlarge and recompose that SAME instance/);
  assert.match(productReplacement, /never add a second copy, a smaller foreground copy, a detached packshot, or a separate product panel/);
  assert.match(productReplacement, /Never place a second miniature lineup over or in front of the first lineup/);
  assert.match(productReplacement, /CHARACTER \/ ICON STYLE-LOCK RULE/);
  assert.match(productReplacement, /keep the inherited character or motif count, positions/);
  assert.match(productReplacement, /ProductTruth\/product title/);
  assert.match(productReplacement, /use the current product as the replacement character or motif/);
  assert.match(productReplacement, /Do not regenerate the rest of the table, room, wall, window, furniture, lighting or photographic scene/);
  assert.match(copyReplacement, /STAGE 3 OF 4/);
  assert.match(copyReplacement, /Change ONLY the source advertisement's copy/);
  assert.match(copyReplacement, /Preserve its natural scene contact, hand occlusion, reflections and shadows/);
  assert.match(copyReplacement, /no local product layer will be restored later/);
  assert.match(copyReplacement, /메인 문구: 후킹 1/);
  assert.match(copyReplacement, /가격·혜택: 12,000원/);
  assert.match(copyReplacement, /SOURCE → TARGET COPY SLOT CONTRACT/);
  assert.match(copyReplacement, /headline\/strong/);
  assert.match(copyReplacement, /same number of headline, support, proof, offer\/label, CTA and badge zones/);
  assert.match(copyReplacement, /must never collapse into a plain product-name label/);
  assert.match(copyReplacement, /Render no number, price, discount, quantity or benefit that is absent from EXACT COPY/);
  assert.match(copyReplacement, /There will be no local text overlay/);
  assert.match(qaRepair, /STAGE 4 OF 4/);
  assert.match(qaRepair, /TARGETED RASTER REPAIR/);
  assert.match(qaRepair, /edit only the smallest failing region named by QA/);
  assert.match(qaRepair, /incompatible semantic carrier, source prop or product-linked decorative motif/);
  assert.match(qaRepair, /product-linked decorative motif/);
  assert.match(qaRepair, /unrelated ingredient\/product character/);
  assert.match(qaRepair, /preserve the reference's count, position, scale, crop, expression, pose, line weight and illustration style/);
  assert.match(qaRepair, /MUST change when retaining it makes the current product read as a different category/);
  assert.match(qaRepair, /A product that exists but is small is a scale\/layout problem, not a missing-product problem/);
  assert.match(qaRepair, /repair visibility only by enlarging and recomposing that SAME existing instance/);
  assert.match(qaRepair, /Do not add another package, duplicate lineup, miniature foreground product, detached packshot, rectangular product-reference panel or pasted product scene/);
  assert.match(qaRepair, /keep one set and resize the whole set as one unit rather than repeating it/);
  assert.match(qaRepair, /Do not mistake an intentional, physically coherent set arrangement for an overlay/);
  assert.match(qaRepair, /mismatched scale, light, perspective, contact, occlusion, edge treatment or redundant placement are decisive evidence/);
  assert.match(qaRepair, /Never copy their surrounding promotional background, rays, splashes, ingredient collage, copy, badge or border/);
  assert.match(qaRepair, /product count/);
  assert.match(qaRepair, /exact Korean copy/);
  assert.match(qaRepair, /가격 표기를 다시 확인하세요/);
});

test("육류는 원본 부위와 마블링을 근거로 장면 안에 자연스럽게 재생성한다", () => {
  const meatTruth = {
    ...truth,
    product: { ...truth.product, productName: "설록우 알등심 스테이크 1kg", category: "육류" },
    normalized: { ...truth.normalized, cleanProductName: "설록우 알등심 스테이크 1kg", category: "육류" },
  };
  const meatJob = { productTruth: meatTruth, creativePlan: { categoryCreativeProfile: { category: "food_meat" } }, results };
  const productReplacement = buildNativeStagePrompt("product-replacement", meatJob, results[0], "/tmp/02-product.png");
  const copyReplacement = buildNativeStagePrompt("copy-replacement", meatJob, results[0], "/tmp/03-copy.png");
  const validation = buildNativeValidationPrompt(meatJob, results[0]);
  const lockedValidation = buildNativeValidationPrompt(meatJob, results[0], { hasLockedProductStage: true });
  assert.equal(resolveProductRenderingPolicy(meatJob), "natural-meat-reference");
  assert.match(productReplacement, /MEAT PRODUCT POLICY — NATURAL SCENE INTEGRATION/);
  assert.match(productReplacement, /irregular marbling boundaries/);
  assert.match(productReplacement, /non-repeating muscle fibers/);
  assert.match(productReplacement, /width-to-thickness ratio/);
  assert.match(productReplacement, /never make the meat thicker, rounder, redder or more heavily marbled/);
  assert.match(productReplacement, /RESOLVED MEAT PRESENTATION MODE: CLEAN RETAIL CUT/);
  assert.match(productReplacement, /RAW\/COOKED HOOK GATE/);
  assert.match(productReplacement, /product title containing words such as steak, grill or barbecue is not enough by itself/);
  assert.match(productReplacement, /keep the hero meat raw\/chilled or packaged/);
  assert.match(productReplacement, /PRODUCT IDENTITY OVERRIDES THE SOURCE FOOD SCENE/);
  assert.match(productReplacement, /SHAPE CONSERVATION/);
  assert.match(productReplacement, /COOKING-SURFACE TRANSFORMATION/);
  assert.match(productReplacement, /DETAIL BUDGET AND PIECE COUNT/);
  assert.match(productReplacement, /normally 3-7/);
  assert.match(productReplacement, /must not survive cooking as raised white grooves/);
  assert.match(productReplacement, /must never increase apparent thickness/);
  assert.match(productReplacement, /do not hallucinate macro texture or a generic cooked steak/);
  assert.match(productReplacement, /do not clone, mirror or repeat the same vein map/);
  assert.match(productReplacement, /Do not add dense white spiderwebs/);
  assert.match(productReplacement, /small varied specular highlights/);
  assert.match(productReplacement, /not matte, chalky, gray, dry or dehydrated/);
  assert.match(productReplacement, /never slimy, lacquered, glassy or uniformly glossy/);
  assert.match(productReplacement, /Never fill an unused product slot with a gift box, gold tray, retail package or invented label/);
  assert.match(productReplacement, /never like a rectangular source photo or detached cutout/);
  assert.match(productReplacement, /never crop, screen-capture, cut out or locally composite/);
  assert.match(productReplacement, /different cut, grade, origin, quantity or package/);
  assert.match(productReplacement, /Change the source product instances/);
  assert.match(validation, /clearly different fictional adult/);
  assert.match(validation, /smooth plastic\/waxy surface/);
  assert.match(validation, /altered width-to-thickness ratio/);
  assert.match(validation, /exaggerated marbling grade\/density/);
  assert.match(validation, /natural, appetizing, physically coherent food photography/);
  assert.match(validation, /MANDATORY STRUCTURED MEAT AUDIT/);
  assert.match(validation, /Cooked meat is allowed without a seller-provided cooked photograph/);
  assert.match(validation, /abundant but physically believable juices/);
  assert.match(validation, /TOP BRAND\/탑브랜드/);
  assert.match(validation, /Matte, chalky, gray, dry, dehydrated or visibly tough meat/);
  assert.match(validation, /meatArtificialPatternDetected/);
  assert.match(validation, /meatGrotesqueDetailDetected/);
  assert.match(validation, /reject dozens of equally sharp, similarly rectangular pieces/);
  assert.match(copyReplacement, /PRODUCT PIXEL LOCK — IDENTITY CHECK ONLY/);
  assert.match(copyReplacement, /preserve the exact stage-2 piece count, outlines, overlap/);
  assert.doesNotMatch(copyReplacement, /MEAT PRODUCT POLICY — NATURAL SCENE INTEGRATION/);
  assert.match(lockedValidation, /COPY-STAGE PIXEL LOCK AUDIT/);
  assert.match(lockedValidation, /critical copy-stage mutation/);
});

test("구운 고기는 상품명이 아니라 실제 후킹이 조리·섭취를 요구할 때만 사용한다", () => {
  const meatTruth = {
    ...truth,
    product: { ...truth.product, productName: "설록우 알등심 스테이크 1kg", category: "육류" },
    normalized: { ...truth.normalized, cleanProductName: "설록우 알등심 스테이크 1kg", category: "육류" },
  };
  const baseJob = { productTruth: meatTruth, creativePlan: { categoryCreativeProfile: { category: "food_meat" } }, results };
  const titleOnly = resolveMeatPresentationContract(baseJob, results[0]);
  assert.equal(titleOnly.mode, "clean-retail-cut");
  assert.equal(titleOnly.cookedSceneAllowed, false);

  const cookedResult = {
    ...results[0],
    hookPlan: {
      ...results[0].hookPlan,
      headline: "팬에 굽자마자 육즙이 팡",
      body: "오늘 저녁 한입으로 확인하세요",
      sceneIntent: "뜨거운 팬에서 같은 부위를 구워 육즙을 보여주는 장면",
    },
  };
  const cooked = resolveMeatPresentationContract(baseJob, cookedResult);
  assert.equal(cooked.hasAuthoritativeCutEvidence, true);
  assert.equal(cooked.hasAuthoritativeCookedEvidence, false);
  assert.equal(cooked.cookedSceneAllowed, true);
  assert.equal(cooked.mode, "hook-supported-cooked-scene");
  const prompt = buildNativeStagePrompt("product-replacement", baseJob, cookedResult, "/tmp/02-product.png");
  assert.match(prompt, /RESOLVED MEAT PRESENTATION MODE: HOOK-SUPPORTED COOKED SCENE/);
  assert.match(prompt, /appetizing irregular searing/);
  assert.match(prompt, /abundant but physically believable meat juices/);
  assert.match(prompt, /visibly prove the assigned hook at first glance/);
});

test("육류 before-after 레퍼런스는 문구에 조리어가 없어도 원물→조리 상태 변화를 유지한다", () => {
  const meatTruth = {
    ...truth,
    product: { ...truth.product, productName: "한우 안창살", category: "육류" },
    normalized: { ...truth.normalized, cleanProductName: "한우 안창살", category: "육류" },
  };
  const beforeAfterResult = {
    ...results[0],
    nativeCreative: {
      ...results[0].nativeCreative,
      adReference: { ...(results[0].nativeCreative?.adReference || {}), compositionType: "before-after" },
    },
    hookPlan: { ...results[0].hookPlan, headline: "안창살의 진한 풍미", body: "오늘 식탁에서 확인하세요" },
  };
  const meatJob = { productTruth: meatTruth, creativePlan: { categoryCreativeProfile: { category: "food_meat" } }, results: [beforeAfterResult] };
  const contract = resolveMeatPresentationContract(meatJob, beforeAfterResult);
  assert.equal(contract.referenceNeedsCookedScene, true);
  assert.equal(contract.cookedSceneAllowed, true);
  assert.equal(contract.mode, "hook-supported-cooked-scene");
  const prompt = buildNativeStagePrompt("product-replacement", meatJob, beforeAfterResult, "/tmp/02-product.png");
  assert.match(prompt, /before\/after means a truthful state transition, not two packages/);
  assert.match(prompt, /Do not substitute a required cooked\/served state with a gift box/);
});

test("육류 세트는 검증된 팩 수와 다중 판매단위 이미지가 함께 있을 때만 전체 구성을 만든다", () => {
  const setTruth = {
    ...truth,
    product: {
      ...truth.product,
      productName: "설록우 특등심 5팩 세트",
      category: "육류",
      sourceImageCandidates: [{ id: "set", type: "detail", imagePath: "/set.jpg", label: "5팩 전체 구성", selected: true, createdAt: new Date(0).toISOString(), multipleObjectsAreSalesUnit: true }],
    },
    normalized: { ...truth.normalized, cleanProductName: "설록우 특등심 5팩 세트", category: "육류", composition: "특등심 5팩 세트" },
    facts: [...truth.facts, { id: "composition", key: "composition", label: "구성", value: "특등심 5팩", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: ["5팩"], evidenceType: "composition" }],
  };
  const setJob = { productTruth: setTruth, creativePlan: { categoryCreativeProfile: { category: "food_meat" } }, results };
  const contract = resolveMeatPresentationContract(setJob, results[0]);
  assert.equal(contract.mode, "verified-set-composition");
  assert.equal(contract.verifiedPackCount, 5);
  const prompt = buildNativeStagePrompt("product-replacement", setJob, results[0], "/tmp/02-product.png");
  assert.match(prompt, /Show exactly 5 separately countable sales units/);
  assert.match(prompt, /Do not invent gold trays, gift boxes, garnish, extra packs/);

  const noVisualProofJob = { ...setJob, productTruth: { ...setTruth, product: { ...setTruth.product, sourceImageCandidates: [] } } };
  assert.equal(resolveMeatPresentationContract(noVisualProofJob, results[0]).mode, "clean-retail-cut");

  const ambiguousOptionsJob = {
    ...setJob,
    productTruth: {
      ...setTruth,
      normalized: { ...setTruth.normalized, composition: "3팩/4팩/5팩 세트 옵션 선택" },
      facts: truth.facts,
    },
  };
  assert.equal(resolveMeatPresentationContract(ambiguousOptionsJob, results[0]).verifiedPackCount, undefined);
  assert.equal(resolveMeatPresentationContract(ambiguousOptionsJob, results[0]).mode, "clean-retail-cut");
});

test("여러 팩 옵션이 함께 있는 상품은 선택 전 가격·팩 수를 광고 근거와 이미지 구성에서 차단한다", () => {
  const rawProductTitle = "한우안심 선물세트 (1팩/25,000원꼴) 안심 3팩,4팩,5팩세트 옵션선택";
  assert.deepEqual(extractPackOptionCounts(rawProductTitle), [1, 3, 4, 5]);
  assert.deepEqual(extractPackOptionCounts("48시간 비법숙성 한우 안심4팩세트"), [4]);
  const ambiguousTruth = buildProductTruth({
    product: {
      productName: rawProductTitle,
      category: "육류",
      price: "74,000원",
      originalPrice: "244,000원",
      discountInfo: "70% 할인",
      mainBenefit: "48시간 비법숙성 한우 안심4팩세트",
      verifiedBenefits: ["한우 안심4팩 선물세트", "특마블 등심 5팩세트"],
      landingUrl: "https://example.com/ambiguous-options",
      sourceImageCandidates: [{ id: "set", type: "detail", imagePath: "/set.jpg", label: "전체 구성", selected: true, createdAt: new Date(0).toISOString(), multipleObjectsAreSalesUnit: true }],
    },
    rawProductTitle,
    source: "landing-page",
  });
  assert.equal(ambiguousTruth.normalized.optionSelectionRequired, true);
  assert.equal(ambiguousTruth.normalized.composition, undefined);
  assert.deepEqual(ambiguousTruth.normalized.ambiguousOptionCounts, [1, 3, 4, 5]);
  assert.ok(ambiguousTruth.facts.filter((fact) => /(?:4팩|5팩|74,000원|244,000원|70%)/u.test(fact.value)).every((fact) => fact.copyEligibility === "blocked" && fact.usableInCopy === false));
  assert.ok(!ambiguousTruth.allowedNumericTokens.some((token) => /(?:팩|원|%)/u.test(token)));
  const job = { productTruth: ambiguousTruth, creativePlan: { categoryCreativeProfile: { category: "food_meat" } }, results };
  assert.equal(resolveMeatPresentationContract(job, results[0]).verifiedPackCount, undefined);
  assert.equal(resolveMeatPresentationContract(job, results[0]).mode, "clean-retail-cut");
});

test("육류 전용 QA는 후킹 없는 구운 장면·인위적 육결·틀린 팩 수를 승인하지 않는다", () => {
  const baseValidation = {
    hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
    composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
    humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
    observedKoreanText: [], standaloneLogoDetected: false, standaloneLogoFindings: [], failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
  };
  const wrongCooked = normalizeNativeCreativeValidation(
    {
      ...baseValidation,
      meatCutIdentityAccurate: true,
      meatTextureNatural: false,
      meatArtificialPatternDetected: true,
      meatArtificialPatternFindings: ["모든 조각에 같은 격자형 마블링"],
      meatGrotesqueDetailDetected: false,
      meatPresentationModeAligned: false,
      meatPresentationFindings: ["원물 모드인데 구운 스테이크가 보임"],
      meatCookedPresentationDetected: true,
      meatCookedEvidenceSatisfied: false,
      meatSetCompositionAccurate: true,
      meatObservedPackCount: 0,
    },
    {
      category: "food_meat",
      meatPresentationContract: {
        mode: "clean-retail-cut",
        hasAuthoritativeCutEvidence: true,
        hasAuthoritativeCookedEvidence: false,
        hookNeedsCookedScene: false,
        referenceNeedsCookedScene: false,
        cookedSceneAllowed: false,
        hasVerifiedSetComposition: false,
      },
    }
  );
  assert.equal(wrongCooked.recommendation, "revise");
  assert.ok(wrongCooked.productIdentity <= 65);
  assert.ok(wrongCooked.foodAppetiteAppeal <= 35);
  assert.match(wrongCooked.failures.join(" "), /인위적|구운 고기|표현 모드/);

  const wrongSet = normalizeNativeCreativeValidation(
    { ...baseValidation, meatSetCompositionAccurate: false, meatObservedPackCount: 4 },
    {
      category: "food_meat",
      meatPresentationContract: {
        mode: "verified-set-composition",
        hasAuthoritativeCutEvidence: true,
        hasAuthoritativeCookedEvidence: false,
        hookNeedsCookedScene: false,
        referenceNeedsCookedScene: false,
        cookedSceneAllowed: false,
        hasVerifiedSetComposition: true,
        verifiedPackCount: 5,
      },
    }
  );
  assert.equal(wrongSet.recommendation, "revise");
  assert.match(wrongSet.failures.join(" "), /5팩/);

  const inventedSet = normalizeNativeCreativeValidation(
    { ...baseValidation, meatSetCompositionAccurate: true, meatObservedPackCount: 5 },
    {
      category: "food_meat",
      meatPresentationContract: {
        mode: "clean-retail-cut",
        hasAuthoritativeCutEvidence: true,
        hasAuthoritativeCookedEvidence: false,
        hookNeedsCookedScene: false,
        referenceNeedsCookedScene: false,
        cookedSceneAllowed: false,
        hasVerifiedSetComposition: false,
      },
    }
  );
  assert.equal(inventedSet.recommendation, "revise");
  assert.ok(inventedSet.productIdentity <= 45);
  assert.match(inventedSet.failures.join(" "), /선택·검증되지 않은 5팩/u);

  const borderlineMeat = normalizeNativeCreativeValidation(
    { ...baseValidation, productIdentity: 84 },
    {
      category: "food_meat",
      meatPresentationContract: {
        mode: "clean-retail-cut",
        hasAuthoritativeCutEvidence: true,
        hasAuthoritativeCookedEvidence: false,
        hookNeedsCookedScene: false,
        referenceNeedsCookedScene: false,
        cookedSceneAllowed: false,
        hasVerifiedSetComposition: false,
      },
    }
  );
  assert.equal(borderlineMeat.recommendation, "revise");
  assert.match(borderlineMeat.failures.join(" "), /출고 하한 85점/u);
});

test("화장품은 누끼 보호층 없이 상품과 장면을 하나의 AI 래스터로 통합한다", async () => {
  const beautyJob = { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "personal_care" } }, results };
  const productPrompt = buildNativeStagePrompt("product-replacement", beautyJob, results[0], "/tmp/02-product.png");
  const copyPrompt = buildNativeStagePrompt("copy-replacement", beautyJob, results[0], "/tmp/03-copy.png");
  const generationSource = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  assert.equal(resolveProductRenderingPolicy(beautyJob), "ai-packaged-product-reference");
  assert.match(productPrompt, /PACKAGED PRODUCT POLICY — FULL AI REFERENCE INTEGRATION/);
  assert.match(productPrompt, /never extract, cut out, paste, locally composite or restore/);
  assert.match(productPrompt, /Never leave an empty reserved product box/);
  assert.match(copyPrompt, /no local product layer will be restored later/);
  assert.doesNotMatch(generationSource, /createIdentityLockedProductComposite|restoreProtectedProduct/);
});

test("음료·우유·캔·파우치·박스·건강기능식품도 누끼 없는 AI 패키지 통합 정책을 쓴다", () => {
  for (const productName of ["딸기맛 우유 3병", "레몬 음료 캔", "깔라만시 파우치", "비타민 30정 박스", "유산균 건강기능식품"]) {
    const packagedJob = {
      productTruth: { ...truth, product: { ...truth.product, productName, category: "식품" }, normalized: { ...truth.normalized, cleanProductName: productName, category: "식품", packageOrOption: productName } },
      creativePlan: { categoryCreativeProfile: { category: "food_packaged" } },
      results,
    };
    assert.equal(resolveProductRenderingPolicy(packagedJob), "ai-packaged-product-reference", productName);
  }
});

test("차돌복숭아 같은 과일명은 차 음료로 오인하지 않고 일반 상품 레퍼런스를 쓴다", () => {
  const produceName = "프리미엄 딱딱이 희귀품종 봉황 차돌복숭아";
  const produceJob = {
    productTruth: {
      ...truth,
      product: { ...truth.product, productName: produceName, category: "과일/농산물" },
      normalized: { ...truth.normalized, cleanProductName: produceName, category: "과일/농산물", packageOrOption: "" },
    },
    creativePlan: { categoryCreativeProfile: { category: "food_produce" } },
    results,
  };
  assert.equal(resolveProductRenderingPolicy(produceJob), "standard-reference");
});

test("식품으로 분류한 건강간식·봉지 제품은 건강식품 패키지로 재분류하지 않는다", () => {
  const snackName = "건강간식 바삭달콤 고구마칩 반란 괴물용량 350g 1봉지";
  const snackJob = {
    productTruth: {
      ...truth,
      product: { ...truth.product, productName: snackName, category: "식품" },
      normalized: { ...truth.normalized, cleanProductName: snackName, category: "식품", packageOrOption: "350g 1봉지" },
    },
    productReferenceProfile: { immutableFacts: { productType: "snack" } },
    creativePlan: { categoryCreativeProfile: { category: "food_fresh" } },
    referenceCategoryOverride: "food",
    results,
  };
  assert.equal(resolveProductRenderingPolicy(snackJob), "standard-reference");
});

test("관리 화면의 실제 광고 레퍼런스를 다섯 상품군 선택 풀로 등록한다", async () => {
  const manifest = JSON.parse(await readFile(new URL("../data/native-creative-reference-library.json", import.meta.url), "utf8"));
  const categorySource = await readFile(new URL("../app/lib/creative-generation/referenceCreativeLibrary.server.ts", import.meta.url), "utf8");
  assert.ok(manifest.items.length >= 6);
  assert.ok(new Set(manifest.items.map((item) => item.layoutFamily)).size >= 1);
  assert.ok(manifest.items.every((item) => item.publicPath.startsWith("/creative-references/")));
  const categoryCounts = manifest.items.reduce((counts, item) => ({ ...counts, [item.categoryGroup]: (counts[item.categoryGroup] || 0) + 1 }), {});
  assert.equal(
    Object.values(categoryCounts).reduce((sum, count) => sum + count, 0),
    manifest.items.length
  );
  assert.ok((categoryCounts.beauty || 0) >= 6);
  assert.ok((categoryCounts.food || 0) >= 6);
  assert.ok(manifest.items.every((item) => ["fashion", "food", "beauty", "service", "gfa"].includes(item.categoryGroup)));
  assert.ok(manifest.items.every((item) => item.productForm && item.compositionType && item.productSlotCount && item.productSlotShape && item.photographyType && item.textDensity && item.compatibilityConfidence));
  const normalizedFood = manifest.items.filter((item) => item.categoryGroup === "food").map(normalizeNativeReferenceCompatibility);
  const normalizedBeauty = manifest.items.filter((item) => item.categoryGroup === "beauty").map(normalizeNativeReferenceCompatibility);
  for (const foodSubcategory of ["meat", "snack"]) {
    assert.ok(normalizedFood.filter((item) => item.foodSubcategory === foodSubcategory).length >= 6, `${foodSubcategory} 식품 레퍼런스가 6장 이상 필요합니다.`);
  }
  assert.ok(normalizedFood.filter((item) => !item.foodSubcategory).length >= 6, "일반 식품 레퍼런스가 6장 이상 필요합니다.");
  const beautyDesignCount = normalizedBeauty.filter((item) => item.beautySubcategory === "design").length;
  const beautyHookCount = normalizedBeauty.filter((item) => item.beautySubcategory === "hook").length;
  assert.ok(beautyHookCount >= 6, "후킹 화장품 레퍼런스가 6장 이상 필요합니다.");
  assert.ok(beautyHookCount > beautyDesignCount, "현재 화장품 풀은 판매형 후킹 소재가 디자인 키비주얼보다 많아야 합니다.");
  assert.match(manifest.selectionPolicy, /패션·식품·화장품·서비스·GFA 다섯 그룹/);
  assert.match(manifest.selectionPolicy, /식품은 육류·간식 하위 풀/);
  assert.match(manifest.selectionPolicy, /화장품은 디자인·후킹 하위 풀/);
  assert.match(manifest.selectionPolicy, /건강·웰니스와 퍼스널케어는 화장품에 포함/);
  assert.match(manifest.selectionPolicy, /등록 여부 자체를 운영자의 품질 승인/);
  assert.match(manifest.selectionPolicy, /점수 우선순위 없이 중복 없는 무작위 6장/);
  assert.match(manifest.selectionPolicy, /미지정 대카테고리로 임의 보충하지 않으며/);
  assert.match(manifest.selectionPolicy, /삭제된 항목은 즉시 선택 대상에서 제외/);
  assert.match(manifest.usagePolicy, /URL 상품과 ProductTruth 문구로 단계별 교체/);
  assert.match(categorySource, /category === "fashion"\) return "fashion"/);
  assert.match(categorySource, /return "beauty";/);
  assert.match(categorySource, /"health-wellness" \|\| value === "general"\) return "beauty"/);
  assert.match(categorySource, /buildProductReferenceCompatibilityProfile/);
  assert.match(categorySource, /pickUniqueRandomItems/);
  assert.match(categorySource, /referenceBelongsToSelectionPool\(item, categoryGroup, profile\.foodSubcategory\)/);
  assert.match(categorySource, /점수에 따른 우선순위는 적용하지 않았으며/);
  assert.match(categorySource, /recentReferenceIds/);
  assert.doesNotMatch(categorySource, /categorySafeItems/);
  assert.match(categorySource, /readNativeReferenceManifestSync/);
});

test("ZIP 전체 풀에서 무작위 6장을 중복 없이 선택한다", () => {
  const source = Array.from({ length: 113 }, (_, index) => `reference-${index + 1}`);
  const selected = pickUniqueRandomItems(source, 6, () => 0);
  assert.equal(selected.length, 6);
  assert.equal(new Set(selected).size, 6);
  assert.ok(selected.every((item) => source.includes(item)));
});

test("레퍼런스 선택은 같은 호환 점수 안에서도 이미지 구성과 원문 문구가 다른 항목을 우선한다", () => {
  const source = Array.from({ length: 8 }, (_, index) =>
    normalizeNativeReferenceCompatibility({
      id: `diverse-${index + 1}`,
      publicPath: `/diverse-${index + 1}.jpg`,
      sourceFile: `diverse-${index + 1}.jpg`,
      layoutFamily: index % 2 ? "situation-story" : "price-offer",
      categoryGroup: "beauty",
      ordinal: 500 + index,
      productForm: "bottle",
      compositionType: index % 3 === 0 ? "lifestyle-scene" : index % 3 === 1 ? "price-card" : "sensory-closeup",
      supportsPackagedProduct: true,
      compatibilityConfidence: "high",
      nativeCopy: {
        referenceId: `diverse-${index + 1}`,
        rawText: index < 2 ? "같은 원문" : `서로 다른 원문 ${index + 1}`,
        rawLines: [index < 2 ? "같은 원문" : `서로 다른 원문 ${index + 1}`],
        textRegions: [],
        manuallyCorrected: false,
        useForCopyAdaptation: true,
        extractionSource: "manual",
        updatedAt: "2026-08-24T00:00:00.000Z",
      },
    })
  );
  const selected = pickCompatibleRandomItems(
    source,
    6,
    {
      categoryGroup: "beauty",
      productForm: "bottle",
      productCount: 1,
      packagedProduct: true,
      naturalFood: false,
      allowsHumanModel: false,
      compatibleCompositionTypes: ["lifestyle-scene", "price-card", "sensory-closeup"],
    },
    () => 0
  );
  assert.equal(selected.length, 6);
  assert.equal(new Set(selected.map((candidate) => candidate.item.id)).size, 6);
  assert.ok(new Set(selected.map((candidate) => candidate.item.compositionType)).size >= 3);
  assert.ok(new Set(selected.map((candidate) => candidate.item.nativeCopy.rawText)).size >= 5);
});

test("화장품 선택은 상위 점수 밴드로 다시 축소하지 않고 전체 호환 풀을 사용한다", () => {
  const item = (id, productForm, index) => normalizeNativeReferenceCompatibility({
    id,
    publicPath: `/${id}.jpg`,
    sourceFile: `${id}.jpg`,
    layoutFamily: productForm === "bottle" ? "same-layout" : `layout-${index}`,
    categoryGroup: "beauty",
    ordinal: 700 + index,
    productForm,
    compositionType: index % 2 ? "lifestyle-scene" : "price-card",
    supportsPackagedProduct: true,
    compatibilityConfidence: "high",
    nativeCopy: {
      referenceId: id,
      rawText: productForm === "bottle" ? "반복 원문" : `다른 화장품 원문 ${index}`,
      rawLines: [productForm === "bottle" ? "반복 원문" : `다른 화장품 원문 ${index}`],
      textRegions: [],
      manuallyCorrected: false,
      useForCopyAdaptation: true,
      extractionSource: "manual",
      updatedAt: "2026-08-26T00:00:00.000Z",
    },
  });
  const highScoreBottles = Array.from({ length: 6 }, (_, index) => item(`high-${index}`, "bottle", index));
  const compatibleTubes = Array.from({ length: 6 }, (_, index) => item(`pool-${index}`, "tube", index + 6));
  const selected = pickCompatibleRandomItems([...highScoreBottles, ...compatibleTubes], 6, {
    categoryGroup: "beauty",
    productForm: "bottle",
    productCount: 1,
    packagedProduct: true,
    naturalFood: false,
    allowsHumanModel: false,
    compatibleCompositionTypes: ["lifestyle-scene", "price-card"],
  }, () => 0);
  assert.ok(selected.some((candidate) => candidate.item.productForm === "tube"));
});

test("화장품 단품은 인물형과 동일 패키지 복수 배치 레퍼런스도 호환 풀에서 사용한다", () => {
  const source = [
    normalizeNativeReferenceCompatibility({
      id: "beauty-human",
      publicPath: "/beauty-human.jpg",
      sourceFile: "beauty-human.jpg",
      layoutFamily: "human-use",
      categoryGroup: "beauty",
      ordinal: 901,
      productForm: "bottle",
      compositionType: "human-use",
      productSlotCount: 1,
      photographyType: "human-model",
      supportsPackagedProduct: true,
      supportsHumanModel: true,
      compatibilityConfidence: "high",
    }),
    normalizeNativeReferenceCompatibility({
      id: "beauty-repeat",
      publicPath: "/beauty-repeat.jpg",
      sourceFile: "beauty-repeat.jpg",
      layoutFamily: "lineup",
      categoryGroup: "beauty",
      ordinal: 902,
      productForm: "bottle",
      compositionType: "product-lineup",
      productSlotCount: 5,
      photographyType: "packshot",
      supportsPackagedProduct: true,
      supportsMultipleProducts: true,
      compatibilityConfidence: "high",
    }),
  ];
  const profile = {
    categoryGroup: "beauty",
    productForm: "bottle",
    productCount: 1,
    packagedProduct: true,
    naturalFood: false,
    allowsHumanModel: true,
    compatibleCompositionTypes: defaultCompositionTypes({ categoryGroup: "beauty", packagedProduct: true, naturalFood: false, productCount: 1 }),
  };
  const selected = pickCompatibleRandomItems(source, 2, profile, () => 0);
  assert.deepEqual(new Set(selected.map((candidate) => candidate.item.id)), new Set(["beauty-human", "beauty-repeat"]));
});

test("인물 레퍼런스는 확정 주체 모드로 재구성하고 복수 슬롯은 동일 상품만 반복한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/nativeCreativePrompt.ts", import.meta.url), "utf8");
  const humanResult = {
    ...results[0],
    nativeCreative: { adReference: { photographyType: "human-model", compositionType: "human-use", layoutFamily: "human-use" } },
    scenePlan: { ...results[0].scenePlan, sceneAsset: { ...results[0].scenePlan.sceneAsset, includesPerson: true } },
  };
  const humanJob = { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "personal_care" } }, results: [humanResult] };
  const humanPrompt = buildNativeStagePrompt("product-replacement", humanJob, humanResult, "/tmp/human-full-scene.png");
  assert.match(source, /remove the source face, identity, body, pose, gesture, wardrobe, location and old category story completely/i);
  assert.match(source, /new-adult means a clearly different fictional adult/);
  assert.match(source, /Follow the planned subject mode exactly/);
  assert.match(source, /product character or no person/i);
  assert.match(source, /Physical eating, holding or applying is required only when the planned action explicitly says so/);
  assert.match(source, /change at least two composition attributes/i);
  assert.match(source, /Never reproduce the source person's biometric likeness/);
  assert.match(source, /same verified package several times/);
  assert.match(source, /never invent another scent, variant, package design or sales quantity/);
  assert.match(humanPrompt, /SOURCE-PERSON SCENE RECOMPOSITION MODE/);
  assert.match(humanPrompt, /planned subject mode \(new-adult\)/);
  assert.match(humanPrompt, /Never patch onto the old location/);
  assert.match(humanPrompt, /full person-led photographic scene\/background excluding locked copy and graphic zones/);
  assert.doesNotMatch(humanPrompt, /only its immediately surrounding background/);

  const characterResult = {
    ...humanResult,
    referenceAdaptedCopyPlan: {
      sceneAdaptation: { subjectMode: "product-character", expressionPrinciple: "인물의 감탄 역할을 상품 캐릭터로 전환", subjectRole: "상품 캐릭터", action: "제품을 가리키며 감탄", setting: "새 장면", preserveElements: [], replaceElements: [], verifiedMotifs: ["민트 샤워젤"] },
    },
  };
  assert.equal(nativeReferenceContainsPerson(characterResult), true);
  assert.equal(nativePlannedSubjectMode(characterResult), "product-character");
  assert.equal(nativeReferenceRequiresHumanReplacement(characterResult), false);
  assert.match(buildNativeStagePrompt("product-replacement", humanJob, characterResult, "/tmp/character-scene.png"), /planned subject mode \(product-character\)/);
});

test("인물 레퍼런스는 타깃 인물과 다른 인물 구도를 모두 통과해야 승인된다", () => {
  const humanResult = {
    ...results[0],
    nativeCreative: { adReference: { photographyType: "human-model", compositionType: "human-use", layoutFamily: "human-use" } },
  };
  assert.equal(nativeReferenceRequiresHumanReplacement(humanResult), true);
  const failed = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["정확한 문구"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourcePersonDetected: true, sourcePersonReplaced: true, humanCompositionChanged: false, targetAudienceFit: 95,
      humanReplacementFindings: ["얼굴만 바뀌고 포즈와 프레이밍이 같습니다."], failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "personal_care", exportComplianceVerified: true, requiresHumanReplacement: true }
  );
  assert.equal(failed.recommendation, "revise");
  assert.ok(failed.humanNaturalness <= 40);
  assert.match(failed.failures.join(" "), /다른 인물·다른 인물 구도/);
});

test("원본 인물이 있어도 확정 주체가 인물 없음이면 새 성인을 QA가 강제하지 않는다", () => {
  const checked = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["정확한 문구"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourcePersonDetected: true, sourcePersonReplaced: false, humanCompositionChanged: false, humanSceneBackgroundRebuilt: true,
      targetAudienceFit: 100, humanReplacementFindings: [], humanCopyAligned: true, humanCopyAlignmentFindings: [],
      plannedSubjectModeAligned: true, plannedSubjectModeFindings: [],
      sourceAnimalDetected: false, sourceAnimalReplaced: false, animalReplacementFindings: [],
      sourceContextualBackgroundDetected: false, contextualBackgroundRebuilt: true, contextualBackgroundFindings: [],
      sceneProductInteractionAligned: true, sceneProductInteractionFindings: [], unrelatedFoodOrIngredientDetected: false,
      unrelatedFoodOrIngredientFindings: [], sourceBrandRegionCleared: true, sourceBrandRegionFindings: [],
      comparisonSemanticAligned: true, comparisonSemanticFindings: [], failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "general", exportComplianceVerified: true, sourceContainsPerson: true, plannedSubjectMode: "none", requiresHumanReplacement: false, requiresHumanSceneBackgroundRebuild: true }
  );
  assert.equal(checked.plannedSubjectMode, "none");
  assert.equal(checked.recommendation, "approve");
  assert.doesNotMatch(checked.failures.join(" "), /다른 인물·다른 인물 구도/);
});

test("인물만 바꾸고 원본 장소 랜드마크를 남긴 결과는 승인하지 않는다", () => {
  const failed = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["정확한 문구"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourcePersonDetected: true, sourcePersonReplaced: true, humanCompositionChanged: true, humanSceneBackgroundRebuilt: false,
      humanSceneBackgroundFindings: ["원본 책상 위 연필통과 병이 같은 위치에 남았습니다."], targetAudienceFit: 95,
      humanReplacementFindings: [], humanCopyAligned: true, humanCopyAlignmentFindings: [],
      sceneProductInteractionAligned: true, sceneProductInteractionFindings: [], unrelatedFoodOrIngredientDetected: false,
      unrelatedFoodOrIngredientFindings: [], failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "personal_care", exportComplianceVerified: true, requiresHumanReplacement: true, requiresHumanSceneBackgroundRebuild: true }
  );
  assert.equal(failed.recommendation, "revise");
  assert.ok(failed.composition <= 40);
  assert.match(failed.failures.join(" "), /원본 장소·배경 랜드마크/);
});

test("동물은 구도 역할을 유지해 상품 관련 다른 동물로 반드시 교체한다", () => {
  const animalJob = { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "personal_care" } }, results };
  const prompt = buildNativeStagePrompt("product-replacement", animalJob, results[0], "/tmp/animal-product.png");
  assert.match(prompt, /ANIMAL \/ ANIMAL-CHARACTER MANDATORY REPLACEMENT/);
  assert.match(prompt, /Product relevance decides WHAT replaces it, never WHETHER replacement happens/);
  assert.match(prompt, /preserving its count, footprint, depth, gaze, reaction role and visual style/);

  const failed = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["정확한 문구"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourcePersonDetected: false, sourcePersonReplaced: false, humanCompositionChanged: false, targetAudienceFit: 100,
      humanReplacementFindings: [], humanCopyAligned: true, humanCopyAlignmentFindings: [],
      sourceAnimalDetected: true, sourceAnimalReplaced: false,
      animalReplacementFindings: ["레퍼런스의 햄스터가 그대로 남았습니다."],
      sceneProductInteractionAligned: true, sceneProductInteractionFindings: [], unrelatedFoodOrIngredientDetected: false,
      unrelatedFoodOrIngredientFindings: [], failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "personal_care", exportComplianceVerified: true }
  );
  assert.equal(failed.recommendation, "revise");
  assert.ok(failed.categoryFit <= 40);
  assert.match(failed.failures.join(" "), /다른 동물로 교체하지 못했습니다/);
});

test("비인물 레퍼런스는 호환 배경을 보존하되 충돌 소품이 남으면 승인하지 않는다", () => {
  const backgroundJob = { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "food_processed" } }, results };
  const validationPrompt = buildNativeValidationPrompt(backgroundJob, results[0]);
  assert.match(validationPrompt, /MANDATORY CONTEXTUAL-BACKGROUND AUDIT/);
  assert.match(validationPrompt, /compatible background pixels were preserved and every incompatible old-category prop was locally replaced/);

  const failed = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["정확한 문구"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourcePersonDetected: false, sourcePersonReplaced: false, humanCompositionChanged: false, targetAudienceFit: 100,
      humanReplacementFindings: [], humanCopyAligned: true, humanCopyAlignmentFindings: [],
      sourceAnimalDetected: false, sourceAnimalReplaced: false, animalReplacementFindings: [],
      sourceContextualBackgroundDetected: true, contextualBackgroundRebuilt: false,
      contextualBackgroundFindings: ["포도 옆에 원본 김치와 밥 반찬이 남았습니다."],
      sceneProductInteractionAligned: true, sceneProductInteractionFindings: [], unrelatedFoodOrIngredientDetected: false,
      unrelatedFoodOrIngredientFindings: [], failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "food_processed", exportComplianceVerified: true }
  );
  assert.equal(failed.recommendation, "revise");
  assert.ok(failed.commercialQuality <= 40);
  assert.match(failed.failures.join(" "), /호환 배경을 보존하고 충돌 소품만 국소 교체/);
});

test("비인물 자연식품 레퍼런스는 전체 배경 재구성을 강제하지 않고 인물형만 강제한다", () => {
  const contextualResult = {
    ...results[0],
    nativeCreative: {
      adReference: {
        id: "context-food-reference",
        compositionType: "natural-food-scene",
        photographyType: "natural-food",
      },
    },
  };
  assert.equal(nativeReferenceRequiresContextualBackgroundRebuild(contextualResult), false);
  assert.equal(nativeReferenceRequiresContextualBackgroundRebuild({
    ...contextualResult,
    nativeCreative: { adReference: { id: "plain-reference", compositionType: "product-packshot", photographyType: "packshot" } },
  }), false);

  assert.equal(nativeReferenceRequiresContextualBackgroundRebuild({
    ...contextualResult,
    nativeCreative: { adReference: { id: "human-reference", compositionType: "human-use", photographyType: "human-model" } },
  }), true);

  const preserved = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["정확한 문구"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourceContextualBackgroundDetected: false, contextualBackgroundRebuilt: false,
      contextualBackgroundFindings: [], sceneProductInteractionAligned: true, sceneProductInteractionFindings: [],
      failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "food_fresh", exportComplianceVerified: true, requiresContextualBackgroundRebuild: false }
  );
  assert.equal(preserved.sourceContextualBackgroundDetected, false);
  assert.equal(preserved.recommendation, "approve");
});

test("VS OCR 레퍼런스는 같은 카테고리의 불리한 대안과 현재 상품 역할을 강제한다", () => {
  const comparisonResult = {
    ...results[0],
    nativeCreative: {
      adReference: {
        id: "legacy-vs-reference",
        compositionType: "price-card",
        nativeCopy: {
          rawText: "비싸기만 한 간식 VS 한가득 담은 간식",
          rawLines: ["비싸기만 한 간식", "VS", "한가득 담은 간식"],
          textRegions: [
            { id: "problem-copy-left", text: "비싸기만 한 간식" },
            { id: "versus-decoration", text: "VS" },
            { id: "benefit-headline-right", text: "한가득 담은 간식" },
          ],
        },
      },
    },
  };
  const comparisonJob = { productTruth: truth, results: [comparisonResult] };
  assert.equal(nativeReferenceRequiresComparisonSemantics(comparisonResult), true);
  const prompt = buildNativeStagePrompt("product-replacement", comparisonJob, comparisonResult, "/tmp/vs-product.png");
  assert.match(prompt, /SEMANTIC VS COMPARISON OVERRIDE/);
  assert.match(prompt, /generic unbranded alternative from the SAME product category/);
  assert.match(prompt, /Do not turn both sides into the same hero product/);

  const failed = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["정확한 문구"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourcePersonDetected: false, sourcePersonReplaced: false, humanCompositionChanged: false, targetAudienceFit: 100,
      humanReplacementFindings: [], humanCopyAligned: true, humanCopyAlignmentFindings: [],
      sceneProductInteractionAligned: true, sceneProductInteractionFindings: [], unrelatedFoodOrIngredientDetected: false,
      unrelatedFoodOrIngredientFindings: [], comparisonSemanticAligned: false,
      comparisonSemanticFindings: ["왼쪽에 전병이 아닌 채소와 식사가 남았습니다."],
      failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "food_processed", exportComplianceVerified: true, requiresComparisonSemanticAlignment: true }
  );
  assert.equal(failed.recommendation, "revise");
  assert.match(failed.failures.join(" "), /VS 비교 구도/);
});

test("원본 브랜드 글자만 지우고 빈 배지 컨테이너를 남긴 결과는 승인하지 않는다", () => {
  const failed = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["정확한 문구"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourcePersonDetected: false, sourcePersonReplaced: false, humanCompositionChanged: false, targetAudienceFit: 100,
      humanReplacementFindings: [], humanCopyAligned: true, humanCopyAlignmentFindings: [],
      sceneProductInteractionAligned: true, sceneProductInteractionFindings: [], unrelatedFoodOrIngredientDetected: false,
      unrelatedFoodOrIngredientFindings: [], sourceBrandRegionCleared: false,
      sourceBrandRegionFindings: ["왼쪽 하단에 글자 없는 빨간 캡슐이 남았습니다."],
      failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "food_processed", exportComplianceVerified: true, requiresSourceBrandRegionClear: true }
  );
  assert.equal(failed.recommendation, "revise");
  assert.match(failed.failures.join(" "), /빈 배지·캡슐/);
});

test("무화과 반건조 간식은 식품으로 분류하되 확정 장면이 선택 행동이면 먹는 행동을 강제하지 않는다", async () => {
  const figTruth = {
    ...truth,
    product: {
      ...truth.product,
      productName: "재구매 쫄깃달달 반건조 곶감무화과 대용량 300g",
      category: "기타",
      detectedProductType: "snack",
      targetCustomer: "",
    },
    normalized: {
      ...truth.normalized,
      rawProductTitle: "재구매 쫄깃달달 반건조 곶감무화과 대용량 300g",
      cleanProductName: "반건조 곶감무화과 대용량 300g",
      baseProductName: "반건조 곶감무화과",
      category: "기타",
      targetCustomer: "",
      target: "",
    },
    facts: [
      { id: "texture", key: "texture", label: "식감", value: "쫄깃달달", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: [], evidenceType: "usp" },
      { id: "quantity", key: "quantity", label: "판매단위", value: "300g", verification: "source-backed", source: "landing-page", usableInCopy: true, numericTokens: ["300g"], evidenceType: "quantity" },
    ],
  };
  const humanResult = {
    ...results[0],
    hookPlan: { ...results[0].hookPlan, offer: "", factIds: ["texture", "quantity"] },
    referenceAdaptedCopyPlan: {
      sceneAdaptation: { subjectMode: "new-adult", expressionPrinciple: "선택 이유 발견", subjectRole: "간식을 고르는 성인", action: "포장과 구성을 비교해 간식을 고른다", setting: "주말 장보기 장면", preserveElements: [], replaceElements: [], verifiedMotifs: ["반건조 곶감무화과"] },
    },
    nativeCreative: {
      adReference: {
        id: "reference-copy-113",
        categoryGroup: "beauty",
        photographyType: "human-model",
        compositionType: "human-use",
        layoutFamily: "human-use",
      },
    },
  };
  const figJob = { productTruth: figTruth, results: [humanResult] };
  const productReplacement = buildNativeStagePrompt("product-replacement", figJob, humanResult, "/tmp/02-product.png");
  const validation = buildNativeValidationPrompt(figJob, humanResult);
  const categorySource = await readFile(new URL("../app/lib/creative-generation/referenceCreativeLibrary.server.ts", import.meta.url), "utf8");
  const extractSource = await readJoinedSource([
    "../app/api/extract/product/route.ts",
    "../app/lib/mvp/productHtmlSignals.server.ts",
    "../app/lib/mvp/productImageCandidateExtraction.server.ts",
  ]);

  assert.equal(resolveCategoryCreativeProfile(figTruth).category, "food_processed");
  assert.match(categorySource, /identityText[\s\S]*무화과[\s\S]*return "food"/);
  assert.match(extractSource, /무화과\|곶감\|말랭이\|반건조/);
  assert.doesNotMatch(productReplacement, /FOOD HUMAN ACTION IS MANDATORY/);
  assert.match(productReplacement, /포장과 구성을 비교해 간식을 고른다/);
  assert.match(productReplacement, /Physical eating, holding or applying is required only when the planned action explicitly says so/);
  assert.match(productReplacement, /Exact target-copy meaning: 후킹 1 \/ 설명 1 \/ 상품 보기/);
  assert.match(productReplacement, /반건조 곶감무화과를 실제로 먹거나 나눠 먹는 성인 고객/);
  assert.match(productReplacement, /For this dried-fruit\/snack product/);
  assert.match(productReplacement, /meat frying pan\/grill, raw-meat foam tray, butcher knife, kimchi tub, brine container/);
  assert.doesNotMatch(productReplacement, /상쾌한 샤워를 원하는 고객/);
  assert.match(validation, /copy-aligned action/);
  assert.match(validation, /plannedSubjectModeAligned=true/);
  assert.match(validation, /sceneProductInteractionAligned=false/);
  assert.match(validation, /retained incompatible semantic carrier or invented ingredient is a critical failure/i);
  assert.match(validation, /selecting, comparing, discovering or considering a gift may be shown without physical consumption/);
});

test("상품과 무관한 인물 행동은 QA 승인에서 제외한다", () => {
  const failed = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["반건조 곶감무화과"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourcePersonDetected: true, sourcePersonReplaced: true, humanCompositionChanged: true, targetAudienceFit: 90,
      humanReplacementFindings: [], sceneProductInteractionAligned: false,
      sceneProductInteractionFindings: ["인물이 셔츠 냄새를 맡고 음식은 옆에 붙어 있습니다."],
      failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "food_processed", exportComplianceVerified: true, requiresHumanReplacement: true }
  );
  assert.equal(failed.recommendation, "revise");
  assert.ok(failed.categoryFit <= 40);
  assert.match(failed.failures.join(" "), /실제 사용·섭취 맥락/);
});

test("상품은 맞아도 인물의 행동·표정·상황이 최종 문구와 어긋나면 승인하지 않는다", () => {
  const failed = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["쫄깃달달 간식"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourcePersonDetected: true, sourcePersonReplaced: true, humanCompositionChanged: true, targetAudienceFit: 90,
      humanReplacementFindings: [], humanCopyAligned: false,
      humanCopyAlignmentFindings: ["즐겁게 맛보는 문구인데 인물이 무표정으로 상품을 등지고 있습니다."],
      sceneProductInteractionAligned: true, sceneProductInteractionFindings: [],
      failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "food_processed", exportComplianceVerified: true, requiresHumanReplacement: true }
  );
  assert.equal(failed.recommendation, "revise");
  assert.ok(failed.hookAlignment <= 40);
  assert.match(failed.failures.join(" "), /최종 광고 문구의 의미/);
});

test("문제 인물 레퍼런스 메타데이터는 유지하되 기본 제작은 별도 QA 상태로 막지 않는다", async () => {
  const manifest = JSON.parse(await readFile(new URL("../data/native-creative-reference-library.json", import.meta.url), "utf8"));
  const reference = manifest.items.find((item) => item.id === "reference-copy-113");
  const generationSource = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  const providerSource = await readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts", import.meta.url), "utf8");

  assert.equal(reference?.compositionType, "human-use");
  assert.equal(reference?.photographyType, "human-model");
  assert.equal(reference?.supportsHumanModel, true);
  assert.match(generationSource, /status: "success"/);
  assert.doesNotMatch(generationSource, /status: .*quality-review|session\.validate/);
  assert.match(providerSource, /lastStreamError = event\.message/);
  assert.doesNotMatch(providerSource, /event\.type === "error"\)[\s\S]{0,120}throw new Error\(event\.message\)/);
});

test("레퍼런스 원문은 중간 빈 줄·띄어쓰기·인터넷 표현을 교정하지 않고 보존한다", () => {
  assert.deepEqual(normalizeReferenceRawLines(["", "회사에선  몰랐는데", "", "퇴근하고 맡아보면;;", "쉰냄새가...ㅋㅋ", ""]), [
    "회사에선  몰랐는데",
    "",
    "퇴근하고 맡아보면;;",
    "쉰냄새가...ㅋㅋ",
  ]);
});

test("레퍼런스 적응 문구는 단순 명사 치환으로 깨진 주어·조사·문장 완결성을 차단한다", () => {
  const base = {
    referenceRawLines: [],
    adaptedLines: [],
    copySlots: [],
    headline: "",
    subCopy: "",
    proof: "",
    offer: "",
    cta: "",
  };
  const humanSubjectSwap = {
    ...base,
    referenceRawLines: ["남편이 먼저 더 사자고 졸라요", "찰진등심"],
    adaptedLines: ["추석이 먼저 더 사자고 졸라요", "소 찜갈비"],
    headline: "추석이 먼저 더 사자고 졸라요 소 찜갈비",
  };
  assert.match(findReferenceCopyNaturalnessErrors(humanSubjectSwap).join(" "), /사람 주어.*단순 치환/);

  const brokenParticles = {
    ...base,
    referenceRawLines: ["단돈 4만원대에", "등심 무한리필급으로", "드셔보신 적 있으세요?"],
    adaptedLines: ["명절 특별구성에", "소 찜갈비 대용량으로", "드셔보신 적 있으세요?"],
    headline: "명절 특별구성에 소 찜갈비 대용량으로 드셔보신 적 있으세요?",
    copySlots: [
      { role: "headline", targetText: "명절 특별구성에" },
      { role: "headline", targetText: "소 찜갈비 대용량으로" },
      { role: "headline", targetText: "드셔보신 적 있으세요?" },
    ],
  };
  assert.match(findReferenceCopyNaturalnessErrors(brokenParticles).join(" "), /조사 연결/);

  const incomplete = {
    ...base,
    referenceRawLines: ["그릇까지 먹겠어요,"],
    adaptedLines: ["갈비찜으로 간편해결,"],
    headline: "갈비찜으로 간편해결,",
  };
  assert.match(findReferenceCopyNaturalnessErrors(incomplete).join(" "), /간편해결/);

  const overbuiltPersona = { ...base, referenceRawLines: ["고기를 고르는 사람"], adaptedLines: ["수라간 감별관이 결부터 살폈어요"], headline: "수라간 감별관이 결부터 살폈어요" };
  assert.match(findReferenceCopyNaturalnessErrors(overbuiltPersona).join(" "), /직업·세계관형/);
  const productFirstPerson = { ...base, referenceRawLines: ["이 고기는 달라요"], adaptedLines: ["난, 숙성 안심"], headline: "난, 숙성 안심" };
  assert.match(findReferenceCopyNaturalnessErrors(productFirstPerson).join(" "), /상품을 사람처럼/);

  const natural = {
    ...base,
    referenceRawLines: ["단돈 4만원대에", "등심 무한리필급으로", "드셔보신 적 있으세요?"],
    adaptedLines: ["명절 특별구성", "대용량 소 찜갈비로", "준비해 보셨나요?"],
    headline: "명절 특별구성 대용량 소 찜갈비로 준비해 보셨나요?",
  };
  assert.deepEqual(findReferenceCopyNaturalnessErrors(natural), []);

  const vagueHoliday = {
    ...base,
    referenceRawLines: ["오늘 메뉴 없더니..."],
    adaptedLines: ["명절 메뉴 없더니..."],
    headline: "명절 메뉴 없더니...",
  };
  assert.match(findReferenceCopyNaturalnessErrors(vagueHoliday).join(" "), /상황|주체/);

  const consumerSituation = {
    ...base,
    referenceRawLines: ["오늘 저녁 언제 준비해요..."],
    adaptedLines: ["명절 갈비, 언제 손질해요..."],
    headline: "명절 갈비, 언제 손질해요...",
  };
  assert.deepEqual(findReferenceCopyNaturalnessErrors(consumerSituation), []);

  const groundedHumanReaction = {
    ...base,
    referenceRawLines: ["남편이 먼저 더 사자고 졸라요"],
    adaptedLines: ["먹어본 사람은 계속 달라고 졸라요"],
    headline: "먹어본 사람은 계속 달라고 졸라요",
  };
  assert.deepEqual(findReferenceCopyNaturalnessErrors(groundedHumanReaction), []);

  const truncatedResearch = { ...base, referenceRawLines: ["사용 추천"], adaptedLines: ["꽃향보다 산뜻한 향을 선호하"], headline: "꽃향보다 산뜻한 향을 선호하" };
  assert.match(findReferenceCopyNaturalnessErrors(truncatedResearch).join(" "), /완결되지/);
  const corruptedResearch = { ...base, referenceRawLines: ["냉압착 방식으로 소개됨"], adaptedLines: ["냉압착 방식으로 소거됨"], headline: "냉압착 방식으로 소거됨" };
  assert.match(findReferenceCopyNaturalnessErrors(corruptedResearch).join(" "), /잘못 변형/);
  const ambiguousReaction = { ...base, referenceRawLines: ["향 그대로네요"], adaptedLines: ["향 그대로네요"], headline: "향 그대로네요" };
  assert.match(findReferenceCopyNaturalnessErrors(ambiguousReaction).join(" "), /무엇을 가리키는지/);
  const fakeComposition = { ...base, referenceRawLines: ["250ml"], adaptedLines: ["총 250ml 구성"], headline: "총 250ml 구성" };
  assert.match(findReferenceCopyNaturalnessErrors(fakeComposition).join(" "), /세트 구성/);
  const orphanedFact = { ...base, referenceRawLines: ["향을 직접 느껴보세요"], adaptedLines: ["기로, 직접 느껴보세요"], headline: "기로, 직접 느껴보세요" };
  assert.match(findReferenceCopyNaturalnessErrors(orphanedFact).join(" "), /문장 조각/);
});

test("업체 조사 사실은 ProductTruth를 바꾸지 않고 소비자용 작성 힌트로 정리한다", () => {
  assert.equal(consumerFacingFactHint("라임과 오렌지 껍질 오일을 열을 가하지 않고 눌러 얻는 냉압착 방식으로 소개됨"), "열을 가하지 않고 눌러 얻은 라임과 오렌지 껍질 오일");
  assert.equal(consumerFacingFactHint("꽃향보다 중성적이고 산뜻한 시트러스 향을 선호하는 사람에게 어울리는 방향"), "꽃향보다 중성적이고 산뜻한 시트러스 향을 선호하는 분");
});

test("안전 최소 문구는 반복된 보조 근거 때문에 다른 소재 제작까지 막지 않는다", () => {
  const safePlans = ["민트 사용감", "무료배송"].map((headline, index) => ({
    referenceId: `safe-reference-${index + 1}`,
    headline,
    subCopy: "검증된 상품 정보",
    proof: "민트 사용감",
    offer: "",
    cta: `상품 확인 ${index + 1}`,
    factIds: [index ? "offer" : "benefit"],
    validationStatus: "valid",
    validationErrors: [],
    generationSource: "safe-minimal",
    copySlots: [{ role: "proof", sourceText: "원문", targetText: "민트 사용감" }],
  }));
  const checked = applyReferenceCopyGroupRules(safePlans, truth);
  assert.ok(checked.every((plan) => plan.validationStatus === "valid"));
  assert.ok(checked.every((plan) => !plan.validationErrors.some((error) => /핵심 문구 블록이 반복/u.test(error))));
});

test("6장 묶음 문구 규칙은 가격·할인·수량과 동일 의미를 제한하되 핵심 상품 근거 반복은 허용한다", () => {
  const plans = Array.from({ length: 6 }, (_, index) => ({
    id: `plan-${index + 1}`,
    resultCode: `H0${index + 1}`,
    referenceId: `reference-${index + 1}`,
    referenceCopyProfileId: `profile-${index + 1}`,
    referenceRawCopy: `원문 ${index + 1}`,
    referenceRawLines: [`원문 ${index + 1}`],
    adaptedLines: [`민트 사용감 ${12_000 + index}원`],
    headline: index < 3 ? "민트 사용감 12,000원" : `서로 다른 생활 문구 ${index + 1}`,
    subCopy: "",
    proof: "",
    offer: index < 3 ? "12,000원" : "",
    cta: "",
    factIds: ["benefit", "price"],
    sourceFactValues: ["민트 사용감", "12,000원"],
    numericTokens: index < 3 ? ["12,000원"] : [],
    naturalnessScore: 100,
    referenceFitScore: 100,
    factualSafetyScore: 100,
    validationStatus: "valid",
    validationErrors: [],
    plannerProvider: "fallback",
  }));
  const checked = applyReferenceCopyGroupRules(plans, truth);
  assert.equal(checked[0].validationStatus, "valid");
  assert.equal(checked[1].validationStatus, "invalid");
  assert.equal(checked[2].validationStatus, "invalid");
  assert.match(checked[2].validationErrors.join(" "), /가격.*최대 2장/);
  assert.doesNotMatch(checked[2].validationErrors.join(" "), /상품 근거.*최대 2장/);
  assert.match(checked[1].validationErrors.join(" "), /문구 의미가 지나치게 유사/);
});

test("서로 다른 USP 여섯 개는 상품 근거 총량 제한으로 안전 문구 교체 대상이 되지 않는다", () => {
  const uspValues = ["산뜻한 민트 사용감", "운동 뒤 상쾌한 샤워", "비건 인증 포뮬러", "재활용 가능한 용기", "라임 껍질 오일", "250ml 휴대 용량"];
  const distinctFacts = uspValues.map((value, index) => ({
    id: `usp-${index + 1}`,
    key: `verified-benefit-${index + 1}`,
    label: `상세페이지 근거 ${index + 1}`,
    value,
    verification: "source-backed",
    source: "landing-page",
    usableInCopy: true,
    numericTokens: [],
    evidenceType: "usp",
  }));
  const distinctTruth = { ...truth, facts: distinctFacts };
  const plans = distinctFacts.map((fact, index) => ({
    id: `distinct-plan-${index + 1}`,
    resultCode: `H0${index + 1}`,
    referenceId: `distinct-reference-${index + 1}`,
    referenceCopyProfileId: `distinct-profile-${index + 1}`,
    referenceRawCopy: `서로 다른 원문 ${index + 1}`,
    referenceRawLines: [`서로 다른 원문 ${index + 1}`],
    adaptedLines: [fact.value],
    headline: fact.value,
    subCopy: "",
    proof: "",
    offer: "",
    cta: "",
    factIds: [fact.id],
    sourceFactValues: [fact.value],
    numericTokens: [],
    naturalnessScore: 100,
    referenceFitScore: 100,
    factualSafetyScore: 100,
    validationStatus: "valid",
    validationErrors: [],
    plannerProvider: "codex-local",
  }));
  const checked = applyReferenceCopyGroupRules(plans, distinctTruth);
  assert.ok(checked.every((plan) => plan.validationStatus === "valid"));
});

test("어순만 바꾼 유사 헤드라인과 반복 문구 블록도 6장 품질 검수에서 제외한다", () => {
  const headlines = [
    "간식은 많은데 왜 이 식감만 자꾸 찾게 될까?",
    "간식 많은데 이 식감을 왜 자꾸 찾게 될까?",
    "쫀득한 한입이 생각나는 오후",
    "커피 옆에 두기 좋은 달콤함",
    "가볍게 꺼내 먹는 반건조 간식",
    "씨앗 식감까지 살아 있는 한입",
  ];
  const plans = headlines.map((headline, index) => ({
    id: `near-plan-${index}`,
    resultCode: `H0${index + 1}`,
    referenceId: `near-reference-${index}`,
    referenceCopyProfileId: `near-profile-${index}`,
    referenceRawCopy: `서로 다른 원문 ${index}`,
    referenceRawLines: [`서로 다른 원문 ${index}`],
    adaptedLines: [headline],
    copySlots: [{ index: 0, role: "headline", sourceText: `원문 ${index}`, targetText: headline, emphasis: "strong" }],
    headline,
    subCopy: "",
    proof: "",
    offer: "",
    cta: "",
    factIds: [],
    sourceFactValues: [],
    naturalnessScore: 100,
    referenceFitScore: 100,
    factualSafetyScore: 100,
    validationStatus: "valid",
    validationErrors: [],
    repairCount: 0,
    generationSource: "codex-local",
  }));
  const checked = applyReferenceCopyGroupRules(plans, truth);
  assert.equal(checked[0].validationStatus, "valid");
  assert.equal(checked[1].validationStatus, "invalid");
  assert.match(checked[1].validationErrors.join(" "), /문구 의미가 지나치게 유사/);
});

test("일반 식품도 상품 형태와 구도 호환을 통과한 후보에서만 6장을 무작위 선택한다", () => {
  const compatible = Array.from({ length: 6 }, (_, index) =>
    normalizeNativeReferenceCompatibility({
      id: `bottle-${index}`,
      publicPath: `/bottle-${index}.jpg`,
      sourceFile: `bottle-${index}.jpg`,
      layoutFamily: "price-offer",
      categoryGroup: "food",
      ordinal: 200 + index,
      productForm: "bottle",
      supportsPackagedProduct: true,
      supportsNaturalFood: false,
      compatibilityConfidence: "high",
    })
  );
  const meat = normalizeNativeReferenceCompatibility({ id: "meat", publicPath: "/meat.jpg", sourceFile: "meat.jpg", layoutFamily: "price-offer", categoryGroup: "food", ordinal: 11 });
  const beauty = normalizeNativeReferenceCompatibility({ id: "beauty", publicPath: "/beauty.jpg", sourceFile: "beauty.jpg", layoutFamily: "price-offer", categoryGroup: "beauty", ordinal: 90 });
  const selected = pickCompatibleRandomItems(
    [...compatible, meat, beauty],
    6,
    {
      categoryGroup: "food",
      productForm: "bottle",
      productCount: 1,
      packagedProduct: true,
      naturalFood: false,
      allowsHumanModel: false,
      compatibleCompositionTypes: ["product-packshot", "price-card", "lifestyle-scene"],
    },
    () => 0
  );
  assert.equal(selected.length, 6);
  assert.ok(selected.every((candidate) => candidate.item.categoryGroup === "food"));
  assert.ok(selected.every((candidate) => candidate.item.id.startsWith("bottle-")));
  assert.ok(!selected.some((candidate) => candidate.item.id === "meat"));
  assert.equal(new Set(selected.map((candidate) => candidate.item.id)).size, 6);
});

test("식품 대분류는 육류를 포함하고 육류 하위 풀은 육류만 선택한다", async () => {
  const manifest = JSON.parse(await readFile(new URL("../data/native-creative-reference-library.json", import.meta.url), "utf8"));
  const foodReferences = manifest.items.filter((item) => item.categoryGroup === "food").map(normalizeNativeReferenceCompatibility);
  const meatReferences = foodReferences.filter((item) => item.foodSubcategory === "meat");
  const generalFoodReferences = foodReferences.filter((item) => !item.foodSubcategory);
  assert.ok(meatReferences.length >= 6);
  assert.ok(generalFoodReferences.length >= 6);
  assert.ok(foodReferences.every((item) => referenceBelongsToSelectionPool(item, "food")));
  assert.ok(meatReferences.every((item) => referenceBelongsToSelectionPool(item, "food", "meat")));
  assert.ok(meatReferences.every((item) => referenceBelongsToSelectionPool(item, "food")));
  assert.ok(generalFoodReferences.every((item) => referenceBelongsToSelectionPool(item, "food")));
  assert.ok(generalFoodReferences.every((item) => !referenceBelongsToSelectionPool(item, "food", "meat")));
  const profile = {
    categoryGroup: "food",
    foodSubcategory: "meat",
    productForm: "meat-cut",
    productCount: 1,
    packagedProduct: false,
    naturalFood: true,
    allowsHumanModel: false,
    compatibleCompositionTypes: ["product-packshot", "price-card", "lifestyle-scene", "sensory-closeup", "natural-food-scene"],
  };
  const scores = meatReferences.map((item) => scoreReferenceCompatibility(profile, item));
  assert.ok(scores.some((candidate) => candidate.score >= 60));
});

test("간식 상품은 식품 중 수동 지정된 간식 레퍼런스만 선택한다", () => {
  const tagged = Array.from({ length: 6 }, (_, index) =>
    normalizeNativeReferenceCompatibility({
      id: `snack-tagged-${index}`,
      publicPath: `/snack-tagged-${index}.jpg`,
      sourceFile: `snack-${index}.jpg`,
      layoutFamily: "sensory-editorial",
      categoryGroup: "food",
      foodSubcategory: "snack",
      ordinal: 300 + index,
      productForm: index === 0 ? "bottle" : "produce",
      compositionType: index === 0 ? "product-lineup" : "natural-food-scene",
      productSlotCount: 1,
      photographyType: index === 0 ? "packshot" : "natural-food",
      supportsPackagedProduct: index === 0,
      supportsNaturalFood: index !== 0,
      compatibilityConfidence: "high",
    })
  );
  const general = Array.from({ length: 6 }, (_, index) =>
    normalizeNativeReferenceCompatibility({
      id: `food-general-${index}`,
      publicPath: `/food-general-${index}.jpg`,
      sourceFile: `general-${index}.jpg`,
      layoutFamily: "sensory-editorial",
      categoryGroup: "food",
      ordinal: 400 + index,
      productForm: "produce",
      compositionType: "natural-food-scene",
      productSlotCount: 1,
      photographyType: "natural-food",
      supportsPackagedProduct: false,
      supportsNaturalFood: true,
      compatibilityConfidence: "high",
    })
  );
  const selected = pickCompatibleRandomItems(
    [...general, ...tagged],
    6,
    {
      categoryGroup: "food",
      foodSubcategory: "snack",
      productForm: "natural-food",
      productCount: 1,
      packagedProduct: false,
      naturalFood: true,
      allowsHumanModel: false,
      compatibleCompositionTypes: ["natural-food-scene", "sensory-closeup"],
    },
    () => 0
  );
  assert.equal(selected.length, 6);
  assert.ok(selected.every((candidate) => candidate.item.foodSubcategory === "snack"));
  assert.ok(
    selected.some((candidate) => candidate.item.id === "snack-tagged-0"),
    "수동 지정은 과거 자동 상품형태 태그보다 우선해야 합니다."
  );
});

test("화장품 기본 분류 레퍼런스도 추가 식품·간식 풀에 지정하면 간식 후보로 선택된다", () => {
  const sharedBeauty = normalizeNativeReferenceCompatibility({
    id: "beauty-shared-snack",
    publicPath: "/beauty-shared-snack.jpg",
    sourceFile: "화장품 레이아웃.jpg",
    layoutFamily: "price-offer",
    categoryGroup: "beauty",
    additionalSelectionPools: ["food-snack"],
    ordinal: 499,
    productForm: "universal-packshot",
    compositionType: "comparison",
    productSlotCount: 2,
    photographyType: "packshot",
    supportsPackagedProduct: true,
    supportsNaturalFood: false,
    supportsMultipleProducts: false,
    compatibilityConfidence: "high",
  });
  const selected = pickCompatibleRandomItems(
    [sharedBeauty],
    1,
    {
      categoryGroup: "food",
      foodSubcategory: "snack",
      productForm: "natural-food",
      productCount: 1,
      packagedProduct: false,
      naturalFood: true,
      allowsHumanModel: false,
      compatibleCompositionTypes: ["comparison", "natural-food-scene"],
    },
    () => 0
  );
  assert.equal(selected[0].item.categoryGroup, "beauty");
  assert.deepEqual(selected[0].item.additionalSelectionPools, ["food-snack"]);
});

test("육류 상품은 같은 식품 대분류 안에서도 간식 레퍼런스를 사용하지 않는다", () => {
  const food = Array.from({ length: 9 }, (_, index) =>
    normalizeNativeReferenceCompatibility({
      id: `meat-food-${index}`,
      publicPath: `/meat-food-${index}.jpg`,
      sourceFile: `meat-${index}.jpg`,
      layoutFamily: "sensory-editorial",
      categoryGroup: "food",
      ordinal: 500 + index,
      foodSubcategory: index < 3 ? "snack" : "meat",
      productForm: "meat-cut",
      compositionType: "natural-food-scene",
      productSlotCount: 1,
      photographyType: "natural-food",
      supportsPackagedProduct: false,
      supportsNaturalFood: true,
      compatibilityConfidence: "high",
    })
  );
  const selected = pickCompatibleRandomItems(
    food,
    6,
    {
      categoryGroup: "food",
      foodSubcategory: "meat",
      productForm: "meat-cut",
      productCount: 1,
      packagedProduct: false,
      naturalFood: true,
      allowsHumanModel: false,
      compatibleCompositionTypes: ["natural-food-scene", "sensory-closeup"],
    },
    () => 0
  );
  assert.equal(selected.length, 6);
  assert.ok(selected.every((candidate) => candidate.item.foodSubcategory === "meat"));
});

test("식품 하위분류는 육류·간식만 자동 판정하고 일반 식품은 비워 둔다", () => {
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("한우 찰진등심 1kg"), "meat");
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("한돈 돼지 등뼈 3kg"), "meat");
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("미친 육즙 안창살 200g"), "meat");
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("바삭한 고구마칩 간식"), "snack");
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("국내산 배추김치 반찬"), undefined);
});

test("호환 레퍼런스가 부족하면 타 카테고리로 보충하지 않고 정확히 실패한다", () => {
  const onlyBeauty = Array.from({ length: 8 }, (_, index) => normalizeNativeReferenceCompatibility({ id: `beauty-${index}`, publicPath: `/beauty-${index}.jpg`, sourceFile: "beauty.jpg", layoutFamily: "price-offer", categoryGroup: "beauty", ordinal: 80 + index }));
  assert.throws(
    () =>
      pickCompatibleRandomItems(
        onlyBeauty,
        6,
        {
          categoryGroup: "food",
          productForm: "meat-cut",
          productCount: 1,
          packagedProduct: false,
          naturalFood: true,
          allowsHumanModel: false,
          compatibleCompositionTypes: ["natural-food-scene", "price-card"],
        },
        () => 0
      ),
    /호환되는 광고 레퍼런스가 부족합니다/
  );
});

test("01-structure는 원본 레퍼런스를 바이트와 SHA-256까지 동일하게 복사한다", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "adatlas-reference-copy-"));
  const source = path.join(directory, "source.jpg");
  const output = path.join(directory, "nested", "01-structure.jpg");
  const bytes = Buffer.from("reference-raster-byte-fixture-한글");
  await writeFile(source, bytes);
  const copied = await copyReferenceStructureLosslessly(source, output);
  assert.equal(copied.sourceHash, copied.copiedHash);
  assert.equal(copied.bytes, bytes.length);
  assert.deepEqual(await readFile(output), bytes);
});

test("새 작업 레퍼런스는 일반 재생성에서 고정되고 명시적 다른 레퍼런스 요청에서만 바뀐다", async () => {
  const createSource = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const generationSource = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  assert.match(createSource, /serviceCreativeMode === "story" \? 1 : 6/);
  assert.match(createSource, /adReference: selectedAdReferences\[index\]/);
  assert.match(generationSource, /if \(action === "regenerate-new-reference"\)/);
  assert.match(generationSource, /const selectedAdReference = result\.nativeCreative\?\.adReference/);
  assert.match(generationSource, /작업에 고정된 광고 레퍼런스 파일을 읽을 수 없습니다/);
});

test("새 작업은 선택된 카테고리 풀에서 점수 우선순위 없이 직접 무작위 추첨한다", async () => {
  const createSource = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const selectorSource = await readFile(new URL("../app/lib/creative-generation/referenceCreativeLibrary.server.ts", import.meta.url), "utf8");
  const selectionBlock = createSource.slice(createSource.indexOf("const selectedReferenceSet"), createSource.indexOf("const { creativePlan, scenes }"));
  const randomSelectionBlock = selectorSource.slice(selectorSource.indexOf("export function selectCategoryNativeAdReferences"), selectorSource.indexOf("/** 과거 작업처럼"));
  assert.match(selectionBlock, /selectCategoryNativeAdReferences\(\{ productTruth: truth, referenceCategoryOverride \}, serviceCreativeMode === "story" \? 1 : 6\)/);
  assert.match(selectionBlock, /Array\.from\(\{ length: 6 \}, \(\) => selectedReferenceSet\[0\]\)/);
  assert.doesNotMatch(createSource, /recentReferenceJobs|recentReferenceIds/);
  assert.match(randomSelectionBlock, /pickUniqueRandomItems\(usableItems, count, nextIndex\)/);
  assert.doesNotMatch(randomSelectionBlock, /pickCompatibleRandomItems|scoreReferenceCompatibility/);
});

test("새 작업은 레퍼런스와 사용자 입력을 고정하고 별도 문구·후킹 planner를 호출하지 않는다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const runner = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  assert.match(source, /selectCategoryNativeAdReferences/);
  assert.match(source, /buildDefaultCodexGenerationPlan/);
  assert.doesNotMatch(source, /prepareReferenceAdaptedCopyScaffold|buildReferenceAdaptedCreativePlan|analyzeProductReferences/);
  assert.doesNotMatch(runner, /planReferenceAdaptedCopies|ensureReferenceCopyPlanning/);
  assert.match(source, /job\.pipeline = DEFAULT_CODEX_GENERATION_PIPELINE/);
  assert.match(source, /job\.codexDirectTest =/);
  assert.match(source, /assertDefaultCodexGenerationJob\(job\)/);
  assert.doesNotMatch(source, /planHooksWithCodexLocal|buildExplorationCreativePlan|readCategoryHookPrior|buildProductHookExploration/);
});

test("ProductTruth 사실은 문구 사용 역할을 명시하고 상품명을 판매 토큰과 분리한다", () => {
  const built = buildProductTruth({
    product: {
      ...product,
      productName: "오늘만 17% 할인 민트 샤워젤 250ml 2개 세트",
      price: "24,000원",
      originalPrice: "29,000원",
    },
    productImagePaths: ["/product.png"],
    source: "landing-page",
  });
  assert.ok(built.facts.some((item) => item.copyEligibility === "offerOnly"));
  assert.ok(built.facts.some((item) => item.copyEligibility === "identityOnly"));
  assert.ok(built.facts.every((item) => item.copyEligibility));
  assert.ok(built.normalized.promotionalTokens.includes("오늘만"));
  assert.doesNotMatch(built.normalized.baseProductName || "", /오늘만/);
});

test("SEO 상품명은 기본 상품명·검증 설명·용량·판매단위·홍보 토큰으로 분리한다", () => {
  const built = buildProductTruth({
    product: {
      ...product,
      productName: "건강간식 바삭달콤 고구마칩 반란 괴물용량 350g 1봉지",
    },
    productImagePaths: ["/product.png"],
    source: "landing-page",
  });
  assert.equal(built.normalized.baseProductName, "고구마칩");
  assert.equal(built.normalized.verifiedDescriptor, "바삭달콤");
  assert.equal(built.normalized.quantity, "350g");
  assert.equal(built.normalized.salesUnit, "1봉지");
  assert.ok(built.normalized.promotionalTokens.includes("반란"));
  assert.ok(built.normalized.promotionalTokens.includes("괴물용량"));
});

test("레퍼런스 문구 프로필은 해시·버전 캐시와 직접 적응·실패 항목 1회 보정을 사용한다", async () => {
  const source = await readReferenceAdaptedPlanningSource();
  const runtime = await readFile(new URL("../app/lib/creative-generation/referenceCopyPlannerRuntime.server.ts", import.meta.url), "utf8");
  const orchestration = await readFile(new URL("../app/lib/creative-generation/referenceAdaptedPlanning.server.ts", import.meta.url), "utf8");
  assert.match(source, /REFERENCE_COPY_PROFILE_VERSION/);
  assert.match(source, /referenceHash/);
  assert.match(source, /prewarmReferenceCopyProfiles/);
  assert.match(runtime, /별도 AI critic\/selector를 열지 않는다/);
  assert.doesNotMatch(runtime, /const critic = await runCodexJson/);
  assert.doesNotMatch(runtime, /runCodexJson<SelectorPayload>/);
  assert.equal((orchestration.match(/await runPlanner\(/g) || []).length, 2);
  assert.match(source, /repairPlans: failed/);
  assert.match(source, /repaired-codex-local/);
  assert.doesNotMatch(source, /selectDiverseHookHypotheses|genericDrafts|buildProductHookExploration/);
});

test("기존 광고주 로고 슬롯은 새 브랜드 로고로 치환하지 않고 배경으로 제거한다", async () => {
  const planner = await readReferenceAdaptedPlanningSource();
  const prompt = await readFile(new URL("../app/lib/creative-generation/nativeCreativePrompt.ts", import.meta.url), "utf8");
  assert.match(planner, /function isSourceBrandRemovalRegion/);
  assert.match(planner, /const removeSourceRegion = isSourceBrandRemovalRegion\(region, sourceText\)/);
  assert.match(planner, /targetText: removeSourceRegion \? ""/);
  assert.match(planner, /region\.sourceType === "source-product-label" \|\| region\.sourceType === "decorative"/);
  assert.match(planner, /region\.replacePolicy === "product-replacement" \|\| region\.replacePolicy === "preserve"/);
  assert.match(planner, /연출\|예시\|참고\|합성\|생성/);
  assert.match(planner, /기존 광고주 로고 제거 슬롯에 새 로고 문구가 지정됐습니다/);
  assert.match(prompt, /ERASE THE ENTIRE REGION INCLUDING ITS BADGE\/CAPSULE\/RIBBON\/CONTAINER/);
  assert.match(prompt, /Never turn the current product or brand name into a newly invented standalone logo/);
  assert.match(prompt, /Source-brand\/remove slots that must be text-free background after removal/);
  assert.match(prompt, /standaloneLogoDetected=true/);
  assert.match(prompt, /Apply that prohibition to the ENTIRE canvas/);
  assert.match(prompt, /Optional advertiser branding is a separate user-selected delivery post-process/);
});

test("문구 실패는 최초 원인·보정·안전 대체 출처를 계획에 남긴다", async () => {
  const planner = await readReferenceAdaptedPlanningSource();
  assert.match(planner, /planningTrace/);
  assert.match(planner, /firstFailureStage/);
  assert.match(planner, /firstFailureCategory/);
  assert.match(planner, /missingPlannerResponseIds/);
  assert.match(planner, /문구 배치 응답에서 해당 소재가 누락됐습니다/);
  assert.match(planner, /1회 보정 응답에도 해당 소재가 누락됐습니다/);
  assert.match(planner, /repairAttempted/);
  assert.match(planner, /repairErrors/);
  assert.match(planner, /fallbackCopy/);
  assert.match(planner, /finalSource/);
  assert.doesNotMatch(planner, /naturalnessScore: Math\.max\(NATURALNESS_PASS_SCORE/);
  assert.match(planner, /isFallback \? plan\.naturalnessScore/);
  assert.match(planner, /isFallback \? plan\.referenceFitScore/);
});

test("비브랜드 문구 슬롯은 빈 버튼·띠·배지 상태로 최종 승인되지 않는다", () => {
  const validation = {
    hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
    composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
    humanNaturalness: 100, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
    observedKoreanText: ["반건조 곶감무화과"], standaloneLogoDetected: false, standaloneLogoFindings: [],
    sourcePersonDetected: false, sourcePersonReplaced: false, humanCompositionChanged: false, targetAudienceFit: 100,
    humanReplacementFindings: [], humanCopyAligned: true, humanCopyAlignmentFindings: [],
    sceneProductInteractionAligned: true, sceneProductInteractionFindings: [], failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
  };
  const checked = enforceReferenceCopySlotCompleteness(validation, [
    { index: 0, role: "cta", sourceText: "개당 1,490원 세트혜택까지 >>", targetText: "", sourceType: "ad-copy", replacePolicy: "adapt", emphasis: "strong" },
    { index: 1, role: "other", sourceText: "기존 브랜드", targetText: "", sourceType: "source-brand", replacePolicy: "remove", emphasis: "light" },
  ]);
  assert.equal(checked.recommendation, "revise");
  assert.match(checked.failures.join(" "), /비브랜드 문구 슬롯.*빈 상태/);

  const sourceBrandOnly = enforceReferenceCopySlotCompleteness(validation, [
    { index: 0, role: "other", sourceText: "기존 브랜드", targetText: "", sourceType: "source-brand", replacePolicy: "remove", emphasis: "light" },
  ]);
  assert.equal(sourceBrandOnly.recommendation, "approve");
});

test("독립 인장형 브랜드 배지만 제거하고 가격·혜택 배지는 문구 적응 대상으로 유지한다", () => {
  const sourceBrand = normalizeReferenceTextRegionBrandPolicy({
    id: "badge-02",
    role: "badge",
    sourceType: "ad-copy",
    replacePolicy: "adapt",
    text: "국대\n한우",
    lines: ["국대", "한우"],
    backgroundHint: "상단 빨강, 하단 파랑 원형 배지",
  });
  assert.equal(sourceBrand.sourceType, "source-brand");
  assert.equal(sourceBrand.replacePolicy, "remove");

  const offer = normalizeReferenceTextRegionBrandPolicy({
    id: "offer-badge",
    role: "badge",
    sourceType: "ad-copy",
    replacePolicy: "adapt",
    text: "오늘만\n50% 할인",
    lines: ["오늘만", "50% 할인"],
    backgroundHint: "상단 빨강, 하단 파랑 원형 배지",
  });
  assert.equal(offer.sourceType, "ad-copy");
  assert.equal(offer.replacePolicy, "adapt");

  const packageLogo = normalizeReferenceTextRegionBrandPolicy({
    id: "package-logo",
    role: "other",
    sourceType: "source-product-label",
    replacePolicy: "preserve",
    text: "실제 상품 로고",
    lines: ["실제 상품 로고"],
  });
  assert.equal(packageLogo.sourceType, "source-product-label");
  assert.equal(packageLogo.replacePolicy, "product-replacement");
});

test("패키지 밖의 AI 생성 독립 로고는 별도 치명 오류로 정규화한다", () => {
  const validation = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95,
      productIdentity: 95,
      factualAccuracy: 100,
      koreanTextAccuracy: 100,
      readability: 95,
      composition: 95,
      diversity: 90,
      commercialQuality: 95,
      exportCompliance: 100,
      productVisibility: 95,
      humanNaturalness: 95,
      categoryFit: 95,
      foodAppetiteAppeal: 95,
      sensoryExpression: 95,
      mobileReadability: 95,
      observedKoreanText: ["정확한 광고 문구"],
      standaloneLogoDetected: true,
      standaloneLogoFindings: ["우측 상단의 캘리그래피 상품명"],
      failures: [],
      recommendation: "approve",
      checkedAt: new Date(0).toISOString(),
    },
    { category: "food_meat", exportComplianceVerified: true }
  );
  assert.equal(validation.recommendation, "revise");
  assert.ok(validation.commercialQuality <= 40);
  assert.match(validation.failures.join(" "), /독립 로고·워드마크/);
});

test("손글씨 효과는 같은 상품·후킹 seed에서 결정적이고 허용 범위 안이다", () => {
  const left = seededHandwritingStyle("p-1:H01:T04");
  const right = seededHandwritingStyle("p-1:H01:T04");
  assert.deepEqual(left, right);
  assert.ok(left.rotation >= -4 && left.rotation <= 4);
  assert.ok(left.outline >= 2 && left.outline <= 5);
});

test("상업 이용 가능한 OFL 한글 폰트와 손글씨 fallback 파일이 모두 존재한다", async () => {
  assert.equal(await verifyCreativeFontFiles(), true);
  assert.match(creativeFontRegistry.HANDWRITTEN_MARKER.family, /Nanum Pen Script/);
  assert.equal(creativeFontRegistry.HANDWRITTEN_BRUSH.fallbackRole, "HANDWRITTEN_MARKER");
});

test("레거시 고급 합성기는 과거 작업 호환을 위해 1200 정사각 결과·로컬 QA를 유지한다", { timeout: 30_000 }, async () => {
  const actual = path.join(os.tmpdir(), `adatlas-composer-${Date.now()}`);
  await mkdir(actual, { recursive: true });
  const backgroundPath = path.join(actual, "background.png");
  const productPath = path.join(actual, "product.png");
  const outputPath = path.join(actual, "composed.png");
  await writeFile(
    backgroundPath,
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: { r: 232, g: 244, b: 238 } } })
      .png()
      .toBuffer()
  );
  await writeFile(productPath, await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="720"><rect x="50" y="10" width="260" height="700" rx="55" fill="#00a77a"/><rect x="82" y="250" width="196" height="190" fill="#fff"/><rect x="98" y="285" width="164" height="70" fill="#071b2a"/></svg>`)).png().toBuffer());
  const hookPlan = { ...hooks[2], headline: "운동 뒤, 민트로 씻을 시간", body: "땀 흘린 날 더 산뜻하게", offer: "", cta: "상품 보기", creativeGrammarId: "FEATURE_EVIDENCE" };
  const result = { ...results[0], id: "result-1", order: 1, hookPlan };
  const job = { id: "job-1", productTruth: truth, results: [result], creativePlan: {} };
  const composed = await composeAdaptiveNativeCreative({ job, result, backgroundPath, productImagePath: productPath, productTransparent: true, outputPath });
  const metadata = await sharp(await readFile(outputPath)).metadata();
  const manifest = JSON.parse(await readFile(`${outputPath}.composition.json`, "utf8"));
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1200);
  assert.equal(composed.productComposed, true);
  assert.deepEqual(manifest.exactText, { headline: hookPlan.headline, body: hookPlan.body, price: "", cta: "" });
  assert.equal(manifest.productSource, productPath);
  assert.equal(manifest.productComposed, true);
  assert.equal(manifest.headlineOverflow, false);
  assert.equal(manifest.bodyOverflow, false);
  assert.ok(manifest.minTextContrastRatio >= 4.5);
  const qa = await validateAdaptiveNativeCreative({ job, result, file: outputPath, composition: composed });
  assert.notEqual(qa.recommendation, "approve");
  assert.ok(["manual-review", "revise"].includes(qa.recommendation));
  assert.ok(!qa.failures.some((failure) => /잘렸/.test(failure)));
  const overflowQa = await validateAdaptiveNativeCreative({
    job,
    result,
    file: outputPath,
    composition: { ...composed, headlineOverflow: true },
  });
  assert.equal(overflowQa.recommendation, "revise");
  assert.ok(overflowQa.failures.some((failure) => /잘렸/.test(failure)));
});

test("native 레퍼런스는 광고 픽셀·누끼를 제외하고 원본 상품 상세페이지 사진만 전달한다", () => {
  const pack = { id: "pack", path: "/pack.jpg", role: "product-packshot", source: "product-page", verified: true, reason: "원본" };
  const lifestyle = { id: "life", path: "/life.jpg", role: "product-lifestyle", source: "product-page", verified: true, reason: "사용 장면" };
  const detail = { id: "detail", path: "/detail.jpg", role: "detail-image", source: "product-page", verified: true, reason: "상세" };
  const referenceA = { id: "ref-a", path: "/ref-a.jpg", role: "ad-reference", source: "selected-reference", verified: true, reason: "스타일 참고" };
  const referenceB = { ...referenceA, id: "ref-b", path: "/ref-b.jpg" };
  const referenceC = { ...referenceA, id: "ref-c", path: "/ref-c.jpg" };
  const cutout = { id: "cutout", path: "/processed-products/cutout.png", role: "product-cutout", source: "user-confirmed", verified: true, reason: "가공 이미지" };
  const disguisedCutout = { id: "alpha", path: "/uploads/original-source-product.png", role: "product-packshot", source: "product-page", verified: true, transparent: true, reason: "역할만 포장 이미지인 투명 누끼" };
  const namedCutout = { id: "named", path: "/uploads/mint-removebg.png", role: "product-packshot", source: "product-page", verified: true, reason: "파일명 누끼" };
  const job = { productTruth: { ...truth, imageAssets: [cutout, disguisedCutout, namedCutout, pack, lifestyle, detail], referenceImages: [referenceA, referenceB, referenceC] } };
  const selected = selectNativeReferenceSources(job);
  assert.deepEqual(
    selected.map((asset) => asset.path),
    ["/pack.jpg", "/life.jpg", "/detail.jpg"]
  );
  assert.equal(selected.filter((asset) => asset.role === "ad-reference").length, 0);
  assert.ok(!selected.some((asset) => /processed-products/.test(asset.path)));
  assert.ok(!selected.some((asset) => asset.transparent));
  assert.ok(!selected.some((asset) => /removebg/.test(asset.path)));
});

test("레퍼런스 분석이 배송 안내를 패키지로 오인해도 확인된 대표 상품 이미지를 우선한다", () => {
  const confirmedMain = { id: "confirmed-main", path: "/confirmed-main.jpg", role: "product-lifestyle", source: "product-page", verified: true, reason: "상품 대표" };
  const confirmedDetail = { id: "confirmed-detail", path: "/confirmed-detail.jpg", role: "detail-image", source: "product-page", verified: true, reason: "상품 상세" };
  const job = {
    productTruth: { ...truth, imageAssets: [confirmedMain, confirmedDetail], referenceImages: [] },
    productReferenceProfile: {
      referenceImages: [
        { id: "wrong-package", url: "/shipping-info.jpg", role: "front-package", usableForGeneration: true, duplicateOf: undefined, watermarkRisk: false, hasText: false, importance: 100, description: "오탐지" },
      ],
    },
  };
  const selected = selectNativeReferenceSources(job);
  assert.equal(selected[0].path, "/confirmed-main.jpg");
  assert.ok(selected.findIndex((asset) => asset.path === "/confirmed-detail.jpg") < selected.findIndex((asset) => asset.path === "/shipping-info.jpg"));
});

test("신규 소재는 평균내지 않고 결과별 비포장 원본 한 장만 고정하며 조리 사진을 제외한다", () => {
  const raw = { id: "raw", url: "/raw-cut.jpg", role: "primary-product", importance: 100, width: 1200, height: 1200, usableForGeneration: true, description: "판매 원육" };
  const cooked = { id: "cooked", url: "/cooked-serving.jpg", role: "cooked", importance: 200, width: 1200, height: 1200, usableForGeneration: true, description: "조리 완성" };
  const assignmentJob = {
    productTruth: {
      ...truth,
      product: {
        ...truth.product,
        category: "육류",
        detectedProductType: "소고기",
        sourceImageCandidates: [
          { imagePath: raw.url, expectedRepresentationType: "irregular-product", selected: true },
          { imagePath: cooked.url, expectedRepresentationType: "plated-product", selected: true },
        ],
      },
      normalized: { ...truth.normalized, cleanProductName: "소고기 특수부위" },
    },
    productReferenceProfile: { immutableFacts: {}, referenceImages: [cooked, raw] },
    results: [],
  };
  const references = [
    { id: "ref-1", productForm: "meat-cut", productPresentation: "unpackaged" },
    { id: "ref-2", productForm: "meat-cut", productPresentation: "unpackaged" },
  ];
  const assigned = assignNativeProductSources(assignmentJob, references);
  assert.equal(isCookedProductSource(assignmentJob, cooked), true);
  assert.deepEqual(assigned.map((items) => items.map((item) => item.sourcePath)), [[raw.url], [raw.url]]);
  assert.ok(assigned.every((items) => items.length === 1));
});

test("포장·비포장 혼합 레퍼런스만 라벨 원본과 원물 원본 두 장을 역할별로 배정한다", () => {
  const packaged = { id: "packaged", url: "/label-pack.jpg", role: "front-package", importance: 96, width: 1200, height: 1200, usableForGeneration: true, hasText: true, description: "실제 패키지 라벨" };
  const raw = { id: "raw", url: "/raw-cut.jpg", role: "product-detail", importance: 90, width: 1200, height: 1200, usableForGeneration: true, description: "실제 원물" };
  const assignmentJob = {
    productTruth: {
      ...truth,
      product: {
        ...truth.product,
        category: "육류",
        detectedProductType: "소고기",
        sourceImageCandidates: [
          { imagePath: packaged.url, expectedRepresentationType: "packaged-product", selected: true },
          { imagePath: raw.url, expectedRepresentationType: "irregular-product", selected: true },
        ],
      },
      normalized: { ...truth.normalized, cleanProductName: "소고기 특수부위" },
    },
    productReferenceProfile: { immutableFacts: { packageType: "트레이" }, referenceImages: [packaged, raw] },
    results: [],
  };
  const [mixed, unpackagedOnly] = assignNativeProductSources(assignmentJob, [
    { id: "mixed", productPresentation: "mixed" },
    { id: "raw-only", productPresentation: "unpackaged" },
  ]);
  assert.equal(resolveNativeReferenceProductPresentation({ id: "legacy-mixed", supportsPackagedProduct: true, supportsNaturalFood: true }), "mixed");
  assert.deepEqual(mixed.map((item) => item.kind), ["packaged", "unpackaged"]);
  assert.equal(mixed[0].protectPhysicalLabel, true);
  assert.deepEqual(unpackagedOnly.map((item) => item.kind), ["unpackaged"]);
});

test("상품 패키지에 인쇄된 실제 라벨은 일반 광고 배너 문구와 달리 원본 근거로 유지한다", async () => {
  const buffer = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#ece8dd" } }).jpeg().toBuffer();
  const file = `data:image/jpeg;base64,${buffer.toString("base64")}`;
  const inspected = await inspectProductTruthImages({
    ...truth,
    product: {
      ...truth.product,
      packageType: "트레이",
      sourceImageCandidates: [{ id: "package", type: "hero", imagePath: file, label: "정면 패키지 라벨", selected: true, createdAt: new Date().toISOString(), expectedRepresentationType: "packaged-product", hasText: true }],
    },
    imageAssets: [{ id: "package", path: file, role: "product-packshot", source: "product-page", verified: true, hasText: true, reason: "정면 패키지 라벨", validationStatus: "confirmed" }],
  });
  assert.equal(inspected.imageAssets[0].verified, true);
  assert.equal(inspected.imageAssets[0].validationStatus, "confirmed");
  assert.match(inspected.imageAssets[0].reason, /상품 정체성 근거로 보존/);
});

test("문구 교체는 OCR 영역 밖 픽셀을 버리고 상품 교체는 OCR 원문 픽셀을 복원한다", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "adatlas-region-lock-"));
  const sourcePath = path.join(directory, "source.png");
  const copyGeneratedPath = path.join(directory, "copy-generated.png");
  const productGeneratedPath = path.join(directory, "product-generated.png");
  await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ff0000" } }).png().toFile(sourcePath);
  await sharp({ create: { width: 100, height: 100, channels: 3, background: "#0000ff" } }).png().toFile(copyGeneratedPath);
  await sharp({ create: { width: 100, height: 100, channels: 3, background: "#0000ff" } }).png().toFile(productGeneratedPath);
  const contract = resolveReferenceCopyRasterRegions({
    copySlots: [{ index: 0, regionId: "headline", role: "headline", sourceText: "원문", targetText: "새 문구", emphasis: "strong", action: "replace", box: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, sizeClass: "medium" }],
  });
  assert.equal(contract.complete, true);
  assert.equal(contract.regions.length, 1);

  const copyResult = await applyNativeRasterRegionLock({ sourcePath, generatedPath: copyGeneratedPath, regions: contract.regions, complete: contract.complete, requireComplete: true, mode: "edit-regions-only" });
  assert.equal(copyResult.applied, true);
  const copyPixels = await sharp(copyGeneratedPath).removeAlpha().raw().toBuffer();
  const pixel = (buffer, x, y) => [...buffer.subarray((y * 100 + x) * 3, (y * 100 + x) * 3 + 3)];
  assert.deepEqual(pixel(copyPixels, 5, 5), [255, 0, 0]);
  assert.deepEqual(pixel(copyPixels, 50, 50), [0, 0, 255]);

  const productResult = await applyNativeRasterRegionLock({ sourcePath, generatedPath: productGeneratedPath, regions: contract.regions, complete: contract.complete, mode: "preserve-regions" });
  assert.equal(productResult.applied, true);
  const productPixels = await sharp(productGeneratedPath).removeAlpha().raw().toBuffer();
  assert.deepEqual(pixel(productPixels, 5, 5), [0, 0, 255]);
  assert.deepEqual(pixel(productPixels, 50, 50), [255, 0, 0]);
});

test("상품분석의 판매자 실적·후기 문장·옵션 UI는 레퍼런스 카피 근거에서 제외한다", () => {
  const pollutedTruth = buildProductTruth({
    product: {
      ...product,
      advertiserName: "국대한우",
      productName: "찰진등심 1kg박스",
      mainBenefit: "적당한 마블링과 숙성으로 살린 감칠맛",
      verifiedBenefits: [
        "160만 소비자가 선택한 국대한우",
        "전국 1위 한우 쇼핑몰 – 950만 세트 판매 신화",
        "가격에 놀라서 시켜보았는데 맛있어서 또 한번 놀랐습니다",
        "찰진등심 업그레이드 선택",
        "적당한 마블링과 숙성으로 살린 감칠맛",
      ],
      detailImageOcrInsights: [{
        id: "ocr",
        imageUrl: "https://example.com/detail.jpg",
        contentHash: "hash",
        ocrText: "국대한우 쇼핑몰\n오' 가성비 1등 상품\n알등심 / 특마블",
        ocrProvider: "codex-local",
        ocrConfidence: 0.9,
        copyFacts: ["국대한우 쇼핑몰", "오' 가성비 1등 상품", "알등심 / 특마블"],
        productConstraints: [],
        identityOnlyLabels: [],
        discardedNotices: [],
        warnings: [],
      }],
    },
    source: "landing-page",
  });
  const planningFacts = pollutedTruth.coreEvidence.map((fact) => fact.summary).join("\n");
  assert.doesNotMatch(planningFacts, /160만|950만|쇼핑몰|놀랐습니다|업그레이드 선택|오' 가성비|국대한우/u);
  assert.match(planningFacts, /적당한 마블링과 숙성으로 살린 감칠맛|알등심 \/ 특마블/u);
});

test("상세 OCR offer가 구조화 판매가와 같으면 가격 반응의 검증 가격으로 인정한다", () => {
  const priceTruth = buildProductTruth({
    product: {
      ...product,
      productName: "찰진등심 1kg박스",
      price: "59,800원",
      detailImageOcrInsights: [{
        id: "price-ocr",
        imageUrl: "https://example.com/price.jpg",
        contentHash: "price-hash",
        ocrText: "59,800원",
        ocrProvider: "codex-local",
        ocrConfidence: 0.9,
        copyFacts: ["59,800원"],
        productConstraints: [],
        identityOnlyLabels: [],
        discardedNotices: [],
        warnings: [],
      }],
    },
    source: "landing-page",
  });
  assert.equal(priceTruth.facts.some((fact) => fact.value === "59,800원" && fact.evidenceType === "offer"), true);
  assert.equal(priceTruth.facts.some((fact) => fact.key === "price"), false);
  assert.equal(hasVerifiedPriceFact(priceTruth), true);
});

test("기본 Codex 제작은 사용자가 고른 상품·추가 참고·포장상품 이미지만 첨부한다", async () => {
  const anchoredResult = {
    ...results[0],
    nativeCreative: {
      ...results[0].nativeCreative,
      productSourceAssignments: [
        { kind: "packaged", imageId: "pack", sourcePath: "/pack.jpg", sourceRole: "front-package", protectPhysicalLabel: true, reason: "실제 라벨" },
        { kind: "unpackaged", imageId: "raw", sourcePath: "/raw.jpg", sourceRole: "product-detail", protectPhysicalLabel: false, reason: "실제 원물" },
      ],
    },
  };
  const prompt = buildNativeStagePrompt("product-replacement", { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "personal_care" } }, results: [anchoredResult] }, anchoredResult, "/tmp/02-product.png");
  const resultGenerationSource = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  const factorySource = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  assert.match(prompt, /ASSIGNED PRODUCT SOURCE CONTRACT — DO NOT AVERAGE/);
  assert.match(prompt, /Product attachment 1: PACKAGED SOURCE/);
  assert.match(prompt, /Product attachment 2: UNPACKAGED\/RAW SOURCE/);
  assert.match(prompt, /No cooked seller photo is attached or permitted/);
  assert.doesNotMatch(prompt, /compare several authoritative raw-product photos/);
  assert.match(factorySource, /const directReferencePaths = siteAnalysisMode/);
  assert.match(factorySource, /requestedSiteVisualImagePaths\.length \? requestedSiteVisualImagePaths : \[directProductImagePath\]/);
  assert.match(factorySource, /\[directProductImagePath, directSupportingImagePath, directPackagingImagePath\]/);
  assert.match(factorySource, /productImagePaths: directReferencePaths/);
  assert.match(resultGenerationSource, /prepareDefaultCodexGenerationImages\(job, result\)/);
  assert.doesNotMatch(resultGenerationSource, /assignNativeProductSources|supportingReferences/);
});

test("H01~H06은 상품별 회전된 서로 다른 동적 LayoutPlan을 만든다", () => {
  const plans = results.map((result) => buildAdaptiveLayoutPlan({ truth, result, groupResults: results }));
  assert.equal(plans.length, 6);
  assert.equal(new Set(plans.map((plan) => `${plan.sceneAnchor}|${plan.copyAnchor}|${plan.productAnchor}|${plan.textAlign}`)).size, 6);
  assert.ok(plans.some((plan) => plan.typographyRole === "handwritten") || plans.some((plan) => plan.graphicMotif !== "none"));
});

test("검증된 가격·구성 근거가 없으면 가격 강조와 다중 상품을 만들지 않는다", () => {
  const noOffer = { ...truth, normalized: { ...truth.normalized, price: "", composition: "", packageOrOption: "" }, product: { ...product, price: "", discountInfo: "" } };
  const priceResult = { ...results[0], hookPlan: { ...results[0].hookPlan, creativeGrammarId: "PRICE_VALUE" } };
  const bundleResult = { ...results[1], hookPlan: { ...results[1].hookPlan, creativeGrammarId: "BUNDLE_LINEUP" } };
  assert.equal(buildAdaptiveLayoutPlan({ truth: noOffer, result: priceResult }).priceEmphasis, false);
  assert.equal(buildAdaptiveLayoutPlan({ truth: noOffer, result: bundleResult }).productCount, 1);
});

test("7~10 점수는 70~100으로 정규화하고 기존 0~100 점수는 다시 곱하지 않는다", () => {
  assert.deepEqual(normalizePlannerScoreValues({ evidenceStrength: 7, claimSafety: 10 }), { evidenceStrength: 70, claimSafety: 100 });
  assert.deepEqual(normalizePlannerScoreValues({ evidenceStrength: 70, claimSafety: 96 }), { evidenceStrength: 70, claimSafety: 96 });
  assert.equal(recomputeHookTotal({ evidenceStrength: 70, specificity: 70, purchaseReasonStrength: 70, distinctiveness: 70, attentionPotential: 70, visualizability: 70, advertisingFit: 70, claimSafety: 100, categoryPrior: 70, novelty: 70 }), 73);
});

test("최종 6안은 coreClaim·sceneKey가 다르고 태그 4개 이상이며 가격형은 최대 2개다", () => {
  const score = { evidenceStrength: 90, specificity: 88, purchaseReasonStrength: 86, distinctiveness: 84, attentionPotential: 82, visualizability: 90, advertisingFit: 86, claimSafety: 96, categoryPrior: 80, novelty: 82, total: 88 };
  const tags = ["price-value", "price-value", "price-value", "feature-usp", "sensory-experience", "usage-occasion", "problem-solution", "review-trust"];
  const candidates = tags.map((primaryTag, index) => ({
    id: `candidate-${index}`,
    primaryTag,
    secondaryTags: [],
    hypothesis: `가설 ${index}`,
    mainHook: `서로 다른 후킹 ${index}`,
    subCopy: `서로 다른 설명 ${index}`,
    coreClaim: `핵심 소구 ${index}`,
    sentenceStyle: ["question", "declaration", "dialogue", "contrast", "sensory", "urgency", "proof"][index % 7],
    customerReason: `이유 ${index}`,
    customerTension: `긴장 ${index}`,
    verifiedEvidence: [`근거 ${index}`],
    intendedReaction: `반응 ${index}`,
    visualConcept: `비주얼 ${index}`,
    prohibitedClaims: [],
    confidence: "high",
    generationSource: "fallback",
    selectionReason: "",
    evidenceSummary: `근거 ${index}`,
    evidence: [],
    factIds: ["benefit"],
    sceneKey: `scene-${index}`,
    visualStory: `스토리 ${index}`,
    score: { ...score, total: score.total - index },
    status: "candidate",
    creativeBrief: {},
  }));
  const selected = selectQualityDiverseHooks(candidates, 6);
  assert.equal(selected.length, 6);
  assert.ok(new Set(selected.map((item) => item.primaryTag)).size >= 4);
  assert.ok(selected.filter((item) => item.primaryTag === "price-value").length <= 2);
  assert.equal(new Set(selected.map((item) => item.coreClaim)).size, 6);
  assert.equal(new Set(selected.map((item) => item.sceneKey)).size, 6);
});

test("긴 프로모션 상품명에서 정체성은 유지하고 행사·가격 문구를 제거한다", () => {
  assert.equal(cleanProductTitle("[10일한정] 설록우 ★1++★ 등심 1kg 49,800원 무료배송", "설록우"), "1++ 등심 1kg");
  assert.doesNotMatch(cleanProductTitle("[사전예약/무료배송] 오리지널소스 민트 샤워젤 2+1", "오리지널소스"), /사전예약|무료배송|2\+1/);
  assert.equal(cleanProductTitle("*첫출시 입점기념 60% 할인 -탑브랜드한우 안창살/안창살"), "한우 안창살");
});

test("계획 fingerprint는 추적 파라미터를 무시하고 사실 또는 이미지가 바뀌면 달라진다", () => {
  const first = buildCreativePlanFingerprint(truth);
  const same = buildCreativePlanFingerprint({ ...truth, product: { ...product, landingUrl: "https://www.originalsource.co.kr/product/detail.html?product_no=65&utm_campaign=x" } });
  const changedFact = buildCreativePlanFingerprint({ ...truth, facts: [...facts, { ...facts[0], id: "new", value: "13,000원" }] });
  const changedImage = buildCreativePlanFingerprint({ ...truth, confirmedProductImage: { ...truth.confirmedProductImage, width: 900 } });
  assert.equal(first, same);
  assert.notEqual(first, changedFact);
  assert.notEqual(first, changedImage);
});

test("기본 native 실행은 레퍼런스·선택 이미지·프롬프트를 한 세션에 한 번 전달한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  assert.match(source, /withNativeCreativeSession\(provider/);
  assert.match(source, /session\.generate/);
  assert.doesNotMatch(source, /session\.validate\(|validateGroup/);
  assert.doesNotMatch(source, /provider\.generate\(/);
  assert.doesNotMatch(source, /provider\.validate\(/);
  assert.match(source, /referencePaths: productReferences/);
  assert.match(source, /adReferencePath: selectedAdReference\.path/);
  assert.match(source, /directPrompt,/);
  assert.match(source, /stage: "codex-direct-test"/);
  assert.doesNotMatch(source, /selectGoldenReferences/);
  assert.doesNotMatch(source, /composeAdaptiveNativeCreative|validateAdaptiveNativeCreative|composeLocalPerformanceCreative|localValidation/);
  assert.match(source, /action === "copy-update" \|\| action === "revalidate"/);
  assert.doesNotMatch(source, /provider\.validateGroup\(/);
  assert.doesNotMatch(source, /ensureProductAdCopy/);
  assert.match(source, /generationRequestKey:\s*`codex-direct-v1:\$\{job\.id\}:\$\{latest\.id\}`/);
  assert.doesNotMatch(source, /generationRequestKey:\s*`codex-direct-v1:[^`]*requestId/);
});

test("레퍼런스 fallback은 브랜드 슬롯을 비우되 강한 원문과 문구 밀도를 상품 사실로 보존한다", async () => {
  const source = await readReferenceAdaptedPlanningSource();
  assert.match(source, /prioritizedPlanningFacts/);
  assert.match(source, /fact\.source === "vendor-research"/);
  assert.match(source, /if \(isSourceBrandRemovalRegion\(region\)\) return ""/);
  assert.match(source, /function referenceAwareFallbackText/);
  assert.match(source, /minimumUsefulLength/);
  assert.match(source, /strongSourceHook/);
  assert.match(source, /contentFallbackCandidates/);
  assert.match(source, /const isPrimaryOfferSlot = offerIndex === 0/);
  assert.match(source, /contentFallbackCandidates\.filter\(\(candidate\) => !extractNumericTokens\(candidate\)\.length\)/);
  assert.match(source, /recordFactsForTarget/);
});

test("사용자 수정 피드백은 교체 가능한 repository와 기본 STRONG 강도로 분리된다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/creativePreferenceRepository.server.ts", import.meta.url), "utf8");
  assert.match(source, /interface CreativePreferenceRepository/);
  assert.match(source, /expressionStrength:\s*"STRONG"/);
  assert.match(source, /approved-after-copy-edit/);
  assert.match(source, /never-reuse/);
});

test("수정 요청은 기본 프롬프트에 피드백을 붙여 광고 전체를 다시 생성한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  assert.match(source, /action === "revise" && input\.feedback\?\.trim\(\)/);
  assert.match(source, /`추가 수정 요청:\\n\$\{input\.feedback\.trim\(\)\}`/);
  assert.match(source, /기본 Codex 제작은 별도 문구 단계 없이 현재 프롬프트로 광고 전체를 다시 생성합니다/);
  assert.doesNotMatch(source, /backgroundPath\) throw|shouldGenerateBackground|composeAdaptiveNativeCreative/);
});

test("수동 제작과 아침 자동 제작은 동일한 native 생성 작업 팩토리를 사용한다", async () => {
  const manual = await readFile(new URL("../app/api/creative-generation/jobs/route.ts", import.meta.url), "utf8");
  const automatic = await readFile(new URL("../app/lib/auto-production/productionRunner.server.ts", import.meta.url), "utf8");
  const factory = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const selection = await readFile(new URL("../app/lib/creative-generation/referenceCreativeLibrary.server.ts", import.meta.url), "utf8");
  assert.match(manual, /createNativeGenerationJob/);
  assert.match(automatic, /createNativeGenerationJob/);
  assert.match(automatic, /engine:\s*"codex_local"/);
  assert.doesNotMatch(automatic, /openai_api/);
  assert.match(factory, /applyOriginalSourceVendorResearch\(input\.product, input\.product\.landingUrl\)/);
  assert.match(factory, /selectCategoryNativeAdReferences/);
  assert.match(selection, /food-meat/);
  assert.match(selection, /food-snack/);
  assert.match(selection, /food-other/);
});

test("로컬 공급자는 H 결과별 단일 세션에서 생성·QA를 계속한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts", import.meta.url), "utf8");
  const sessionBlock = source.slice(source.indexOf("async openSession"), source.indexOf("async validateGroup"));
  assert.equal((sessionBlock.match(/codex\.startThread/g) || []).length, 1);
  assert.match(sessionBlock, /runThreadWithIdleTimeout/);
  assert.match(source, /thread\.runStreamed/);
  assert.doesNotMatch(sessionBlock, /AbortSignal\.timeout/);
  assert.match(sessionBlock, /const generate/);
  assert.match(sessionBlock, /const validate/);
  assert.match(sessionBlock, /thread = undefined/);
  assert.match(source, /runtime\.imageReasoning/);
  assert.match(source, /codexLocalAuthenticated\(\{ force: true \}\)/);
  assert.doesNotMatch(source, /qaThread|resumeThread|saveAdvertiserThread|codexProductThreadKey/);
});

test("자동 재시도도 같은 고정 입력으로 단일 Codex 생성을 다시 실행한다", async () => {
  const runner = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  const generation = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  assert.match(runner, /action:\s*"generate"/);
  assert.doesNotMatch(runner, /next\.attempts > 0 \? "regenerate"/);
  assert.match(generation, /prepareDefaultCodexGenerationImages/);
  assert.match(generation, /result\.nativeCreative\?\.adReference/);
  assert.doesNotMatch(generation, /recoveredProductPath|recoveredCopyPath|validStageFileWrittenSince/);
});

test("세션 러너는 성공·실패 모두 close하고 H·상품 간 세션을 공유하지 않는다", async () => {
  let openCount = 0;
  const closed = [];
  const used = [];
  const provider = {
    engine: "codex_local",
    async status() {
      return { engine: "codex_local", available: true, authenticated: true, paidApiUsed: false, detail: "mock" };
    },
    async openSession() {
      const id = ++openCount;
      let active = true;
      return {
        async generate() {
          assert.equal(active, true);
          used.push(`generate-${id}`);
          return { outputPath: `/${id}.png` };
        },
        async validate() {
          assert.equal(active, true);
          used.push(`validate-${id}`);
          return {};
        },
        async close() {
          active = false;
          closed.push(id);
        },
      };
    },
    async validateGroup() {
      return {};
    },
  };
  await provider.status();
  assert.equal(openCount, 0);
  await Promise.all(
    Array.from({ length: 6 }, () =>
      withNativeCreativeSession(provider, async (session) => {
        await session.generate({});
        await session.validate({});
      })
    )
  );
  assert.equal(openCount, 6);
  assert.equal(new Set(closed).size, 6);
  assert.equal(used.length, 12);
  await assert.rejects(
    withNativeCreativeSession(provider, async (session) => {
      await session.generate({});
      throw new Error("mock failure");
    }),
    /mock failure/
  );
  assert.equal(openCount, 7);
  assert.equal(closed.length, 7);
  await withNativeCreativeSession(provider, async (session) => session.generate({}));
  assert.equal(openCount, 8);
  assert.equal(closed.length, 8);
});

test("URL 입력·상품 분석·작업 생성만으로 이미지 세션을 열지 않는다", async () => {
  const [ui, factory, createJob, resultRunner] = await Promise.all([readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx", import.meta.url), "utf8"), readFile(new URL("../app/lib/creative-generation/providers/providerFactory.server.ts", import.meta.url), "utf8"), readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8"), readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8")]);
  assert.doesNotMatch(ui, /startThread|openSession/);
  assert.doesNotMatch(factory, /startThread|openSession/);
  assert.match(createJob, /imageProvider\.status\(\)/);
  assert.doesNotMatch(createJob, /imageProvider\.openSession\(\)/);
  const actionRouter = resultRunner.slice(resultRunner.indexOf("async function runNativeResultGeneration"));
  assert.ok(actionRouter.indexOf("handlePreference(input, job)") < actionRouter.indexOf("runDefaultCodexResult(input, job, result"));
  assert.doesNotMatch(createJob, /withNativeCreativeSession/);
  assert.match(resultRunner, /async function runDefaultCodexResult/);
});

test("세션 ID는 작업·manifest·공개 응답에 저장하지 않는다", async () => {
  const sources = await Promise.all(["types.ts", "nativeCreativeStorage.server.ts", "publicJob.server.ts", "createNativeGenerationJob.server.ts"].map((file) => readFile(new URL(`../app/lib/creative-generation/${file}`, import.meta.url), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /codexThreadId/);
});

test("유료 provider도 명시 승인을 유지한 상태로 세션 계약을 준수한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/providers/OpenAIFinalCreativeProvider.server.ts", import.meta.url), "utf8");
  assert.match(source, /async openSession/);
  assert.match(source, /generateOnce/);
  assert.match(source, /validateOnce/);
  assert.match(source, /async close\(\)/);
  assert.match(source, /explicitPaidApiAuthorization/);
  assert.doesNotMatch(source, /resumeThread|codexThreadId/);
});

test("기본 UI는 유료 엔진·동의 값을 보내지 않고 Codex 상태만 조회한다", async () => {
  const ui = await readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx", import.meta.url), "utf8");
  const statusRoute = await readFile(new URL("../app/api/codex/status/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /paidApiAuthorization|paidApiExplicitlySelected|engine\s*:/);
  assert.match(statusRoute, /const engine = "codex_local"/);
  assert.doesNotMatch(statusRoute, /searchParams|get\("engine"\)/);
});

test("Codex 자식 프로세스는 API 환경을 제거하고 ChatGPT 로그인만 인증으로 인정한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/codexLocalRuntime.server.ts", import.meta.url), "utf8");
  assert.match(source, /OPENAI_API_KEY/);
  assert.match(source, /CODEX_ACCESS_TOKEN/);
  assert.match(source, /OPENAI_BASE_URL/);
  assert.match(source, /logged in using chatgpt/i);
  assert.match(source, /codexLocalAuthenticated\(\{ force: true \}\)/);
  assert.doesNotMatch(source, /\/logged in\/i\.test/);
});

test("Codex 계정 전환 후에는 저장된 스레드 없이 현재 로그인의 새 작업을 연다", async () => {
  const [provider, adCopy, videoPlanning] = await Promise.all([
    readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/ad-copy/adCopyGenerator.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/video-collaboration/videoPlanningAi.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(provider, /codexLocalAuthenticated\(\{ force: true \}\)/);
  assert.match(adCopy, /responses\.create/);
  assert.match(adCopy, /store: false/);
  assert.doesNotMatch(adCopy, /requireFreshCodexLocalChatGptLogin|resumeThread/);
  assert.match(videoPlanning, /requireFreshCodexLocalChatGptLogin/);
  assert.doesNotMatch(`${provider}\n${videoPlanning}`, /resumeThread|getAdvertiserThread|saveAdvertiserThread/);
});

test("직접 이미지 API 함수도 작업별 명시 승인 없이는 호출할 수 없다", async () => {
  const client = await readFile(new URL("../app/lib/mvp/openaiImageClient.ts", import.meta.url), "utf8");
  const nativePaid = await readFile(new URL("../app/lib/creative-generation/providers/OpenAIFinalCreativeProvider.server.ts", import.meta.url), "utf8");
  assert.match(client, /assertExplicitPaidImageAuthorization/);
  assert.match(client, /explicitPaidApiAuthorization/);
  assert.match(nativePaid, /explicitPaidApiAuthorization: this\.explicitPaidApiAuthorization/);
});

test("레거시 후킹 planner는 과거 작업 호환을 위해 일회성 thread 방식을 유지한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/CodexLocalHookPlanner.server.ts", import.meta.url), "utf8");
  assert.match(source, /minItems: 12/);
  assert.match(source, /maxItems: 15/);
  assert.match(source, /runtime\.plannerReasoning/);
  assert.doesNotMatch(source, /resumeThread|saveAdvertiserThread|codexProductThreadKey/);
});

test("최종 내보내기는 1200x1200 JPEG 800KB 이하로만 저장한다", async () => {
  const actual = path.join(os.tmpdir(), `adatlas-fast-${Date.now()}`);
  await mkdir(actual, { recursive: true });
  const source = path.join(actual, "source.png"),
    target = path.join(actual, "final.jpg");
  await writeFile(
    source,
    await sharp({ create: { width: 1500, height: 900, channels: 3, background: { r: 10, g: 180, b: 130 } } })
      .png()
      .toBuffer()
  );
  const result = await optimizeNativeFinalImage(source, target);
  const metadata = await sharp(await readFile(target)).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1200);
  assert.equal(metadata.format, "jpeg");
  assert.ok(result.bytes < 800 * 1024);
});

test("UI는 한 번의 클릭 뒤 기본 Codex 6장 진행·완성 표시·ZIP 흐름을 제공한다", async () => {
  const source = await readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx", import.meta.url), "utf8");
  const jobFactory = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const jobRunner = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  const nativeResultGenerator = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  const nativeVersion = await readFile(new URL("../app/lib/creative-generation/nativeCreativeVersion.ts", import.meta.url), "utf8");
  const runnerPolicy = await readFile(new URL("../app/lib/creative-generation/jobRunnerPolicy.ts", import.meta.url), "utf8");

  assert.match(source, /concurrency: 3/);
  assert.match(source, /codexDirectTest:/);
  assert.match(source, /수동·자동 공통 기본 방식/);
  assert.match(source, /추가\/강조 사항/);
  assert.match(source, /additionalInstructions: directAdditionalInstructions\.trim\(\) \|\| undefined/);
  assert.doesNotMatch(source, />Codex에 전달할 프롬프트</);
  assert.doesNotMatch(source, /테스트 모드|기존 제작|reference-first-adapted-copy|ProductAdCopyPanel|copyEdits/);
  assert.match(source, /동일 레퍼런스로 다시 만들기/);
  assert.match(source, /다른 레퍼런스로 다시 만들기/);
  assert.match(source, /resultEditLabels/);
  assert.match(source, /six-creative-editing-overlay/);
  assert.match(source, /수정 요청을 반영하는 중/);
  assert.match(source, /value: "food-meat", label: "식품 · 육류"/);
  assert.match(source, /value: "food-snack", label: "식품 · 간식"/);
  assert.match(source, /value: "food", label: "식품"/);
  assert.match(source, /value: "all", label: "전체 카테고리"/);
  assert.match(source, /value: "beauty-design", label: "화장품 · 디자인"/);
  assert.match(source, /value: "beauty-hook", label: "화장품 · 후킹"/);
  assert.match(source, /value: "service", label: "서비스"/);
  assert.match(source, /value: "gfa", label: "GFA"/);
  assert.doesNotMatch(source, /value: "food-other", label:/);
  assert.match(source, /generationStageProgress/);
  assert.match(source, /장째 광고를 제작 중입니다/);
  assert.match(source, /simple-generation-steps/);
  assert.match(source, /완성된 광고는 한 장씩 바로 표시됩니다/);
  assert.match(source, /완료 6\/6 · 다운로드 가능/);
  assert.match(source, /생성된 이미지 ZIP 다운로드/);
  assert.match(source, /6장 ZIP 다운로드/);
  assert.match(source, /allCreativesReady/);

  assert.match(jobFactory, /CURRENT_REFERENCE_EDIT_JOB_VERSION/);
  assert.match(jobFactory, /currentProductImagePaths/);
  assert.match(jobFactory, /selectCategoryNativeAdReferences/);
  assert.match(jobFactory, /job\.pipeline = DEFAULT_CODEX_GENERATION_PIPELINE/);
  assert.match(jobFactory, /assertDefaultCodexGenerationJob\(job\)/);
  assert.doesNotMatch(jobFactory, /inspectProductTruthImages|analyzeProductReferences|planHooksWithCodexLocal|buildExplorationCreativePlan/);

  assert.match(jobRunner, /isDefaultCodexGenerationJob/);
  assert.doesNotMatch(jobRunner, /planReferenceAdaptedCopies|ensureReferenceCopyPlanning|validateCompletedReferenceGroup/);
  assert.match(nativeResultGenerator, /runDefaultCodexResult/);
  assert.match(nativeResultGenerator, /stage: "codex-direct-test"/);
  assert.doesNotMatch(nativeResultGenerator, /session\.validate|copyReferenceStructureLosslessly|hasPublishableReferenceCopyContract/);
  assert.match(nativeVersion, /NATIVE_CREATIVE_VERSION = "v1"/);
  assert.match(runnerPolicy, /CURRENT_REFERENCE_EDIT_JOB_VERSION = NATIVE_CREATIVE_VERSION/);
  assert.match(runnerPolicy, /return isDefaultCodexGenerationJob\(job\)/);
});
