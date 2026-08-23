import type { DataQualityIssue, DataQualityReport, Product, ProductDailyMetric } from "./types.ts";

const metricFields: Array<keyof ProductDailyMetric> = ["impressions", "views", "cartAdds", "paidOrders", "revenue", "refunds"];

export function buildDataQualityReport(params: { advertiserId: string; products: Product[]; metrics: ProductDailyMetric[]; now?: string }): DataQualityReport {
  const issues: DataQualityIssue[] = [];
  const productIds = new Set(params.products.map((product) => product.id));
  for (const metric of params.metrics) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metric.date)) {
      issues.push({ code: "INVALID_DATE", severity: "error", productId: metric.productId, field: "date", message: `잘못된 날짜 형식: ${metric.date}` });
    }
    if (!productIds.has(metric.productId)) {
      issues.push({ code: "UNKNOWN_PRODUCT", severity: "error", productId: metric.productId, field: "productId", message: "상품 마스터에 없는 지표 행입니다." });
    }
    for (const field of metricFields) {
      const value = metric[field];
      if (typeof value === "number" && value < 0) {
        issues.push({ code: "NEGATIVE_METRIC", severity: "error", productId: metric.productId, field, message: `${field} 값은 음수일 수 없습니다.` });
      }
    }
    if (metric.cartAdds !== null && metric.views !== null && metric.cartAdds > metric.views) {
      issues.push({ code: "FUNNEL_INVERSION", severity: "warning", productId: metric.productId, field: "cartAdds", message: "장바구니 수가 조회 수보다 큽니다. 집계 기준을 확인하세요." });
    }
  }
  for (const product of params.products) {
    if (!product.name.trim()) issues.push({ code: "MISSING_PRODUCT_NAME", severity: "error", productId: product.id, field: "name", message: "상품명이 없습니다." });
    if (!params.metrics.some((metric) => metric.productId === product.id)) issues.push({ code: "MISSING_METRICS", severity: "warning", productId: product.id, field: null, message: "분석 기간의 지표가 없습니다." });
  }
  const completeness: Record<string, number> = {};
  for (const field of metricFields) {
    const count = params.metrics.filter((metric) => metric[field] !== null).length;
    completeness[field] = params.metrics.length ? Math.round((count / params.metrics.length) * 100) : 0;
    if (completeness[field] === 0) {
      issues.push({ code: "FIELD_UNAVAILABLE", severity: "info", productId: null, field, message: `${field} 데이터가 없어 해당 지표 기반 규칙은 건너뜁니다.` });
    }
  }
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.filter((issue) => issue.severity === "warning").length;
  const score = Math.max(0, Math.round(100 - errors * 12 - warnings * 3));
  const now = params.now || new Date().toISOString();
  return {
    id: `quality-${params.advertiserId}-${now.replace(/\D/g, "").slice(0, 14)}`,
    advertiserId: params.advertiserId,
    runAt: now,
    score,
    completeness,
    issues,
    usableForAnalysis: params.products.length > 0 && params.metrics.length > 0 && errors === 0,
  };
}
