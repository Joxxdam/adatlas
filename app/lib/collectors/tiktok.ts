import { CollectRequest, CollectedReference } from "./types";
import { asArray, asRecord, asString, fetchJson, requireEnv, stableId, withCollectedAt } from "./utils";

export async function collectTikTok(request: CollectRequest): Promise<CollectedReference[]> {
  const endpoint = requireEnv("TIKTOK_AD_API_URL");
  const token = requireEnv("TIKTOK_ACCESS_TOKEN");
  const result = asRecord(
    await fetchJson(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: request.query,
        country: request.country,
        fromDate: request.fromDate,
        toDate: request.toDate,
        limit: request.limit ?? 25,
      }),
    }),
  );

  const items = asArray(result.data).length ? asArray(result.data) : asArray(result.items);

  return items.map((value) => {
    const item = asRecord(value);
    const externalId = asString(item.id) || asString(item.ad_id) || crypto.randomUUID();
    const videoUrl = asString(item.video_url) || asString(item.url);
    const thumbnailUrl = asString(item.thumbnail_url) || asString(item.cover_url);

    return withCollectedAt({
      id: stableId("tiktok", externalId),
      source: "tiktok",
      platform: "TikTok Creative Center",
      externalId,
      title: asString(item.title) || asString(item.ad_title, "TikTok 광고"),
      brand: asString(item.brand) || asString(item.advertiser_name, "알 수 없음"),
      body: asString(item.caption) || asString(item.description),
      landingUrl: asString(item.landing_url),
      mediaUrls: [videoUrl, thumbnailUrl].filter(Boolean),
      thumbnailUrl,
      country: request.country,
      startDate: asString(item.start_date) || request.fromDate,
      endDate: asString(item.end_date) || request.toDate,
      raw: item,
    });
  });
}
