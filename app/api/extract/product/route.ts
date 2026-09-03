import { NextResponse } from "next/server";
import type { ExtractedProductInfo, ProductImageCandidate, SourceImageCandidate } from "../../../lib/mvp/types";
import { analyzeProductSourceCandidates } from "../../../lib/mvp/productImageAnalysis.server";
import { inferProductRepresentation } from "../../../lib/mvp/productImagePipeline";
import { analyzeReviewSourceCandidates } from "../../../lib/mvp/reviewImageAnalysis.server";
import { analyzeProductDetailImageCandidates } from "../../../lib/mvp/productDetailOcr.server";
import { inferProductDetailOcrEvidenceRoles, resolveProductDetailOcrBudget } from "../../../lib/mvp/productDetailOcrSelection.ts";
import { isMerchantCredentialOnlyDetailImage } from "../../../lib/creative-generation/productSignalHygiene.ts";
import { normalizeCafe24BundlePricingClaims, resolveCafe24RequiredBundlePricing } from "../../../lib/store-analysis/extractors/cafe24Pricing";
import { applyOriginalSourceVendorResearch, matchOriginalSourceVendorResearch } from "../../../lib/product-research/originalSourceResearch";
import { evaluateProductImageIdentity, filterCurrentProductImages, isDifferentProductImage, stripDifferentProductLinkBlocks } from "../../../lib/mvp/productImageIdentity.ts";
import { decodeHtmlResponse, isSafeHttpUrl } from "../../../lib/mvp/productPageResponse.server";
import {
  absoluteUrl,
  extractCategory,
  extractDiscountInfo,
  extractJsonLd,
  extractOriginalPrice,
  extractPrice,
  invalidProductPageMessage,
  metaContent,
  normalizeProductCategory,
  titleContent,
} from "../../../lib/mvp/productHtmlSignals.server";
import {
  classifyProductType,
  collectGalleryImages,
  extractEnhancedImageCandidates,
  extractProductUspDescription,
  extractStructuredProductSignals,
  isRecommendedThumbnailUrl,
  maxDetailImages,
  maxGalleryImages,
  mergeImageUrls,
  normalizeImageUrlForDedup,
  selectMainBenefit,
  selectMainProductImage,
} from "../../../lib/mvp/productImageCandidateExtraction.server";
import { collectReviewImageCandidates } from "../../../lib/mvp/productReviewCandidateExtraction.server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const productUrl = String(body.productUrl || "").trim();

    if (!productUrl) {
      return NextResponse.json({ ok: false, error: "productUrl is required." }, { status: 400 });
    }

    let url: URL;
    try {
      url = new URL(productUrl);
    } catch {
      return NextResponse.json({ ok: false, error: "Enter a valid product URL." }, { status: 400 });
    }

    if (!isSafeHttpUrl(url.toString())) {
      return NextResponse.json({ ok: false, error: "Only http and https URLs are supported." }, { status: 400 });
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; AdAtlasProductExtractor/1.0)",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: `Product page request failed: HTTP ${response.status}` }, { status: 502 });
    }

    const html = decodeHtmlResponse(await response.arrayBuffer(), response.headers.get("content-type")).slice(0, 2_000_000);
    const invalidPageMessage = invalidProductPageMessage(html, url);
    if (invalidPageMessage) {
      return NextResponse.json({ ok: false, error: invalidPageMessage }, { status: 422 });
    }

    const jsonLd = extractJsonLd(html, url.toString());
    const productName = jsonLd.name || metaContent(html, "og:title") || metaContent(html, "twitter:title") || titleContent(html);
    // 추천상품 카드의 다른 goodsNo가 본문 문구·OCR 후보·상품 이미지에 함께
    // 들어오는 것을 도메인별 클래스명이 아니라 상품번호 경계로 먼저 차단합니다.
    const productScopedHtml = stripDifferentProductLinkBlocks(url.toString(), html);
    const fallbackPrice = extractPrice(html, jsonLd.price);
    const fallbackOriginalPrice = extractOriginalPrice(html, fallbackPrice);
    const cafe24BundlePricing = resolveCafe24RequiredBundlePricing(html, productName);
    const price = cafe24BundlePricing?.price || fallbackPrice;
    const originalPrice = cafe24BundlePricing?.originalPrice || fallbackOriginalPrice;
    const rawBaseDescription = jsonLd.description || metaContent(html, "og:description") || metaContent(html, "description") || metaContent(html, "twitter:description");
    const baseDescription = cafe24BundlePricing ? normalizeCafe24BundlePricingClaims(rawBaseDescription, cafe24BundlePricing) : rawBaseDescription;
    const rawExtractedDescription = extractProductUspDescription(productScopedHtml, baseDescription, productName);
    const extractedDescription = cafe24BundlePricing ? normalizeCafe24BundlePricingClaims(rawExtractedDescription, cafe24BundlePricing) : rawExtractedDescription;
    const structuredSignals = extractStructuredProductSignals(extractedDescription);
    const mainBenefit = selectMainBenefit(structuredSignals.verifiedBenefits, extractedDescription, productName);
    const structuredProductImages = filterCurrentProductImages(url.toString(), jsonLd.images ?? [], (image) => image);
    const openGraphImage = absoluteUrl(metaContent(html, "og:image") || metaContent(html, "twitter:image"), url.toString());
    const fallbackMainImage = [...structuredProductImages, openGraphImage]
      .find((image) => image && !isDifferentProductImage(url.toString(), image)) || "";
    const collectedGalleryImages = collectGalleryImages(productScopedHtml, url.toString(), [fallbackMainImage, ...structuredProductImages]);
    const rawGalleryImages = filterCurrentProductImages(url.toString(), collectedGalleryImages, (image) => image);
    const collectedEnhancedCandidates = extractEnhancedImageCandidates(productScopedHtml, url.toString(), [fallbackMainImage, ...structuredProductImages]);
    const enhancedCandidates = filterCurrentProductImages(url.toString(), collectedEnhancedCandidates, (candidate) => candidate.url);
    const extractedCategory = extractCategory(html, jsonLd.category);
    const normalizedCategory = normalizeProductCategory(extractedCategory, [productName, baseDescription, extractedDescription].join(" "));
    const productTextForType = [jsonLd.name, jsonLd.description, normalizedCategory, metaContent(html, "og:title"), metaContent(html, "og:description")].join(" ");
    const detected = classifyProductType(productTextForType);
    const candidateUrls = enhancedCandidates.map((candidate) => candidate.url);
    const mergedGalleryCandidates = mergeImageUrls([...candidateUrls, ...rawGalleryImages]);
    const representation = inferProductRepresentation({
      productName,
      description: extractedDescription,
      category: normalizedCategory,
      packageType: [productName, extractedDescription].join(" "),
    });
    const rawReviewCandidates = filterCurrentProductImages(url.toString(), collectReviewImageCandidates(productScopedHtml, url.toString()), (candidate) => candidate.url);
    const detailOcrCandidates: ProductImageCandidate[] = [
      ...mergeImageUrls([...structuredProductImages, openGraphImage]).map((image, index) => ({
        url: image,
        type: "detail" as const,
        score: Math.max(70, 100 - index),
        reason: "구조화 대표 이미지 자동 확정 전 OCR 검증",
        pageOrder: index,
        evidenceRoles: ["identity" as const],
        evidenceScope: "structured-main" as const,
      })),
      ...enhancedCandidates.map((candidate) => ({
        ...candidate,
        evidenceRoles: candidate.evidenceRoles?.length
          ? candidate.evidenceRoles
          : inferProductDetailOcrEvidenceRoles(`${candidate.alt || ""} ${candidate.reason || ""} ${candidate.url}`),
        evidenceScope: candidate.evidenceScope || (candidate.type === "main" ? "structured-main" as const : candidate.type === "detail" || candidate.type === "content" ? "product-detail" as const : "gallery" as const),
      })),
      ...mergedGalleryCandidates
        .filter((image) => image !== fallbackMainImage && !enhancedCandidates.some((candidate) => candidate.url === image))
        .map((image, index) => ({
          url: image,
          type: "detail" as const,
          score: Math.max(5, 35 - index),
          reason: "상품 상세 영역에서 수집한 OCR 후보",
          pageOrder: index,
          evidenceRoles: inferProductDetailOcrEvidenceRoles(image),
          evidenceScope: "product-detail" as const,
        })),
    ];
    const curatedResearchMatch = matchOriginalSourceVendorResearch({ productName, brandName: jsonLd.brandName }, url.toString());
    const detailOcrBudget = resolveProductDetailOcrBudget({
      hasCuratedResearch: Boolean(curatedResearchMatch),
      htmlFactCount: new Set([...structuredSignals.verifiedBenefits, ...structuredSignals.ingredients]).size,
      candidateCount: detailOcrCandidates.length,
    });
    const [reviewSources, detailImageOcrInsights] = await Promise.all([
      analyzeReviewSourceCandidates({
        candidates: rawReviewCandidates,
        productName,
        productDescription: extractedDescription,
        collectLimit: 10,
        displayLimit: 5,
      }).catch(() => []),
      detailOcrBudget > 0
        ? analyzeProductDetailImageCandidates({
            candidates: detailOcrCandidates,
            productName,
            category: normalizedCategory,
            price,
            originalPrice,
            discountInfo: cafe24BundlePricing?.discountInfo || extractDiscountInfo(html, price, originalPrice),
            description: extractedDescription,
            verifiedBenefits: structuredSignals.verifiedBenefits,
            ingredients: structuredSignals.ingredients,
            maxCandidates: detailOcrBudget,
          }).catch(() => [])
        : Promise.resolve([]),
    ]);
    const productCopyConstraints = Array.from(new Set(detailImageOcrInsights.flatMap((insight) => insight.productConstraints))).slice(0, 20);
    const excludedAutoProductImageKeys = new Set(
      detailImageOcrInsights
        .filter((insight) => {
          // 수상·순위만 있는 판매자 배너는 상품 원본에서 제외합니다. 반면 실제
          // 포장 라벨이나 조리·사용 사진은 OCR 문구가 많다는 이유만으로 버리지
          // 않습니다. OCR 근거 풀과 생성용 상품 이미지 풀은 서로 다른 책임입니다.
          return isMerchantCredentialOnlyDetailImage(insight);
        })
        .map((insight) => normalizeImageUrlForDedup(insight.imageUrl))
    );
    const isAutoProductImage = (image: string | undefined) => Boolean(
      image &&
      !isDifferentProductImage(url.toString(), image) &&
      !excludedAutoProductImageKeys.has(normalizeImageUrlForDedup(image))
    );
    const rankedCandidates: ProductImageCandidate[] = [
      ...(fallbackMainImage
        ? [
            {
              url: fallbackMainImage,
              type: "main" as const,
              score: 120,
              reason: "구조화 메타데이터에서 확인한 현재 상품 대표 이미지",
            },
          ]
        : []),
      ...enhancedCandidates,
      ...mergedGalleryCandidates
        .filter((image) => !enhancedCandidates.some((candidate) => candidate.url === image))
        .map((image, index) => ({
          url: image,
          type: index === 0 ? ("gallery" as const) : ("detail" as const),
          score: Math.max(5, 45 - index),
          reason: "상세페이지 또는 갤러리에서 수집",
        })),
    ];
    let sourceImageCandidates = await analyzeProductSourceCandidates({
      candidates: rankedCandidates,
      representation,
      limit: 6,
    }).catch(() => [] as SourceImageCandidate[]);
    if (sourceImageCandidates.length < 3) {
      const existing = new Set(sourceImageCandidates.map((candidate) => candidate.imagePath));
      const createdAt = new Date().toISOString();
      const fallbackCandidates = rankedCandidates
        .filter((candidate) => candidate.url && !existing.has(candidate.url) && (!candidate.width || candidate.width >= 240) && (!candidate.height || candidate.height >= 240))
        .slice(0, 6 - sourceImageCandidates.length)
        .map((candidate, index): SourceImageCandidate => ({
          id: `source-fallback-${index + 1}`,
          type: sourceImageCandidates.length || index ? "detail" : "hero",
          imagePath: candidate.url,
          originalUrl: candidate.url,
          label: "분석 대기 원본",
          selected: false,
          createdAt,
          sourceType: candidate.type === "main" ? "product-gallery" : "detail-content",
          sourceImageQualityScore: Math.max(0.2, Math.min(0.7, candidate.score / 100)),
          salesUnitMatchScore: 0.5,
          recommendationScore: 0.45,
          analysisReason: "다운로드할 수 없어 HTML 문맥 점수만 반영했습니다.",
          expectedRepresentationType: representation.type,
          expectedExtractionScope: representation.recommendedExtractionScope,
          warnings: ["이미지 기본 정보 분석에 실패했습니다."],
        }));
      sourceImageCandidates = [...sourceImageCandidates, ...fallbackCandidates];
      if (sourceImageCandidates[0]) sourceImageCandidates[0].selected = true;
    }
    sourceImageCandidates = sourceImageCandidates.filter((candidate) => {
      const originalKey = normalizeImageUrlForDedup(candidate.originalUrl || candidate.imagePath);
      const finalKey = normalizeImageUrlForDedup(candidate.imagePath);
      const excluded = excludedAutoProductImageKeys.has(originalKey) || excludedAutoProductImageKeys.has(finalKey);
      if (excluded) {
        // 리디렉션·리사이즈 URL도 같은 수상 배너로 다시 유입되지 않게 두
        // 주소를 함께 기억합니다. OCR insight 자체는 상품 분석 자료로 남습니다.
        excludedAutoProductImageKeys.add(originalKey);
        excludedAutoProductImageKeys.add(finalKey);
      }
      return !excluded;
    });
    const inferredRepresentation = sourceImageCandidates[0]?.alreadyTransparent
      ? {
          ...representation,
          type: "already-transparent" as const,
          confidence: 0.98,
          reason: "자동 추천 원본에서 정상 투명 영역이 확인됨",
          recommendedExtractionScope: "visible-all" as const,
          selectedExtractionScope: "visible-all" as const,
        }
      : representation;
    const fallbackSelectedImage = selectMainProductImage(
      enhancedCandidates.filter((candidate) => isAutoProductImage(candidate.url)),
      mergedGalleryCandidates.filter(isAutoProductImage),
      "",
      false
    );
    const autoProductSourceScore = (candidate: SourceImageCandidate) => {
      let score = candidate.recommendationScore ?? 0;
      if (["multi-unit-set", "bundle-components"].includes(representation.type)) {
        if (candidate.multipleObjectsAreSalesUnit) score += 0.24;
        else if (candidate.hasMultipleObjects) score -= 0.12;
      }
      return score;
    };
    const rankedAutoProductSources = sourceImageCandidates
      .filter((candidate) =>
        (!candidate.hasText || evaluateProductImageIdentity(url.toString(), candidate.originalUrl || candidate.imagePath).status === "match") &&
        isAutoProductImage(candidate.originalUrl || candidate.imagePath) &&
        isAutoProductImage(candidate.imagePath)
      )
      .sort((left, right) => autoProductSourceScore(right) - autoProductSourceScore(left));
    const preferredSourceImage = rankedAutoProductSources[0];
    // OCR에서 수상·순위 증빙 전용 이미지로 확인된 구조화 이미지는 대표로
    // 승격하지 않습니다. 나머지 구조화 이미지는 분석 추천 순서에 맞춰 실제
    // 상품 사진이 썸네일과 제작 원본의 첫 장이 되도록 정렬합니다.
    const sourceRank = new Map<string, number>();
    rankedAutoProductSources.forEach((candidate, index) => {
      sourceRank.set(normalizeImageUrlForDedup(candidate.imagePath), index);
      if (candidate.originalUrl) sourceRank.set(normalizeImageUrlForDedup(candidate.originalUrl), index);
    });
    const analyzedProductImages = rankedAutoProductSources
      .filter((candidate) => (candidate.sourceImageQualityScore ?? 0) >= 0.45 && (candidate.recommendationScore ?? 0) >= 0.45)
      .map((candidate) => candidate.imagePath);
    const confirmedProductImages = mergeImageUrls([...structuredProductImages, openGraphImage, ...analyzedProductImages])
      .filter(isAutoProductImage)
      .sort((left, right) => (sourceRank.get(normalizeImageUrlForDedup(left)) ?? Number.MAX_SAFE_INTEGER) - (sourceRank.get(normalizeImageUrlForDedup(right)) ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 6);
    const mainImage = preferredSourceImage?.imagePath || confirmedProductImages[0] || fallbackSelectedImage;
    sourceImageCandidates = sourceImageCandidates.map((candidate, index) => ({
      ...candidate,
      selected: preferredSourceImage ? candidate.id === preferredSourceImage.id : index === 0,
      type: preferredSourceImage?.id === candidate.id ? "hero" : candidate.type,
      sourceType: preferredSourceImage?.id === candidate.id ? "product-gallery" : candidate.sourceType,
    }));
    const galleryImages = mergeImageUrls([...sourceImageCandidates.map((candidate) => candidate.imagePath), ...mergedGalleryCandidates])
      .filter(isAutoProductImage)
      .slice(0, maxGalleryImages);
    const detailImages = galleryImages.filter((image) => image && image !== mainImage).slice(0, maxDetailImages);
    // 자동 갤러리·OCR 후보는 대표 이미지로 보이더라도 확정 자산이 아니다.
    // JSON-LD와 페이지 대표 메타 이미지만 자동 확정하고 나머지는 사용자가
    // 직접 선택해야 user-confirmed로 승격할 수 있다.
    const baseExtractedProductInfo: ExtractedProductInfo = {
      productName,
      category: normalizedCategory,
      price,
      originalPrice,
      oldPrice: originalPrice,
      discountInfo: cafe24BundlePricing?.discountInfo || extractDiscountInfo(html, price, originalPrice),
      brandName: jsonLd.brandName,
      detectedProductType: detected.type,
      categoryKeywords: detected.keywords,
      mainImage,
      galleryImages,
      confirmedProductImages,
      description: extractedDescription,
      extractedDescription,
      mainBenefit,
      landingUrl: url.toString(),
      heroImage: mainImage,
      detailImages,
      imageCandidates: enhancedCandidates.slice(0, 30),
      sourceImageCandidates,
      productRepresentation: inferredRepresentation,
      reviewSources,
      detailImageOcrInsights,
      productCopyConstraints,
      verifiedBenefits: structuredSignals.verifiedBenefits,
      ingredients: structuredSignals.ingredients,
    };
    const extractedProductInfo = applyOriginalSourceVendorResearch(baseExtractedProductInfo, url.toString());

    // AI-native 제작은 상세페이지의 실제 제품·사용·질감 이미지를 그대로
    // 참조한다. 과거 템플릿 합성용 등록 누끼로 대표 이미지를 교체하지 않는다.
    const productInfo: ExtractedProductInfo = extractedProductInfo;

    if (!productInfo.productName && !productInfo.price && !productInfo.mainImage) {
      return NextResponse.json(
        {
          ok: false,
          error: "상품 상세 정보를 찾지 못했습니다. 상품 목록이 아닌 실제 상품 상세페이지 URL인지 확인해주세요.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      ok: true,
      success: true,
      productInfo,
      productName: productInfo.productName,
      price: productInfo.price,
      heroImage: mainImage,
      detailImages,
      imageCandidates: productInfo.imageCandidates,
      sourceImageCandidates,
      reviewSources,
      debug: {
        totalImageUrlsFound: enhancedCandidates.length || rawGalleryImages.length,
        imageCandidatesReturned: productInfo.imageCandidates?.length || 0,
        rejectedImageCount: Math.max(0, collectedEnhancedCandidates.length - enhancedCandidates.length) + Math.max(0, collectedGalleryImages.length - rawGalleryImages.length) + Math.max(0, mergedGalleryCandidates.length - galleryImages.length),
        mainImageSource: isRecommendedThumbnailUrl(mainImage) ? "fallback-thumbnail" : enhancedCandidates.some((candidate) => candidate.url === mainImage) ? "html" : galleryImages.includes(mainImage) ? "gallery" : fallbackMainImage ? "og" : "none",
        detectedProductType: detected.type,
        reviewCandidatesFound: rawReviewCandidates.length,
        reviewCandidatesReturned: reviewSources.length,
        detailOcrBudget,
        detailOcrImagesAnalyzed: detailImageOcrInsights.length,
        curatedResearchUsed: Boolean(curatedResearchMatch),
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Product extraction failed." }, { status: 500 });
  }
}
