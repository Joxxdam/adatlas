import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

import { findBannedCreativePhrases, hasBannedCreativePhrase, looksLikeGenericOrRepetitiveCopy, repairBannedCreativeSentence } from "../app/lib/creative-generation/bannedCreativePhrases.ts";
import { resolveFastCreativeRuntime } from "../app/lib/creative-generation/fastCreativeRuntime.ts";
import { createAsyncConcurrencyGate, resolveCodexCreativeParallelLimit } from "../app/lib/creative-generation/asyncConcurrencyGate.ts";
import { buildNativeFinalCreativePrompt, buildNativeStagePrompt, buildNativeValidationPrompt } from "../app/lib/creative-generation/nativeCreativePrompt.ts";
import { enforceExactRenderedCopyValidation, normalizeNativeCreativeValidation } from "../app/lib/creative-generation/nativeCreativeValidation.ts";
import { pickCompatibleRandomItems, pickUniqueRandomItems, scoreReferenceCompatibility } from "../app/lib/creative-generation/referenceSelection.ts";
import { normalizeNativeReferenceCompatibility, normalizeReferenceRawLines } from "../app/lib/creative-generation/referenceLibraryManagement.ts";
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
import { hasOrphanedRunningResult, isServerRunnableGenerationJob, resumeGenerationJob } from "../app/lib/creative-generation/jobRunnerPolicy.ts";
import { resolveProductRenderingPolicy } from "../app/lib/creative-generation/productRenderingPolicy.ts";
import { isPaidImageGenerationEnabled } from "../app/lib/image-generation/SceneGenerationProvider.ts";
import { hasExplicitPaidApiAuthorization } from "../app/lib/creative-generation/types.ts";
import { withNativeCreativeSession } from "../app/lib/creative-generation/providers/CreativeGenerationProvider.ts";
import { applyReferenceCopyGroupRules } from "../app/lib/creative-generation/referenceCopyDiversity.ts";
import { findReferenceCopyNaturalnessErrors } from "../app/lib/creative-generation/referenceCopyNaturalness.ts";
import { downloadSequenceFromCodes, numberedProductImageFileName, productDownloadStem } from "../app/lib/creative-generation/downloadNaming.ts";

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

test("새 상품군 우선 ZIP 레퍼런스 작업 버전은 서버 러너가 실행한다", () => {
  assert.equal(
    isServerRunnableGenerationJob({
      engine: "codex_local",
      version: "generation-job-v12-category-reference-edit",
      results,
    }),
    true
  );
});

test("개발 서버 핫리로드는 단계 경계 취소 계약을 사용하는 v9 러너를 사용한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/jobRunner.server.ts", import.meta.url), "utf8");
  assert.match(source, /server-runner-v10-ad-copy-version-refresh/);
  assert.match(source, /시작 전 v11 작업을 상품군 우선 ZIP 레퍼런스로 재배정/);
  assert.match(source, /사전 문구 검증 차단을 해제하고 pending으로 복구/);
  assert.match(source, /resolveFastCreativeRuntime\(\)\.concurrency/);
});

test("고속 모드는 동시 3장·자동 수정 최대 1회·그룹 QA off가 기본이다", () => {
  assert.deepEqual(resolveFastCreativeRuntime({}), { enabled: true, concurrency: 3, autoRevisionLimit: 1, groupQaEnabled: false, plannerReasoning: "medium", imageReasoning: "low", maxCreatives: 6 });
  assert.equal(resolveFastCreativeRuntime({ ADATLAS_CREATIVE_CONCURRENCY: "9" }).concurrency, 3);
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
  assert.match(prompt, /This is NOT a background plate/);
  assert.match(prompt, /MAIN COPY: 후킹 1/);
  assert.match(prompt, /SUB COPY: 설명 1/);
  assert.match(prompt, /OFFER: 12,000원/);
  assert.match(prompt, /CTA: 상품 보기/);
  assert.match(prompt, /No template renderer, SVG text layer, canvas text layer, product cutout or post-render copy panel/);
  assert.match(prompt, /No source-product pixels will be extracted, cut out, pasted or restored/);
  assert.doesNotMatch(prompt, /text-free square advertising scene plate|No product package/);
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
  assert.match(productReplacement, /Change the source product instances/);
  assert.match(productReplacement, /clearly different fictional adult/);
  assert.match(productReplacement, /visible source-person region/);
  assert.match(productReplacement, /Never extract, cut out or locally composite/);
  assert.match(copyReplacement, /STAGE 3 OF 4/);
  assert.match(copyReplacement, /Change ONLY the source advertisement's copy/);
  assert.match(copyReplacement, /Preserve the AI-integrated package created in stage 2/);
  assert.match(copyReplacement, /regenerate this complete raster/);
  assert.match(copyReplacement, /메인 문구: 후킹 1/);
  assert.match(copyReplacement, /가격·혜택: 12,000원/);
  assert.match(copyReplacement, /SOURCE → TARGET COPY SLOT CONTRACT/);
  assert.match(copyReplacement, /headline\/strong/);
  assert.match(copyReplacement, /same number of headline, support, proof, offer\/label, CTA and badge zones/);
  assert.match(copyReplacement, /must never collapse into a plain product-name label/);
  assert.match(copyReplacement, /Render no number, price, discount, quantity or benefit that is absent from EXACT COPY/);
  assert.match(copyReplacement, /There will be no local text overlay/);
  assert.match(qaRepair, /STAGE 4 OF 4/);
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
});

test("화장품은 원본을 참고자료로만 쓰고 로컬 누끼 없이 전체 AI 래스터로 생성한다", async () => {
  const beautyJob = { productTruth: truth, creativePlan: { categoryCreativeProfile: { category: "personal_care" } }, results };
  const productPrompt = buildNativeStagePrompt("product-replacement", beautyJob, results[0], "/tmp/02-product.png");
  const copyPrompt = buildNativeStagePrompt("copy-replacement", beautyJob, results[0], "/tmp/03-copy.png");
  const generationSource = await readFile(new URL("../app/lib/creative-generation/nativeResultGeneration.server.ts", import.meta.url), "utf8");
  const compositorSource = await readFile(new URL("../app/lib/creative-generation/protectedProductCompositor.server.ts", import.meta.url), "utf8");
  assert.equal(resolveProductRenderingPolicy(beautyJob), "ai-packaged-product-reference");
  assert.match(productPrompt, /FULL AI REFERENCE INTEGRATION/);
  assert.match(productPrompt, /Never extract, cut out or locally composite/);
  assert.match(productPrompt, /Change the source product instances/);
  assert.match(copyPrompt, /Preserve the AI-integrated package/);
  assert.doesNotMatch(generationSource, /createIdentityLockedProductComposite|restoreIdentityLockedProduct|02-product-base|03-copy-base/);
  assert.doesNotMatch(compositorSource, /createIdentityLockedProductComposite/);
});

test("음료·우유·캔·파우치·박스·건강기능식품도 전체 AI 패키지 참고 정책을 쓴다", () => {
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
  assert.match(manifest.selectionPolicy, /패션·식품·화장품 세 그룹/);
  assert.match(manifest.selectionPolicy, /건강·웰니스와 퍼스널케어는 화장품에 포함/);
  assert.match(manifest.selectionPolicy, /식품 전체 풀에서 중복 없이 무작위 선택/);
  assert.match(manifest.selectionPolicy, /과일·농산물 상품은 이 태그가 있는 식품 레퍼런스만 사용/);
  assert.match(manifest.selectionPolicy, /고기와 일반 식품은.*과일\/농산물 태그 항목을 포함한 식품 전체 풀/);
  assert.match(manifest.selectionPolicy, /삭제된 항목은 즉시 선택 대상에서 제외/);
  assert.match(manifest.usagePolicy, /URL 상품과 ProductTruth 문구로 단계별 교체/);
  assert.match(categorySource, /category === "fashion"\) return "fashion"/);
  assert.match(categorySource, /return "beauty";/);
  assert.match(categorySource, /"health-wellness" \|\| value === "general"\) return "beauty"/);
  assert.match(categorySource, /buildProductReferenceCompatibilityProfile/);
  assert.match(categorySource, /pickCompatibleRandomItems/);
  assert.match(categorySource, /resolveNativeReferenceFoodSubcategory/);
  assert.match(categorySource, /category === "food_fresh"/);
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

test("과일·농산물 상품은 식품 중 수동 지정된 전용 레퍼런스만 선택한다", () => {
  const tagged = Array.from({ length: 6 }, (_, index) =>
    normalizeNativeReferenceCompatibility({
      id: `produce-tagged-${index}`,
      publicPath: `/produce-tagged-${index}.jpg`,
      sourceFile: `produce-${index}.jpg`,
      layoutFamily: "sensory-editorial",
      categoryGroup: "food",
      foodSubcategory: "produce-agriculture",
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
      id: `produce-general-${index}`,
      publicPath: `/produce-general-${index}.jpg`,
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
      foodSubcategory: "produce-agriculture",
      productForm: "produce",
      productCount: 1,
      packagedProduct: false,
      naturalFood: true,
      allowsHumanModel: false,
      compatibleCompositionTypes: ["natural-food-scene", "sensory-closeup"],
    },
    () => 0
  );
  assert.equal(selected.length, 6);
  assert.ok(selected.every((candidate) => candidate.item.foodSubcategory === "produce-agriculture"));
  assert.ok(
    selected.some((candidate) => candidate.item.id === "produce-tagged-0"),
    "수동 지정은 과거 자동 상품형태 태그보다 우선해야 합니다."
  );
});

test("고기와 일반 식품은 과일·농산물 태그가 붙은 항목도 식품 전체 풀로 사용한다", () => {
  const food = Array.from({ length: 6 }, (_, index) =>
    normalizeNativeReferenceCompatibility({
      id: `meat-food-${index}`,
      publicPath: `/meat-food-${index}.jpg`,
      sourceFile: `meat-${index}.jpg`,
      layoutFamily: "sensory-editorial",
      categoryGroup: "food",
      ordinal: 500 + index,
      foodSubcategory: index < 3 ? "produce-agriculture" : undefined,
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
  assert.equal(selected.filter((candidate) => candidate.item.foodSubcategory === "produce-agriculture").length, 3);
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

test("최근 레퍼런스 제외는 취소·실패를 빼고 같은 자동제작 묶음의 최근 4개 상품까지만 유지한다", async () => {
  const createSource = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  const recentBlock = createSource.slice(createSource.indexOf("const recentReferenceJobs"), createSource.indexOf("const selectedAdReferences"));
  assert.match(recentBlock, /recentFor\(\{ advertiserId, limit: 50 \}\)/);
  assert.match(recentBlock, /!\["cancelled", "failed"\]\.includes\(previous\.status\)/);
  assert.match(recentBlock, /\.slice\(0, 4\)/);
  assert.doesNotMatch(recentBlock, /\.slice\(0, 12\)/);
});

test("새 작업은 레퍼런스를 먼저 고정하고 레퍼런스 적응 문구를 계획하며 후킹 planner를 호출하지 않는다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/createNativeGenerationJob.server.ts", import.meta.url), "utf8");
  assert.match(source, /selectCategoryNativeAdReferences/);
  assert.match(source, /planReferenceAdaptedCopies/);
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
  assert.match(planner, /targetText: isSourceBrandRemovalRegion\(region\) \? ""/);
  assert.match(planner, /기존 광고주 로고 제거 슬롯에 새 로고 문구가 지정됐습니다/);
  assert.match(prompt, /ERASE COMPLETELY; reconstruct only the immediate surrounding background/);
  assert.match(prompt, /Never turn the current product or brand name into a newly invented standalone logo/);
  assert.match(prompt, /Source-brand\/remove slots that must be text-free background after removal/);
  assert.match(prompt, /standaloneLogoDetected=true/);
  assert.match(prompt, /Apply that prohibition to the ENTIRE canvas/);
  assert.match(prompt, /Optional advertiser branding is a separate user-selected delivery post-process/);
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
  const job = { productTruth: { ...truth, imageAssets: [cutout, pack, lifestyle, detail], referenceImages: [referenceA, referenceB, referenceC] } };
  const selected = selectNativeReferenceSources(job);
  assert.deepEqual(
    selected.map((asset) => asset.path),
    ["/pack.jpg", "/life.jpg", "/detail.jpg"]
  );
  assert.equal(selected.filter((asset) => asset.role === "ad-reference").length, 0);
  assert.ok(!selected.some((asset) => /processed-products/.test(asset.path)));
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
  assert.match(source, /stagePaths:/);
  assert.match(source, /previousArtifact && previousArtifact\.promptVersion !== NATIVE_FINAL_PROMPT_VERSION/);
  assert.match(source, /action === "regenerate" \|\| action === "regenerate-new-reference" \|\| promptVersionChanged/);
  assert.doesNotMatch(source, /selectGoldenReferences/);
  assert.doesNotMatch(source, /composeAdaptiveNativeCreative|validateAdaptiveNativeCreative|composeLocalPerformanceCreative|localValidation/);
  assert.match(source, /action === "copy-update"/);
  assert.doesNotMatch(source, /provider\.validateGroup\(/);
  assert.doesNotMatch(source, /ensureProductAdCopy/);
  assert.match(source, /hasCriticalNativeQaFailure/);
  assert.match(source, /Math\.min\(1,\s*runtime\.autoRevisionLimit\)/);
  assert.match(source, /backgroundPath:\s*undefined/);
  assert.match(source, /compositionMs:\s*0/);
  assert.match(source, /generationRequestKey:\s*`native-ai-final:/);
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
  assert.match(manual, /createNativeGenerationJob/);
  assert.match(automatic, /createNativeGenerationJob/);
  assert.match(automatic, /engine:\s*"codex_local"/);
  assert.doesNotMatch(automatic, /openai_api/);
});

test("로컬 공급자는 H 결과별 단일 세션에서 생성·QA를 계속한다", async () => {
  const source = await readFile(new URL("../app/lib/creative-generation/providers/CodexLocalCreativeProvider.server.ts", import.meta.url), "utf8");
  const sessionBlock = source.slice(source.indexOf("async openSession"), source.indexOf("async validateGroup"));
  assert.equal((sessionBlock.match(/this\.codex\.startThread/g) || []).length, 1);
  assert.match(sessionBlock, /activeThread\(\)\.run/);
  assert.match(sessionBlock, /const generate/);
  assert.match(sessionBlock, /const validate/);
  assert.match(sessionBlock, /thread = undefined/);
  assert.match(source, /runtime\.imageReasoning/);
  assert.doesNotMatch(source, /qaThread|resumeThread|saveAdvertiserThread|codexProductThreadKey/);
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
  assert.match(source, /OPENAI_BASE_URL/);
  assert.match(source, /logged in using chatgpt/i);
  assert.doesNotMatch(source, /\/logged in\/i\.test/);
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
  assert.match(source, /previousUrl === currentProductUrl/);
  assert.match(source, /진행 중인 광고 작업을 그대로 유지/);
  assert.doesNotMatch(source, /품질 확인이 필요합니다/);
  assert.match(source, /생성된 이미지 ZIP 다운로드/);
  assert.match(source, /6장 ZIP 다운로드/);
  assert.match(source, /allCreativesReady/);
  assert.doesNotMatch(source, /Boolean\(result\.imagePath && result\.nativeCreative\?\.finalPath\)/);
  assert.doesNotMatch(source, /상품군 선택 레퍼런스/);
  assert.doesNotMatch(source, /후킹 실험 생성에 실패|후킹 기획을 다시/);
  assert.doesNotMatch(jobFactory, /후킹 기획을 다시 실행해 주세요/);
  assert.match(jobFactory, /planReferenceAdaptedCopies/);
  assert.match(adaptedPlanner, /adaptedLines.*rawLines.*같은 개수·순서·빈 줄/);
  assert.match(adaptedPlanner, /replaceUnusablePlansWithTruthFallback/);
  assert.match(adaptedPlanner, /automaticOfferLine/);
  assert.match(adaptedPlanner, /buildNumberedReasonFallback/);
  assert.match(adaptedPlanner, /대한한우에서 고르는 이유|brand \? `\$\{brand\}에서 고르는 이유`/);
  assert.match(adaptedPlanner, /title-benefit/);
  assert.match(adaptedPlanner, /validateCopyAgainstTruth\(renderedCopy, truth\)\.valid/);
  assert.match(adaptedPlanner, /reference-native-copy-adapter-v10-clean-product-identity/);
  assert.match(adaptedPlanner, /signatures\.length !== new Set\(signatures\)\.size/);
  assert.match(adaptedPlanner, /if \(plan\.validationStatus === "invalid"\) return false/);
  assert.match(adaptedPlanner, /productName: shortProductIdentity\(input\.truth\)/);
  assert.match(adaptedPlanner, /긴 SEO 상품명이 문구 슬롯에 그대로 사용됐습니다/);
  assert.match(adaptedPlanner, /validationStatus: "valid"/);
  assert.match(nativeResultGenerator, /createTruthFallbackReferenceCopyPlan/);
  assert.match(nativeResultGenerator, /빈 문구 계획을 ProductTruth 안전 문구로 교체해 제작을 계속합니다/);
  assert.doesNotMatch(jobFactory, /planHooksWithCodexLocal|buildExplorationCreativePlan/);
  const localPlanner = await readFile(new URL("../app/lib/creative-generation/CodexLocalHookPlanner.server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(localPlanner, /로컬 Codex 후킹 기획을 사용할 수 없어/);
  assert.match(localPlanner, /자동 광고 구성을 근거 기반 규칙 엔진으로 보완했으며 제작은 계속 진행합니다/);
});
