import "server-only";

import { decodeBigQueryAdvertiserId } from "../bigquery/repository.server";
import { listBigQueryAdvertisers } from "../bigquery/candidateService.server";
import { readBigQueryCache, writeBigQueryCache } from "../bigquery/cache.server";
import { normalizeProductCategory } from "./normalization";
import { categoryStatusLabels, classifyCategoryTrend } from "./policy";
import { queryCategoryProductSignals } from "./repository.server";
import type { CategoryCandidate, CategoryCandidateResponse, CategoryMetricRow } from "./types";

function rate(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous : null;
}

export async function analyzeCategoryCandidates(advertiserId: string) {
  const advertiser = decodeBigQueryAdvertiserId(advertiserId);
  if (!advertiser) throw new Error("지원하지 않는 광고주 식별자입니다.");
  const cacheKey = `category-candidates:v1:${advertiserId}`;
  const cached = readBigQueryCache<CategoryCandidateResponse>(cacheKey);
  if (cached) return { ...cached, cacheHit: true, processedBytes: 0 };
  const advertisers = await listBigQueryAdvertisers();
  const catalogEntry = advertisers.advertisers.find((item) => item.id === advertiserId);
  if (!catalogEntry) throw new Error("선택한 광고주의 최신 집계 데이터를 찾지 못했습니다.");
  const currentEnd = catalogEntry.latestDataDate;
  const result = await queryCategoryProductSignals({ ...advertiser, currentEnd });
  const response = buildCategoryCandidateResponse(advertiserId, advertiser, currentEnd, result);
  writeBigQueryCache(cacheKey, response, 4 * 60 * 1_000);
  return response;
}

function buildCategoryCandidateResponse(
  advertiserId: string,
  advertiser: { source: "host24" | "hostmk"; brandName: string },
  currentEnd: string,
  result: Awaited<ReturnType<typeof queryCategoryProductSignals>>
): CategoryCandidateResponse {
  const grouped = new Map<string, { name: string; rows: CategoryMetricRow[] }>();
  for (const row of result.rows) {
    const category = normalizeProductCategory(row.productName);
    const group = grouped.get(category.id) || { name: category.name, rows: [] };
    group.rows.push(row);
    grouped.set(category.id, group);
  }
  const brandSales = result.rows.reduce((sum, row) => sum + row.current7Sales, 0);
  const candidates: CategoryCandidate[] = [...grouped.entries()]
    .map(([categoryId, group]) => {
      const current7Sales = group.rows.reduce((sum, row) => sum + row.current7Sales, 0);
      const previous7Sales = group.rows.reduce((sum, row) => sum + row.previous7Sales, 0);
      const current7Orders = group.rows.reduce((sum, row) => sum + row.current7Orders, 0);
      const previous7Orders = group.rows.reduce((sum, row) => sum + row.previous7Orders, 0);
      const weeklySales = [0, 1, 2, 3].map((index) => group.rows.reduce((sum, row) => sum + row.weeklySales[index], 0)) as [number, number, number, number];
      const weeklyOrders = [0, 1, 2, 3].map((index) => group.rows.reduce((sum, row) => sum + row.weeklyOrders[index], 0)) as [number, number, number, number];
      const status = classifyCategoryTrend(group.rows);
      const topProductSales = Math.max(0, ...group.rows.map((row) => row.current7Sales));
      return {
        id: `${advertiserId}:${categoryId}`,
        advertiserId,
        advertiserName: advertiser.brandName,
        categoryId,
        categoryName: group.name,
        originalCategorySignals: group.rows.slice(0, 8).map((row) => row.productName),
        status,
        statusLabel: categoryStatusLabels[status],
        current7Sales,
        previous7Sales,
        current7Orders,
        previous7Orders,
        salesChangeRate: rate(current7Sales, previous7Sales),
        orderChangeRate: rate(current7Orders, previous7Orders),
        weeklySales,
        weeklyOrders,
        activeProductCount: group.rows.length,
        advertiserSalesShare: brandSales > 0 ? current7Sales / brandSales : 0,
        topProductConcentration: current7Sales > 0 ? topProductSales / current7Sales : 0,
        evidenceProducts: group.rows.sort((a, b) => b.current7Sales - a.current7Sales).slice(0, 5).map((row) => row.productName),
        reason: `${categoryStatusLabels[status]} 흐름 · 최근 7일 주문 ${current7Orders.toLocaleString("ko-KR")}건 · 활성 상품 ${group.rows.length}개`,
        peerComparison: { available: false, label: "동급 업체 비교 데이터 부족", reason: "현재 읽기 전용 원본에는 신뢰 가능한 공통 카테고리 키가 없어 임의 비교하지 않았습니다." },
      };
    })
    .sort((a, b) => b.current7Sales - a.current7Sales);
  return {
    advertiser: { id: advertiserId, name: advertiser.brandName, source: advertiser.source },
    candidates,
    latestDataDate: result.rows[0]?.latestDate || currentEnd,
    processedBytes: result.processedBytes,
    cacheHit: result.cacheHit,
    generatedAt: new Date().toISOString(),
  };
}
