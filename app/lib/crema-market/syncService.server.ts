import { buildWeeklyMetrics, deduplicateDailyMetrics } from "./aggregation.ts";
import { runOpportunityAnalysis } from "./opportunityEngine.ts";
import { buildDataQualityReport } from "./quality.ts";
import { cremaMarketRepository } from "./repository.server.ts";
import type {
  CremaInputProvider,
  CremaMarketDataset,
  CremaMarketImport,
  CremaMarketSyncJob,
} from "./types.ts";

function mergeById<T extends { id: string }>(previous: T[], incoming: T[]) {
  const merged = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) merged.set(item.id, { ...merged.get(item.id), ...item });
  return Array.from(merged.values());
}

export function mergeMetricSnapshots(
  previous: CremaMarketDataset["dailyMetrics"],
  incoming: CremaMarketDataset["dailyMetrics"]
) {
  const merged = new Map(previous.map((metric) => [`${metric.advertiserId}::${metric.productId}::${metric.date}`, metric]));
  for (const metric of deduplicateDailyMetrics(incoming)) {
    const key = `${metric.advertiserId}::${metric.productId}::${metric.date}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, metric);
      continue;
    }
    const next = { ...current, source: metric.source };
    for (const field of [
      "impressions", "views", "cartAdds", "paidOrders", "paidQuantity", "revenue", "refunds",
      "refundAmount", "repeatOrders", "stockCount", "reviewCount", "photoReviewCount", "ratingSum", "ratingCount",
      "productImpressions", "uniqueVisitors", "checkoutStarts", "grossRevenue", "cancelledOrders",
      "cancelledQuantity", "cancelledRevenue", "refundedOrders", "refundedRevenue", "netOrders",
      "netQuantity", "netRevenue", "stockQuantity", "newCustomers", "returningCustomers", "newReviewCount", "averageRating",
    ] as const) {
      if (metric[field] !== null && metric[field] !== undefined) next[field] = metric[field];
    }
    merged.set(key, next);
  }
  return Array.from(merged.values());
}

export async function importAndAnalyzeCremaMarket(params: {
  payload: CremaMarketImport;
  provider: CremaInputProvider;
  periodDays?: 1 | 7 | 14 | 28;
  now?: string;
}) {
  const now = params.now || new Date().toISOString();
  const previous = await cremaMarketRepository.get(params.payload.advertiser.id);
  const syncJob: CremaMarketSyncJob = {
    id: `sync-${params.payload.advertiser.id}-${now.replace(/\D/g, "").slice(0, 14)}`,
    advertiserId: params.payload.advertiser.id,
    provider: params.provider,
    status: params.payload.warnings.some((warning) => !warning.startsWith("FIELD_UNAVAILABLE:")) ? "partial" : "completed",
    startedAt: now,
    completedAt: now,
    productsRead: params.payload.products.length,
    metricsRead: params.payload.dailyMetrics.length,
    reviewsRead: params.payload.reviewMetrics.length,
    warnings: params.payload.warnings,
    error: null,
  };
  const products = mergeById(previous?.products || [], params.payload.products);
  const dailyMetrics = mergeMetricSnapshots(previous?.dailyMetrics || [], params.payload.dailyMetrics);
  const reviewInsights = mergeById(previous?.reviewInsights || [], params.payload.reviewInsights);
  const quality = buildDataQualityReport({ advertiserId: params.payload.advertiser.id, products, metrics: dailyMetrics, now });
  const analyzed = runOpportunityAnalysis({ advertiserId: params.payload.advertiser.id, products, metrics: dailyMetrics, insights: reviewInsights, qualityReport: quality, periodDays: params.periodDays, now });
  const dataset: CremaMarketDataset = {
    advertiser: {
      ...params.payload.advertiser,
      connectionStatus: params.provider === "crema_api"
        ? params.payload.warnings.some((warning) => warning.startsWith("API_PARTIAL:"))
          ? "crema_partial"
          : "crema_connected"
        : "crema_partial",
      provider: params.provider,
      lastSyncedAt: now,
      lastError: null,
    },
    products,
    dailyMetrics,
    weeklyMetrics: buildWeeklyMetrics(dailyMetrics),
    reviewMetrics: [...(previous?.reviewMetrics || []), ...params.payload.reviewMetrics],
    reviewInsights,
    syncJobs: [...(previous?.syncJobs || []), syncJob].slice(-30),
    qualityReports: [...(previous?.qualityReports || []), quality].slice(-30),
    analysisRuns: [...(previous?.analysisRuns || []), analyzed.run].slice(-30),
    opportunities: [
      ...(previous?.opportunities || []).filter((item) => item.analysisRunId !== analyzed.run.id),
      ...analyzed.opportunities,
    ],
    updatedAt: now,
  };
  await cremaMarketRepository.save(dataset);
  return { dataset, syncJob, quality, analysis: analyzed.run, opportunities: analyzed.opportunities };
}

export async function saveCremaConnectionError(params: { advertiserId: string; advertiserName: string; error: string }) {
  const now = new Date().toISOString();
  const previous = await cremaMarketRepository.get(params.advertiserId);
  const dataset: CremaMarketDataset = previous || {
    advertiser: { id: params.advertiserId, name: params.advertiserName, brandName: params.advertiserName, domain: null, timezone: "Asia/Seoul", connectionStatus: "crema_error", provider: null, lastSyncedAt: null, lastError: params.error },
    products: [], dailyMetrics: [], weeklyMetrics: [], reviewMetrics: [], reviewInsights: [], syncJobs: [], qualityReports: [], analysisRuns: [], opportunities: [], updatedAt: now,
  };
  dataset.advertiser.connectionStatus = "crema_error";
  dataset.advertiser.lastError = params.error.slice(0, 500);
  dataset.updatedAt = now;
  await cremaMarketRepository.save(dataset);
  return dataset;
}
