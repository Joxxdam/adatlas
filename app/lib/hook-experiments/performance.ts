import type { AggregatedMetrics, CreativeExperiment, ExperimentAnalysis, ExperimentAsset, ExperimentObjective, HookGroup, HookPerformanceResult, PerformanceRecord } from "./types.ts";

function sum(records: PerformanceRecord[], key: keyof PerformanceRecord) {
  const values = records.map((record) => record[key]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function ratio(numerator: number | null, denominator: number | null, multiplier = 1) {
  if (numerator === null || denominator === null || denominator <= 0) return null;
  const value = (numerator / denominator) * multiplier;
  return Number.isFinite(value) ? value : null;
}

function median(values: Array<number | null>) {
  const sorted = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export const HookPerformanceAggregationService = {
  aggregate(records: PerformanceRecord[]): AggregatedMetrics {
    const spend = sum(records, "spend");
    const impressions = sum(records, "impressions");
    const reach = sum(records, "reach");
    const clicks = sum(records, "clicks");
    const linkClicks = sum(records, "linkClicks");
    const outboundClicks = sum(records, "outboundClicks");
    const landingPageViews = sum(records, "landingPageViews");
    const engagements = sum(records, "engagements");
    const purchases = sum(records, "purchases");
    const purchaseValue = sum(records, "purchaseValue");
    return {
      spend,
      impressions,
      reach,
      frequency: ratio(impressions, reach),
      cpm: ratio(spend, impressions, 1000),
      clicks,
      linkClicks,
      outboundClicks,
      landingPageViews,
      ctr: ratio(linkClicks, impressions),
      outboundCtr: ratio(outboundClicks, impressions),
      cpc: ratio(spend, linkClicks),
      costPerLandingPageView: ratio(spend, landingPageViews),
      landingPageArrivalRate: ratio(landingPageViews, linkClicks),
      purchases,
      purchaseValue,
      cvr: ratio(purchases, linkClicks),
      cpa: ratio(spend, purchases),
      roas: ratio(purchaseValue, spend),
      engagements,
      engagementRate: ratio(engagements, impressions),
      costPerEngagement: ratio(spend, engagements),
    };
  },
};

export const ObjectiveMetricService = {
  primary(objective: ExperimentObjective, metrics: AggregatedMetrics) {
    if (objective === "AWR") return { name: "CPM", value: metrics.cpm, direction: "lower" as const };
    if (objective === "TRF")
      return {
        name: "랜딩페이지 조회당 비용",
        value: metrics.costPerLandingPageView,
        direction: "lower" as const,
      };
    if (objective === "SLS") return { name: "ROAS", value: metrics.roas, direction: "higher" as const };
    if (objective === "ENG") return { name: "참여당 비용", value: metrics.costPerEngagement, direction: "lower" as const };
    return { name: "CTR", value: metrics.ctr, direction: "higher" as const };
  },
};

function assetEligible(experiment: CreativeExperiment, metrics: AggregatedMetrics) {
  const rules = experiment.ruleConfig;
  if ((metrics.spend || 0) < rules.minimumSpend || (metrics.impressions || 0) < rules.minimumImpressions) return false;
  if (experiment.objective === "TRF") return (metrics.linkClicks || 0) >= rules.minimumClicks && (metrics.landingPageViews || 0) >= rules.minimumLandingPageViews;
  if (experiment.objective === "SLS") return (metrics.linkClicks || 0) >= rules.minimumClicks && (metrics.purchases || 0) >= rules.minimumPurchases;
  if (experiment.objective === "ENG") return (metrics.engagements || 0) >= rules.minimumClicks;
  return true;
}

function groupResult(input: { experiment: CreativeExperiment; group: HookGroup; assets: ExperimentAsset[]; records: PerformanceRecord[] }): HookPerformanceResult & {
  assetPrimaryValues: Array<{ code: string; value: number; eligible: boolean; spend: number }>;
} {
  const matched = input.records.filter((record) => record.hookGroupId === input.group.id && record.matchStatus === "matched");
  const metrics = HookPerformanceAggregationService.aggregate(matched);
  const byAsset = input.assets
    .map((asset) => {
      const assetRecords = matched.filter((record) => record.assetId === asset.assetId);
      const assetMetrics = HookPerformanceAggregationService.aggregate(assetRecords);
      const primary = ObjectiveMetricService.primary(input.experiment.objective, assetMetrics);
      return {
        code: asset.assetCode || asset.id,
        value: primary.value,
        eligible: assetEligible(input.experiment, assetMetrics),
        spend: assetMetrics.spend || 0,
      };
    })
    .filter((item): item is { code: string; value: number; eligible: boolean; spend: number } => item.value !== null);
  const eligibleAssets = byAsset.filter((item) => item.eligible);
  const spends = byAsset.map((item) => item.spend);
  const totalSpend = spends.reduce((total, value) => total + value, 0);
  const concentration = totalSpend > 0 ? Math.max(0, ...spends) / totalSpend : null;
  const sortedAssets = [...byAsset].sort((left, right) => {
    const direction = ObjectiveMetricService.primary(input.experiment.objective, metrics).direction;
    return direction === "higher" ? right.value - left.value : left.value - right.value;
  });
  const warnings: string[] = [];
  if (eligibleAssets.length < input.experiment.ruleConfig.minimumEligibleAssetsPerHook) warnings.push("최소 집행기준을 충족한 소재가 부족합니다.");
  if (concentration !== null && concentration > input.experiment.ruleConfig.maximumSingleAssetSpendShare) warnings.push("특정 소재에 지출이 과도하게 집중됐습니다.");
  const primary = ObjectiveMetricService.primary(input.experiment.objective, metrics);
  return {
    hookGroupId: input.group.id,
    hookCode: input.group.hookCode,
    hookType: input.group.hookType,
    metrics,
    connectedAssetCount: new Set(matched.map((record) => record.assetId).filter(Boolean)).size,
    eligibleAssetCount: eligibleAssets.length,
    topAssetCode: sortedAssets[0]?.code,
    bottomAssetCode: sortedAssets.at(-1)?.code,
    spendConcentration: concentration,
    medianPrimaryMetric: median(eligibleAssets.map((item) => item.value)),
    primaryMetric: primary.name,
    primaryMetricValue: primary.value,
    eligible: !warnings.length && primary.value !== null,
    warnings,
    stability: eligibleAssets.length ? "UNSTABLE" : "INSUFFICIENT_DATA",
    assetPrimaryValues: byAsset,
  };
}

export const ExperimentComparabilityService = {
  inspect(
    experiment: CreativeExperiment,
    groups: Array<
      HookPerformanceResult & {
        assetPrimaryValues: Array<{
          code: string;
          value: number;
          eligible: boolean;
          spend: number;
        }>;
      }
    >,
    records: PerformanceRecord[]
  ) {
    const warnings: string[] = [];
    const matched = records.filter((record) => record.matchStatus === "matched");
    if (matched.some((record) => record.objective !== experiment.objective)) warnings.push("서로 다른 캠페인 목표의 보고서 행이 포함됐습니다.");
    if (new Set(matched.map((record) => `${record.dateStart}|${record.dateEnd}`)).size > 1) warnings.push("비교 기간이 서로 다른 보고서 행이 포함됐습니다.");
    const spends = groups.map((group) => group.metrics.spend || 0).filter((value) => value > 0);
    if (spends.length > 1 && Math.max(...spends) / Math.min(...spends) > experiment.ruleConfig.maximumSpendImbalanceRatio) warnings.push("후킹별 지출 차이가 비교 허용 범위를 넘었습니다.");
    if (groups.filter((group) => group.eligible).length < Math.min(2, groups.length)) warnings.push("비교 가능한 후킹 그룹이 부족합니다.");
    return { comparable: warnings.length === 0, warnings };
  },
};

function rankGroups<T extends HookPerformanceResult>(experiment: CreativeExperiment, groups: T[]): T[] {
  return [...groups].sort((left, right) => {
    if (left.eligible !== right.eligible) return left.eligible ? -1 : 1;
    const direction = ObjectiveMetricService.primary(experiment.objective, left.metrics).direction;
    const leftValue = left.primaryMetricValue;
    const rightValue = right.primaryMetricValue;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    if (leftValue !== rightValue) return direction === "higher" ? rightValue - leftValue : leftValue - rightValue;
    return (right.eligibleAssetCount || 0) - (left.eligibleAssetCount || 0);
  });
}

function applyStability(
  experiment: CreativeExperiment,
  groups: Array<
    HookPerformanceResult & {
      assetPrimaryValues: Array<{ code: string; value: number; eligible: boolean; spend: number }>;
    }
  >
): Array<
  HookPerformanceResult & {
    assetPrimaryValues: Array<{ code: string; value: number; eligible: boolean; spend: number }>;
  }
> {
  const direction = ObjectiveMetricService.primary(experiment.objective, groups[0]?.metrics || HookPerformanceAggregationService.aggregate([])).direction;
  return groups.map((group) => {
    if (experiment.stage !== "VALIDATION" || group.eligibleAssetCount < 3)
      return {
        ...group,
        stability: group.eligibleAssetCount ? ("UNSTABLE" as const) : ("INSUFFICIENT_DATA" as const),
      };
    const competitors = groups.filter((item) => item.hookGroupId !== group.hookGroupId).flatMap((item) => item.assetPrimaryValues.filter((asset) => asset.eligible).map((asset) => asset.value));
    const benchmark = median(competitors);
    if (benchmark === null) return { ...group, stability: "INSUFFICIENT_DATA" as const };
    const eligible = group.assetPrimaryValues.filter((asset) => asset.eligible);
    const better = eligible.filter((asset) => (direction === "higher" ? asset.value > benchmark : asset.value < benchmark)).length;
    const stableMinimum = Math.max(3, Math.ceil(eligible.length * 0.6));
    const stability = better >= stableMinimum && (group.spendConcentration || 0) <= experiment.ruleConfig.maximumSingleAssetSpendShare ? "STABLE_WINNER" : better <= 1 || (group.spendConcentration || 0) > experiment.ruleConfig.maximumSingleAssetSpendShare ? "SINGLE_ASSET_WINNER" : "UNSTABLE";
    return { ...group, stability };
  });
}

export const HookValidationService = {
  analyze(input: { experiment: CreativeExperiment; hookGroups: HookGroup[]; experimentAssets: ExperimentAsset[]; performanceRecords: PerformanceRecord[] }): ExperimentAnalysis {
    const rawGroups = input.hookGroups.map((group) =>
      groupResult({
        experiment: input.experiment,
        group,
        assets: input.experimentAssets.filter((asset) => asset.hookGroupId === group.id),
        records: input.performanceRecords,
      })
    );
    const stabilityGroups = applyStability(input.experiment, rawGroups);
    const ranked = rankGroups(input.experiment, stabilityGroups).map((group, index) => ({
      ...group,
      rank: group.eligible ? index + 1 : undefined,
    }));
    const comparability = ExperimentComparabilityService.inspect(input.experiment, rawGroups, input.performanceRecords);
    const topEligible = ranked.filter((group) => group.eligible);
    const canSelect = comparability.comparable && topEligible.length >= Math.min(2, ranked.length);
    const selectedHookCodes = input.experiment.stage === "DISCOVERY" && canSelect ? topEligible.slice(0, 3).map((group) => group.hookCode) : [];
    const winner = input.experiment.stage === "VALIDATION" && canSelect && topEligible[0]?.stability === "STABLE_WINNER" ? topEligible[0].hookCode : input.experiment.stage === "REFINEMENT" && canSelect ? topEligible[0]?.hookCode : undefined;
    return {
      experimentId: input.experiment.id,
      objective: input.experiment.objective,
      stage: input.experiment.stage,
      comparable: comparability.comparable,
      needsMoreData: !canSelect || (input.experiment.stage === "VALIDATION" && !winner),
      warnings: [...comparability.warnings, ...ranked.flatMap((group) => group.warnings.map((warning) => `${group.hookCode}: ${warning}`))],
      groups: ranked.map(({ assetPrimaryValues, ...group }) => {
        void assetPrimaryValues;
        return group;
      }),
      selectedHookCodes,
      winnerHookCode: winner,
      analyzedAt: new Date().toISOString(),
    };
  },
};

export { median };
