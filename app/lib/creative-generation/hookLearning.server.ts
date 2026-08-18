import { hookExperimentRepository } from "../hook-experiments/repository.server.ts";
import type { ExperimentObjective, HookExperimentStore } from "../hook-experiments/types.ts";
import type { CategoryHookPrior } from "./hookHypothesisEngine.ts";
import type { HookTaxonomyTag } from "./types.ts";

const taxonomyAliases: Array<[HookTaxonomyTag, RegExp]> = [
  ["problem-solution", /problem|solution|문제|해결|고민/i],
  ["sensory-experience", /sensory|sense|감각|사용감/i],
  ["price-value", /price|discount|benefit|value|가격|할인|혜택|가성비/i],
  ["feature-usp", /feature|usp|proof|기능|성분|특징/i],
  ["review-trust", /review|trust|ugc|social|후기|리뷰|신뢰/i],
  ["usage-occasion", /usage|occasion|situation|lifestyle|사용|상황/i],
  ["target-identity", /target|identity|타깃|정체성/i],
  ["convenience", /convenience|routine|편의|간편/i],
  ["bundle-choice", /bundle|set|option|세트|구성|옵션/i],
  ["season-newness", /season|new|launch|시즌|신상품/i],
  ["brand-origin", /brand|origin|브랜드|원산지|산지/i],
  ["comparison-alternative", /comparison|alternative|비교|대안/i],
  ["scarcity-urgency", /scarcity|urgency|limited|한정|긴급/i],
  ["gift-purpose", /gift|선물/i],
];

export function taxonomyTagForHistoricalHook(value: string): HookTaxonomyTag {
  return taxonomyAliases.find(([, pattern]) => pattern.test(value))?.[0] || "other";
}

/**
 * Historical performance is only a capped prior (maximum ten points in the
 * hypothesis score). A category with no eligible history remains neutral.
 */
export function buildCategoryHookPriorFromHistory(
  store: HookExperimentStore,
  input: {
    categoryId: string;
    objective: ExperimentObjective;
  }
): CategoryHookPrior {
  const relevant = store.insights.filter(
    (insight) =>
      insight.categoryId === input.categoryId &&
      insight.objective === input.objective &&
      insight.medianLift !== null &&
      insight.status !== "EXPLORATION"
  );
  const buckets = new Map<HookTaxonomyTag, Array<{ lift: number; confidence: number }>>();
  for (const insight of relevant) {
    const tag = taxonomyTagForHistoricalHook(insight.hookType);
    const rows = buckets.get(tag) || [];
    rows.push({
      lift: Math.max(-0.5, Math.min(0.5, insight.medianLift || 0)),
      confidence: Math.max(0, Math.min(1, insight.confidenceScore / 100)),
    });
    buckets.set(tag, rows);
  }
  const performanceRows = store.performanceRecords.filter(
    (record) =>
      record.matchStatus === "matched" &&
      record.category === input.categoryId &&
      record.objective === input.objective &&
      record.primaryTag &&
      record.resultStatus !== "needs-more-data"
  );
  const performanceValue = (record: (typeof performanceRows)[number]) => {
    if (input.objective === "AWR") return { value: record.cpm, direction: "lower" as const };
    if (input.objective === "TRF")
      return { value: record.costPerLandingPageView, direction: "lower" as const };
    if (input.objective === "SLS") return { value: record.roas, direction: "higher" as const };
    return { value: record.ctr, direction: "higher" as const };
  };
  const comparableValues = performanceRows
    .map((record) => performanceValue(record).value)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  const benchmark = comparableValues.length
    ? comparableValues.length % 2
      ? comparableValues[Math.floor(comparableValues.length / 2)]
      : (comparableValues[comparableValues.length / 2 - 1] +
          comparableValues[comparableValues.length / 2]) /
        2
    : null;
  if (benchmark !== null && benchmark !== 0) {
    for (const record of performanceRows) {
      const metric = performanceValue(record);
      if (metric.value === null || metric.value === undefined || !Number.isFinite(metric.value))
        continue;
      const rawLift = metric.direction === "higher"
        ? (metric.value - benchmark) / Math.abs(benchmark)
        : (benchmark - metric.value) / Math.abs(benchmark);
      const tag = record.primaryTag as HookTaxonomyTag;
      const ageDays = Math.max(
        0,
        (Date.now() - new Date(record.dateEnd || record.importedAt).getTime()) / 86_400_000
      );
      const recency = Math.max(0.5, 1 - ageDays / 365);
      const rows = buckets.get(tag) || [];
      rows.push({
        lift: Math.max(-0.5, Math.min(0.5, rawLift)),
        confidence: 0.15 * recency,
      });
      buckets.set(tag, rows);
    }
  }
  if (!buckets.size) return {};
  return Object.fromEntries(
    [...buckets.entries()].map(([tag, rows]) => {
      const weight = rows.reduce((sum, row) => sum + row.confidence, 0) || 1;
      const weightedLift = rows.reduce((sum, row) => sum + row.lift * row.confidence, 0) / weight;
      const evidenceEnvelope = Math.min(1, weight);
      return [
        tag,
        Math.round(Math.max(20, Math.min(80, 50 + weightedLift * evidenceEnvelope * 60))),
      ];
    })
  );
}

export async function readCategoryHookPrior(input: {
  categoryId: string;
  objective: ExperimentObjective;
}): Promise<CategoryHookPrior> {
  return buildCategoryHookPriorFromHistory(await hookExperimentRepository.readAll(), input);
}
