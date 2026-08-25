import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCreativeArchiveEntries } from "../app/lib/creative-archive/archive.ts";
import { createCreativeArchiveMetadataRepository } from "../app/lib/creative-archive/metadataRepository.server.ts";
import { archiveEntriesToMetaDrafts, prepareArchivePerformanceSelection } from "../app/lib/meta/archivePerformanceSelection.ts";

const createdAt = "2026-08-21T01:00:00.000Z";

function asset(overrides = {}) {
  return {
    id: "asset-001",
    assetCode: "AT-ORS-MINT-T01-H01",
    brandId: "original-source",
    brandName: "오리지널소스",
    brandCode: "ORS",
    productId: "mint-shower",
    productName: "민트 티트리 샤워젤",
    productCode: "MINT",
    category: "바디케어",
    hookType: "problem-solution",
    hookCode: "PRB",
    hookVariantCode: "H01",
    mainMessage: "운동 후 남은 찝찝함",
    visualDirection: "운동 직후 샤워 장면",
    advertisingHypothesis: "운동 후 불편을 보여준다",
    headline: "샤워했는데도 덥다면?",
    subCopy: "민트 티트리의 산뜻한 사용감",
    benefitCopy: "",
    templateId: "native-ai",
    layoutType: "native-ai",
    backgroundType: "native-ai",
    sourceProductImage: "/product.jpg",
    generatedImageUrl: "/generated-ads/mint-h01.jpg",
    fileName: "AT-ORS-MINT-T01-H01.jpg",
    recommendedAdName: "AT-ORS-MINT-T01-H01",
    utmContent: "utm_content=AT-ORS-MINT-T01-H01",
    objective: "purchase",
    status: "generated",
    version: 1,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function result({ id, hookCode, imagePath, creativeAsset, status = "success" }) {
  return {
    id,
    order: Number(hookCode.slice(-1)),
    blueprintId: "problem-solution-split",
    blueprintLabel: "문제 해결",
    status,
    hookPlan: {
      id: `hook-${hookCode}`,
      blueprintId: "problem-solution-split",
      hookType: "problem-solution",
      title: "문제 해결",
      headline: `${hookCode} 전용 후킹`,
      body: "상품 근거를 담은 서브 문구",
      proof: "",
      offer: "",
      cta: "상품 보기",
      audience: "",
      sceneIntent: "서로 다른 장면",
      factIds: [],
      numericTokens: [],
      hookCode,
      hypothesis: "상품별 메시지 가설",
      confidence: "high",
    },
    scenePlan: { sceneAsset: {} },
    imagePath,
    creativeAsset,
    qa: { score: 91 },
    attempts: 1,
    completedAt: createdAt,
  };
}

function job(results) {
  return {
    id: "creative-job-archive-test-001",
    status: "partial",
    productTruth: {
      productId: "mint-shower",
      product: {
        productName: "민트 티트리 샤워젤",
        category: "바디케어",
        advertiserName: "오리지널소스",
        brandName: "오리지널소스",
        landingUrl: "https://originalsource.example/mint",
      },
    },
    creativePlan: {},
    results,
    concurrency: 2,
    retryLimit: 1,
    paidImageGenerationEnabled: false,
    createdAt,
    updatedAt: createdAt,
    timing: { planningMs: 1 },
    errors: [],
    version: "test",
    advertiserName: "오리지널소스",
  };
}

test("아카이브는 소재 자산과 과거 AI 결과를 합치되 동일 이미지를 중복 표시하지 않는다", () => {
  const registered = asset();
  const matching = result({
    id: "result-h01",
    hookCode: "H01",
    imagePath: registered.generatedImageUrl,
    creativeAsset: { id: registered.id, assetCode: registered.assetCode },
  });
  const unregistered = result({
    id: "result-h02",
    hookCode: "H02",
    imagePath: "/generated-ads/mint-h02.jpg",
  });
  const excluded = result({
    id: "result-h03",
    hookCode: "H03",
    imagePath: "/generated-ads/mint-h03.jpg",
    status: "excluded",
  });
  const metadata = {
    "result:creative-job-archive-test-001:result-h02": {
      entryId: "result:creative-job-archive-test-001:result-h02",
      savedAsReference: true,
      tags: ["쿨링", "미팅 우선안"],
      note: "여름 캠페인에서 재사용",
      updatedAt: createdAt,
    },
  };

  const entries = buildCreativeArchiveEntries({
    assets: [registered],
    jobs: [job([matching, unregistered, excluded])],
    metadata,
  });

  assert.equal(entries.length, 2);
  assert.equal(entries.filter((entry) => entry.imageUrl === registered.generatedImageUrl).length, 1);
  const legacyResult = entries.find((entry) => entry.hookCode === "H02");
  assert.equal(legacyResult.source, "generation-result");
  assert.equal(legacyResult.savedAsReference, true);
  assert.deepEqual(legacyResult.tags, ["쿨링", "미팅 우선안"]);
  assert.match(legacyResult.resultUrl, /create-product\?view=results&jobId=/);
  assert.equal(entries.find((entry) => entry.hookCode === "H01").landingUrl, "https://originalsource.example/mint");
});

test("과거 작업에 도메인으로 저장된 광고주는 브랜드 표시명으로 통합한다", () => {
  const entries = buildCreativeArchiveEntries({
    assets: [
      asset({ id: "asset-kookdae", assetCode: "AT-KOOKDAE-H01", brandName: "kookdae.co.kr", generatedImageUrl: "/generated-ads/kookdae.jpg" }),
      asset({ id: "asset-daehan", assetCode: "AT-DAEHAN-H01", brandName: "koreakoreanbeef.com", generatedImageUrl: "/generated-ads/daehan.jpg" }),
      asset({ id: "asset-farm", assetCode: "AT-FARM-H01", brandName: "fightingfarm.com", generatedImageUrl: "/generated-ads/farm.jpg" }),
    ],
    jobs: [],
    metadata: {},
  });
  assert.deepEqual(
    entries.map((entry) => entry.advertiserName).sort((left, right) => left.localeCompare(right, "ko")),
    ["국대한우", "대한한우", "힘내라농가"].sort((left, right) => left.localeCompare(right, "ko"))
  );
});

test("아카이브 레퍼런스 메타데이터는 태그와 메모를 정리해 영구 저장한다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-creative-archive-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeArchiveMetadataRepository({ dataDirectory: directory });
  const entryId = "asset:asset-001";
  const saved = await repository.update(entryId, {
    savedAsReference: true,
    tags: [" 여름 ", "여름", "미팅 우선안"],
    note: "  다음 업체 미팅에서   먼저 보여주기  ",
  });
  assert.equal(saved.savedAsReference, true);
  assert.deepEqual(saved.tags, ["여름", "미팅 우선안"]);
  assert.equal(saved.note, "다음 업체 미팅에서 먼저 보여주기");

  const reloaded = createCreativeArchiveMetadataRepository({ dataDirectory: directory });
  assert.deepEqual((await reloaded.list())[entryId], saved);
});

test("아카이브 후처리 메타데이터는 원본을 보존하고 미리보기·다운로드에 후처리본을 연결한다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-creative-archive-branding-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeArchiveMetadataRepository({ dataDirectory: directory });
  const entryId = "asset:asset-001";
  const branding = {
    logoId: "original-source",
    aiDisclosure: true,
    imagePath: "/private/archive-delivery.jpg",
    sourceImagePath: "/generated-ads/mint-h01.jpg",
    updatedAt: "2026-08-23T08:00:00.000Z",
  };
  await repository.updateDeliveryBranding(entryId, branding);
  const metadata = await repository.list();
  const [entry] = buildCreativeArchiveEntries({ assets: [asset()], jobs: [], metadata });
  assert.deepEqual(entry.deliveryBranding, {
    logoId: "original-source",
    aiDisclosure: true,
    updatedAt: branding.updatedAt,
  });
  assert.equal(entry.brandingEligible, true);
  assert.match(entry.imageUrl, /\/api\/creative-archive\/asset%3Aasset-001\/image\?branding=/);
  assert.match(entry.downloadUrl, /download=1/);
  assert.doesNotMatch(JSON.stringify(entry), /private\/archive-delivery/);

  await repository.updateDeliveryBranding(entryId, undefined);
  const restored = buildCreativeArchiveEntries({ assets: [asset()], jobs: [], metadata: await repository.list() })[0];
  assert.equal(restored.imageUrl, "/generated-ads/mint-h01.jpg");
  assert.equal(restored.deliveryBranding, undefined);
});

test("삭제한 아카이브 항목은 원본 생성 결과가 남아 있어도 목록에 다시 나타나지 않는다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-creative-archive-delete-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeArchiveMetadataRepository({ dataDirectory: directory });
  const registered = asset();
  const matching = result({
    id: "result-h01",
    hookCode: "H01",
    imagePath: registered.generatedImageUrl,
    creativeAsset: { id: registered.id, assetCode: registered.assetCode },
  });
  await repository.hide(["asset:asset-001"]);
  const metadata = await repository.list();
  assert.ok(metadata["asset:asset-001"].deletedAt);
  assert.equal(metadata["asset:asset-001"].savedAsReference, false);
  const entries = buildCreativeArchiveEntries({ assets: [registered], jobs: [job([matching])], metadata });
  assert.equal(entries.length, 0);
});

test("아카이브는 이미지·영상 제작과 별도의 주 메뉴 및 독립 화면으로 제공된다", async () => {
  const { readFile } = await import("node:fs/promises");
  const navigation = await readFile("app/components/AppFeatureNavigation.tsx", "utf8");
  const page = await readFile("app/archive/page.tsx", "utf8");
  const workspace = await readFile("app/components/creative-archive/CreativeArchiveWorkspace.tsx", "utf8");
  const collectionRoute = await readFile("app/api/creative-archive/route.ts", "utf8");
  const entryRoute = await readFile("app/api/creative-archive/[entryId]/route.ts", "utf8");
  const productZipRoute = await readFile("app/api/creative-archive/product-zip/route.ts", "utf8");
  const productZipService = await readFile("app/lib/creative-archive/productZip.server.ts", "utf8");
  assert.match(navigation, /ARCHIVE_FEATURE[\s\S]*href: "\/archive"[\s\S]*label: "아카이브"/);
  assert.match(navigation, /ASSET LIBRARY/);
  assert.match(page, /CreativeArchiveWorkspace/);
  assert.match(workspace, /업체 레퍼런스만/);
  assert.match(workspace, /태그·메모/);
  assert.match(workspace, /제작 결과 열기/);
  assert.match(workspace, /선택 소재로 성과 설정/);
  assert.match(workspace, /개별 삭제/);
  assert.match(workspace, /이 상품 전체 선택/);
  assert.match(workspace, /선택한 이미지 모두 삭제/);
  assert.match(workspace, /상품 전체 ZIP/);
  assert.match(workspace, /\/api\/creative-archive\/product-zip/);
  assert.match(workspace, /아카이브 이미지에 로고·AI 고지 적용/);
  assert.match(workspace, /업체를 선택하세요/);
  assert.match(workspace, /상품을 선택하세요/);
  assert.match(workspace, /로고·AI: 이 상품 전체/);
  assert.match(workspace, /visibleLogos\.map/);
  assert.match(workspace, /선택한 \$\{brandingIds\.length\}장에만 적용/);
  assert.doesNotMatch(workspace, /현재 목록 선택(?: 해제)?/);
  assert.match(collectionRoute, /export async function DELETE/);
  assert.match(entryRoute, /export async function DELETE/);
  assert.match(productZipRoute, /createCreativeArchiveProductZip/);
  assert.match(productZipRoute, /Content-Disposition/);
  assert.match(productZipService, /resolveValidatedNativeDownload/);
  assert.match(productZipService, /archive-manifest\.json/);
  assert.match(productZipService, /실패-보고서\.txt/);
});

test("아카이브 성과 선택은 같은 상품만 허용하고 디자인 차이를 소재 조합 테스트로 표시한다", () => {
  const base = buildCreativeArchiveEntries({ assets: [asset()], jobs: [], metadata: {} })[0];
  const second = {
    ...base,
    id: "asset:asset-002",
    assetCode: "AT-ORS-MINT-T01-H02",
    hookCode: "H02",
    visualDirection: "제품을 크게 보여주는 다른 장면",
  };
  const combination = prepareArchivePerformanceSelection([base, second]);
  assert.equal(combination.valid, true);
  assert.equal(combination.testType, "creative-combination");
  assert.match(combination.message, /완성 소재 성과/);

  const hookOnly = prepareArchivePerformanceSelection([
    { ...base, templateId: "fixed-design", visualDirection: "동일 디자인" },
    { ...second, templateId: "fixed-design", visualDirection: "동일 디자인" },
  ]);
  assert.equal(hookOnly.testType, "hook-only");
  assert.equal(hookOnly.hookOnlyEligible, true);

  const referenceAdapted = prepareArchivePerformanceSelection([
    asset({ id: "asset-reference-a", assetCode: "AT-REF-A", copyPlanMode: "reference-adapted", templateId: "same", visualDirection: "same", generatedImageUrl: "/generated-ads/ref-a.jpg" }),
    asset({ id: "asset-reference-b", assetCode: "AT-REF-B", copyPlanMode: "reference-adapted", templateId: "same", visualDirection: "same", generatedImageUrl: "/generated-ads/ref-b.jpg" }),
  ]);
  assert.equal(referenceAdapted.testType, "creative-combination");
  assert.equal(referenceAdapted.hookOnlyEligible, false);

  const mixed = prepareArchivePerformanceSelection([base, { ...second, productId: "another-product", productName: "다른 상품" }]);
  assert.equal(mixed.valid, false);
  assert.match(mixed.message, /같은 광고주·같은 상품/);
});

test("아카이브 소재는 소재코드·후킹·UTM을 보존한 Meta 초안으로 변환된다", () => {
  const entry = buildCreativeArchiveEntries({ assets: [asset()], jobs: [], metadata: {} })[0];
  const [draft] = archiveEntriesToMetaDrafts([entry], "https://shop.example/product");
  assert.equal(draft.hookCode, "H01");
  assert.equal(draft.materialCode, entry.assetCode);
  assert.equal(draft.utm, entry.utmContent);
  assert.equal(draft.landingUrl, "https://shop.example/product");
});
