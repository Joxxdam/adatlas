import { collectMeta } from "./meta";
import { collectPinterest } from "./pinterest";
import { collectTikTok } from "./tiktok";
import { CollectedReference, CollectRequest } from "./types";

export async function collectReferences(request: CollectRequest): Promise<CollectedReference[]> {
  if (request.source === "meta") {
    return collectMeta(request);
  }
  if (request.source === "tiktok") {
    return collectTikTok(request);
  }
  if (request.source === "pinterest") {
    return collectPinterest(request);
  }

  throw new Error("지원하지 않는 수집 소스입니다.");
}
