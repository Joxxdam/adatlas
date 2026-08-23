import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertReadOnlyBigQuery, BigQueryReadOnlyError } from "../app/lib/bigquery/readonlyGuard.ts";
import { buildCandidatesFromSignals, buildProductFamilies, detectOfferVariant, normalizeProductFamilyName, resolveBigQueryProductUrl } from "../app/lib/bigquery/scoring.ts";
import { assertInternalApiAccess, InternalApiAccessError } from "../app/lib/internal-api/access.server.ts";

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

for (const keyword of ["INSERT", "UPDATE", "DELETE", "MERGE", "CREATE", "DROP", "ALTER", "TRUNCATE", "CALL", "EXPORT", "LOAD", "EXECUTE", "REPLACE", "COPY", "GRANT", "REVOKE", "BEGIN", "COMMIT", "ROLLBACK"]) {
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
  ["행 주석 우회", "SELECT BRAND_NAME FROM `first-project-394906.FACT_HOST24.PRODUCT` -- DELETE\n WHERE BRAND_NAME = @brandName"],
  ["블록 주석 우회", "SELECT BRAND_NAME /* UPDATE */ FROM `first-project-394906.FACT_HOST24.PRODUCT` WHERE BRAND_NAME = @brandName"],
  ["해시 주석 우회", "SELECT BRAND_NAME FROM `first-project-394906.FACT_HOST24.PRODUCT` # DROP\n WHERE BRAND_NAME = @brandName"],
]) {
  test(`BigQuery 가드는 ${name}를 차단한다`, () => {
    assert.throws(() => assertReadOnlyBigQuery({ sql, namedParameters: { brandName: "브랜드", name: "값" } }), BigQueryReadOnlyError);
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

test("내부 BigQuery API 접근은 개발 환경에서 열리고 production 설정 누락 시 fail-closed 된다", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousToken = process.env.ADATLAS_INTERNAL_API_TOKEN;
  try {
    process.env.NODE_ENV = "development";
    assert.doesNotThrow(() => assertInternalApiAccess(new Request("http://localhost/api")));

    process.env.NODE_ENV = "production";
    delete process.env.ADATLAS_INTERNAL_API_TOKEN;
    assert.throws(
      () => assertInternalApiAccess(new Request("https://example.com/api")),
      (error) => error instanceof InternalApiAccessError && error.status === 503
    );

    process.env.ADATLAS_INTERNAL_API_TOKEN = "server-only-test-token";
    assert.throws(
      () => assertInternalApiAccess(new Request("https://example.com/api")),
      (error) => error instanceof InternalApiAccessError && error.status === 401
    );
    assert.doesNotThrow(() =>
      assertInternalApiAccess(
        new Request("https://example.com/api", {
          headers: { Authorization: "Bearer server-only-test-token" },
        })
      )
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousToken === undefined) delete process.env.ADATLAS_INTERNAL_API_TOKEN;
    else process.env.ADATLAS_INTERNAL_API_TOKEN = previousToken;
  }
});

test("BigQuery 가드는 누락된 named parameter와 위치 매개변수를 차단한다", () => {
  assert.throws(() => assertReadOnlyBigQuery({ sql: allowedSql, namedParameters: { brandName: "브랜드" } }), /rowLimit/);
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

test("후보 상품 ID와 쇼핑몰 주소를 제작 화면용 상세 URL로 보존한다", () => {
  assert.equal(
    resolveBigQueryProductUrl({
      source: "host24",
      storeUrl: "https://originalsource.co.kr/category/쇼핑/91/",
      productId: "65",
    }),
    "https://originalsource.co.kr/product/detail.html?product_no=65"
  );
  assert.equal(
    resolveBigQueryProductUrl({
      source: "hostmk",
      storeUrl: "https://shop.example.com/wn/",
      productId: "9012",
    }),
    "https://shop.example.com/shop/shopdetail.html?branduid=9012"
  );
  assert.equal(
    resolveBigQueryProductUrl({
      source: "host24",
      storeUrl: "javascript:alert(1)",
      productId: "65",
    }),
    null
  );

  const candidates = buildCandidatesFromSignals(
    [
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
    ],
    {
      advertiserId: "advertiser",
      source: "host24",
      brandId: "17451",
      brandName: "오리지널소스",
      category: "뷰티",
      storeUrl: "https://originalsource.co.kr/category/쇼핑/91/",
      analysisPeriodStart: "2026-07-17",
      analysisPeriodEnd: "2026-08-13",
      comparisonPeriodStart: "2026-06-19",
      comparisonPeriodEnd: "2026-07-16",
      sourceTable: "first-project-394906.FACT_HOST24.PRODUCT",
      candidateId: () => "candidate-with-url",
    }
  );
  assert.equal(candidates[0].productUrl, "https://originalsource.co.kr/product/detail.html?product_no=65");
});

const candidateContext = {
  advertiserId: "original-source",
  source: "host24",
  brandId: "17451",
  brandName: "오리지널소스",
  category: "뷰티",
  analysisPeriodStart: "2026-07-17",
  analysisPeriodEnd: "2026-08-13",
  comparisonPeriodStart: "2026-06-19",
  comparisonPeriodEnd: "2026-07-16",
  sourceTable: "first-project-394906.FACT_HOST24.PRODUCT",
  candidateId: (row) => `candidate-${row.productIdHint || row.productName}`,
};

function signal(overrides) {
  return {
    productName: "테스트 상품",
    productIdHint: null,
    currentSales: 300_000,
    previousSales: 300_000,
    currentExposures: 2_000,
    previousExposures: 2_000,
    currentPurchases: 60,
    previousPurchases: 60,
    currentCarts: 100,
    conversionRate: 0.03,
    salesChangeRate: 0,
    averageExposures: 5_000,
    brandConversionRate: 0.03,
    salesRank: 5,
    purchaseRank: 5,
    productCount: 10,
    recent4WeekSales: 300_000,
    previous4WeekSales: 300_000,
    recent8WeekSales: 600_000,
    recent12WeekSales: 900_000,
    recent4WeekPurchases: 60,
    previous4WeekPurchases: 60,
    periodsAvailable: 3,
    latestDate: "2026-08-13",
    ...overrides,
  };
}

const originalSourceRows = [
  signal({
    productName: "오리지널소스 민트티트리 샤워젤 250ml",
    productIdHint: "65",
    currentSales: 4_000_000,
    previousSales: 5_500_000,
    currentExposures: 6_000,
    previousExposures: 6_300,
    currentPurchases: 300,
    previousPurchases: 390,
    currentCarts: 510,
    conversionRate: 0.05,
    salesChangeRate: -0.273,
    salesRank: 1,
    purchaseRank: 1,
    recent4WeekSales: 4_000_000,
    previous4WeekSales: 5_500_000,
    recent8WeekSales: 9_500_000,
    recent12WeekSales: 14_800_000,
  }),
  signal({
    productName: "오리지널소스 민트티트리 샤워젤 250ml 2+1",
    productIdHint: "6501",
    currentSales: 3_000_000,
    previousSales: 2_500_000,
    currentExposures: 4_000,
    previousExposures: 3_800,
    currentPurchases: 240,
    previousPurchases: 190,
    currentCarts: 390,
    conversionRate: 0.06,
    salesChangeRate: 0.2,
    salesRank: 2,
    purchaseRank: 2,
    recent4WeekSales: 3_000_000,
    previous4WeekSales: 2_500_000,
    recent8WeekSales: 5_500_000,
    recent12WeekSales: 7_700_000,
  }),
  signal({
    productName: "오리지널소스 레몬 샤워젤 250ml",
    productIdHint: "66",
    currentSales: 300_000,
    previousSales: 250_000,
    currentExposures: 500,
    previousExposures: 420,
    currentPurchases: 40,
    previousPurchases: 28,
    currentCarts: 70,
    conversionRate: 0.08,
    salesChangeRate: 0.2,
    salesRank: 6,
    purchaseRank: 6,
  }),
  signal({
    productName: "오리지널소스 코코넛 샤워젤 250ml",
    productIdHint: "67",
    currentSales: 500_000,
    previousSales: 520_000,
    currentExposures: 10_000,
    previousExposures: 9_500,
    currentPurchases: 30,
    previousPurchases: 34,
    currentCarts: 210,
    conversionRate: 0.003,
    salesChangeRate: -0.038,
    salesRank: 5,
    purchaseRank: 5,
  }),
  signal({
    productName: "오리지널소스 라임 샤워젤 250ml",
    productIdHint: "68",
    currentSales: 2_000_000,
    previousSales: 2_000_000,
    currentExposures: 4_500,
    currentPurchases: 180,
    currentCarts: 260,
    conversionRate: 0.04,
    salesChangeRate: 0,
    salesRank: 3,
    purchaseRank: 3,
  }),
];

test("오리지널소스 주력 단품 하락은 핵심 회복, 상위 혜택상품은 핵심 확장으로 분류한다", () => {
  const candidates = buildCandidatesFromSignals(originalSourceRows, candidateContext);
  const mint = candidates.find((item) => item.productId === "65");
  const mintOffer = candidates.find((item) => item.productId === "6501");
  assert.equal(mint?.primaryType, "core-recovery");
  assert.ok((mint?.recommendationScore || 0) > 55);
  assert.deepEqual(mint?.recommendedHookTypes, ["강한 감각형", "문제해결형", "성분·USP형"]);
  assert.equal(mintOffer?.primaryType, "core-scale");
  assert.equal(mintOffer?.offerVariant, "two-plus-one");
  assert.ok(mintOffer?.recommendedHookTypes.includes("가격·혜택형"));
  assert.equal(candidates[0].productId, "65");
});

test("저노출·고효율은 최소 기준 충족 시에만 숨은 잠재 상품이 된다", () => {
  const qualified = buildCandidatesFromSignals(originalSourceRows, candidateContext).find((item) => item.productId === "66");
  const underMinimum = buildCandidatesFromSignals(
    [
      signal({
        productName: "소량 반응 상품",
        currentSales: 20_000,
        currentExposures: 20,
        currentPurchases: 2,
        currentCarts: 2,
        conversionRate: 0.1,
        averageExposures: 1_000,
        brandConversionRate: 0.02,
        salesRank: 9,
        purchaseRank: 9,
      }),
    ],
    candidateContext
  );
  assert.equal(qualified?.primaryType, "hidden-potential");
  assert.equal(underMinimum.length, 0);
});

test("고노출·저효율이면서 사업 기여가 있는 상품은 콘텐츠 개선 후보가 된다", () => {
  const candidate = buildCandidatesFromSignals(originalSourceRows, candidateContext).find((item) => item.productId === "67");
  assert.equal(candidate?.primaryType, "creative-improvement");
  assert.ok(candidate?.recommendedHookTypes.includes("문제해결형"));
});

test("0% 성장과 기간 비교 불가는 나머지 근거를 재정규화해 정상 점수를 만든다", () => {
  const stableCandidate = buildCandidatesFromSignals(originalSourceRows, candidateContext).find((item) => item.productId === "68");
  const noPrevious = buildCandidatesFromSignals(
    [
      signal({
        productName: "새 비교기간 상품",
        currentSales: 1_000_000,
        previousSales: 0,
        previousPurchases: 0,
        salesChangeRate: null,
        recent4WeekSales: 1_000_000,
        previous4WeekSales: 0,
        previous4WeekPurchases: 0,
        recent8WeekSales: 1_000_000,
        recent12WeekSales: 1_000_000,
        periodsAvailable: 1,
        salesRank: 1,
        purchaseRank: 1,
      }),
    ],
    candidateContext
  )[0];
  assert.equal(stableCandidate?.trendState, "stable");
  assert.ok((stableCandidate?.recommendationScore || 0) >= 60);
  assert.ok(Number.isFinite(noPrevious.recommendationScore));
  assert.equal(noPrevious.scoreBreakdown.positiveMomentumScore, null);
});

test("매출·구매 비중과 상품군 합산을 계산하고 향이 다른 상품은 합치지 않는다", () => {
  const candidates = buildCandidatesFromSignals(originalSourceRows, candidateContext);
  const mint = candidates.find((item) => item.productId === "65");
  const totalSales = originalSourceRows.reduce((sum, row) => sum + row.currentSales, 0);
  assert.equal(Number(mint?.salesShare.toFixed(6)), Number((4_000_000 / totalSales).toFixed(6)));
  const families = buildProductFamilies(originalSourceRows);
  const mintFamily = families.find((family) => family.productNames.includes("오리지널소스 민트티트리 샤워젤 250ml"));
  assert.equal(mintFamily?.productNames.length, 2);
  assert.equal(mintFamily?.totalSales, 7_000_000);
  assert.equal(mintFamily?.totalPurchases, 540);
  assert.notEqual(normalizeProductFamilyName("오리지널소스 민트티트리 샤워젤 250ml"), normalizeProductFamilyName("오리지널소스 레몬 샤워젤 250ml"));
});

test("혜택 구성 표현을 offerVariant로 감지한다", () => {
  assert.equal(detectOfferVariant("민트 샤워젤 2+1").variant, "two-plus-one");
  assert.equal(detectOfferVariant("민트 샤워젤 세트").variant, "set");
  assert.equal(detectOfferVariant("민트 샤워젤 5종 SET").variant, "set");
  assert.equal(detectOfferVariant("민트 샤워젤 기획팩").variant, "planning-pack");
});

test("BigQuery 업체 화면은 부정적인 기술 충분도 문구를 노출하지 않는다", async () => {
  const source = await readFile(new URL("../app/components/bigquery/BigQueryCandidateWorkspace.tsx", import.meta.url), "utf8");
  for (const phrase of ["신뢰도 낮음", "데이터 부족", "표본 부족", "검증 불충분", "신뢰할 수 없음"]) {
    assert.equal(source.includes(phrase), false, `${phrase} 문구가 UI에 남아 있습니다.`);
  }
  assert.match(source, /광고 추천도/);
  assert.match(source, /이 상품으로 후킹 6개 만들기/);
});
