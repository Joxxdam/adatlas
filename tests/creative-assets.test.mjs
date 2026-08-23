import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createBrandCode, createHookVariantAssetCode, createExplorationAssetCode, createProductCode, extractCreativeAssetCode, generateCreativeAssetCode, getHookCode, validateCreativeAssetCode } from "../app/lib/creative-assets/code.ts";
import { createCreativeAssetRepository } from "../app/lib/creative-assets/repository.server.ts";

const fixedDate = new Date(2026, 7, 12, 12, 0, 0);

function baseAsset(overrides = {}) {
  return {
    brandId: "original-source",
    brandName: "Original Source",
    productId: "product-mint-shower-gel",
    productName: "Mint Tea Tree Shower Gel",
    category: "퍼스널케어",
    hookType: "price-benefit",
    advertisingHypothesis: "가격 혜택을 먼저 보여주면 선택 이유가 선명해집니다.",
    headline: "민트 샤워젤 혜택",
    subCopy: "실제 상품 정보를 확인해 보세요.",
    benefitCopy: "상세페이지 확인 정보",
    templateId: "problem-solution-split",
    layoutType: "problem-solution-split",
    backgroundType: "library",
    backgroundId: "beauty-01",
    sourceProductImage: "/test-fixtures/original-source-product.webp",
    generatedImageUrl: "/generated-ads/test-result.webp",
    objective: "purchase",
    createdAt: fixedDate.toISOString(),
    ...overrides,
  };
}

test("정상 소재코드를 지정 형식으로 생성한다", () => {
  const code = generateCreativeAssetCode({
    brandCode: "ORS",
    productCode: "MINT",
    hookCode: "PRC",
    createdAt: fixedDate,
    unique: "K4M7",
  });
  assert.equal(code, "AT-ORS-MINT-PRC-260812-K4M7");
  assert.equal(validateCreativeAssetCode(code), true);
});

test("후킹 실험 소재코드는 브랜드·상품·T01·H01을 동일하게 연결한다", async (context) => {
  const code = createHookVariantAssetCode({
    brandCode: "ORS",
    productCode: "MINT",
    testCode: "T01",
    hookVariantCode: "H01",
  });
  assert.equal(code, "AT-ORS-MINT-T01-H01");
  assert.equal(validateCreativeAssetCode(code), true);
  assert.equal(extractCreativeAssetCode(`${code}.webp`), code);

  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-hook-assets-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeAssetRepository({ dataDirectory: directory });
  const first = await repository.create(baseAsset({ testCode: "T01", hookVariantCode: "H01", generationRequestKey: "hook-1" }));
  const revision = await repository.create(baseAsset({ testCode: "T01", hookVariantCode: "H01", generationRequestKey: "hook-2" }));
  assert.match(first.asset.assetCode, /^AT-[A-Z0-9]{3,5}-[A-Z0-9]{3,5}-T01-H01$/);
  assert.equal(revision.asset.assetCode, `${first.asset.assetCode}-V02`);
});

test("상품별 광고 콘셉트 탐색 소재코드는 E01·H01·C01을 동일하게 연결한다", async (context) => {
  const code = createExplorationAssetCode({
    brandCode: "ORS",
    productCode: "MINT",
    explorationCode: "E01",
    hookVariantCode: "H01",
    conceptCode: "C01",
  });
  assert.equal(code, "AT-ORS-MINT-E01-H01-C01");
  assert.equal(validateCreativeAssetCode(code), true);
  assert.equal(extractCreativeAssetCode(`${code}.webp`), code);

  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-exploration-assets-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeAssetRepository({ dataDirectory: directory });
  const first = await repository.create(
    baseAsset({
      explorationCode: "E01",
      hookVariantCode: "H01",
      conceptCode: "C01",
      primaryHookTag: "sensory-experience",
      secondaryHookTags: ["usage-occasion"],
      customerReason: "민트와 티트리의 상쾌한 사용감",
      generationRequestKey: "exploration-1",
    })
  );
  assert.equal(first.asset.assetCode, code);
  assert.equal(first.asset.primaryHookTag, "sensory-experience");
  assert.deepEqual(first.asset.secondaryHookTags, ["usage-occasion"]);
});

test("10,000개 이상 생성해도 프로세스 내 UNIQUE가 겹치지 않는다", () => {
  const codes = new Set();
  for (let index = 0; index < 10_500; index += 1) {
    codes.add(generateCreativeAssetCode({ brandCode: "ORS", productCode: "MINT", hookCode: "USP", createdAt: fixedDate }));
  }
  assert.equal(codes.size, 10_500);
});

test("영문 브랜드와 상품 코드는 3~5자리 영문·숫자로 안정적으로 생성한다", () => {
  const brand = createBrandCode("Original Source", "original-source");
  const product = createProductCode("Mint Tea Tree", "product-mint-tea-tree");
  assert.match(brand, /^[A-Z0-9]{3,5}$/);
  assert.match(product, /^[A-Z0-9]{3,5}$/);
  assert.equal(createBrandCode("Original Source", "original-source"), brand);
  assert.equal(createProductCode("Mint Tea Tree", "product-mint-tea-tree"), product);
});

test("한글 브랜드와 상품도 빈 값이 아닌 고정 코드를 생성한다", () => {
  const brand = createBrandCode("국대한우", "brand-gukdae-001");
  const product = createProductCode("한우 선물세트", "product-korean-001");
  assert.match(brand, /^[A-Z0-9]{3,5}$/);
  assert.match(product, /^[A-Z0-9]{3,5}$/);
  assert.equal(createBrandCode("국대한우 리뉴얼", "brand-gukdae-001"), brand);
  assert.equal(createProductCode("한우 선물세트 리뉴얼", "product-korean-001"), product);
});

test("표준 및 기존 후킹 타입을 소재 소구 코드로 매핑한다", () => {
  assert.equal(getHookCode("가격·혜택형"), "PRC");
  assert.equal(getHookCode("product-hero"), "USP");
  assert.equal(getHookCode("review-ugc"), "REV");
  assert.equal(getHookCode("problem-solution"), "PRB");
  assert.equal(getHookCode("editorial-story"), "EMP");
  assert.equal(getHookCode("limited-offer"), "URG");
  assert.equal(getHookCode("가성비형"), "VAL");
  assert.equal(getHookCode("promotion-event"), "EVT");
});

test("알 수 없는 후킹 타입은 ETC로 처리한다", () => {
  assert.equal(getHookCode("brand-new-angle"), "ETC");
  assert.equal(getHookCode(""), "ETC");
});

test("정확한 코드만 검증하고 잘못된 날짜·소문자·형식을 거부한다", () => {
  assert.equal(validateCreativeAssetCode("AT-ORS-MINT-PRC-260812-K4M7"), true);
  assert.equal(validateCreativeAssetCode("AT-OR-MINT-PRC-260812-K4M7"), false);
  assert.equal(validateCreativeAssetCode("AT-ORS-MINT-XXX-260812-K4M7"), false);
  assert.equal(validateCreativeAssetCode("AT-ORS-MINT-PRC-261332-K4M7"), false);
  assert.equal(validateCreativeAssetCode("at-ors-mint-prc-260812-k4m7"), false);
});

test("광고명 앞뒤 문구와 이미지 확장자 사이에서 정확한 코드를 추출한다", () => {
  const code = "AT-ORS-MINT-PRC-260812-K4M7";
  assert.equal(extractCreativeAssetCode(`전환_민트티트리_${code}_가격소구`), code);
  assert.equal(extractCreativeAssetCode(`${code}.png`), code);
  assert.equal(extractCreativeAssetCode("AT-OR-MINT-PRC-260812-K4M7.png"), null);
  assert.equal(extractCreativeAssetCode(`X${code}9`), null);
});

test("repository가 멱등 저장·재조회·수정본·파일명·UTM을 보존한다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-creative-assets-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeAssetRepository({ dataDirectory: directory });
  const first = await repository.create(baseAsset({ generationRequestKey: "request-1" }));
  const retried = await repository.create(baseAsset({ generationRequestKey: "request-1" }));
  assert.equal(first.created, true);
  assert.equal(retried.created, false);
  assert.equal(retried.asset.assetCode, first.asset.assetCode);
  assert.equal(first.asset.fileName, `${first.asset.assetCode}.webp`);
  assert.equal(first.asset.recommendedAdName, first.asset.assetCode);
  assert.equal(first.asset.utmContent, `utm_content=${first.asset.assetCode}`);

  const reloaded = createCreativeAssetRepository({ dataDirectory: directory });
  assert.equal((await reloaded.getByCode(first.asset.assetCode))?.assetCode, first.asset.assetCode);
  const revision = await reloaded.create(
    baseAsset({
      headline: "수정한 헤드라인",
      parentAssetCode: first.asset.assetCode,
      generationRequestKey: "request-2",
    })
  );
  assert.notEqual(revision.asset.assetCode, first.asset.assetCode);
  assert.equal(revision.asset.parentAssetCode, first.asset.assetCode);
  assert.equal(revision.asset.version, 2);
});

test("기회 분석·참고사항·후기 인사이트 메타데이터를 소재 레코드에 보존한다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-creative-assets-context-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeAssetRepository({ dataDirectory: directory });
  const { asset } = await repository.create(
    baseAsset({
      advertiserId: "adv-1",
      opportunityId: "opp-1",
      analysisRunId: "run-1",
      opportunityType: "HIDDEN_WINNER",
      recommendedHookType: "price-value",
      appliedContentNoteIds: ["note-1", "note-1", "note-2"],
      reviewInsightIds: ["review-1"],
    })
  );
  const stored = await repository.getByCode(asset.assetCode);
  assert.equal(stored.advertiserId, "adv-1");
  assert.equal(stored.opportunityId, "opp-1");
  assert.equal(stored.opportunityType, "HIDDEN_WINNER");
  assert.deepEqual(stored.appliedContentNoteIds, ["note-1", "note-2"]);
  assert.deepEqual(stored.reviewInsightIds, ["review-1"]);
});

test("동시에 생성된 서로 다른 소재 레코드의 코드가 충돌하지 않는다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-creative-assets-concurrent-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeAssetRepository({ dataDirectory: directory });
  const results = await Promise.all(Array.from({ length: 60 }, (_, index) => repository.create(baseAsset({ generationRequestKey: `concurrent-${index}` }))));
  assert.equal(new Set(results.map((result) => result.asset.assetCode)).size, 60);
});

test("브랜드·상품 이름이 바뀌어도 저장된 엔티티 코드를 재사용한다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-creative-assets-codes-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeAssetRepository({ dataDirectory: directory });
  const before = await repository.create(baseAsset({ generationRequestKey: "name-before" }));
  const after = await repository.create(
    baseAsset({
      brandName: "Original Source Korea",
      productName: "Mint Tea Tree Shower Gel Renewed",
      generationRequestKey: "name-after",
    })
  );
  assert.equal(after.asset.brandCode, before.asset.brandCode);
  assert.equal(after.asset.productCode, before.asset.productCode);
});

test("정확한 소재코드 기반 성과 매칭과 검색을 준비한다", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adatlas-creative-assets-match-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createCreativeAssetRepository({ dataDirectory: directory });
  const { asset } = await repository.create(baseAsset({ generationRequestKey: "match-1" }));
  const match = await repository.matchFromText(`전환_${asset.assetCode}_소재`);
  assert.equal(match.status, "matched");
  assert.equal(match.status === "matched" && match.asset.id, asset.id);
  assert.equal((await repository.matchFromText("코드 없는 광고명")).status, "needs-review");
  assert.equal((await repository.list({ brand: "Original", hook: "PRC", dateFrom: "2026-08-12", dateTo: "2026-08-12" })).length, 1);
  assert.equal((await repository.updateStatus(asset.assetCode, "exported")).status, "exported");
});
