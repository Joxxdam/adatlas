import "server-only";

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import type { VideoConcept, VideoProject } from "./types.ts";
import { buildVideoPlanningPdfHtml } from "./videoPlanningPdf.ts";

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

export async function renderVideoPlanningPdf(project: VideoProject, concept: VideoConcept) {
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSansKR-Variable.ttf");
  const fontDataBase64 = await fs.promises.readFile(fontPath, "base64");
  const executablePath = browserExecutablePath();
  if (!executablePath) {
    throw new Error("PDF 렌더링에 사용할 Chrome 또는 Chromium을 찾지 못했습니다.");
  }
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage();
    await page.setContent(
      buildVideoPlanningPdfHtml({ project, concept, fontDataBase64 }),
      { waitUntil: "load" }
    );
    await page.emulateMedia({ media: "print" });
    return Buffer.from(
      await page.pdf({
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate:
          '<div style="width:100%;padding:0 13mm;color:#8290a2;font-family:Arial,sans-serif;font-size:8px;text-align:right"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      })
    );
  } finally {
    await browser.close();
  }
}
