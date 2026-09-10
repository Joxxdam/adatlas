import assert from "node:assert/strict";
import test from "node:test";
import { collectSitePageImages, siteImageCandidatesForProductInfo } from "../app/lib/mvp/siteImageCandidateExtraction.server.ts";
import { collectSameDomainSiteLinks, extractSitePageSignals } from "../app/lib/mvp/siteBusinessAnalysis.server.ts";

test("사이트 분석은 상품 필터 없이 페이지 콘텐츠 이미지·로고·배경을 순서대로 수집한다", () => {
  const html = `
    <html>
      <head>
        <meta property="og:image" content="/media/hero.jpg" />
        <link rel="preload" as="image" href="/images/intro.webp" />
      </head>
      <body>
        <img src="/images/logo.png" alt="회사 로고" width="180" height="60" />
        <img data-src="/images/service-screen-1.png" alt="자동 포스팅 화면" width="960" height="600" />
        <picture><source srcset="/images/mobile-small.jpg 480w, /images/mobile-large.jpg 1200w" /></picture>
        <section data-bg="/images/lazy-section.jpg"></section>
        <section style="background-image:url('/assets/result-banner.jpg')"></section>
        <img src="/images/tracking-pixel.png" width="1" height="1" />
      </body>
    </html>
  `;

  const images = collectSitePageImages(html, "https://example.com/service");
  assert.deepEqual(images.map((item) => item.url), [
    "https://example.com/media/hero.jpg",
    "https://example.com/images/intro.webp",
    "https://example.com/images/logo.png",
    "https://example.com/images/service-screen-1.png",
    "https://example.com/images/mobile-large.jpg",
    "https://example.com/images/lazy-section.jpg",
    "https://example.com/assets/result-banner.jpg",
  ]);
});

test("사이트 분석은 같은 도메인의 서비스·가격·지원 페이지를 발견하고 외부·회원 링크는 제외한다", () => {
  const html = `
    <nav>
      <a href="/service">서비스</a>
      <a href="/pricing?utm_source=test">가격</a>
      <a href="/support">지원자료</a>
      <a href="/login">로그인</a>
      <a href="https://outside.example/news">외부 기사</a>
    </nav>
  `;
  const links = collectSameDomainSiteLinks(html, "https://example.com/", "https://example.com/");
  assert.deepEqual(links.map((item) => item.url), [
    "https://example.com/service",
    "https://example.com/pricing",
    "https://example.com/support",
  ]);
});

test("사이트 페이지 신호는 제목·설명뿐 아니라 본문 헤딩과 전환 문구를 추출한다", () => {
  const page = extractSitePageSignals({
    url: "https://example.com/service",
    html: `<html><head><title>서비스 소개</title><meta name="description" content="반복 업무를 자동화합니다"></head><body><h1>고객사의 성장을 지원합니다</h1><h2>실시간 상담</h2><p>여러 채널을 한 번에 관리하세요.</p><button>무료로 시작하기</button></body></html>`,
  });
  assert.equal(page.title, "서비스 소개");
  assert.equal(page.description, "반복 업무를 자동화합니다");
  assert.deepEqual(page.headings, ["고객사의 성장을 지원합니다", "실시간 상담"]);
  assert.ok(page.callsToAction.includes("무료로 시작하기"));
  assert.match(page.text, /여러 채널을 한 번에 관리하세요/);
});

test("사이트 이미지 후보는 점수 선별 없이 수집된 전체 목록을 제작 UI에 전달한다", () => {
  const candidates = Array.from({ length: 37 }, (_, index) => ({
    url: `https://cdn.example.com/content/${index + 1}.jpg`,
    label: `페이지 이미지 ${index + 1}`,
    order: index,
    source: "image",
  }));
  const result = siteImageCandidatesForProductInfo(candidates, "2026-09-09T00:00:00.000Z");
  assert.equal(result.imageCandidates.length, 37);
  assert.equal(result.sourceImageCandidates.length, 37);
  assert.equal(result.sourceImageCandidates[0].selected, true);
  assert.equal(result.sourceImageCandidates[36].imagePath, "https://cdn.example.com/content/37.jpg");
});

test("상품 분석 API는 유지하고 사이트 분석 API를 별도 경로로 둔다", async () => {
  const { readFile } = await import("node:fs/promises");
  const dashboard = await readFile(new URL("../app/components/MvpDashboard.tsx", import.meta.url), "utf8");
  const productRoute = await readFile(new URL("../app/api/extract/product/route.ts", import.meta.url), "utf8");
  const siteRoute = await readFile(new URL("../app/api/extract/site/route.ts", import.meta.url), "utf8");
  const siteSummary = await readFile(new URL("../app/components/features/product-brief/SiteAnalysisSummary.tsx", import.meta.url), "utf8");
  const generator = await readFile(new URL("../app/components/features/creative-generation/SixCreativeGenerator.tsx", import.meta.url), "utf8");

  assert.match(dashboard, /상품 분석하기/);
  assert.match(dashboard, /사이트 분석하기/);
  assert.match(dashboard, /fetch\("\/api\/extract\/site"/);
  assert.match(dashboard, /fetch\("\/api\/extract\/product"/);
  assert.match(productRoute, /stripDifferentProductLinkBlocks/);
  assert.doesNotMatch(siteRoute, /stripDifferentProductLinkBlocks|resolveProductDetailOcrBudget|analyzeProductSourceCandidates/);
  assert.match(siteRoute, /crawlPublicSite/);
  assert.match(siteRoute, /analyzeSiteBusiness/);
  assert.match(siteRoute, /captureRenderedSiteSections/);
  assert.match(siteRoute, /collectSitePageImages/);
  assert.match(dashboard, /productInfo\.analysisMode === "site"/);
  assert.match(siteSummary, /우선 타겟/);
  assert.match(siteSummary, /추천 광고 방향/);
  assert.match(siteSummary, /visuals\.map/);
  assert.match(siteSummary, /로고/);
  assert.match(siteSummary, /마스코트/);
  assert.match(siteSummary, /기능 이미지/);
  assert.match(siteSummary, /onVisualSelectionsChange/);
  assert.match(generator, /siteAnalysisMode \? \"사이트 시각 자료와 추가 사항을 확인해 주세요\"/);
  assert.match(generator, /사이트 시각 자료는 위의 사이트 분석 결과에서 한 번만 선택합니다/);
});
