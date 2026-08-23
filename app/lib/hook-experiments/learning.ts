import type { CreativeExperiment, ExperimentAnalysis, ExperimentObjective, HookExperimentStore, ObjectiveHookInsight } from "./types.ts";
import { ObjectiveMetricService, median } from "./performance.ts";

function finiteAverage(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
}

function lift(value: number, benchmark: number, direction: "higher" | "lower") {
  if (!Number.isFinite(value) || !Number.isFinite(benchmark) || benchmark === 0) return null;
  const result = direction === "higher" ? (value - benchmark) / Math.abs(benchmark) : (benchmark - value) / Math.abs(benchmark);
  return Number.isFinite(result) ? result : null;
}

export const ObjectiveHookLearningService = {
  build(store: HookExperimentStore): ObjectiveHookInsight[] {
    const eligibleAnalyses = store.analyses.filter((analysis) => !analysis.needsMoreData);
    const buckets = new Map<
      string,
      {
        experiment: CreativeExperiment;
        hookType: string;
        hookCode: ObjectiveHookInsight["hookCode"];
        lifts: number[];
        experiments: Set<string>;
        assets: Set<string>;
      }
    >();
    for (const analysis of eligibleAnalyses) {
      const experiment = store.experiments.find((item) => item.id === analysis.experimentId);
      if (!experiment) continue;
      const direction = ObjectiveMetricService.primary(experiment.objective, analysis.groups[0]?.metrics).direction;
      for (const group of analysis.groups.filter((item) => item.eligible && item.primaryMetricValue !== null)) {
        const competitors = analysis.groups.filter((item) => item.hookGroupId !== group.hookGroupId && item.eligible).map((item) => item.primaryMetricValue);
        const benchmark = median(competitors);
        const groupLift = benchmark === null ? null : lift(group.primaryMetricValue!, benchmark, direction);
        const key = [experiment.advertiserId, experiment.categoryId, experiment.productId, experiment.objective, group.hookCode].join("|");
        const bucket = buckets.get(key) || {
          experiment,
          hookType: group.hookType,
          hookCode: group.hookCode,
          lifts: [],
          experiments: new Set<string>(),
          assets: new Set<string>(),
        };
        bucket.experiments.add(experiment.id);
        if (groupLift !== null) bucket.lifts.push(groupLift);
        store.experimentAssets.filter((asset) => asset.experimentId === experiment.id && asset.hookGroupId === group.hookGroupId && asset.assetId).forEach((asset) => bucket.assets.add(asset.assetId!));
        buckets.set(key, bucket);
      }
    }
    return Array.from(buckets.entries()).map(([id, bucket]) => {
      const experimentCount = store.experiments.filter((item) => item.advertiserId === bucket.experiment.advertiserId && item.categoryId === bucket.experiment.categoryId && item.productId === bucket.experiment.productId && item.objective === bucket.experiment.objective).length;
      const eligibleExperimentCount = bucket.experiments.size;
      const assetCount = bucket.assets.size;
      const confidenceScore = Math.round(Math.min(1, eligibleExperimentCount / 3) * Math.min(1, assetCount / 6) * 100);
      const status: ObjectiveHookInsight["status"] = eligibleExperimentCount >= 3 && assetCount >= 6 ? "VERIFIED" : eligibleExperimentCount >= 2 ? "REPEATED" : eligibleExperimentCount >= 1 ? "EARLY_SIGNAL" : "EXPLORATION";
      return {
        id,
        advertiserId: bucket.experiment.advertiserId,
        categoryId: bucket.experiment.categoryId,
        productId: bucket.experiment.productId,
        objective: bucket.experiment.objective,
        hookType: bucket.hookType,
        hookCode: bucket.hookCode,
        experimentCount,
        eligibleExperimentCount,
        assetCount,
        medianLift: median(bucket.lifts),
        averageLift: finiteAverage(bucket.lifts),
        confidenceScore,
        status,
        lastUpdatedAt: new Date().toISOString(),
      };
    });
  },

  recommendations(insights: ObjectiveHookInsight[], objective: ExperimentObjective) {
    return insights.filter((item) => item.objective === objective && item.status === "VERIFIED" && item.medianLift !== null).sort((left, right) => (right.medianLift || 0) - (left.medianLift || 0));
  },
};

export const NextExperimentService = {
  nextStage(experiment: CreativeExperiment, analysis: ExperimentAnalysis) {
    if (analysis.needsMoreData) throw new Error("비교 가능한 데이터가 부족해 다음 실험을 만들 수 없습니다.");
    if (experiment.stage === "DISCOVERY") {
      if (analysis.selectedHookCodes.length < 3) throw new Error("T02로 진행할 상위 후킹 3개가 필요합니다.");
      return {
        stage: "VALIDATION" as const,
        selectedHookCodes: analysis.selectedHookCodes.slice(0, 3),
        variantsPerHook: 6,
      };
    }
    if (experiment.stage === "VALIDATION") {
      if (!analysis.winnerHookCode) throw new Error("안정적인 우승 후킹이 확인되지 않았습니다.");
      return {
        stage: "REFINEMENT" as const,
        selectedHookCodes: [analysis.winnerHookCode],
        variantsPerHook: 6,
      };
    }
    throw new Error("T03 고도화 이후에는 새 탐색 실험을 시작해 주세요.");
  },
};

export const DiscoveryCreativeGenerationService = { stage: "DISCOVERY" as const };
export const RefinementCreativeGenerationService = { stage: "REFINEMENT" as const };
