import type { CreativeOpportunityContext } from "../creative-content-notes/types.ts";
import { resolveCreativeContentNotes, applyCreativeContentNotesToCopy } from "../creative-content-notes/service.ts";
import { aggregateProductMetrics, buildWeeklyMetrics } from "./aggregation.ts";
import { normalizeWorkbookRows } from "./normalizer.ts";
import { runOpportunityAnalysis } from "./opportunityEngine.ts";
import { buildDataQualityReport } from "./quality.ts";
import { importAndAnalyzeCremaMarket } from "./syncService.server.ts";
import type { CremaMarketImport, ProductDailyMetric, ProductOpportunity, ReviewInsight } from "./types.ts";

export const CremaMarketDataNormalizer = { normalizeWorkbookRows };

export class CremaMarketSyncService {
  importAndAnalyze = importAndAnalyzeCremaMarket;
}

export const MetricAggregationService = {
  aggregateProductMetrics,
  buildWeeklyMetrics,
};

export const ReviewInsightService = {
  withAnalysisPeriod(insight: ReviewInsight, startsOn: string, endsOn: string, totalReviews: number | null) {
    return {
      ...insight,
      mentionShare: totalReviews && totalReviews > 0 ? insight.evidenceCount / totalReviews : null,
      confidence: Math.min(100, Math.round(35 + Math.log2(insight.evidenceCount + 1) * 15)),
      analysisStartsOn: startsOn,
      analysisEndsOn: endsOn,
    } satisfies ReviewInsight;
  },
};

export const DataQualityService = { buildReport: buildDataQualityReport };
export const OpportunityDetectionEngine = { analyze: runOpportunityAnalysis };
export const OpportunityScoringService = {
  rank(opportunities: ProductOpportunity[]) {
    return [...opportunities].sort((left, right) => right.opportunityScore - left.opportunityScore);
  },
};
export const OpportunityExplanationService = {
  explain(opportunity: ProductOpportunity) {
    return [opportunity.summary, ...opportunity.evidence.map((item) => item.message)].filter(Boolean);
  },
};

export const CreativeContextBuilder = {
  build(input: CreativeOpportunityContext) {
    return { ...input, recommendedHookTypes: Array.from(new Set(input.recommendedHookTypes || [])) };
  },
};

export const CreativeContentNoteService = { resolve: resolveCreativeContentNotes };
export const CreativeComplianceService = { applyToCopy: applyCreativeContentNotesToCopy };

export type CremaMarketNormalizedPayload = CremaMarketImport;
export type CremaMarketMetricRows = ProductDailyMetric[];
