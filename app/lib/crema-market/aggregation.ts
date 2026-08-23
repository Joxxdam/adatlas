import type { ProductDailyMetric, ProductWeeklyMetric } from "./types.ts";
import { safeDivide, sumNullable } from "./math.ts";

export type AggregatedProductMetric = Omit<ProductDailyMetric, "date" | "source" | "ratingSum" | "ratingCount"> & {
  startsOn: string;
  endsOn: string;
  ratingSum: number | null;
  ratingCount: number | null;
  averageRating: number | null;
  viewToCartRate: number | null;
  cartToOrderRate: number | null;
  viewToOrderRate: number | null;
  refundRate: number | null;
};

export function isoDateShift(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function latestMetricDate(metrics: ProductDailyMetric[], fallback = new Date()) {
  const latest = metrics
    .map((metric) => metric.date)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (latest) return latest;
  const seoul = new Date(fallback.getTime() + 9 * 60 * 60 * 1000);
  return seoul.toISOString().slice(0, 10);
}

function inRange(date: string, startsOn: string, endsOn: string) {
  return date >= startsOn && date <= endsOn;
}

export function aggregateProductMetrics(metrics: ProductDailyMetric[], startsOn: string, endsOn: string): AggregatedProductMetric[] {
  const byProduct = new Map<string, ProductDailyMetric[]>();
  for (const metric of metrics) {
    if (!inRange(metric.date, startsOn, endsOn)) continue;
    const rows = byProduct.get(metric.productId) || [];
    rows.push(metric);
    byProduct.set(metric.productId, rows);
  }
  return Array.from(byProduct, ([productId, rows]) => {
    const total = (field: keyof ProductDailyMetric) => sumNullable(rows.map((row) => (typeof row[field] === "number" ? (row[field] as number) : null)));
    const ratingSum = total("ratingSum");
    const ratingCount = total("ratingCount");
    const views = total("views");
    const cartAdds = total("cartAdds");
    const paidOrders = total("netOrders") ?? total("paidOrders");
    const refunds = total("refunds");
    return {
      advertiserId: rows[0].advertiserId,
      productId,
      startsOn,
      endsOn,
      impressions: total("impressions"),
      views,
      cartAdds,
      paidOrders,
      paidQuantity: total("netQuantity") ?? total("paidQuantity"),
      revenue: total("netRevenue") ?? total("revenue"),
      refunds,
      refundAmount: total("refundAmount"),
      repeatOrders: total("repeatOrders"),
      stockCount:
        rows
          .map((row) => row.stockCount)
          .filter((value): value is number => value !== null)
          .at(-1) ?? null,
      reviewCount: total("reviewCount"),
      photoReviewCount: total("photoReviewCount"),
      ratingSum,
      ratingCount,
      productImpressions: total("productImpressions"),
      uniqueVisitors: total("uniqueVisitors"),
      checkoutStarts: total("checkoutStarts"),
      grossRevenue: total("grossRevenue"),
      cancelledOrders: total("cancelledOrders"),
      cancelledQuantity: total("cancelledQuantity"),
      cancelledRevenue: total("cancelledRevenue"),
      refundedOrders: total("refundedOrders"),
      refundedRevenue: total("refundedRevenue"),
      netOrders: total("netOrders"),
      netQuantity: total("netQuantity"),
      netRevenue: total("netRevenue"),
      newCustomers: total("newCustomers"),
      returningCustomers: total("returningCustomers"),
      newReviewCount: total("newReviewCount"),
      averageRating: safeDivide(ratingSum, ratingCount),
      viewToCartRate: safeDivide(cartAdds, views),
      cartToOrderRate: safeDivide(paidOrders, cartAdds),
      viewToOrderRate: safeDivide(paidOrders, views),
      refundRate: safeDivide(refunds, paidOrders),
    };
  });
}

export function buildWeeklyMetrics(metrics: ProductDailyMetric[]): ProductWeeklyMetric[] {
  if (!metrics.length) return [];
  const dates = Array.from(new Set(metrics.map((metric) => metric.date))).sort();
  const result: ProductWeeklyMetric[] = [];
  for (let cursor = 0; cursor < dates.length; cursor += 7) {
    const startsOn = dates[cursor];
    const endsOn = dates[Math.min(cursor + 6, dates.length - 1)];
    for (const aggregate of aggregateProductMetrics(metrics, startsOn, endsOn)) {
      result.push({
        advertiserId: aggregate.advertiserId,
        productId: aggregate.productId,
        startsOn,
        endsOn,
        impressions: aggregate.impressions,
        views: aggregate.views,
        cartAdds: aggregate.cartAdds,
        paidOrders: aggregate.paidOrders,
        paidQuantity: aggregate.paidQuantity,
        revenue: aggregate.revenue,
        refunds: aggregate.refunds,
        viewToCartRate: aggregate.viewToCartRate,
        cartToOrderRate: aggregate.cartToOrderRate,
        viewToOrderRate: aggregate.viewToOrderRate,
      });
    }
  }
  return result;
}

export function deduplicateDailyMetrics(metrics: ProductDailyMetric[]) {
  const groups = new Map<string, ProductDailyMetric[]>();
  for (const metric of metrics) {
    const key = `${metric.advertiserId}::${metric.productId}::${metric.date}`;
    const rows = groups.get(key) || [];
    rows.push(metric);
    groups.set(key, rows);
  }
  return Array.from(groups.values(), (rows) => {
    const source = rows.some((row) => row.source === "file_upload") ? "file_upload" : rows.some((row) => row.source === "crema_api") ? "crema_api" : "development_fixture";
    const total = (field: keyof ProductDailyMetric) => sumNullable(rows.map((row) => (typeof row[field] === "number" ? (row[field] as number) : null)));
    return {
      ...rows[0],
      impressions: total("impressions"),
      views: total("views"),
      cartAdds: total("cartAdds"),
      paidOrders: total("paidOrders"),
      paidQuantity: total("paidQuantity"),
      revenue: total("revenue"),
      refunds: total("refunds"),
      refundAmount: total("refundAmount"),
      repeatOrders: total("repeatOrders"),
      stockCount:
        rows
          .map((row) => row.stockCount)
          .filter((value): value is number => value !== null)
          .at(-1) ?? null,
      reviewCount: total("reviewCount"),
      photoReviewCount: total("photoReviewCount"),
      ratingSum: total("ratingSum"),
      ratingCount: total("ratingCount"),
      productImpressions: total("productImpressions"),
      uniqueVisitors: total("uniqueVisitors"),
      checkoutStarts: total("checkoutStarts"),
      grossRevenue: total("grossRevenue"),
      cancelledOrders: total("cancelledOrders"),
      cancelledQuantity: total("cancelledQuantity"),
      cancelledRevenue: total("cancelledRevenue"),
      refundedOrders: total("refundedOrders"),
      refundedRevenue: total("refundedRevenue"),
      netOrders: total("netOrders"),
      netQuantity: total("netQuantity"),
      netRevenue: total("netRevenue"),
      stockQuantity:
        rows
          .map((row) => row.stockQuantity)
          .filter((value): value is number => value !== null && value !== undefined)
          .at(-1) ?? null,
      newCustomers: total("newCustomers"),
      returningCustomers: total("returningCustomers"),
      newReviewCount: total("newReviewCount"),
      source,
    } satisfies ProductDailyMetric;
  });
}
