import { chromium, type Browser, type Locator, type Page } from "playwright";
import { MetaAdCard, MetaCrawlRequest, MetaCrawlResult } from "./types";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 5;

function normalizeLimit(limit?: number) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)));
}

function isLikelyMetaAdUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes("facebook.com") && parsed.pathname.includes("/ads/library");
  } catch {
    return false;
  }
}

function shouldRunHeadless() {
  const configured = process.env.META_CRAWLER_HEADLESS;
  if (configured === "false") return false;
  return true;
}

async function safeText(locator: Locator) {
  try {
    return (await locator.innerText({ timeout: 1200 })).replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

async function safeAttr(locator: Locator, attr: string) {
  try {
    return (await locator.getAttribute(attr, { timeout: 800 })) ?? undefined;
  } catch {
    return undefined;
  }
}

function absoluteUrl(value: string | undefined, baseUrl: string) {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function imageFromStyle(value: string | undefined, baseUrl: string) {
  const match = value?.match(/url\(["']?([^"')]+)["']?\)/i);
  return absoluteUrl(match?.[1], baseUrl);
}

function extractStartedAt(text: string) {
  const patterns = [
    /Started running on\s+([^.\n]+)/i,
    /Library ID:\s*\d+[\s\S]{0,160}?Started running on\s+([^.\n]+)/i,
    /게재 시작[:\s]+([^.\n]+)/i,
    /시작일[:\s]+([^.\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

async function extractCard(card: Locator, brandName: string, pageUrl: string): Promise<MetaAdCard> {
  const crawledAt = new Date().toISOString();
  const text = await safeText(card);
  const imageUrl = absoluteUrl(await safeAttr(card.locator("img").first(), "src"), pageUrl);
  const videoThumbnailUrl =
    absoluteUrl(await safeAttr(card.locator("video").first(), "poster"), pageUrl) ??
    imageFromStyle(
      await safeAttr(card.locator("[style*='background-image']").first(), "style"),
      pageUrl
    );
  const rawSnapshotHref =
    (await safeAttr(card.locator("a[href*='ads/library/?id=']").first(), "href")) ??
    (await safeAttr(card.locator("a[href*='ad_archive_id']").first(), "href")) ??
    (await safeAttr(card.locator("a[href*='library_id']").first(), "href"));
  const adSnapshotUrl = absoluteUrl(rawSnapshotHref, pageUrl);
  const landingHref =
    (await safeAttr(card.locator("a[href^='http']").last(), "href")) ??
    (await safeAttr(card.locator("a[role='link']").last(), "href"));
  const landingUrl = absoluteUrl(landingHref, pageUrl);

  return {
    brandName,
    adText: text,
    imageUrl,
    videoThumbnailUrl,
    landingUrl,
    adSnapshotUrl,
    startedAt: extractStartedAt(text),
    crawledAt,
  };
}

async function collectCandidateCards(page: Page) {
  const selectors = [
    "[data-testid='ad-library-card']",
    "div:has-text('Library ID')",
    "div:has-text('Sponsored')",
    "div:has-text('Started running')",
    "div[role='article']",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count().catch(() => 0);
    if (count > 0) {
      return locator;
    }
  }

  return page.locator("div");
}

async function scrollToLoad(page: Page, limit: number) {
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(900);

    const cards = await collectCandidateCards(page);
    const count = await cards.count().catch(() => 0);
    if (count >= limit) {
      break;
    }
  }
}

async function collectImageCandidates(
  page: Page,
  brandName: string,
  limit: number
): Promise<MetaAdCard[]> {
  const pageUrl = page.url();
  const crawledAt = new Date().toISOString();
  const candidates = await page.evaluate(() => {
    const blocked = /(logo|icon|favicon|sprite|emoji|profile|avatar|badge|static.xx.fbcdn.net)/i;

    return Array.from(document.images)
      .map((image) => {
        const source =
          image.currentSrc ||
          image.src ||
          image.getAttribute("data-src") ||
          image.getAttribute("data-imgsrc") ||
          image.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0] ||
          "";

        return {
          source,
          alt: image.alt || "",
          width: image.naturalWidth || image.width || 0,
          height: image.naturalHeight || image.height || 0,
        };
      })
      .filter((item) => item.source)
      .filter((item) => !item.source.startsWith("data:") && !item.source.startsWith("blob:"))
      .filter((item) => !blocked.test(item.source) && !blocked.test(item.alt))
      .filter((item) => item.width >= 250 && item.height >= 250)
      .sort((a, b) => {
        const aLargeEnough = a.width >= 300 && a.height >= 300 ? 1 : 0;
        const bLargeEnough = b.width >= 300 && b.height >= 300 ? 1 : 0;
        return bLargeEnough - aLargeEnough || b.width * b.height - a.width * a.height;
      });
  });

  const byUrl = new Map<string, MetaAdCard>();

  for (const candidate of candidates) {
    const imageUrl = absoluteUrl(candidate.source, pageUrl);
    if (!imageUrl || byUrl.has(imageUrl)) continue;

    byUrl.set(imageUrl, {
      brandName,
      adText: candidate.alt,
      imageUrl,
      crawledAt,
    });

    if (byUrl.size >= limit) break;
  }

  return [...byUrl.values()];
}

export async function crawlMetaAdLibrary(request: MetaCrawlRequest): Promise<MetaCrawlResult> {
  const brandName = request.brandName.trim();
  const metaLibraryUrl = request.metaLibraryUrl.trim();
  const limit = normalizeLimit(request.limit);
  const warnings: string[] = [];

  if (!brandName) {
    throw new Error("brandName is required.");
  }
  if (!metaLibraryUrl || !isLikelyMetaAdUrl(metaLibraryUrl)) {
    throw new Error("A valid Meta Ad Library URL is required.");
  }

  let browser: Browser | undefined;

  try {
    browser = await chromium.launch({
      headless: shouldRunHeadless(),
      slowMo: process.env.NODE_ENV === "development" ? 80 : 0,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1200 },
      locale: "ko-KR",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    });
    const page = await context.newPage();

    try {
      await page.goto(metaLibraryUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    } catch (error) {
      throw new Error(
        `Meta 페이지 접속 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`
      );
    }
    await page.waitForTimeout(2500);
    await scrollToLoad(page, limit);

    const imageCandidates = await collectImageCandidates(page, brandName, limit);
    if (imageCandidates.length >= limit) {
      return {
        brandName,
        metaLibraryUrl,
        limit,
        count: imageCandidates.length,
        ads: imageCandidates,
        warnings,
        crawledAt: new Date().toISOString(),
      };
    }

    const cards = await collectCandidateCards(page);
    const count = Math.min(await cards.count(), limit * 3);
    const byKey = new Map<string, MetaAdCard>(
      imageCandidates.map((ad) => [ad.imageUrl ?? ad.adSnapshotUrl ?? ad.adText, ad])
    );

    for (let index = 0; index < count && byKey.size < limit; index += 1) {
      try {
        const ad = await extractCard(cards.nth(index), brandName, page.url());
        const hasUsefulData = ad.adText || ad.imageUrl || ad.videoThumbnailUrl || ad.adSnapshotUrl;
        if (!hasUsefulData) {
          continue;
        }

        const dedupeKey = ad.adSnapshotUrl ?? `${ad.imageUrl ?? ""}:${ad.adText.slice(0, 120)}`;
        if (!byKey.has(dedupeKey)) {
          byKey.set(dedupeKey, ad);
        }
      } catch (error) {
        warnings.push(
          error instanceof Error ? error.message : `Card ${index + 1} extraction failed.`
        );
      }
    }

    return {
      brandName,
      metaLibraryUrl,
      limit,
      count: byKey.size,
      ads: [...byKey.values()],
      warnings,
      crawledAt: new Date().toISOString(),
    };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
