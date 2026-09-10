import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { PageImageCandidate } from "./siteImageCandidateExtraction.server";
import type { CrawledSitePage } from "./siteBusinessAnalysis.server";
import { validatePublicHttpUrl } from "../store-analysis/urlSafety.ts";

const MAX_CAPTURE_PAGES = 6;
const MAX_CAPTURES_PER_PAGE = 5;

function browserExecutablePath() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function safeFilePart(value: string, fallback: string) {
  const normalized = value.normalize("NFKC").replace(/[^a-z0-9가-힣_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return normalized || fallback;
}

async function installSafeRequestPolicy(context: BrowserContext) {
  const validation = new Map<string, Promise<boolean>>();
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!/^(?:GET|HEAD)$/i.test(request.method())) return route.abort("blockedbyclient");
    if (["websocket", "media", "eventsource"].includes(request.resourceType())) return route.abort("blockedbyclient");
    const url = request.url();
    if (/^(?:data:|blob:|about:)/i.test(url)) return route.continue();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return route.abort("blockedbyclient");
    }
    const key = `${parsed.protocol}//${parsed.host}`;
    let pending = validation.get(key);
    if (!pending) {
      pending = validatePublicHttpUrl(key).then(() => true).catch(() => false);
      validation.set(key, pending);
    }
    return (await pending) ? route.continue() : route.abort("blockedbyclient");
  });
}

async function meaningfulSections(page: Page) {
  return page.locator("main > section, main > div, [role='main'] > section, [role='main'] > div, body > section").evaluateAll((elements, limit) =>
    elements
      .map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        const imageCount = element.querySelectorAll("img, picture, video, canvas, svg").length;
        return { index, x: rect.x, y: rect.y + window.scrollY, width: rect.width, height: rect.height, visible: style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0, textLength: text.length, imageCount };
      })
      .filter((item) => item.visible && item.width >= 540 && item.height >= 220 && item.height <= 1_800 && (item.textLength >= 20 || item.imageCount > 0))
      .sort((left, right) => left.y - right.y)
      .slice(0, limit),
    MAX_CAPTURES_PER_PAGE
  );
}

async function capturePageSections(input: {
  page: Page;
  sitePage: CrawledSitePage;
  outputDirectory: string;
  publicDirectory: string;
  pageIndex: number;
}) {
  await input.page.goto(input.sitePage.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await input.page.waitForTimeout(750);
  await input.page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important} [aria-modal='true']{display:none!important}" }).catch(() => undefined);
  const locator = input.page.locator("main > section, main > div, [role='main'] > section, [role='main'] > div, body > section");
  const sections = await meaningfulSections(input.page);
  const captures: PageImageCandidate[] = [];

  for (let captureIndex = 0; captureIndex < sections.length; captureIndex += 1) {
    const section = sections[captureIndex];
    const filename = `page-${String(input.pageIndex + 1).padStart(2, "0")}-section-${String(captureIndex + 1).padStart(2, "0")}.jpg`;
    const outputPath = path.join(input.outputDirectory, filename);
    try {
      const item = locator.nth(section.index);
      await item.scrollIntoViewIfNeeded();
      await input.page.waitForTimeout(120);
      await item.screenshot({ path: outputPath, type: "jpeg", quality: 84, animations: "disabled" });
      captures.push({
        url: `${input.publicDirectory}/${filename}`,
        label: `${input.sitePage.title || safeFilePart(input.sitePage.url, "사이트")} · 화면 구간 ${captureIndex + 1}`,
        order: input.pageIndex * 10_000 + captureIndex,
        source: "capture",
      });
    } catch {
      // 한 구간의 렌더 실패가 나머지 사이트 분석을 막지 않게 합니다.
    }
  }

  if (!captures.length) {
    const filename = `page-${String(input.pageIndex + 1).padStart(2, "0")}-view-01.jpg`;
    const outputPath = path.join(input.outputDirectory, filename);
    await input.page.screenshot({ path: outputPath, type: "jpeg", quality: 84, fullPage: false, animations: "disabled" });
    captures.push({
      url: `${input.publicDirectory}/${filename}`,
      label: `${input.sitePage.title || safeFilePart(input.sitePage.url, "사이트")} · 화면`,
      order: input.pageIndex * 10_000,
      source: "capture",
    });
  }
  return captures;
}

export async function captureRenderedSiteSections(input: { pages: CrawledSitePage[]; analysisId: string }) {
  const executablePath = browserExecutablePath();
  if (!executablePath) {
    return { captures: [] as PageImageCandidate[], warning: "사이트 화면 구간을 수집할 Chrome 또는 Chromium을 찾지 못했습니다." };
  }
  const safeAnalysisId = safeFilePart(input.analysisId, "site-analysis");
  const relativeDirectory = `/extracted/site-analysis/${safeAnalysisId}`;
  const outputDirectory = path.join(process.cwd(), "public", "extracted", "site-analysis", safeAnalysisId);
  await fs.promises.mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1, locale: "ko-KR" });
    await installSafeRequestPolicy(context);
    const captures: PageImageCandidate[] = [];
    const warnings: string[] = [];
    for (let pageIndex = 0; pageIndex < Math.min(MAX_CAPTURE_PAGES, input.pages.length); pageIndex += 1) {
      const sitePage = input.pages[pageIndex];
      const page = await context.newPage();
      try {
        captures.push(...(await capturePageSections({ page, sitePage, outputDirectory, publicDirectory: relativeDirectory, pageIndex })));
      } catch (error) {
        warnings.push(`${sitePage.title || sitePage.url} 화면 구간 수집 실패: ${error instanceof Error ? error.message : "렌더링 오류"}`);
      } finally {
        await page.close();
      }
    }
    await context.close();
    return { captures, warning: warnings.join(" ") };
  } finally {
    await browser.close();
  }
}
