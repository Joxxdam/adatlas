import type { MetaInsightSnapshot, PerformanceExperiment, PerformanceHookRow } from "./types.ts";

function safeDivide(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

export function aggregateMetaPerformance(
  experiment: PerformanceExperiment,
  snapshots: MetaInsightSnapshot[],
  thresholds: {
    impressions: number;
    outboundClicks: number;
    purchases: number;
    spend: number;
  }
): PerformanceExperiment {
  const grouped = new Map<string, MetaInsightSnapshot[]>();
  for (const snapshot of snapshots) {
    const list = grouped.get(snapshot.adId) || [];
    list.push(snapshot);
    grouped.set(snapshot.adId, list);
  }
  const totalsByAd = experiment.rows.map((row) => {
    const latestByDate = new Map<string, MetaInsightSnapshot>();
    for (const snapshot of grouped.get(row.adId) || []) {
      latestByDate.set(`${snapshot.dateStart}:${snapshot.dateStop}`, snapshot);
    }
    const totals = [...latestByDate.values()].reduce(
      (sum, item) => ({
        impressions: sum.impressions + item.impressions,
        spend: sum.spend + item.spend,
        outboundClicks: sum.outboundClicks + item.outboundClicks,
        landingPageViews: sum.landingPageViews + item.landingPageViews,
        purchases: sum.purchases + item.purchases,
        purchaseValue: sum.purchaseValue + item.purchaseValue,
      }),
      {
        impressions: 0,
        spend: 0,
        outboundClicks: 0,
        landingPageViews: 0,
        purchases: 0,
        purchaseValue: 0,
      }
    );
    return { row, totals };
  });
  const totalSpend = totalsByAd.reduce((sum, item) => sum + item.totals.spend, 0);
  const rows: PerformanceHookRow[] = totalsByAd.map(({ row, totals }) => {
    const enough = totals.impressions >= thresholds.impressions && totals.outboundClicks >= thresholds.outboundClicks && totals.purchases >= thresholds.purchases && totals.spend >= thresholds.spend;
    return {
      ...row,
      ...totals,
      ctr: safeDivide(totals.outboundClicks * 100, totals.impressions),
      cpc: safeDivide(totals.spend, totals.outboundClicks),
      cpa: safeDivide(totals.spend, totals.purchases),
      roas: safeDivide(totals.purchaseValue, totals.spend),
      spendShare: safeDivide(totals.spend, totalSpend),
      status: enough ? "유망 후킹" : "추가 데이터 필요",
    };
  });
  const eligible = rows.filter((row) => row.status === "유망 후킹");
  const leader = [...eligible].sort((a, b) => b.roas - a.roas || a.cpa - b.cpa || b.purchases - a.purchases)[0];
  if (leader && eligible.length >= 2) leader.status = "검증된 우승";
  return { ...experiment, rows };
}

export function spendImbalanceWarning(rows: PerformanceHookRow[]) {
  const highest = [...rows].sort((a, b) => b.spendShare - a.spendShare)[0];
  if (!highest || highest.spendShare < 0.4) return "";
  return `${highest.hookCode}에 전체 광고비의 ${Math.round(highest.spendShare * 100)}%가 배분되었습니다. 현재 결과는 Meta의 불균등 노출 영향을 포함합니다.`;
}

export function recentThreeDayRange(now = new Date()) {
  const stop = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(stop);
  start.setUTCDate(start.getUTCDate() - 2);
  return {
    since: start.toISOString().slice(0, 10),
    until: stop.toISOString().slice(0, 10),
  };
}
