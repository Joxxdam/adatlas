import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { findBannedCreativePhrases, hasBannedCreativePhrase, looksLikeGenericOrRepetitiveCopy, repairBannedCreativeSentence } from "../app/lib/creative-generation/bannedCreativePhrases.ts";
import { resolveFastCreativeRuntime } from "../app/lib/creative-generation/fastCreativeRuntime.ts";
import { createAsyncConcurrencyGate, resolveCodexCreativeParallelLimit } from "../app/lib/creative-generation/asyncConcurrencyGate.ts";
import { buildNativeFinalCreativePrompt, buildNativeStagePrompt, buildNativeValidationPrompt, nativeReferenceRequiresComparisonSemantics, nativeReferenceRequiresContextualBackgroundRebuild, nativeReferenceRequiresHumanReplacement } from "../app/lib/creative-generation/nativeCreativePrompt.ts";
import { enforceExactRenderedCopyValidation, enforceNoSourceDisclosureCopy, enforceOriginCopyPolicy, enforceReferenceCopyPlanValidity, enforceReferenceCopySlotCompleteness, isSourceDisclosureCopy, normalizeNativeCreativeValidation } from "../app/lib/creative-generation/nativeCreativeValidation.ts";
import { defaultCompositionTypes, pickCompatibleRandomItems, pickUniqueRandomItems, scoreReferenceCompatibility } from "../app/lib/creative-generation/referenceSelection.ts";
import { normalizeNativeReferenceCompatibility, normalizeReferenceRawLines, normalizeReferenceTextRegionBrandPolicy } from "../app/lib/creative-generation/referenceLibraryManagement.ts";
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
import { buildProductTruth, cleanProductTitle } from "../app/lib/creative-generation/productTruth.ts";
import { hasOrphanedRunningResult, isServerRunnableGenerationJob, migrateActiveJobToPromptVersion, resumeGenerationJob } from "../app/lib/creative-generation/jobRunnerPolicy.ts";
import { resolveMeatPresentationContract, resolveProductRenderingPolicy } from "../app/lib/creative-generation/productRenderingPolicy.ts";
import { isPaidImageGenerationEnabled } from "../app/lib/image-generation/SceneGenerationProvider.ts";
import { hasExplicitPaidApiAuthorization } from "../app/lib/creative-generation/types.ts";
import { withNativeCreativeSession } from "../app/lib/creative-generation/providers/CreativeGenerationProvider.ts";
import { applyReferenceCopyGroupRules } from "../app/lib/creative-generation/referenceCopyDiversity.ts";
import { consumerFacingFactHint, findReferenceCopyNaturalnessErrors } from "../app/lib/creative-generation/referenceCopyNaturalness.ts";
import { downloadSequenceFromCodes, numberedProductImageFileName, productDownloadStem } from "../app/lib/creative-generation/downloadNaming.ts";
import { resolveCategoryCreativeProfile } from "../app/lib/creative-generation/categoryCreativeRouter.ts";

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

  const resumed = resumeGenerationJob(job, false, "2026-08-22T00:02:00.000Z");
  assert.equal(resumed.status, "running");
  assert.equal(resumed.results[2].status, "pending");
  assert.equal(resumed.results[2].startedAt, undefined);
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

test("개발 서버 핫리로드는 체크포인트 복구 러너를 사용한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  const activeRoute = await readFile(new URL("../app/api/creative-generation/jobs/active/route.ts", import.meta.url), "utf8");
  const instrumentation = await readFile(new URL("../instrumentation.ts", import.meta.url), "utf8");
  assert.match(source, /runnerPolicySignature/);
  assert.match(source, /CURRENT_REFERENCE_EDIT_JOB_VERSION/);
  assert.match(source, /CURRENT_REFERENCE_COPY_POLICY_VERSION/);
  assert.match(source, /NATIVE_FINAL_PROMPT_VERSION/);
  assert.match(source, /server-runner:\$\{runnerPolicySignature\}/);
  assert.doesNotMatch(source, /server-runner-v\d+[^\n]*copy-v\d+/);
  assert.match(source, /executionTimeoutMs: runnerWatchdogMs\(\)/);
  assert.doesNotMatch(source, /시작 전 v11 작업을 상품군 우선 ZIP 레퍼런스로 재배정/);
  assert.match(source, /ensureReferenceCopyPlanning/);
  assert.match(source, /planReferenceAdaptedCopies/);
  assert.doesNotMatch(source, /사전 문구 검증 차단을 해제하고 pending으로 복구/);
  assert.match(source, /resolveFastCreativeRuntime\(\)\.concurrency/);
  assert.match(source, /export async function recoverPersistedGenerationJobs/);
  assert.match(source, /hasOrphanedRunningResult\(job, runnerWasActive\)/);
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
  assert.match(prompt, /reference person is only permission to use a human/);
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
  assert.match(productReplacement, /target-customer-relevant fictional adult/);
  assert.match(productReplacement, /change at least two of these human-composition attributes/i);
  assert.match(productReplacement, /NON-HUMAN SCENE-REBUILD MODE/);
  assert.match(productReplacement, /meaningful contextual background exists/);
  assert.match(productReplacement, /background-absent white\/solid\/achromatic\/abstract\/graphic\/plain seamless studio field remains locked/);
  assert.match(productReplacement, /every visible animal or animal-like character/);
  assert.match(productReplacement, /SEMANTIC CARRIER AND DECORATIVE-MOTIF REPLACEMENT IS MANDATORY, NOT OPTIONAL/);
  assert.match(productReplacement, /meat frying pan\/grill\/raw-meat tray, kimchi or brine tub/);
  assert.match(productReplacement, /verified current-product-compatible carrier or motif/);
  assert.match(productReplacement, /unrelated product\/ingredient character/);
  assert.match(productReplacement, /emoji-style icon/);
  assert.match(productReplacement, /same footprint as a verified current-product-compatible carrier or motif/);
  assert.match(productReplacement, /If the verified target product is already present but too small, enlarge and recompose that SAME instance/);
  assert.match(productReplacement, /never add a second copy, a smaller foreground copy, a detached packshot, or a separate product panel/);
  assert.match(productReplacement, /Never place a second miniature lineup over or in front of the first lineup/);
  assert.match(productReplacement, /CHARACTER \/ ICON STYLE-LOCK RULE/);
  assert.match(productReplacement, /keep the inherited character or motif count, positions/);
  assert.match(productReplacement, /ProductTruth\/product title/);
  assert.match(productReplacement, /use the current product as the replacement character or motif/);
  assert.match(productReplacement, /art desk with pencils and glass dishes must become a coherent family snack\/tea setting/);
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
  const validation = buildNativeValidationPrompt(meatJob, results[0]);
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
  assert.match(productReplacement, /must never increase apparent thickness/);
  assert.match(productReplacement, /do not hallucinate macro texture or a generic cooked steak/);
  assert.match(productReplacement, /do not clone, mirror or repeat the same vein map/);
  assert.match(productReplacement, /Do not add dense white spiderwebs/);
  assert.match(productReplacement, /not lacquered, glassy, rubbery or uniformly glossy/);
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
  assert.match(validation, /meatArtificialPatternDetected/);
  assert.match(validation, /meatGrotesqueDetailDetected/);
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
        cookedSceneAllowed: false,
        hasVerifiedSetComposition: true,
        verifiedPackCount: 5,
      },
    }
  );
  assert.equal(wrongSet.recommendation, "revise");
  assert.match(wrongSet.failures.join(" "), /5팩/);
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

test("관리 화면의 실제 광고 레퍼런스를 세 상품군 선택 풀로 등록한다", async () => {
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
  assert.ok(manifest.items.every((item) => ["fashion", "food", "beauty"].includes(item.categoryGroup)));
  assert.ok(manifest.items.every((item) => item.productForm && item.compositionType && item.productSlotCount && item.productSlotShape && item.photographyType && item.textDensity && item.compatibilityConfidence));
  assert.match(manifest.selectionPolicy, /패션·음식·화장품 세 그룹/);
  assert.match(manifest.selectionPolicy, /건강·웰니스와 퍼스널케어는 화장품에 포함/);
  assert.match(manifest.selectionPolicy, /등록 여부 자체를 운영자의 품질 승인/);
  assert.match(manifest.selectionPolicy, /일반 음식 상품은 간식 추가 풀 항목까지 포함한 음식 전체 풀/);
  assert.match(manifest.selectionPolicy, /간식 상품은 기본 음식 > 간식 또는 추가 간식 풀/);
  assert.match(manifest.selectionPolicy, /간식 풀 안에서는 원본 상품 형태나 조리 소품으로 추가 제외하지 않습니다/);
  assert.match(manifest.selectionPolicy, /상품에 맞는 의미 소품과 장면으로 다시 구성/);
  assert.match(manifest.selectionPolicy, /OCR 상태·상품 형태·슬롯 수·인물 포함 여부·호환 점수·최근 사용 여부는 추가 선택 제한으로 사용하지 않습니다/);
  assert.match(manifest.selectionPolicy, /삭제된 항목은 즉시 선택 대상에서 제외/);
  assert.match(manifest.usagePolicy, /URL 상품과 ProductTruth 문구로 단계별 교체/);
  assert.match(categorySource, /category === "fashion"\) return "fashion"/);
  assert.match(categorySource, /return "beauty";/);
  assert.match(categorySource, /"health-wellness" \|\| value === "general"\) return "beauty"/);
  assert.match(categorySource, /buildProductReferenceCompatibilityProfile/);
  assert.match(categorySource, /pickUniqueRandomItems/);
  assert.match(categorySource, /referenceBelongsToSelectionPool\(item, categoryGroup, profile\.foodSubcategory\)/);
  assert.match(categorySource, /void recentReferenceIds/);
  assert.doesNotMatch(categorySource.slice(categorySource.indexOf("export function selectCategoryNativeAdReferences"), categorySource.indexOf("export function selectNativeAdReference")), /pickCompatibleRandomItems|isApprovedReferenceNativeCopy|scoreReferenceCompatibility/);
  assert.doesNotMatch(categorySource, /categorySafeItems|categoryGroup === "fashion"[\s\S]*categoryGroup === "beauty"/);
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

test("화장품 인물 레퍼런스는 다른 인물로 재생성하고 복수 슬롯은 동일 상품만 반복한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/nativeCreativePrompt.ts", import.meta.url), "utf8");
  const humanResult = {
    ...results[0],
    nativeCreative: { adReference: { photographyType: "human-model", compositionType: "human-use", layoutFamily: "human-use" } },
    scenePlan: { ...results[0].scenePlan, sceneAsset: { ...results[0].scenePlan.sceneAsset, includesPerson: true } },
  };
  const humanJob = { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "personal_care" } }, results: [humanResult] };
  const humanPrompt = buildNativeStagePrompt("product-replacement", humanJob, humanResult, "/tmp/human-full-scene.png");
  assert.match(source, /Remove the source person's recognizable identity completely/);
  assert.match(source, /verified target customer/);
  assert.match(source, /HUMAN-PRESENCE SIGNAL/);
  assert.match(source, /identity, body, silhouette, pose, action, gesture, expression, gaze, wardrobe, styling, location and category story are not references to preserve/);
  assert.match(source, /current ProductTruth and exact target copy/);
  assert.match(source, /Do NOT preserve the old location pixels, source person's semantic advertising role/);
  assert.match(source, /Change at least TWO of these human-composition attributes/);
  assert.match(source, /near-identical pose/);
  assert.match(source, /same verified package several times/);
  assert.match(source, /never invent another scent, variant, package design or sales quantity/);
  assert.match(humanPrompt, /HUMAN FULL-SCENE MODE/);
  assert.match(humanPrompt, /person, action, location, surrounding props and complete photographic background together/);
  assert.match(humanPrompt, /never patch a new person onto the old location/);
  assert.match(humanPrompt, /full person-led photographic scene\/background excluding locked copy and graphic zones/);
  assert.doesNotMatch(humanPrompt, /only its immediately surrounding background/);
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

test("의미 있는 장소·생활 소품 배경을 그대로 둔 결과는 인물 없이도 승인하지 않는다", () => {
  const backgroundJob = { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "food_processed" } }, results };
  const validationPrompt = buildNativeValidationPrompt(backgroundJob, results[0]);
  assert.match(validationPrompt, /MANDATORY CONTEXTUAL-BACKGROUND AUDIT/);
  assert.match(validationPrompt, /A plausible but unchanged art desk, room, table, kitchen or bathroom fails/);

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
      contextualBackgroundFindings: ["연필통과 유리 접시가 있는 원본 작업실 책상이 남았습니다."],
      sceneProductInteractionAligned: true, sceneProductInteractionFindings: [], unrelatedFoodOrIngredientDetected: false,
      unrelatedFoodOrIngredientFindings: [], failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "food_processed", exportComplianceVerified: true }
  );
  assert.equal(failed.recommendation, "revise");
  assert.ok(failed.commercialQuality <= 40);
  assert.match(failed.failures.join(" "), /의미 있는 원본 장소·생활 소품 배경/);
});

test("명백한 자연식품·라이프스타일 레퍼런스는 검수 모델이 배경 없다고 답해도 재구성을 강제한다", () => {
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
  assert.equal(nativeReferenceRequiresContextualBackgroundRebuild(contextualResult), true);
  assert.equal(nativeReferenceRequiresContextualBackgroundRebuild({
    ...contextualResult,
    nativeCreative: { adReference: { id: "plain-reference", compositionType: "product-packshot", photographyType: "packshot" } },
  }), false);

  const failed = normalizeNativeCreativeValidation(
    {
      hookAlignment: 95, productIdentity: 95, factualAccuracy: 100, koreanTextAccuracy: 100, readability: 95,
      composition: 95, diversity: 90, commercialQuality: 95, exportCompliance: 100, productVisibility: 95,
      humanNaturalness: 95, categoryFit: 95, foodAppetiteAppeal: 95, sensoryExpression: 95, mobileReadability: 95,
      observedKoreanText: ["정확한 문구"], standaloneLogoDetected: false, standaloneLogoFindings: [],
      sourceContextualBackgroundDetected: false, contextualBackgroundRebuilt: false,
      contextualBackgroundFindings: [], sceneProductInteractionAligned: true, sceneProductInteractionFindings: [],
      failures: [], recommendation: "approve", checkedAt: new Date(0).toISOString(),
    },
    { category: "food_fresh", exportComplianceVerified: true, requiresContextualBackgroundRebuild: true }
  );
  assert.equal(failed.sourceContextualBackgroundDetected, true);
  assert.equal(failed.recommendation, "revise");
  assert.match(failed.failures.join(" "), /새 장면으로 재구성하지 못했습니다/);
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

test("무화과 반건조 간식은 기타·snack 입력이어도 식품으로 분류하고 먹는 행동을 강제한다", async () => {
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
  const extractSource = await readFile(new URL("../app/api/extract/product/route.ts", import.meta.url), "utf8");

  assert.equal(resolveCategoryCreativeProfile(figTruth).category, "food_processed");
  assert.match(categorySource, /identityText[\s\S]*무화과[\s\S]*return "food"/);
  assert.match(extractSource, /무화과\|곶감\|말랭이\|반건조/);
  assert.match(productReplacement, /eating, tasting, offering, serving/);
  assert.match(productReplacement, /Never preserve smelling a shirt\/body/);
  assert.match(productReplacement, /actual product must be involved in the hand-to-mouth or table interaction/);
  assert.match(productReplacement, /TARGET COPY MEANING: 후킹 1 \/ 설명 1 \/ 상품 보기/);
  assert.match(productReplacement, /반건조 곶감무화과를 실제로 먹거나 나눠 먹는 성인 고객/);
  assert.match(productReplacement, /For this dried-fruit\/snack product/);
  assert.match(productReplacement, /meat frying pan\/grill, raw-meat foam tray, butcher knife, kimchi tub, brine container/);
  assert.doesNotMatch(productReplacement, /상쾌한 샤워를 원하는 고객/);
  assert.match(validation, /humanCopyAligned=false/);
  assert.match(validation, /sceneProductInteractionAligned=false/);
  assert.match(validation, /retained incompatible semantic carrier or decorative motif is a critical failure/i);
  assert.match(validation, /product merely pasted beside a non-eating person/);
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

test("문제 인물 레퍼런스 메타데이터와 미승인 결과 상태를 보수적으로 관리한다", async () => {
  const manifest = JSON.parse(await readFile(new URL("../data/native-creative-reference-library.json", import.meta.url), "utf8"));
  const reference = manifest.items.find((item) => item.id === "reference-copy-113");
  const generationSource = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  const providerSource = await readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts", import.meta.url), "utf8");

  assert.equal(reference?.compositionType, "human-use");
  assert.equal(reference?.photographyType, "human-model");
  assert.equal(reference?.supportsHumanModel, true);
  assert.match(generationSource, /validation\.recommendation === "approve" \? "success" : "quality-review"/);
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

test("6장 묶음 문구 규칙은 가격·할인·수량·상품 근거 반복과 동일 의미를 해당 소재만 표시한다", () => {
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
  assert.match(checked[2].validationErrors.join(" "), /상품 근거.*최대 2장/);
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

test("일반 식품은 세부 상품 형태와 관계없이 식품 카테고리 전체에서 6장을 무작위 선택한다", () => {
  const compatible = Array.from({ length: 5 }, (_, index) =>
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
  assert.ok(selected.some((candidate) => candidate.item.id === "meat"));
  assert.equal(new Set(selected.map((candidate) => candidate.item.id)).size, 6);
});

test("관리 화면의 식품1~7 레퍼런스는 일반 육류 선택 풀에 모두 포함된다", async () => {
  const manifest = JSON.parse(await readFile(new URL("../data/native-creative-reference-library.json", import.meta.url), "utf8"));
  const visibleFoodReferences = manifest.items.filter((item) => /^(?:식품1|식품\([2-7]\))\.jpg$/.test(item.sourceFile.normalize("NFC")));
  assert.equal(visibleFoodReferences.length, 7);
  const profile = {
    categoryGroup: "food",
    productForm: "meat-cut",
    productCount: 1,
    packagedProduct: false,
    naturalFood: true,
    allowsHumanModel: false,
    compatibleCompositionTypes: ["product-packshot", "price-card", "lifestyle-scene", "sensory-closeup", "natural-food-scene"],
  };
  const scores = visibleFoodReferences.map((item) => scoreReferenceCompatibility(profile, normalizeNativeReferenceCompatibility(item)));
  assert.ok(scores.every((candidate) => candidate.score >= 60));
});

test("간식 상품은 음식 중 수동 지정된 간식 레퍼런스만 선택한다", () => {
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

test("화장품 기본 분류 레퍼런스도 추가 간식 풀에 지정하면 간식 후보로 선택된다", () => {
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

test("고기와 일반 음식은 간식 태그가 붙은 항목도 음식 전체 풀로 사용한다", () => {
  const food = Array.from({ length: 6 }, (_, index) =>
    normalizeNativeReferenceCompatibility({
      id: `meat-food-${index}`,
      publicPath: `/meat-food-${index}.jpg`,
      sourceFile: `meat-${index}.jpg`,
      layoutFamily: "sensory-editorial",
      categoryGroup: "food",
      ordinal: 500 + index,
      foodSubcategory: index < 3 ? "snack" : undefined,
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
  assert.equal(selected.filter((candidate) => candidate.item.foodSubcategory === "snack").length, 3);
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

test("새 작업에 배정된 상품군 레퍼런스는 재생성에서도 다시 추첨하지 않는다", async () => {
  const createSource = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const generationSource = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  assert.match(createSource, /selectCategoryNativeAdReferences\(\{ productTruth: truth, referenceCategoryOverride \}, 6/);
  assert.match(createSource, /adReference: selectedAdReferences\[index\]/);
  assert.match(generationSource, /usesCurrentReferenceEditPipeline\(job\) \? undefined : selectNativeAdReference/);
  assert.match(generationSource, /이 작업에 고정된 광고 레퍼런스가 없습니다/);
  assert.doesNotMatch(generationSource, /adReference && action !== "regenerate"/);
});

test("새 작업은 최근 사용·OCR·호환 점수로 등록 레퍼런스를 다시 제외하지 않는다", async () => {
  const createSource = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const selectionBlock = createSource.slice(createSource.indexOf("const selectedAdReferences"), createSource.indexOf("const referencePlanning"));
  assert.match(selectionBlock, /selectCategoryNativeAdReferences\(\{ productTruth: truth, referenceCategoryOverride \}, 6\)/);
  assert.doesNotMatch(createSource, /recentReferenceJobs|recentReferenceIds/);
});

test("새 작업은 레퍼런스를 먼저 고정하고 레퍼런스 적응 문구를 계획하며 후킹 planner를 호출하지 않는다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const runner = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  assert.match(source, /selectCategoryNativeAdReferences/);
  assert.match(source, /prepareReferenceAdaptedCopyScaffold/);
  assert.match(runner, /planReferenceAdaptedCopies/);
  assert.match(runner, /referenceCopyPlanning/);
  assert.match(source, /copyPlanMode = "reference-adapted"/);
  assert.match(source, /pipeline = CURRENT_REFERENCE_EDIT_PIPELINE/);
  assert.match(source, /assertCurrentReferenceEditGenerationJob\(job\)/);
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

test("레퍼런스 문구 프로필은 해시·버전 캐시와 일괄 critic·실패 항목 1회 보정을 사용한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/referenceAdaptedPlanning.server.ts", import.meta.url), "utf8");
  assert.match(source, /REFERENCE_COPY_PROFILE_VERSION/);
  assert.match(source, /referenceHash/);
  assert.match(source, /prewarmReferenceCopyProfiles/);
  assert.match(source, /criticPrompt/);
  assert.match(source, /repairPlans: failed/);
  assert.match(source, /repaired-codex-local/);
  assert.doesNotMatch(source, /selectDiverseHookHypotheses|genericDrafts|buildProductHookExploration/);
});

test("기존 광고주 로고 슬롯은 새 브랜드 로고로 치환하지 않고 배경으로 제거한다", async () => {
  const planner = await readFile(new URL("../app/lib/creative-generation/referenceAdaptedPlanning.server.ts", import.meta.url), "utf8");
  const prompt = await readFile(new URL("../app/lib/creative-generation/nativeCreativePrompt.ts", import.meta.url), "utf8");
  assert.match(planner, /function isSourceBrandRemovalRegion/);
  assert.match(planner, /const removeSourceRegion = isSourceBrandRemovalRegion\(region, sourceText\)/);
  assert.match(planner, /targetText: removeSourceRegion \? ""/);
  assert.match(planner, /연출\|예시\|참고\|합성\|생성/);
  assert.match(planner, /기존 광고주 로고 제거 슬롯에 새 로고 문구가 지정됐습니다/);
  assert.match(prompt, /ERASE THE ENTIRE SOURCE-BRAND REGION INCLUDING ITS BADGE\/CAPSULE\/RIBBON\/CONTAINER/);
  assert.match(prompt, /Never turn the current product or brand name into a newly invented standalone logo/);
  assert.match(prompt, /Source-brand\/remove slots that must be text-free background after removal/);
  assert.match(prompt, /standaloneLogoDetected=true/);
  assert.match(prompt, /Apply that prohibition to the ENTIRE canvas/);
  assert.match(prompt, /Optional advertiser branding is a separate user-selected delivery post-process/);
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

test("native 실행은 구조를 무손실 복사하고 상품·문구·치명 QA에만 AI를 사용한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  assert.match(source, /withNativeCreativeSession\(provider/);
  assert.match(source, /session\.generate/);
  assert.match(source, /session\.validate\(/);
  assert.doesNotMatch(source, /provider\.generate\(/);
  assert.doesNotMatch(source, /provider\.validate\(/);
  assert.match(source, /referencePaths:\s*generationReferences/);
  assert.match(source, /selectNativeAdReference/);
  assert.match(source, /copyReferenceStructureLosslessly/);
  assert.doesNotMatch(source, /runStage\("structure-recreation"/);
  assert.match(source, /runStage\(\s*"product-replacement"/);
  assert.match(source, /runStage\(\s*"copy-replacement"/);
  assert.match(source, /runStage\(\s*"qa-repair"/);
  assert.match(source, /If the verified target product or set already exists but is small, enlarge and recompose that same instance or whole set in place/);
  assert.match(source, /Never add a second package, miniature copy, duplicate lineup, detached packshot or rectangular product-reference panel/);
  assert.match(source, /MEAT IDENTITY RECOVERY — REBUILD, DO NOT RETOUCH THE GENERIC STEAK/);
  assert.match(source, /exact hook calls for cooking, eating, serving, searing or juiciness/);
  assert.match(source, /abundant but believable juices/);
  assert.match(source, /Never turn thin slices into medallions, cubes or identical molded rectangles/);
  assert.match(source, /conciseQaFeedback\(validation, isMeat\)/);
  assert.match(source, /stagePaths:/);
  assert.match(source, /previousArtifact && previousArtifact\.promptVersion !== NATIVE_FINAL_PROMPT_VERSION/);
  assert.match(source, /action === "regenerate" \|\| action === "regenerate-new-reference" \|\| promptVersionChanged/);
  assert.doesNotMatch(source, /selectGoldenReferences/);
  assert.doesNotMatch(source, /composeAdaptiveNativeCreative|validateAdaptiveNativeCreative|composeLocalPerformanceCreative|localValidation/);
  assert.match(source, /action === "copy-update"/);
  assert.doesNotMatch(source, /provider\.validateGroup\(/);
  assert.doesNotMatch(source, /ensureProductAdCopy/);
  assert.match(source, /hasCriticalNativeQaFailure/);
  assert.match(source, /프라이팬\|후라이팬\|불판\|그릴/);
  assert.match(source, /semantic\\s\*\(\?:prop\|carrier\|container\|vessel\|motif\)/);
  assert.match(source, /mandatoryCriticalQaRevisionLimit = Math\.max\(1, runtime\.autoRevisionLimit\)/);
  assert.match(source, /backgroundPath:\s*undefined/);
  assert.match(source, /compositionMs:\s*0/);
  assert.match(source, /generationRequestKey:\s*`native-ai-final:/);
});

test("레퍼런스 fallback은 브랜드 슬롯을 비우되 강한 원문과 문구 밀도를 상품 사실로 보존한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/referenceAdaptedPlanning.server.ts", import.meta.url), "utf8");
  assert.match(source, /factIdByKey\.get\(`vendor-\$\{id\}`\)/);
  assert.match(source, /if \(isSourceBrandRemovalRegion\(region\)\) return ""/);
  assert.match(source, /function referenceAwareFallbackText/);
  assert.match(source, /minimumUsefulLength/);
  assert.match(source, /strongSourceHook/);
  assert.match(source, /contentFallbackCandidates/);
  assert.match(source, /offerIndex === 0 \? undefined/);
  assert.match(source, /recordFactsForTarget/);
});

test("사용자 수정 피드백은 교체 가능한 repository와 기본 STRONG 강도로 분리된다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/creativePreferenceRepository.server.ts", import.meta.url), "utf8");
  assert.match(source, /interface CreativePreferenceRepository/);
  assert.match(source, /expressionStrength:\s*"STRONG"/);
  assert.match(source, /approved-after-copy-edit/);
  assert.match(source, /never-reuse/);
});

test("문구 수정도 기존 배경·후처리 합성을 재사용하지 않고 AI 완성 광고 전체를 다시 생성한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  const copyIndex = source.indexOf('action === "copy-update"');
  const providerIndex = source.indexOf("createCreativeGenerationProvider", copyIndex);
  assert.ok(copyIndex > 0 && providerIndex > copyIndex);
  assert.match(source, /else if \(action === "copy-update"\)/);
  assert.match(source, /copyPath = undefined/);
  assert.match(source, /runStage\(\s*"copy-replacement"/);
  assert.match(source, /if \(action === "revise"\)/);
  assert.match(source, /04-qa-repair-user/);
  assert.doesNotMatch(source, /backgroundPath\) throw|shouldGenerateBackground|composeAdaptiveNativeCreative/);
});

test("수동 제작과 아침 자동 제작은 동일한 native 생성 작업 팩토리를 사용한다", async () => {
  const manual = await readFile(new URL("../app/api/creative-generation/jobs/route.ts", import.meta.url), "utf8");
  const automatic = await readFile(new URL("../app/lib/auto-production/productionRunner.server.ts", import.meta.url), "utf8");
  const factory = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  assert.match(manual, /createNativeGenerationJob/);
  assert.match(automatic, /createNativeGenerationJob/);
  assert.match(automatic, /engine:\s*"codex_local"/);
  assert.doesNotMatch(automatic, /openai_api/);
  assert.match(factory, /applyOriginalSourceVendorResearch\(input\.product, input\.product\.landingUrl\)/);
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

test("자동 재시도는 완료된 native 단계 파일을 지우지 않고 이어서 실행한다", async () => {
  const runner = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  const generation = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  assert.match(runner, /action:\s*"generate"/);
  assert.doesNotMatch(runner, /next\.attempts > 0 \? "regenerate"/);
  assert.match(generation, /recoveredProductPath/);
  assert.match(generation, /recoveredCopyPath/);
  assert.match(generation, /validStageFileWrittenSince/);
  assert.match(generation, /완료 파일을 Codex 완료 이벤트 지연 뒤 복구/);
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
  assert.ok(resultRunner.indexOf("handlePreference(input, job)") < resultRunner.indexOf("withNativeCreativeSession(provider"));
  assert.ok(resultRunner.lastIndexOf("copyReferenceStructureLosslessly") < resultRunner.lastIndexOf("withNativeCreativeSession(provider"));
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
  assert.match(adCopy, /requireFreshCodexLocalChatGptLogin/);
  assert.match(videoPlanning, /requireFreshCodexLocalChatGptLogin/);
  assert.doesNotMatch(`${provider}\n${adCopy}\n${videoPlanning}`, /resumeThread|getAdvertiserThread|saveAdvertiserThread/);
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

test("UI는 한 번의 클릭 뒤 1~6 진행 상태·완성 즉시 표시·전체 ZIP 흐름을 제공한다", async () => {
  const source = await readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx", import.meta.url), "utf8");
  const jobFactory = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const jobRunner = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  const adaptedPlanner = await readFile(new URL("../app/lib/creative-generation/referenceAdaptedPlanning.server.ts", import.meta.url), "utf8");
  const nativeResultGenerator = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  assert.match(source, /concurrency: 3/);
  assert.match(source, /수정 문구로 전체 광고 재생성/);
  assert.doesNotMatch(source, /문구만 적용|AI 재생성 없이/);
  assert.match(source, /동일 레퍼런스로 다시 만들기/);
  assert.match(source, /다른 레퍼런스로 다시 만들기/);
  assert.match(jobFactory, /CURRENT_REFERENCE_EDIT_JOB_VERSION/);
  assert.match(source, /reference-first-adapted-copy/);
  assert.match(source, /generationStageProgress/);
  assert.match(source, /장째 광고를 제작 중입니다/);
  assert.match(source, /현재 진행/);
  assert.match(source, /simple-generation-steps/);
  assert.match(source, /완성된 광고는 한 장씩 바로 표시됩니다/);
  assert.match(source, /\.filter\(\(result\) => Boolean\(result\.imagePath\)\)/);
  assert.match(source, /완료 6\/6 · 다운로드 가능/);
  assert.match(source, /원본 구조 적용 중/);
  assert.match(source, /품질 확인 필요 · 다운로드 가능/);
  assert.doesNotMatch(source, /previousUrl === currentProductUrl/);
  assert.doesNotMatch(source, /진행 중인 광고 작업을 그대로 유지/);
  assert.match(source, /dismissedJobIds\.current\.add\(activeJobIdRef\.current\)/);
  assert.match(source, /new Set\(\[previousUrl, currentProductUrl\]\.filter\(Boolean\)\)/);
  assert.match(source, /상품 분석을 다시 완료해 이전 제작 카드를 비웠습니다/);
  assert.doesNotMatch(source, /품질 확인이 필요합니다/);
  assert.match(source, /생성된 이미지 ZIP 다운로드/);
  assert.match(source, /6장 ZIP 다운로드/);
  assert.match(source, /allCreativesReady/);
  assert.doesNotMatch(source, /Boolean\(result\.imagePath && result\.nativeCreative\?\.finalPath\)/);
  assert.doesNotMatch(source, /상품군 선택 레퍼런스/);
  assert.doesNotMatch(source, /후킹 실험 생성에 실패|후킹 기획을 다시/);
  assert.doesNotMatch(jobFactory, /후킹 기획을 다시 실행해 주세요/);
  assert.match(jobFactory, /prepareReferenceAdaptedCopyScaffold/);
  assert.match(jobRunner, /planReferenceAdaptedCopies/);
  assert.match(jobFactory, /currentProductImagePaths/);
  assert.match(jobFactory, /userConfirmedPaths: Array\.from\(new Set\(\[\.\.\.acceptedSelected, \.\.\.acceptedRequested\]\)\)/);
  assert.match(jobFactory, /selectedAdImages: \[\]/);
  assert.match(jobFactory, /allowedProductPaths\.has/);
  assert.match(adaptedPlanner, /adaptedLines.*rawLines.*같은 개수·순서·빈 줄/);
  assert.match(adaptedPlanner, /ensureRenderableReferencePlans/);
  assert.match(adaptedPlanner, /export const createTruthFallbackReferenceCopyPlan = createBestEffortReferenceCopyPlan/);
  assert.match(adaptedPlanner, /automaticOfferLine/);
  assert.match(adaptedPlanner, /buildNumberedReasonFallback/);
  assert.match(adaptedPlanner, /고를 때 보는 이유/);
  assert.match(adaptedPlanner, /fact\.key !== "brand-name"/);
  assert.doesNotMatch(adaptedPlanner, /brand \? `\$\{brand\}에서 고르는 이유`/);
  assert.match(adaptedPlanner, /title-benefit/);
  assert.match(adaptedPlanner, /비브랜드 광고 슬롯의 빈값/);
  assert.match(adaptedPlanner, /blankNonBrandSlots/);
  assert.match(adaptedPlanner, /groundingErrors/);
  assert.match(adaptedPlanner, /CURRENT_REFERENCE_COPY_POLICY_VERSION/);
  assert.match(adaptedPlanner, /productFactPlanningPriority/);
  assert.match(adaptedPlanner, /업체의 업력·순위·수상은 상품 USP를 대신할 수 없고/);
  assert.match(adaptedPlanner, /현재 업체·브랜드명을 주어로 적고 평가 분야를 함께 쓴다/);
  assert.match(adaptedPlanner, /loadCopyGuideForProduct/);
  assert.match(adaptedPlanner, /allowSheetClaimsInCopy/);
  assert.match(adaptedPlanner, /승인된 광고 근거/);
  assert.match(adaptedPlanner, /copyGuidePromptBlock/);
  assert.match(adaptedPlanner, /계절·시즌·명절·날씨·일상 상황·대중문화·밈·유행 먹거리/);
  assert.match(adaptedPlanner, /자연스럽게 연결된 계절·시즌·유행·밈·사용 상황이 ProductTruth에 없다는 이유만으로 factualSafety를 감점하거나 오류로 판정하지 않는다/);
  assert.match(adaptedPlanner, /근거 없는 'SNS 1위'.*'오늘만 할인'.*'곧 품절'은 금지/);
  assert.match(adaptedPlanner, /function canonicalCopyFields/);
  assert.match(adaptedPlanner, /const copyFields = canonicalCopyFields\(copySlots, raw\)/);
  assert.match(adaptedPlanner, /plannerDeclaredSafetyErrors/);
  assert.match(adaptedPlanner, /readyPlans = applyMerchantCredentialGroupRule\(applyReferenceCopyGroupRules\(readyPlans, input\.truth\)\)/);
  assert.match(adaptedPlanner, /copyHint는 조사 보고서 말투를 제거한 작성 힌트/);
  assert.match(adaptedPlanner, /미검수 AI 문구 미사용/);
  assert.match(adaptedPlanner, /후기 카드의 작성 날짜·시각·작성자·닉네임/);
  assert.doesNotMatch(adaptedPlanner, /if \(plan\.validationStatus === "invalid"\) return false/);
  assert.match(adaptedPlanner, /isShippingCreativeSignal\(renderedCopy\)/);
  assert.match(adaptedPlanner, /hasPublishableReferenceCopyContract/);
  assert.match(adaptedPlanner, /findImageCreativePremiseCopyErrors/);
  assert.match(adaptedPlanner, /6장에 인물형·시대극·상품 1인칭·USP·비교 역할별 장수를 강제하지 않는다/);
  assert.match(adaptedPlanner, /수라간 감별관.*상품 큐레이터.*구매 담당.*저녁밥 총무.*욕실 집사/);
  assert.match(adaptedPlanner, /임금님도 감동할 진짜 특급한우/);
  assert.match(adaptedPlanner, /plan\.generationSource !== "reference-best-effort"/);
  assert.match(adaptedPlanner, /선택 옵션과 가격의 직접 연결 근거/);
  assert.match(adaptedPlanner, /minimumDensityRatio/);
  assert.match(adaptedPlanner, /질문·반전·판매 강도가 지나치게 단순화/);
  assert.match(adaptedPlanner, /productName: shortProductIdentity\(input\.truth\)/);
  assert.match(adaptedPlanner, /긴 SEO 상품명이 문구 슬롯에 그대로 사용됐습니다/);
  assert.match(adaptedPlanner, /validationStatus: "valid"/);
  assert.match(nativeResultGenerator, /createBestEffortReferenceCopyPlan/);
  assert.match(nativeResultGenerator, /hasExecutableReferenceCopyContract/);
  assert.match(nativeResultGenerator, /문구 품질 경고를 보존하고 이미지 생성 계속/);
  assert.match(nativeResultGenerator, /편집 불가능 문구를 ProductTruth 안전 문구로 교체하고 이미지 생성 계속/);
  assert.doesNotMatch(nativeResultGenerator, /품질 기준을 통과하지 못해 이미지 생성을 시작하지 않았습니다/);
  assert.doesNotMatch(jobFactory, /planHooksWithCodexLocal|buildExplorationCreativePlan/);
  const localPlanner = await readFile(new URL("../app/lib/creative-generation/CodexLocalHookPlanner.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(localPlanner, /로컬 Codex 후킹 기획을 사용할 수 없어/);
  assert.match(localPlanner, /자동 광고 구성을 근거 기반 규칙 엔진으로 보완했으며 제작은 계속 진행합니다/);
});
