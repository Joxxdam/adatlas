import assert from "node:assert/strict";
import test from "node:test";

import {
  assertReadOnlyBigQuery,
  BigQueryReadOnlyError,
} from "../app/lib/bigquery/readonlyGuard.ts";
import { buildCandidatesFromSignals } from "../app/lib/bigquery/scoring.ts";

const allowedSql = `
SELECT BRAND_NAME, SUM(PURCHASE_AMOUNT) AS sales
FROM \`first-project-394906.FACT_HOST24.PRODUCT\`
WHERE BRAND_NAME = @brandName
GROUP BY BRAND_NAME
LIMIT @rowLimit
`;

test("BigQuery 가드는 허용 테이블의 named-parameter SELECT만 통과시킨다", () => {
  const result = assertReadOnlyBigQuery({
    sql: allowedSql,
    namedParameters: { brandName: "오리지널소스", rowLimit: 10 },
  });
  assert.deepEqual(result.parameterNames.sort(), ["brandName", "rowLimit"]);
  assert.deepEqual(result.references, ["first-project-394906.FACT_HOST24.PRODUCT"]);
});

test("BigQuery 가드는 WITH로 시작하는 단일 SELECT를 허용한다", () => {
  const result = assertReadOnlyBigQuery({
    sql: `WITH filtered AS (
      SELECT BRAND_NAME FROM \`first-project-394906.FACT_HOST24.PRODUCT\`
      WHERE BRAND_NAME = @brandName
    ) SELECT BRAND_NAME FROM filtered WHERE @rowLimit > 0`,
    namedParameters: { brandName: "오리지널소스", rowLimit: 10 },
  });
  assert.equal(result.references.length, 1);
});

for (const keyword of [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "CREATE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CALL",
]) {
  test(`BigQuery 가드는 ${keyword} 명령을 차단한다`, () => {
    assert.throws(
      () =>
        assertReadOnlyBigQuery({
          sql: `${keyword} \`first-project-394906.FACT_HOST24.PRODUCT\` WHERE @guard = @guard`,
          namedParameters: { guard: true },
        }),
      BigQueryReadOnlyError
    );
  });
}

for (const [name, sql] of [
  ["다중 SQL", `${allowedSql.trim()}; SELECT BRAND_NAME FROM \`first-project-394906.FACT_HOST24.PRODUCT\` WHERE BRAND_NAME = @brandName`],
  ["SELECT 별표", "SELECT * FROM `first-project-394906.FACT_HOST24.PRODUCT` WHERE BRAND_NAME = @brandName"],
  ["별칭 SELECT 별표", "SELECT p.* FROM `first-project-394906.FACT_HOST24.PRODUCT` AS p WHERE BRAND_NAME = @brandName"],
  ["미허용 테이블", "SELECT name FROM `other-project.dataset.table` WHERE name = @name"],
]) {
  test(`BigQuery 가드는 ${name}를 차단한다`, () => {
    assert.throws(
      () => assertReadOnlyBigQuery({ sql, namedParameters: { brandName: "브랜드", name: "값" } }),
      BigQueryReadOnlyError
    );
  });
}

test("SQL 형태의 사용자 값은 named parameter 값으로만 전달되어 쿼리 구조를 바꾸지 않는다", () => {
  const result = assertReadOnlyBigQuery({
    sql: allowedSql,
    namedParameters: {
      brandName: "브랜드'; DELETE FROM target --",
      rowLimit: 10,
    },
  });
  assert.equal(result.parameterNames.includes("brandName"), true);
});

test("BigQuery 가드는 누락된 named parameter와 위치 매개변수를 차단한다", () => {
  assert.throws(
    () => assertReadOnlyBigQuery({ sql: allowedSql, namedParameters: { brandName: "브랜드" } }),
    /rowLimit/
  );
  assert.throws(
    () =>
      assertReadOnlyBigQuery({
        sql: "SELECT BRAND_NAME FROM `first-project-394906.FACT_HOST24.PRODUCT` WHERE BRAND_NAME = ? AND @guard = @guard",
        namedParameters: { guard: true },
      }),
    /위치 기반/
  );
});

test("후보 점수는 사용 가능한 판매·노출 지표만 쓰고 후기·가격을 만들지 않는다", () => {
  const rows = [
    {
      productName: "민트 샤워젤(65)",
      productIdHint: "65",
      currentSales: 12_000_000,
      previousSales: 8_000_000,
      currentExposures: 5_000,
      previousExposures: 4_000,
      currentPurchases: 400,
      previousPurchases: 280,
      currentCarts: 600,
      conversionRate: 0.08,
      salesChangeRate: 0.5,
      averageExposures: 8_000,
      brandConversionRate: 0.04,
      salesRank: 1,
      productCount: 20,
      latestDate: "2026-08-13",
    },
  ];
  const candidates = buildCandidatesFromSignals(rows, {
    advertiserId: "advertiser",
    source: "host24",
    brandId: "17451",
    brandName: "오리지널소스",
    category: "뷰티",
    analysisPeriodStart: "2026-07-17",
    analysisPeriodEnd: "2026-08-13",
    comparisonPeriodStart: "2026-06-19",
    comparisonPeriodEnd: "2026-07-16",
    sourceTable: "first-project-394906.FACT_HOST24.PRODUCT",
    candidateId: () => "candidate",
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reviewCount, null);
  assert.equal(candidates[0].productUrl, null);
  assert.equal(candidates[0].imageUrl, null);
  assert.equal(candidates[0].secondaryTypes.includes("review-strength"), false);
  assert.equal(Number.isFinite(candidates[0].score), true);
  assert.ok(candidates[0].score >= 0 && candidates[0].score <= 100);
});
