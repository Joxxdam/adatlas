import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";

import {
  aggregateProductMetrics,
  deduplicateDailyMetrics,
  isoDateShift,
} from "../app/lib/crema-market/aggregation.ts";
import { buildDevelopmentFixture } from "../app/lib/crema-market/fixture.ts";
import { parseCremaMarketWorkbook } from "../app/lib/crema-market/fileParser.server.ts";
import {
  normalizeDate,
  normalizeMetricRows,
  normalizeProductRows,
  normalizeWorkbookRows,
  nullableNumber,
} from "../app/lib/crema-market/normalizer.ts";
import { runOpportunityAnalysis } from "../app/lib/crema-market/opportunityEngine.ts";
import {
  averageNullable,
  percentile,
  safeChangeRate,
  safeDivide,
  smoothedConversionRate,
  sumNullable,
  weightedAvailableScore,
} from "../app/lib/crema-market/math.ts";
import { buildDataQualityReport } from "../app/lib/crema-market/quality.ts";
import { mergeMetricSnapshots } from "../app/lib/crema-market/syncService.server.ts";

test("null-safe 비율 계산은 0 분모와 미수집 값을 NaN/Infinity로 만들지 않는다", () => {
  assert.equal(safeDivide(2, 0), null);
  assert.equal(safeDivide(null, 4), null);
  assert.equal(safeChangeRate(4, 0), null);
  assert.equal(JSON.stringify({ value: safeDivide(1, 0) }).includes("null"), true);
});

test("미수집 합계는 null이고 실제 0은 0으로 보존한다", () => {
  assert.equal(sumNullable([null, null]), null);
  assert.equal(sumNullable([0, null]), 0);
  assert.equal(averageNullable([null, 2, 4]), 3);
});

test("중앙값과 분위수는 null을 제외하고 결정적으로 계산한다", () => {
  assert.equal(percentile([4, null, 1, 3, 2], 0.5), 2.5);
  assert.equal(percentile([1, 2, 3, 4], 0.75), 3.25);
  assert.equal(percentile([], 0.5), null);
});

test("희소 상품 전환율에 카테고리 사전분포를 적용한다", () => {
  assert.equal(smoothedConversionRate({ orders: 1, views: 0, categoryRate: 0.1, priorStrength: 20 }), 0.15);
  assert.equal(smoothedConversionRate({ orders: null, views: 0, categoryRate: 0.1 }), null);
});

test("가용한 점수 항목만 가중치 재정규화한다", () => {
  assert.equal(weightedAvailableScore([{ value: 80, weight: 3 }, { value: null, weight: 5 }, { value: 20, weight: 1 }]), 65);
  assert.equal(weightedAvailableScore([{ value: null, weight: 1 }]), null);
});

test("숫자와 날짜 정규화가 빈 값을 0으로 바꾸지 않는다", () => {
  assert.equal(nullableNumber(""), null);
  assert.equal(nullableNumber("12,900원"), 12900);
  assert.equal(normalizeDate("2026.8.1"), "2026-08-01");
  assert.equal(normalizeDate("not-a-date"), null);
});

test("한글과 영문 헤더를 동일한 상품 모델로 정규화한다", () => {
  const result = normalizeProductRows({
    advertiserId: "adv",
    provider: "file_upload",
    now: "2026-08-12T00:00:00Z",
    rows: [{ 상품코드: "A-1", 상품명: "민트젤", 카테고리: "뷰티", 판매가: "12,000원", 재고: "", 진열: "예" }],
  });
  assert.equal(result.products[0].code, "A-1");
  assert.equal(result.products[0].finalPrice, 12000);
  assert.equal(result.products[0].stockCount, null);
  assert.equal(result.products[0].display, true);
  assert.equal(result.products[0].provenance.finalPrice, "file_upload");
});

test("상품이나 날짜가 연결되지 않는 지표는 경고 후 제외한다", () => {
  const { products } = normalizeProductRows({ advertiserId: "adv", provider: "file_upload", rows: [{ 상품코드: "A", 상품명: "상품 A" }] });
  const result = normalizeMetricRows({ advertiserId: "adv", products, provider: "file_upload", rows: [{ 상품코드: "B", 날짜: "2026-08-01", 조회수: 4 }, { 상품코드: "A", 날짜: "", 조회수: 3 }] });
  assert.equal(result.metrics.length, 0);
  assert.equal(result.warnings.length, 2);
});

test("중복 일별 지표는 합산하고 업로드 출처를 우선 기록한다", () => {
  const base = { advertiserId: "adv", productId: "p", date: "2026-08-01", impressions: null, views: 4, cartAdds: null, paidOrders: 1, paidQuantity: null, revenue: 1000, refunds: null, refundAmount: null, repeatOrders: null, stockCount: null, reviewCount: null, photoReviewCount: null, ratingSum: null, ratingCount: null };
  const result = deduplicateDailyMetrics([{ ...base, source: "crema_api" }, { ...base, views: 6, paidOrders: 2, source: "file_upload" }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].views, 10);
  assert.equal(result[0].paidOrders, 3);
  assert.equal(result[0].source, "file_upload");
});

test("반복 동기화 스냅샷은 같은 날짜 값을 중복 합산하지 않고 새 값을 교체한다", () => {
  const base = { advertiserId: "adv", productId: "p", date: "2026-08-01", impressions: null, views: null, cartAdds: null, paidOrders: 2, paidQuantity: null, revenue: 2000, refunds: null, refundAmount: null, repeatOrders: null, stockCount: null, reviewCount: null, photoReviewCount: null, ratingSum: null, ratingCount: null, source: "crema_api" };
  const repeated = mergeMetricSnapshots([base], [{ ...base }]);
  assert.equal(repeated[0].paidOrders, 2);
  assert.equal(repeated[0].revenue, 2000);
  const supplemented = mergeMetricSnapshots(repeated, [{ ...base, views: 40, paidOrders: null, revenue: null, source: "file_upload" }]);
  assert.equal(supplemented[0].views, 40);
  assert.equal(supplemented[0].paidOrders, 2);
  assert.equal(supplemented[0].source, "file_upload");
});

test("기간 집계는 퍼널 비율과 평균 평점을 안전하게 계산한다", () => {
  const fixture = buildDevelopmentFixture();
  const productId = fixture.products.find((product) => product.code === "P-004").id;
  const aggregate = aggregateProductMetrics(fixture.dailyMetrics, "2026-07-29", "2026-08-11").find((item) => item.productId === productId);
  assert.ok(aggregate.views > 0);
  assert.ok(aggregate.viewToCartRate > 0);
  assert.ok(aggregate.cartToOrderRate > 0);
  assert.equal(Number.isFinite(aggregate.averageRating), true);
});

test("서울 기준 비교 기간은 현재 기간과 겹치지 않는다", () => {
  assert.equal(isoDateShift("2026-08-01", -1), "2026-07-31");
  assert.equal(isoDateShift("2024-03-01", -1), "2024-02-29");
});

test("XLSX 상품·일별지표·후기 시트를 구분해 읽는다", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 상품코드: "A", 상품명: "A 상품" }]), "상품");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 상품코드: "A", 날짜: "2026-08-01", 조회수: 10 }]), "일별지표");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 상품코드: "A", 후기요약: "좋아요" }]), "후기");
  const parsed = parseCremaMarketWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "metrics.xlsx");
  assert.equal(parsed.productRows.length, 1);
  assert.equal(parsed.metricRows.length, 1);
  assert.equal(parsed.reviewRows.length, 1);
});

test("지표 시트가 없는 XLSX는 성공처럼 처리하지 않는다", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ 상품코드: "A", 상품명: "A 상품" }]), "상품");
  assert.throws(() => parseCremaMarketWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), "products.xlsx"), /일별 지표 시트/);
});

test("개발 fixture는 실제 출처와 명확히 구분되고 28일 상품 지표를 제공한다", () => {
  const fixture = buildDevelopmentFixture();
  assert.equal(fixture.products.length, 7);
  assert.equal(fixture.products.every((product) => Object.values(product.provenance).every((source) => source === "development_fixture")), true);
  assert.equal(new Set(fixture.dailyMetrics.map((metric) => metric.date)).size, 28);
});

test("데이터 품질 리포트는 미수집 필드를 정보로 표시하고 음수를 오류로 표시한다", () => {
  const fixture = buildDevelopmentFixture();
  const report = buildDataQualityReport({ advertiserId: fixture.advertiser.id, products: fixture.products, metrics: [{ ...fixture.dailyMetrics[0], impressions: null, refunds: -1 }] });
  assert.ok(report.issues.some((issue) => issue.code === "FIELD_UNAVAILABLE" && issue.field === "impressions"));
  assert.ok(report.issues.some((issue) => issue.code === "NEGATIVE_METRIC" && issue.field === "refunds"));
  assert.equal(report.usableForAnalysis, false);
});

test("기회 엔진은 현재 14일과 바로 앞 14일을 비교한다", () => {
  const fixture = buildDevelopmentFixture();
  const quality = buildDataQualityReport({ advertiserId: fixture.advertiser.id, products: fixture.products, metrics: fixture.dailyMetrics, now: "2026-08-12T00:00:00Z" });
  const { run } = runOpportunityAnalysis({ advertiserId: fixture.advertiser.id, products: fixture.products, metrics: fixture.dailyMetrics, insights: fixture.reviewInsights, qualityReport: quality, periodDays: 14, now: "2026-08-12T00:00:00Z" });
  assert.equal(run.currentStartsOn, "2026-07-29");
  assert.equal(run.currentEndsOn, "2026-08-11");
  assert.equal(run.previousStartsOn, "2026-07-15");
  assert.equal(run.previousEndsOn, "2026-07-28");
});

test("핵심 기회 유형과 광고 제외 우선순위를 탐지한다", () => {
  const fixture = buildDevelopmentFixture();
  const quality = buildDataQualityReport({ advertiserId: fixture.advertiser.id, products: fixture.products, metrics: fixture.dailyMetrics });
  const result = runOpportunityAnalysis({ advertiserId: fixture.advertiser.id, products: fixture.products, metrics: fixture.dailyMetrics, insights: fixture.reviewInsights, qualityReport: quality, periodDays: 14, now: "2026-08-12T00:00:00Z" });
  const types = new Set(result.opportunities.flatMap((item) => [item.type, ...item.secondaryTypes]));
  for (const expected of ["HIDDEN_WINNER", "RISING_PRODUCT", "SCALE_CANDIDATE", "HIGH_INTEREST_LOW_CONVERSION", "REVIEW_POWERED", "REVIEW_RISK", "REPEAT_PURCHASE", "BUNDLE_CANDIDATE", "NEW_PRODUCT_TEST", "INVENTORY_OPPORTUNITY", "EXCLUDE_FROM_ADS"]) assert.equal(types.has(expected), true, expected);
  const excludedProduct = fixture.products.find((product) => product.code === "P-007");
  const excluded = result.opportunities.filter((item) => item.productId === excludedProduct.id);
  assert.deepEqual(excluded.map((item) => item.type), ["EXCLUDE_FROM_ADS"]);
  assert.equal(excluded[0].status, "excluded");
});

test("상품당 하나의 주 후보와 중복 없는 보조 후보 유형을 저장한다", () => {
  const fixture = buildDevelopmentFixture();
  const quality = buildDataQualityReport({ advertiserId: fixture.advertiser.id, products: fixture.products, metrics: fixture.dailyMetrics });
  const result = runOpportunityAnalysis({ advertiserId: fixture.advertiser.id, products: fixture.products, metrics: fixture.dailyMetrics, insights: fixture.reviewInsights, qualityReport: quality, periodDays: 14, now: "2026-08-12T00:00:00Z" });
  assert.equal(new Set(result.opportunities.map((item) => item.productId)).size, result.opportunities.length);
  assert.equal(result.opportunities.every((item) => item.primaryType === item.type), true);
  assert.equal(result.opportunities.every((item) => new Set(item.secondaryTypes).size === item.secondaryTypes.length), true);
  assert.equal(result.opportunities.every((item) => item.analysisPeriodStart && item.comparisonPeriodStart), true);
});

test("취소·환불을 제외한 순 주문·순매출을 분석 집계에 사용한다", () => {
  const imported = normalizeWorkbookRows({ advertiserId: "adv", advertiserName: "광고주", productRows: [{ 상품코드: "A", 상품명: "A", 상품URL: "https://example.com/a" }], metricRows: [{ 상품코드: "A", 날짜: "2026-08-01", 결제주문수: 10, 매출: 100000, 취소주문: 2, 취소금액: 20000, 환불건수: 1, 환불금액: 10000 }] });
  assert.equal(imported.dailyMetrics[0].netOrders, 7);
  assert.equal(imported.dailyMetrics[0].netRevenue, 70000);
  const aggregate = aggregateProductMetrics(imported.dailyMetrics, "2026-08-01", "2026-08-01")[0];
  assert.equal(aggregate.paidOrders, 7);
  assert.equal(aggregate.revenue, 70000);
});

test("기회 근거는 null/유한 숫자만 포함하고 사람이 읽을 수 있는 메시지를 가진다", () => {
  const fixture = buildDevelopmentFixture();
  const quality = buildDataQualityReport({ advertiserId: fixture.advertiser.id, products: fixture.products, metrics: fixture.dailyMetrics });
  const result = runOpportunityAnalysis({ advertiserId: fixture.advertiser.id, products: fixture.products, metrics: fixture.dailyMetrics, insights: fixture.reviewInsights, qualityReport: quality, periodDays: 14, now: "2026-08-12T00:00:00Z" });
  for (const opportunity of result.opportunities) for (const evidence of opportunity.evidence) {
    assert.equal(evidence.current === null || Number.isFinite(evidence.current), true);
    assert.ok(evidence.message.length > 3);
  }
  assert.equal(JSON.stringify(result).includes("NaN"), false);
  assert.equal(JSON.stringify(result).includes("Infinity"), false);
});

test("통합 정규화는 후기 요약을 원문 개인정보 없이 인사이트로 저장한다", () => {
  const imported = normalizeWorkbookRows({ advertiserId: "adv", advertiserName: "광고주", productRows: [{ 상품코드: "A", 상품명: "A" }], metricRows: [{ 상품코드: "A", 날짜: "2026-08-01", 주문: 1 }], reviewRows: [{ 상품코드: "A", 후기주제: "향", 후기요약: "향이 산뜻함", 긍부정: "긍정", 후기수: 3 }] });
  assert.equal(imported.reviewInsights.length, 1);
  assert.equal(imported.reviewInsights[0].summary, "향이 산뜻함");
  assert.deepEqual(imported.reviewInsights[0].sourceReviewIds, []);
});
