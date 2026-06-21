import { CollectRequest, CollectedReference } from "./types";
import { asArray, asRecord, asString, fetchJson, requireEnv, stableId, withCollectedAt } from "./utils";

export async function collectPinterest(request: CollectRequest): Promise<CollectedReference[]> {
  const token = requireEnv("PINTEREST_ACCESS_TOKEN");
  const url = new URL("https://api.pinterest.com/v5/pins/search");

  url.searchParams.set("query", request.query);
  url.searchParams.set("page_size", String(request.limit ?? 25));

  const result = asRecord(
    await fetchJson(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),
  );

  return asArray(result.items).map((value) => {
    const item = asRecord(value);
    const media = asRecord(item.media);
    const images = asRecord(media.images);
    const original = asRecord(images.original);
    const medium = asRecord(images["600x"]);
    const imageUrl = asString(medium.url) || asString(original.url);
    const externalId = asString(item.id, crypto.randomUUID());

    return withCollectedAt({
      id: stableId("pinterest", externalId),
      source: "pinterest",
      platform: "Pinterest",
      externalId,
      title: asString(item.title) || asString(item.description, "Pinterest Pin"),
      brand: asString(asRecord(item.board).name, "Pinterest"),
      body: asString(item.description),
      landingUrl: asString(item.link),
      mediaUrls: imageUrl ? [imageUrl] : [],
      thumbnailUrl: imageUrl,
      country: request.country,
      startDate: asString(item.created_at),
      raw: item,
    });
  });
}
