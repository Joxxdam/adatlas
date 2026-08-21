import type { MetaAdvertiserAssetMap } from "./types.ts";

type BudgetMap = Record<string, { currency: string; dailyBudgetMinor: number }>;

function booleanEnv(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true";
}

function jsonEnv<T>(value: string | undefined, fallback: T): T {
  if (!value?.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizeAssetMaps(value: unknown): MetaAdvertiserAssetMap[] {
  if (Array.isArray(value)) return value as MetaAdvertiserAssetMap[];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, Omit<MetaAdvertiserAssetMap, "advertiserId">>).map(
    ([advertiserId, mapping]) => ({ advertiserId, ...mapping })
  );
}

export function readMetaServerConfig() {
  const advertiserMap = normalizeAssetMaps(
    jsonEnv<unknown>(process.env.META_ADVERTISER_ASSET_MAP_JSON, {})
  );
  return {
    graphApiVersion: process.env.META_GRAPH_API_VERSION?.trim() || "",
    appId: process.env.META_APP_ID?.trim() || "",
    appSecret: process.env.META_APP_SECRET?.trim() || "",
    systemUserAccessToken: process.env.META_SYSTEM_USER_ACCESS_TOKEN?.trim() || "",
    allowedAdAccountIds: new Set(
      (process.env.META_ALLOWED_AD_ACCOUNT_IDS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    ),
    advertiserMap,
    budgetByAccount: jsonEnv<BudgetMap>(process.env.META_ADSET_BUDGET_BY_ACCOUNT_JSON, {}),
    readEnabled: booleanEnv(process.env.META_READ_ENABLED, false),
    writeEnabled: booleanEnv(process.env.META_WRITE_ENABLED, false),
    dryRun: booleanEnv(process.env.META_DRY_RUN, true),
    insightsSchedulerEnabled: booleanEnv(process.env.META_INSIGHTS_SCHEDULER_ENABLED, false),
    insightsIntervalMinutes: Math.max(15, Number(process.env.META_INSIGHTS_INTERVAL_MINUTES || 60)),
    defaultDailyBudgetUsd: Number(process.env.META_DEFAULT_ADSET_DAILY_BUDGET_USD || 5),
    maxAdsPerRequest: Math.min(6, Math.max(1, Number(process.env.META_MAX_ADS_PER_REQUEST || 6))),
    requestTimeoutMs: Math.max(3_000, Number(process.env.META_REQUEST_TIMEOUT_MS || 15_000)),
    thresholds: {
      impressions: Math.max(0, Number(process.env.HOOK_MIN_IMPRESSIONS || 1_000)),
      outboundClicks: Math.max(0, Number(process.env.HOOK_MIN_OUTBOUND_CLICKS || 30)),
      purchases: Math.max(0, Number(process.env.HOOK_MIN_PURCHASES || 3)),
      spend: Math.max(0, Number(process.env.HOOK_MIN_SPEND || 20)),
    },
  };
}

export function publicMetaCapability() {
  const config = readMetaServerConfig();
  return {
    readEnabled: config.readEnabled,
    writeEnabled: config.writeEnabled,
    dryRun: config.dryRun,
    configured: Boolean(config.graphApiVersion && config.appId && config.systemUserAccessToken),
    schedulerEnabled: config.insightsSchedulerEnabled,
    schedulerIntervalMinutes: config.insightsIntervalMinutes,
  };
}
