import { readMetaServerConfig } from "./config.server.ts";
import { createGuardedMetaClient } from "./guardedClient.server.ts";
import { GraphMetaProvider, type MetaProvider } from "./provider.server.ts";
import type { MetaAccount, MetaAdvertiserAssetMap, MetaBaselineAdSet, MetaCampaign } from "./types.ts";

type DataResponse<T> = { data?: T[] };

export function createMetaReadService(options?: { provider?: MetaProvider }) {
  const config = readMetaServerConfig();
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
    async verifyConnection() {
      return client.read<{ id: string; name?: string }>("connection", "me", {
        fields: "id,name",
      });
    },
    async accounts(mapping: MetaAdvertiserAssetMap) {
      const response = await client.read<DataResponse<MetaAccount>>("accounts", "me/adaccounts", {
        fields: "id,name,currency,timezone_name",
      });
      const mapped = new Set(mapping.adAccountIds);
      return (response.data || []).filter(
        (account) => mapped.has(account.id) && config.allowedAdAccountIds.has(account.id)
      );
    },
    async campaigns(accountId: string) {
      const response = await client.read<DataResponse<Record<string, unknown>>>(
        "campaigns",
        `${accountId}/campaigns`,
        {
          fields:
            "id,name,objective,status,daily_budget,lifetime_budget,budget_remaining,special_ad_categories,smart_promotion_type",
        }
      );
      return (response.data || []).map((campaign): MetaCampaign => ({
        id: String(campaign.id),
        accountId,
        name: String(campaign.name || "이름 없는 캠페인"),
        objective: String(campaign.objective || ""),
        status: String(campaign.status || ""),
        budgetMode: campaign.daily_budget || campaign.lifetime_budget ? "CBO" : "ABO",
        isAdvantagePlus: Boolean(
          campaign.smart_promotion_type &&
          String(campaign.smart_promotion_type) !== "GUIDED_CREATION"
        ),
        specialAdCategories: Array.isArray(campaign.special_ad_categories)
          ? campaign.special_ad_categories.map(String).filter(Boolean)
          : [],
      }));
    },
    async adSets(accountId: string, campaignId: string) {
      const response = await client.read<DataResponse<Record<string, unknown>>>(
        "adsets",
        `${campaignId}/adsets`,
        {
          fields:
            "id,name,campaign_id,account_id,targeting,optimization_goal,billing_event,attribution_spec,promoted_object",
        }
      );
      return (response.data || []).map((adSet): MetaBaselineAdSet => ({
        id: String(adSet.id),
        accountId: String(adSet.account_id || accountId),
        campaignId: String(adSet.campaign_id || campaignId),
        name: String(adSet.name || "이름 없는 광고 세트"),
        targeting: (adSet.targeting || {}) as Record<string, unknown>,
        placements: (() => {
          const targeting = (adSet.targeting || {}) as Record<string, unknown>;
          return [
            "publisher_platforms",
            "facebook_positions",
            "instagram_positions",
            "messenger_positions",
          ].flatMap((key) =>
            Array.isArray(targeting[key]) ? (targeting[key] as unknown[]).map(String) : []
          );
        })(),
        promotedObject: {
          pixelId: String(
            (adSet.promoted_object as Record<string, unknown> | undefined)?.pixel_id || ""
          ),
          datasetId: String(
            (adSet.promoted_object as Record<string, unknown> | undefined)?.dataset_id || ""
          ),
          customEventType: String(
            (adSet.promoted_object as Record<string, unknown> | undefined)?.custom_event_type || ""
          ),
        },
        optimizationGoal: String(adSet.optimization_goal || ""),
        billingEvent: String(adSet.billing_event || ""),
        attributionSpec: Array.isArray(adSet.attribution_spec)
          ? (adSet.attribution_spec as Array<Record<string, unknown>>)
          : undefined,
      }));
    },
    async ads(adSetId: string) {
      const response = await client.read<DataResponse<Record<string, unknown>>>(
        "ads",
        `${adSetId}/ads`,
        { fields: "id,name,status,effective_status,creative{id,name}" }
      );
      return response.data || [];
    },
  };
}
