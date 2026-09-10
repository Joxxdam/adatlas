import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { ExtractedProductInfo } from "../../../lib/mvp/types";
import { analyzeSiteBusiness, crawlPublicSite } from "../../../lib/mvp/siteBusinessAnalysis.server";
import { collectSitePageImages, siteImageCandidatesForProductInfo, type PageImageCandidate } from "../../../lib/mvp/siteImageCandidateExtraction.server";
import { captureRenderedSiteSections } from "../../../lib/mvp/siteSectionCapture.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function compactText(value: string, maxLength: number) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.slice(0, maxLength);
}

function uniqueCandidates(candidates: PageImageCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.url.replace(/#.*$/, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pageImageCandidates(crawl: Awaited<ReturnType<typeof crawlPublicSite>>) {
  return uniqueCandidates(
    crawl.pages.flatMap((page, pageIndex) =>
      collectSitePageImages(page.html, page.url).map((candidate, imageIndex) => ({
        ...candidate,
        label: `${page.title || `페이지 ${pageIndex + 1}`} · ${candidate.label}`,
        order: 100_000 + pageIndex * 10_000 + imageIndex,
      }))
    )
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const siteUrl = String(body.siteUrl || body.productUrl || "").trim();
    if (!siteUrl) {
      return NextResponse.json({ ok: false, error: "siteUrl is required." }, { status: 400 });
    }

    const crawl = await crawlPublicSite(siteUrl);
    const staticImages = pageImageCandidates(crawl);
    const analysisId = `site-${randomUUID()}`;
    const [siteAnalysis, rendered] = await Promise.all([
      analyzeSiteBusiness(crawl),
      captureRenderedSiteSections({ pages: crawl.pages, analysisId }).catch((error) => ({
        captures: [] as PageImageCandidate[],
        warning: `사이트 화면 구간 수집 실패: ${error instanceof Error ? error.message : "렌더링 오류"}`,
      })),
    ]);
    const allCandidates = uniqueCandidates([...rendered.captures, ...staticImages]);
    const { imageCandidates, sourceImageCandidates } = siteImageCandidatesForProductInfo(allCandidates);
    const galleryImages = allCandidates.map((candidate) => candidate.url);
    const mainImage = galleryImages[0] || "";
    siteAnalysis.renderedSectionCount = rendered.captures.length;
    siteAnalysis.warnings = Array.from(new Set([...siteAnalysis.warnings, ...(rendered.warning ? [rendered.warning] : [])])).filter(Boolean);

    const pageTitle = compactText(siteAnalysis.oneLineSummary || crawl.pages[0]?.title || crawl.siteName, 180);
    const description = compactText(siteAnalysis.oneLineSummary || crawl.pages[0]?.description || "", 700);
    const mainBenefit = compactText(siteAnalysis.coreValueProps.join(" · ") || siteAnalysis.businessModel || description, 700);
    const targetCustomer = compactText(siteAnalysis.targetPriorities.slice(0, 4).map((target) => target.name).join(", "), 300);

    const productInfo: ExtractedProductInfo = {
      productName: crawl.pages[0]?.title || pageTitle,
      category: "서비스",
      price: "",
      originalPrice: "",
      oldPrice: "",
      discountInfo: "",
      brandName: crawl.siteName,
      detectedProductType: "service",
      categoryKeywords: ["서비스", "사이트"],
      mainImage,
      galleryImages,
      confirmedProductImages: galleryImages,
      description,
      extractedDescription: description,
      mainBenefit,
      targetCustomer,
      landingUrl: siteUrl,
      heroImage: mainImage,
      detailImages: galleryImages.slice(1),
      imageCandidates,
      sourceImageCandidates,
      reviewSources: [],
      detailImageOcrInsights: [],
      productCopyConstraints: [],
      verifiedBenefits: siteAnalysis.coreValueProps,
      ingredients: [],
      analysisMode: "site",
      siteAnalysis,
    };

    return NextResponse.json({
      ok: true,
      success: true,
      productInfo,
      siteName: crawl.siteName,
      pageTitle,
      images: galleryImages,
      siteAnalysis,
      debug: {
        analysisId,
        crawledPageCount: crawl.pages.length,
        sourceImageCount: staticImages.length,
        renderedSectionCount: rendered.captures.length,
        totalVisualCount: galleryImages.length,
        collectionMode: "same-domain-site-analysis",
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "사이트 분석에 실패했습니다." }, { status: 500 });
  }
}
