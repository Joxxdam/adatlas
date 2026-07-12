import { CollectRequest, CollectedReference } from "./types";
import {
  asArray,
  asRecord,
  asString,
  fetchJson,
  requireEnv,
  stableId,
  withCollectedAt,
} from "./utils";

export async function collectMeta(request: CollectRequest): Promise<CollectedReference[]> {
  const token = requireEnv("META_ACCESS_TOKEN");
  const version = process.env.META_GRAPH_VERSION ?? "v23.0";
  const url = new URL(`https://graph.facebook.com/${version}/ads_archive`);

  url.searchParams.set("access_token", token);
  url.searchParams.set("search_terms", request.query);
  url.searchParams.set("ad_reached_countries", JSON.stringify([request.country]));
  url.searchParams.set("ad_delivery_date_min", request.fromDate);
  url.searchParams.set("ad_delivery_date_max", request.toDate);
  url.searchParams.set("ad_type", "ALL");
  url.searchParams.set("limit", String(request.limit ?? 25));
  url.searchParams.set(
    "fields",
    [
      "id",
      "page_name",
      "ad_creation_time",
      "ad_delivery_start_time",
      "ad_delivery_stop_time",
      "ad_creative_bodies",
      "ad_creative_link_titles",
      "ad_creative_link_descriptions",
      "ad_snapshot_url",
      "publisher_platforms",
    ].join(",")
  );

  const result = asRecord(await fetchJson(url));

  return asArray(result.data).map((value) => {
    const item = asRecord(value);
    const externalId = asString(item.id, crypto.randomUUID());
    const titles = asArray(item.ad_creative_link_titles)
      .map((title) => asString(title))
      .filter(Boolean);
    const bodies = asArray(item.ad_creative_bodies)
      .map((body) => asString(body))
      .filter(Boolean);

    return withCollectedAt({
      id: stableId("meta", externalId),
      source: "meta",
      platform: "Meta Ad Library",
      externalId,
      title: titles[0] || bodies[0]?.slice(0, 80) || asString(item.page_name, "Meta 광고"),
      brand: asString(item.page_name, "알 수 없음"),
      body: bodies.join("\n"),
      landingUrl: asString(item.ad_snapshot_url),
      mediaUrls: [],
      country: request.country,
      startDate: asString(item.ad_delivery_start_time),
      endDate: asString(item.ad_delivery_stop_time),
      raw: item,
    });
  });
}
