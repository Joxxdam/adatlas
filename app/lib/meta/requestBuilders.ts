import { assertNoMetaAutomationOptIn } from "./featureOptOutRegistry.ts";
import type { MetaDraftRegistrationInput, MetaPreflightResult } from "./types.ts";

const cloneableAdSetFields = ["targeting", "promoted_object", "optimization_goal", "billing_event", "attribution_spec"] as const;

export function buildPausedAdSetRequest(input: MetaDraftRegistrationInput, preflight: MetaPreflightResult) {
  if (!preflight.ok || !preflight.budget.dailyBudgetMinor) throw new Error("사전 검토를 통과하지 못했습니다.");
  const request: Record<string, unknown> = {
    name: preflight.draft.adSetName,
    campaign_id: input.campaign.id,
    status: "PAUSED",
    daily_budget: preflight.budget.dailyBudgetMinor,
    targeting: input.baselineAdSet.targeting,
    promoted_object: {
      ...(input.pixelId ? { pixel_id: input.pixelId } : {}),
      ...(input.datasetId ? { dataset_id: input.datasetId } : {}),
      custom_event_type: "PURCHASE",
    },
    optimization_goal: input.baselineAdSet.optimizationGoal,
    billing_event: input.baselineAdSet.billingEvent,
    attribution_spec: input.baselineAdSet.attributionSpec,
  };
  void cloneableAdSetFields;
  assertNoMetaAutomationOptIn(request);
  return request;
}

export function buildSingleMediaCreativeRequest(input: MetaDraftRegistrationInput, creative: MetaDraftRegistrationInput["creatives"][number], mediaId: string) {
  const request = {
    name: `${creative.materialCode}_${creative.hookCode}`,
    object_story_spec: {
      page_id: input.pageId,
      instagram_actor_id: input.instagramActorId,
      link_data: {
        image_hash: creative.mediaType === "image" ? mediaId : undefined,
        video_id: creative.mediaType === "video" ? mediaId : undefined,
        message: creative.primaryText,
        name: creative.headline,
        description: creative.description,
        link: `${creative.landingUrl}${creative.landingUrl.includes("?") ? "&" : "?"}${creative.utm}`,
        call_to_action: {
          type: "SHOP_NOW",
          value: {
            link: `${creative.landingUrl}${creative.landingUrl.includes("?") ? "&" : "?"}${creative.utm}`,
          },
        },
      },
    },
  };
  assertNoMetaAutomationOptIn(request);
  return request;
}

export function buildPausedAdRequest(input: { materialCode: string; hookCode: string; adSetId: string; creativeId: string }) {
  const request = {
    name: `${input.materialCode}_${input.hookCode}`,
    adset_id: input.adSetId,
    creative: { creative_id: input.creativeId },
    status: "PAUSED",
  };
  assertNoMetaAutomationOptIn(request);
  return request;
}
