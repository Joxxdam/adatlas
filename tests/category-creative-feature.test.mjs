import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { defaultFashionCategories, normalizeProductCategory, resolveFashionCategorySelection } from "../app/lib/category-candidates/normalization.ts";
import { categoryStatusLabels, classifyCategoryTrend } from "../app/lib/category-candidates/policy.ts";

function row(overrides = {}) {
  return {
    productName: "가디건",
    current7Sales: 120,
    previous7Sales: 80,
    current7Orders: 12,
    previous7Orders: 8,
    weeklySales: [120, 80, 70, 60],
    weeklyOrders: [12, 8, 7, 6],
    ...overrides,
  };
}

test("카테고리 정규화는 원본 상품명을 바꾸지 않고 별도 카테고리만 반환한다", () => {
  const productName = "레이스 리본 가디건";
  const result = normalizeProductCategory(productName);
  assert.equal(productName, "레이스 리본 가디건");
  assert.equal(result.id, "fashion.cardigans");
  assert.ok(defaultFashionCategories.some((category) => category.id === result.id));
});

test("미분류 제작 링크는 화면에 표시된 지원 카테고리와 실제 요청값을 일치시킨다", async () => {
  assert.equal(resolveFashionCategorySelection("fashion.uncategorized", "미분류").id, "fashion.tops");
  assert.equal(resolveFashionCategorySelection("fashion.uncategorized", "원피스").id, "fashion.dresses");
  const [candidateWorkspace, creativeWorkspace] = await Promise.all([
    readFile(new URL("../app/components/category-candidates/CategoryCandidateWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/category-creatives/CategoryCreativeWorkspace.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(candidateWorkspace, /resolveFashionCategorySelection/);
  assert.match(creativeWorkspace, /resolveFashionCategorySelection\(props\.initialCategoryId, props\.initialCategoryName\)/);
});

test("최근 7일과 4주가 함께 상승하면 상승 상태로 분류한다", () => {
  assert.equal(classifyCategoryTrend([row(), row({ productName: "니트 가디건" })]), "rising");
  assert.equal(categoryStatusLabels.rising, "상승");
});

test("근거 상품이 한 개뿐이면 수치가 커도 데이터 부족으로 표시한다", () => {
  assert.equal(classifyCategoryTrend([row()]), "insufficient");
});

test("카테고리 이미지 API는 기존 상품 광고 GenerationJob을 호출하지 않는다", async () => {
  const [service, route, navigation] = await Promise.all([
    readFile(new URL("../app/lib/category-creatives/service.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/category-creatives/jobs/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/AppFeatureNavigation.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(service + route, /createNativeGenerationJob|GenerationJob|HookPlan|ReferenceAdaptedCopyPlan|H01|H06/);
  assert.match(navigation, /카테고리 이미지/);
  assert.match(navigation, /\/category-images/);
});

test("카테고리 도메인은 BigQuery·Meta 쓰기 경로를 호출하지 않는다", async () => {
  const [candidateRepository, categoryService, categoryRoute] = await Promise.all([
    readFile(new URL("../app/lib/category-candidates/repository.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/category-creatives/service.server.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/category-creatives/jobs/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(candidateRepository, /runReadOnlyBigQuery/);
  assert.doesNotMatch(candidateRepository, /\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|DROP)\b/i);
  assert.doesNotMatch(categoryService + categoryRoute, /\/api\/meta|registerMeta|createAdSet|createCampaign/i);
});

test("선택 원본은 동일 광고주·카테고리로 제한한다", async () => {
  const service = await readFile(new URL("../app/lib/category-creatives/service.server.ts", import.meta.url), "utf8");
  assert.match(service, /source\?\.advertiserId !== input\.advertiserId/);
  assert.match(service, /source\?\.categoryId !== input\.categoryId/);
  assert.match(service, /sourceIds\.length < 3/);
  assert.match(service, /slice\(0, 5\)/);
});

test("두 결과 규격과 문구 전용 재렌더 경로가 고정되어 있다", async () => {
  const [types, composer] = await Promise.all([
    readFile(new URL("../app/lib/category-creatives/types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/category-creatives/composer.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(types, /width: 1200/);
  assert.match(types, /height: 1200/);
  assert.match(types, /width: 1080/);
  assert.match(types, /height: 1920/);
  assert.match(composer, /rerenderCategoryCreativeCopy/);
  assert.match(composer, /`\$\{ratio\}-base\.png`/);
  assert.match(composer, /renderFinal\(job, "square"/);
  assert.match(composer, /renderFinal\(job, "vertical"/);
});

test("카테고리 이미지 아카이브는 작업별 결과 삭제를 지원하고 원본 소스는 별도로 보존한다", async () => {
  const [archive, route, repository] = await Promise.all([
    readFile(new URL("../app/components/category-creatives/CategoryCreativeArchive.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/category-creatives/jobs/[jobId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/category-creatives/repository.server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(archive, /method: "DELETE"/);
  assert.match(archive, /이미지 삭제/);
  assert.match(archive, /원본 상품 이미지는 유지됩니다/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /deleteCategoryCreativeJob/);
  assert.match(repository, /export async function deleteCategoryCreativeJob/);
  assert.match(repository, /fs\.rm\(directory, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(repository.match(/export async function deleteCategoryCreativeJob[\s\S]*?return true;/)?.[0] || "", /sourceRoot|sourceIndexPath/);
});
