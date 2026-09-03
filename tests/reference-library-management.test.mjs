import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inferNativeReferenceCategoryFromText, inferNativeReferenceFoodSubcategoryFromText, isApprovedReferenceNativeCopy, normalizeNativeReferenceCompatibility, normalizeNativeReferenceFoodSubcategory, referenceBelongsToSelectionPool, removeManagedNativeReference } from "../app/lib/creative-generation/referenceLibraryManagement.ts";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("업로드 파일명 fallback도 패션·음식·화장품 세 그룹만 사용한다", () => {
  assert.equal(inferNativeReferenceCategoryFromText("여름 원피스 광고.png"), "fashion");
  assert.equal(inferNativeReferenceCategoryFromText("한우 선물세트.jpg"), "food");
  assert.equal(inferNativeReferenceCategoryFromText("비타민 건강기능식품.webp"), "beauty");
  assert.equal(inferNativeReferenceCategoryFromText("알 수 없는 상품.jpg"), "beauty");
});

test("간식은 새 대카테고리가 아니라 음식에만 붙는 수동 하위 태그다", () => {
  assert.equal(normalizeNativeReferenceFoodSubcategory("snack"), "snack");
  assert.equal(normalizeNativeReferenceFoodSubcategory("produce-agriculture"), "snack");
  assert.equal(normalizeNativeReferenceFoodSubcategory("fruit"), undefined);
  const food = normalizeNativeReferenceCompatibility({
    id: "food-snack",
    publicPath: "/food-snack.jpg",
    sourceFile: "간식 광고.jpg",
    layoutFamily: "sensory-editorial",
    categoryGroup: "food",
    foodSubcategory: "snack",
    ordinal: 201,
  });
  const beauty = normalizeNativeReferenceCompatibility({
    ...food,
    id: "beauty-with-invalid-food-tag",
    categoryGroup: "beauty",
  });
  assert.equal(food.foodSubcategory, "snack");
  assert.equal(beauty.foodSubcategory, undefined);
});

test("저장된 OCR이 VS 좌우 역할을 가지면 오래된 price-card 태그도 비교 구도로 복구한다", () => {
  const reference = normalizeNativeReferenceCompatibility({
    id: "legacy-vs-reference",
    publicPath: "/legacy-vs-reference.jpg",
    sourceFile: "과거 화장품 VS 광고.jpg",
    layoutFamily: "price-offer",
    categoryGroup: "food",
    foodSubcategory: "snack",
    ordinal: 202,
    compositionType: "price-card",
    productSlotCount: 1,
    nativeCopy: {
      rawText: "비싸기만 한 간식 VS 한가득 담은 간식",
      rawLines: ["비싸기만 한 간식", "VS", "한가득 담은 간식"],
      textRegions: [
        { id: "problem-copy-left", text: "비싸기만 한 간식" },
        { id: "versus-decoration", text: "VS" },
        { id: "benefit-headline-right", text: "한가득 담은 간식" },
      ],
    },
  });
  assert.equal(reference.compositionType, "comparison");
  assert.equal(reference.productSlotCount, 2);
  assert.equal(reference.supportsMultipleProducts, false);
});

test("화장품 기본 분류를 유지하면서 간식 제작 풀에도 동시에 포함할 수 있다", () => {
  const shared = normalizeNativeReferenceCompatibility({
    id: "beauty-shared-with-snack",
    publicPath: "/beauty-shared-with-snack.jpg",
    sourceFile: "화장품 구도 레퍼런스.jpg",
    layoutFamily: "price-offer",
    categoryGroup: "beauty",
    additionalSelectionPools: ["food-snack", "food-snack", "beauty"],
    ordinal: 203,
  });
  assert.equal(shared.categoryGroup, "beauty");
  assert.deepEqual(shared.additionalSelectionPools, ["food-snack"]);
  assert.equal(referenceBelongsToSelectionPool(shared, "beauty"), true);
  assert.equal(referenceBelongsToSelectionPool(shared, "food", "snack"), true);
  assert.equal(referenceBelongsToSelectionPool(shared, "food"), true);
  assert.equal(referenceBelongsToSelectionPool(shared, "fashion"), false);
});

test("신규 음식 레퍼런스는 상품의 섭취 맥락으로 간식 여부를 분류한다", () => {
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("반건조 무화과 간식 광고.jpg"), "snack");
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("과일12.jpg"), "snack");
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("한가득 바삭 종합전병 5종"), "snack");
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("한우 떡갈비 프라이팬.jpg"), undefined);
  assert.equal(inferNativeReferenceFoodSubcategoryFromText("김치 반찬 광고.jpg"), undefined);
});

test("수동 광고 제작은 자동 매칭을 기본으로 두고 레퍼런스 상품군을 작업에 고정할 수 있다", async () => {
  const types = await read("app/lib/creative-generation/types.ts");
  const generator = await read("app/components/features/creative-generation/SixCreativeGenerator.tsx");
  const factory = await read("app/lib/creative-generation/createNativeGenerationJob.server.ts");
  const selector = await read("app/lib/creative-generation/referenceCreativeLibrary.server.ts");

  assert.match(types, /ReferenceCategoryOverride\s*=\s*"fashion"\s*\|\s*"food"\s*\|\s*"food-snack"\s*\|\s*"food-produce"\s*\|\s*"beauty"/);
  assert.match(generator, /자동 매칭 \(상품 분석 기준\)/);
  assert.match(generator, /referenceCategoryOverride:\s*referenceCategoryOverride \|\| undefined/);
  assert.match(generator, /음식 · 간식/);
  assert.match(factory, /job\.referenceCategoryOverride\s*=/);
  assert.ok(factory.indexOf("const referenceCategoryOverride =") < factory.indexOf("selectCategoryNativeAdReferences({ productTruth: truth, referenceCategoryOverride }"));
  assert.match(selector, /job\.referenceCategoryOverride === "food-snack"/);
  assert.match(selector, /referenceBelongsToSelectionPool/);
  assert.match(selector, /사용자 수동 지정/);
});

test("삭제한 레퍼런스는 관리 목록에서 즉시 제거된다", () => {
  const items = [
    { id: "keep", categoryGroup: "food" },
    { id: "delete", categoryGroup: "beauty" },
  ];
  assert.deepEqual(
    removeManagedNativeReference(items, "delete").map((item) => item.id),
    ["keep"]
  );
});

test("제작 선택기는 정적 JSON import가 아니라 현재 관리 manifest를 매번 읽는다", async () => {
  const source = await read("app/lib/creative-generation/referenceCreativeLibrary.server.ts");
  assert.match(source, /function readReferenceItems/);
  assert.match(source, /readNativeReferenceManifestSync\(\)/);
  assert.doesNotMatch(source, /import manifest from/);
});

test("레퍼런스 관리 API는 목록·업로드·분류수정·삭제를 지원한다", async () => {
  const route = await read("app/api/admin/references/route.ts");
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /nativeReferenceLibraryRepository\.remove/);
  assert.match(route, /updateCompatibility/);
  assert.match(route, /supportsPackagedProduct/);
  assert.match(route, /foodSubcategory/);
  assert.match(route, /foodSnackCount/);
});

test("레퍼런스 관리 기본 화면은 실제 제작 라이브러리와 업로드·삭제 UI를 표시한다", async () => {
  const page = await read("app/admin/references/page.tsx");
  const manager = await read("app/components/references/NativeReferenceLibraryManager.tsx");
  assert.match(page, /NativeReferenceLibraryManager/);
  assert.match(page, /tab = "library"/);
  assert.match(manager, /이미지 업로드/);
  assert.match(manager, /자동 분류/);
  assert.match(manager, /삭제/);
  assert.match(manager, /고급 호환 태그/);
  assert.match(manager, /productForm/);
  assert.match(manager, /food-snack/);
  assert.match(manager, /간식 제작에도 사용/);
  assert.match(manager, /간식 제작에도 추가 사용/);
  assert.match(manager, /현재.*유지/);
  assert.match(manager, /additionalSelectionPools/);
  assert.match(manager, /\/api\/admin\/references/);
});

test("승인되고 원문이 있는 정밀 분석만 제작 우선 풀 자격을 얻는다", () => {
  const base = { referenceId: "r1", rawText: "광고 문구", rawLines: ["광고 문구"], textRegions: [], manuallyCorrected: false, useForCopyAdaptation: true, extractionSource: "codex-local", updatedAt: new Date(0).toISOString() };
  assert.equal(isApprovedReferenceNativeCopy({ ...base, analysisStatus: "ready", approvalStatus: "auto-approved" }), true);
  assert.equal(isApprovedReferenceNativeCopy({ ...base, analysisStatus: "needs-review", approvalStatus: "needs-review" }), false);
  assert.equal(isApprovedReferenceNativeCopy({ ...base, manuallyCorrected: true, approvalStatus: "manually-approved" }), true);
  assert.equal(isApprovedReferenceNativeCopy({ ...base, manuallyCorrected: true, approvalStatus: "needs-review" }), false);
  assert.equal(isApprovedReferenceNativeCopy({ ...base, useForCopyAdaptation: false, approvalStatus: "auto-approved" }), false);
});

test("정밀 OCR은 업로드·백그라운드 재분석에서 저장하고 제작 중에는 저장본 또는 안전 최소 문구만 쓴다", async () => {
  const analyzer = await read("app/lib/creative-generation/referenceNativeCopy.server.ts");
  const repository = await read("app/lib/creative-generation/nativeReferenceLibraryRepository.server.ts");
  const selector = await read("app/lib/creative-generation/referenceCreativeLibrary.server.ts");
  const planner = await read("app/lib/creative-generation/referenceAdaptedPlanning.server.ts");
  const runner = await read("app/lib/creative-generation/referenceOcrRunner.server.ts");
  const route = await read("app/api/admin/references/route.ts");
  const ocrRoute = await read("app/api/admin/references/ocr/route.ts");
  const instrumentation = await read("instrumentation.ts");
  assert.match(analyzer, /reference-native-copy-analysis-v4-full-label-consensus/);
  assert.match(analyzer, /prepareAnalysisFiles/);
  assert.match(analyzer, /validatePasses/);
  assert.match(analyzer, /validateConsensus/);
  assert.match(analyzer, /allTextualRegions/);
  assert.match(analyzer, /slice\(0, 48\)/);
  assert.match(analyzer, /repairAttempt < 2/);
  assert.match(analyzer, /modelReasoningEffort: "medium"/);
  assert.match(analyzer, /codexCreativeGate\.run/);
  assert.match(repository, /nativeCopy\?\.imageHash === imageHash/);
  assert.match(repository, /options: \{ force\?: boolean \}/);
  assert.match(route, /extractNativeCopy\(id, \{ force: true \}\)/);
  assert.match(route, /startReferenceOcrRun/);
  assert.match(ocrRoute, /getReferenceOcrStatus\(\{ resume: true \}\)/);
  assert.match(ocrRoute, /prioritize-food/);
  assert.match(runner, /prioritizeReferenceOcrRun/);
  assert.match(instrumentation, /getReferenceOcrStatus\(\{ resume: true \}\)/);
  assert.match(runner, /slice\(0, 3\)/);
  assert.match(runner, /reference-ocr-runner-v4-auto-retry-consensus/);
  assert.match(runner, /ADATLAS_REFERENCE_OCR_MAX_ATTEMPTS/);
  assert.match(runner, /force: current\.force \|\| previousAttempts > 0/);
  assert.match(runner, /자동 재시도/);
  assert.match(runner, /categoryGroup === "food"/);
  assert.match(runner, /prioritizeReferenceIds\(current\.targetIds, manifestItems\)/);
  assert.match(runner, /creativeGenerationJobStore\.active\(50\)/);
  assert.match(runner, /waitForCreativeJobs\(runId\)/);
  assert.match(runner, /startAfterCompleteAutoProduction\(runId\)/);
  assert.match(runner, /afterCompleteAutoProductionAdvertiserId/);
  assert.match(runner, /afterCompleteAutoProductionAdvertiserIds/);
  assert.match(runner, /runAutoProductionNow\(\{ advertiserId, trigger: "manual", force: true \}\)/);
  assert.match(ocrRoute, /afterCompleteAutoProductionAdvertiserId/);
  assert.match(runner, /completedIds/);
  assert.match(runner, /isApprovedReferenceNativeCopy/);
  assert.doesNotMatch(selector, /nativeReferenceLibraryRepository\.extractNativeCopy/);
  assert.doesNotMatch(selector, /nativeCopy\?\.analysisStatus\s*===/);
  assert.match(selector, /호환 풀/);
  assert.match(selector, /pickCompatibleRandomItems/);
  assert.match(planner, /제작 중 즉석 OCR은 실행하지 않았습니다/);
  assert.doesNotMatch(planner, /imagePath 이미지를 직접 읽어 전사한다/);
  assert.match(planner, /isApprovedReferenceNativeCopy\(reference\.nativeCopy\)/);
});

test("관리 화면은 정밀 분석 신뢰도·영역 좌표·승인 상태를 검수할 수 있다", async () => {
  const manager = await read("app/components/references/NativeReferenceLibraryManager.tsx");
  assert.match(manager, /문구 위치·교체 정책 검수/);
  assert.match(manager, /region\.box\.x \* 100/);
  assert.match(manager, /검수 승인/);
  assert.match(manager, /문구 사용 제외/);
  assert.match(manager, /analysisError/);
  assert.match(manager, /\/api\/admin\/references\/ocr/);
  assert.match(manager, /미분석 레퍼런스 전체의 정밀 OCR/);
});
