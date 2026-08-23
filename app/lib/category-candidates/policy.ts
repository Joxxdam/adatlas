import type { CategoryMetricRow, CategoryTrendStatus } from "./types";

function changeRate(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? null : 0;
  return (current - previous) / previous;
}

export function classifyCategoryTrend(rows: CategoryMetricRow[]): CategoryTrendStatus {
  const currentSales = rows.reduce((sum, row) => sum + row.current7Sales, 0);
  const previousSales = rows.reduce((sum, row) => sum + row.previous7Sales, 0);
  const weekly = [0, 1, 2, 3].map((index) => rows.reduce((sum, row) => sum + row.weeklySales[index], 0));
  const evidenceWeeks = weekly.filter((value) => value > 0).length;
  if (rows.length < 2 || evidenceWeeks < 2) return "insufficient";
  const short = changeRate(currentSales, previousSales);
  const recentSlope = weekly[0] - weekly[1];
  const olderSlope = weekly[1] - weekly[2];
  if (short !== null && short >= 0.15 && recentSlope > 0) return olderSlope < 0 ? "turning-up" : "rising";
  if (short !== null && short <= -0.15) return recentSlope > olderSlope ? "decline-easing" : "falling";
  return "stable";
}

export const categoryStatusLabels: Record<CategoryTrendStatus, string> = {
  rising: "상승",
  "turning-up": "상승 전환",
  stable: "안정",
  falling: "하락",
  "decline-easing": "하락 둔화",
  insufficient: "데이터 부족",
};
