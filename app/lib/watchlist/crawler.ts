import { analyzeContent } from "./analyzer";
import { readWatchlist, saveContentAnalyses } from "./store";
import { ContentAnalysis, CrawledContent, WatchlistBrand } from "./types";

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .trim();
}

function absoluteUrl(src: string, baseUrl: string) {
  try {
    return new URL(decodeHtml(src), baseUrl).toString();
  } catch {
    return "";
  }
}

function metaContent(html: string, name: string) {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeHtml(match[1]);
    }
  }

  return "";
}

function extractImages(html: string, baseUrl: string) {
  const urls = [
    metaContent(html, "og:image"),
    metaContent(html, "twitter:image"),
    ...[...html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi)].map(
      (match) => match[1]
    ),
  ]
    .map((src) => absoluteUrl(src, baseUrl))
    .filter((src) => /\.(png|jpe?g|webp|avif)(\?|$)/i.test(src))
    .filter((src) => !/(logo|favicon|sprite|icon)/i.test(src));

  return [...new Set(urls)].slice(0, 8);
}

async function fetchContent(
  brand: WatchlistBrand,
  source: CrawledContent["source"],
  url?: string
): Promise<CrawledContent> {
  if (!url) {
    return {
      brandId: brand.id,
      brand: brand.brand,
      source,
      text: `${brand.brand}\n${brand.referenceStrength}\n${brand.hookPattern}\n${brand.memo}`,
      mediaUrls: [],
      fetchedAt: new Date().toISOString(),
      ok: true,
    };
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "AdAtlasBot/0.1 (+local research dashboard)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const html = await response.text();
    const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const description = metaContent(html, "description") || metaContent(html, "og:description");
    const mediaUrls = extractImages(html, url);

    return {
      brandId: brand.id,
      brand: brand.brand,
      source,
      url,
      title,
      description,
      text: stripHtml(html).slice(0, 8000),
      mediaUrls,
      fetchedAt: new Date().toISOString(),
      ok: response.ok,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      brandId: brand.id,
      brand: brand.brand,
      source,
      url,
      text: `${brand.brand}\n${brand.referenceStrength}\n${brand.hookPattern}\n${brand.memo}`,
      mediaUrls: [],
      fetchedAt: new Date().toISOString(),
      ok: false,
      error: error instanceof Error ? error.message : "크롤링 실패",
    };
  }
}

export async function crawlWatchlist(options: { limit?: number; priority?: string } = {}) {
  const watchlist = (await readWatchlist())
    .filter((brand) => brand.enabled)
    .filter((brand) => !options.priority || brand.priority === options.priority)
    .slice(0, options.limit ?? 100);

  const analyses: ContentAnalysis[] = [];

  for (const brand of watchlist) {
    const contents = [
      await fetchContent(brand, "watchlist"),
      await fetchContent(brand, "meta", brand.urls.meta),
      await fetchContent(brand, "google", brand.urls.google),
      await fetchContent(brand, "website", brand.urls.website),
    ];

    for (const content of contents) {
      analyses.push(analyzeContent(brand, content));
    }
  }

  const saved = await saveContentAnalyses(analyses);
  return { brands: watchlist.length, analyses: analyses.length, ...saved };
}
