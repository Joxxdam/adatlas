import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveProductDetailOcrBudget, selectProductDetailOcrCandidates } from "../app/lib/mvp/productDetailOcrSelection.ts";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function candidate(id, overrides = {}) {
  return {
    url: `https://cdn.example.com/${id}.jpg`,
    type: "detail",
    score: 50,
    pageOrder: 0,
    evidenceRoles: ["unknown"],
    evidenceScope: "product-detail",
    ...overrides,
  };
}

test("OCR 8장은 대표 이미지 한 장에 편중되지 않고 상세페이지 앞·중간·뒤를 나눠 읽는다", () => {
  const mains = Array.from({ length: 5 }, (_, index) => candidate(`main-${index}`, {
    // 추출 라우트는 OCR 검증 대상으로 전달할 때 type은 detail로 정규화하지만
    // evidenceScope으로 구조화 대표 이미지임을 보존합니다.
    type: "detail",
    score: 100 - index,
    pageOrder: index,
    evidenceRoles: ["identity"],
    evidenceScope: "structured-main",
  }));
  const details = Array.from({ length: 12 }, (_, index) => candidate(`detail-${index}`, { pageOrder: 100 + index }));
  const selected = selectProductDetailOcrCandidates([...mains, ...details], 8);
  assert.equal(selected.length, 8);
  assert.equal(selected.filter((item) => item.evidenceScope === "structured-main").length, 1);
  assert.ok(selected.some((item) => item.url.endsWith("detail-0.jpg")));
  assert.ok(selected.some((item) => item.url.endsWith("detail-11.jpg")));
});

test("가격·구성·장점·원료·사용법 근거가 있으면 서로 다른 OCR 후보를 우선 확보한다", () => {
  const roles = ["offer", "composition", "benefit", "ingredient", "usage"];
  const selected = selectProductDetailOcrCandidates(
    roles.map((role, index) => candidate(role, { evidenceRoles: [role], pageOrder: index })),
    5
  );
  assert.deepEqual(new Set(selected.flatMap((item) => item.evidenceRoles)), new Set(roles));
});

test("사전 조사본은 실시간 OCR을 생략하고 일반·이미지형 상세페이지는 최대 8장 안에서 적응한다", () => {
  assert.equal(resolveProductDetailOcrBudget({ hasCuratedResearch: true, htmlFactCount: 0, candidateCount: 30 }), 0);
  assert.equal(resolveProductDetailOcrBudget({ hasCuratedResearch: false, htmlFactCount: 9, candidateCount: 30 }), 4);
  assert.equal(resolveProductDetailOcrBudget({ hasCuratedResearch: false, htmlFactCount: 6, candidateCount: 30 }), 6);
  assert.equal(resolveProductDetailOcrBudget({ hasCuratedResearch: false, htmlFactCount: 2, candidateCount: 30 }), 8);
});

test("수동과 자동제작은 동일한 상품 추출·OCR 선택·ProductTruth 생성 경계를 사용한다", async () => {
  const [dashboard, extractRoute, directRun, productSource, jobFactory] = await Promise.all([
    read("app/components/MvpDashboard.tsx"),
    read("app/api/extract/product/route.ts"),
    read("app/api/auto-production/run/route.ts"),
    read("app/lib/auto-production/productSource.server.ts"),
    read("app/lib/creative-generation/createNativeGenerationJob.server.ts"),
  ]);
  assert.match(dashboard, /fetch\("\/api\/extract\/product"/);
  assert.match(extractRoute, /resolveProductDetailOcrBudget/);
  assert.match(extractRoute, /maxCandidates: detailOcrBudget/);
  assert.match(directRun, /POST as extractProduct/);
  assert.match(productSource, /POST as extractProduct/);
  assert.match(jobFactory, /buildProductTruth/);
});
