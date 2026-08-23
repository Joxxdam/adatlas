import type { BackgroundLicense, PexelsSearchPhoto } from "./catalogTypes.ts";
import { importBackgroundSources } from "./importPipeline.server.ts";

const pexelsApiOrigin = "https://api.pexels.com";
const pexelsImageHost = "images.pexels.com";
const pexelsPageHost = "www.pexels.com";
const pexelsLicenseUrl = "https://www.pexels.com/license/";

function pexelsKey() {
  return String(process.env.PEXELS_API_KEY || "").trim();
}

export function pexelsStatus() {
  return {
    available: Boolean(pexelsKey()),
    mode: process.env.PEXELS_MODE === "search-only" ? "search-only" : "search-only",
    bulkPermissionConfirmed: process.env.PEXELS_BULK_PERMISSION_CONFIRMED === "true",
  } as const;
}

function officialUrl(value: string, host: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === host;
  } catch {
    return false;
  }
}

export async function searchPexels(input: { query: string; page?: number; perPage?: number }) {
  const key = pexelsKey();
  if (!key) throw new Error("PEXELS_API_KEY가 없어 Pexels 검색을 사용할 수 없습니다.");
  const query = String(input.query || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (query.length < 2) throw new Error("검색어를 두 글자 이상 입력해주세요.");
  const page = Math.max(1, Math.min(1_000, Number(input.page || 1)));
  const perPage = Math.max(1, Math.min(80, Number(input.perPage || 24)));
  const url = new URL("/v1/search", pexelsApiOrigin);
  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orientation", "square");
  const response = await fetch(url, {
    headers: { Authorization: key, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (response.status === 401 || response.status === 403) throw new Error("Pexels API 키가 올바르지 않습니다.");
  if (response.status === 429) throw new Error("Pexels 검색 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.");
  if (!response.ok) throw new Error(`Pexels 검색 실패: HTTP ${response.status}`);
  const body = (await response.json()) as {
    page?: number;
    per_page?: number;
    total_results?: number;
    next_page?: string;
    photos?: Array<{
      id?: number;
      width?: number;
      height?: number;
      photographer?: string;
      photographer_url?: string;
      url?: string;
      avg_color?: string;
      alt?: string;
      src?: { original?: string; large2x?: string; medium?: string };
    }>;
  };
  const photos: PexelsSearchPhoto[] = (body.photos || []).flatMap((photo) => {
    const pageUrl = String(photo.url || "");
    const originalUrl = String(photo.src?.original || "");
    const photographerUrl = String(photo.photographer_url || "");
    if (!photo.id || !officialUrl(pageUrl, pexelsPageHost) || !officialUrl(originalUrl, pexelsImageHost) || !officialUrl(photographerUrl, pexelsPageHost)) return [];
    return [
      {
        id: String(photo.id),
        width: Number(photo.width || 0),
        height: Number(photo.height || 0),
        photographerName: String(photo.photographer || "Pexels photographer"),
        photographerUrl,
        sourcePageUrl: pageUrl,
        originalUrl,
        largeUrl: String(photo.src?.large2x || originalUrl),
        thumbnailUrl: String(photo.src?.medium || photo.src?.large2x || originalUrl),
        alt: String(photo.alt || ""),
        avgColor: String(photo.avg_color || ""),
      },
    ];
  });
  return {
    query,
    page: Number(body.page || page),
    perPage: Number(body.per_page || perPage),
    totalResults: Number(body.total_results || photos.length),
    hasNextPage: Boolean(body.next_page),
    photos,
    rateLimit: {
      limit: response.headers.get("x-ratelimit-limit") || "",
      remaining: response.headers.get("x-ratelimit-remaining") || "",
      reset: response.headers.get("x-ratelimit-reset") || "",
    },
    attributionNotice: "Photos provided by Pexels",
    licenseUrl: pexelsLicenseUrl,
  };
}

export function assertPexelsBulkAllowed(input: { confirmedByUser?: boolean; permissionEvidence?: string }) {
  if (!pexelsStatus().bulkPermissionConfirmed || input.confirmedByUser !== true || String(input.permissionEvidence || "").trim().length < 8) {
    throw new Error("Pexels 대량 사용 허가와 사용자 확인이 모두 검증되지 않아 batch download를 거부했습니다.");
  }
  return true;
}

export async function saveSelectedPexelsPhoto(input: { photo: PexelsSearchPhoto; collectionId: string; categoryId: string; matchedQuery: string; dryRun?: boolean }) {
  const photo = input.photo;
  if (!/^\d+$/.test(photo.id) || !officialUrl(photo.sourcePageUrl, pexelsPageHost) || !officialUrl(photo.originalUrl, pexelsImageHost) || !officialUrl(photo.photographerUrl, pexelsPageHost)) {
    throw new Error("공식 Pexels 검색 결과만 저장할 수 있습니다.");
  }
  const response = await fetch(photo.originalUrl, {
    headers: { Accept: "image/jpeg,image/png,image/webp" },
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`Pexels 이미지 저장 실패: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 50 * 1024 * 1024) throw new Error("Pexels 원본 파일이 50MB를 초과합니다.");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 50 * 1024 * 1024) throw new Error("Pexels 원본 파일이 50MB를 초과합니다.");
  const now = new Date().toISOString();
  const license: Partial<BackgroundLicense> & { manuallyReviewed?: boolean } = {
    sourceType: "pexels",
    sourceName: "Pexels",
    sourcePageUrl: photo.sourcePageUrl,
    creatorName: photo.photographerName,
    creatorUrl: photo.photographerUrl,
    licenseType: "Pexels License",
    licenseUrl: pexelsLicenseUrl,
    proofPath: photo.sourcePageUrl,
    commercialUseAllowed: true,
    attributionRequired: false,
    attributionText: `Photo by ${photo.photographerName} on Pexels`,
    acquiredAt: now,
    licenseCheckedAt: now,
    licenseStatus: "verified",
    manuallyReviewed: false,
  };
  return importBackgroundSources({
    collectionId: input.collectionId,
    categoryId: input.categoryId,
    sourceType: "pexels",
    dryRun: input.dryRun,
    sources: [
      {
        name: `pexels-${photo.id}.jpg`,
        buffer,
        license,
        matchedQuery: input.matchedQuery,
        providerPhotoId: photo.id,
        originalUrl: photo.originalUrl,
      },
    ],
  });
}
