import { readMetaServerConfig } from "./config.server.ts";
import { createGuardedMetaClient } from "./guardedClient.server.ts";
import { aggregateMetaPerformance, recentThreeDayRange } from "./performance.ts";
import { GraphMetaProvider, type MetaProvider } from "./provider.server.ts";
import { metaRepository, type createMetaRepository } from "./repository.server.ts";
import type { MetaInsightSnapshot } from "./types.ts";

type Repository = ReturnType<typeof createMetaRepository>;

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function actionValue(actions: unknown, types: string[]) {
  if (!Array.isArray(actions)) return 0;
  return actions.reduce((sum, action) => {
    if (!action || typeof action !== "object") return sum;
    const item = action as Record<string, unknown>;
    return types.includes(String(item.action_type)) ? sum + number(item.value) : sum;
  }, 0);
}

export function createMetaInsightsService(options?: {
  provider?: MetaProvider;
  repository?: Repository;
}) {
  const config = readMetaServerConfig();
  const repository = options?.repository || metaRepository;
  const provider =
    options?.provider ||
    new GraphMetaProvider({
      graphApiVersion: config.graphApiVersion,
      systemUserAccessToken: config.systemUserAccessToken,
      appSecret: config.appSecret,
      timeoutMs: config.requestTimeoutMs,
    });
  const client = createGuardedMetaClient({
    provider,
    readEnabled: config.readEnabled,
    writeEnabled: config.writeEnabled,
    dryRun: config.dryRun,
  });
  return {
    async refresh(experimentId: string) {
      const store = await repository.read();
      const experiment = store.performance.find((item) => item.id === experimentId);
      if (!experiment) throw new Error("성과 연결을 찾지 못했습니다.");
      if (!experiment.trackingEnabled) throw new Error("성과 추적을 먼저 시작해 주세요.");
      const range = recentThreeDayRange();
      const adIds = experiment.rows.map((row) => row.adId);
      const response = await client.read<{ data?: Array<Record<string, unknown>> }>(
        "insights",
        `${experiment.adAccountId}/insights`,
        {
          level: "ad",
          fields:
            "ad_id,date_start,date_stop,impressions,reach,spend,clicks,outbound_clicks,actions,action_values",
          time_range: range,
          filtering: [{ field: "ad.id", operator: "IN", value: adIds }],
          time_increment: 1,
        }
      );
      const fetchedAt = new Date().toISOString();
      const snapshots: MetaInsightSnapshot[] = (response.data || []).map((row) => ({
        adId: String(row.ad_id || ""),
        dateStart: String(row.date_start || range.since),
        dateStop: String(row.date_stop || range.until),
        impressions: number(row.impressions),
        reach: number(row.reach),
        spend: number(row.spend),
        clicks: number(row.clicks),
        outboundClicks: actionValue(row.outbound_clicks, ["outbound_click"]),
        landingPageViews: actionValue(row.actions, ["landing_page_view"]),
        purchases: actionValue(row.actions, ["purchase", "offsite_conversion.fb_pixel_purchase"]),
        purchaseValue: actionValue(row.action_values, [
          "purchase",
          "offsite_conversion.fb_pixel_purchase",
        ]),
        fetchedAt,
      }));
      await repository.upsertSnapshots(snapshots);
      const updatedStore = await repository.read();
      const updated = aggregateMetaPerformance(
        {
          ...experiment,
          lastRequestedAt: fetchedAt,
          lastSuccessfulAt: fetchedAt,
        },
        updatedStore.snapshots.filter((item) => adIds.includes(item.adId)),
        config.thresholds
      );
      await repository.upsertPerformance(updated);
      return updated;
    },
  };
}
