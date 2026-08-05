import type { DiscoveredProductLink, ProductDetailAnalysis, StoreProductSummary } from "./types";
import {
  absoluteHttpUrl,
  cleanText,
  discountRateFromPrices,
  extractImageUrls,
  extractJsonLdNodes,
  firstRecord,
  jsonLdTypeIncludes,
  metaContent,
  normalizeCategoryName,
  numberFromUnknown,
  stableId,
  stringValue,
  titleContent,
  uniqueStrings,
} from "./htmlUtils";
import { analyzeReviewTexts } from "./reviewAnalyzer";
import { analyzeDetailPageQuality } from "./detailPageAnalyzer";

function productJsonLd(html: string) {
  return extractJsonLdNodes(html).find((node) => jsonLdTypeIncludes(node, "product")) || {};
}

function breadcrumbCategory(html: string) {
  const breadcrumb = extractJsonLdNodes(html).find((node) =>
    jsonLdTypeIncludes(node, "breadcrumblist")
  );
  const items = Array.isArray(breadcrumb?.itemListElement) ? breadcrumb.itemListElement : [];
  const names = items
    .map(
      (item) =>
        stringValue(firstRecord(firstRecord(item).item).name) || stringValue(firstRecord(item).name)
    )
    .filter(Boolean)
    .filter((name) => !/^(?:홈|home)$/i.test(name));
  return normalizeCategoryName(names[names.length - 1] || "");
}

function arrayImageValues(value: unknown, baseUrl: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => arrayImageValues(item, baseUrl));
  if (typeof value === "string") return [absoluteHttpUrl(value, baseUrl)].filter(Boolean);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return [
      absoluteHttpUrl(stringValue(object.url), baseUrl),
      absoluteHttpUrl(stringValue(object.contentUrl), baseUrl),
    ].filter(Boolean);
  }
  return [];
}

function fallbackPrice(html: string) {
  const known =
    metaContent(html, "product:price:amount") ||
    metaContent(html, "product:sale_price:amount") ||
    metaContent(html, "og:price:amount");
  if (known) return numberFromUnknown(known);
  const match = html.match(/(?:판매가|할인가|상품가)[^\d]{0,40}([\d,]{3,})\s*원/i);
  return numberFromUnknown(match?.[1]);
}

function fallbackOriginalPrice(html: string, salePrice?: number) {
  const known =
    metaContent(html, "product:original_price:amount") ||
    metaContent(html, "product:retail_price:amount");
  const matched =
    known || html.match(/(?:정상가|소비자가|기존가|시중가)[^\d]{0,40}([\d,]{3,})\s*원/i)?.[1];
  const value = numberFromUnknown(matched);
  return value && (!salePrice || value > salePrice) ? value : undefined;
}

function reviewSignals(product: Record<string, unknown>, html: string) {
  const aggregate = firstRecord(product.aggregateRating);
  const reviewCount =
    numberFromUnknown(aggregate.reviewCount) ||
    numberFromUnknown(aggregate.ratingCount) ||
    numberFromUnknown(metaContent(html, "product:review_count"));
  const rating = numberFromUnknown(aggregate.ratingValue);
  const reviewNodes = [
    ...(Array.isArray(product.review) ? product.review : product.review ? [product.review] : []),
    ...extractJsonLdNodes(html).filter((node) => jsonLdTypeIncludes(node, "review")),
  ];
  const reviewTexts = reviewNodes
    .map(
      (node) =>
        stringValue(firstRecord(node).reviewBody) || stringValue(firstRecord(node).description)
    )
    .filter(Boolean);
  for (const match of html.matchAll(
    /<(?:li|div|article)[^>]+(?:class|id)=["'][^"']*(?:review|후기)[^"']*["'][^>]*>([\s\S]*?)<\/(?:li|div|article)>/gi
  )) {
    const text = cleanText(match[1], 360);
    if (text.length >= 12 && text.length <= 360) reviewTexts.push(text);
    if (reviewTexts.length >= 80) break;
  }
  return { reviewCount, rating, reviewTexts: uniqueStrings(reviewTexts, 80) };
}

function extractSpecifications(html: string) {
  const specifications: Record<string, string> = {};
  for (const match of html.matchAll(/<tr[^>]*>[\s\S]*?<\/(?:tr)>/gi)) {
    const cells = Array.from(match[0].matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)).map(
      (cell) => cleanText(cell[1], 160)
    );
    if (cells.length >= 2 && cells[0] && cells[1] && cells[0].length <= 50) {
      specifications[cells[0]] = cells[1];
    }
    if (Object.keys(specifications).length >= 16) break;
  }
  for (const match of html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const key = cleanText(match[1], 50);
    const value = cleanText(match[2], 160);
    if (key && value) specifications[key] = value;
    if (Object.keys(specifications).length >= 16) break;
  }
  return specifications;
}

function extractUspCandidates(
  html: string,
  description: string,
  specifications: Record<string, string>
) {
  const candidates: string[] = [];
  const sourceBlocks = [
    ...description.split(/[.!?。]\s*/),
    ...Array.from(
      html.matchAll(/<(?:h1|h2|h3|strong|em|li)[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|strong|em|li)>/gi)
    ).map((match) => cleanText(match[1], 180)),
    ...Object.entries(specifications).map(([key, value]) => `${key}: ${value}`),
  ];
  for (const raw of sourceBlocks) {
    const text = cleanText(raw, 180);
    if (text.length < 8 || text.length > 180) continue;
    if (
      /(원산지|구성|용량|중량|품질|프리미엄|특허|인증|무첨가|저당|단백질|신선|숙성|향|식감|편리|무료배송|보관|제조|성분|효과|특징|장점|선별|직송|산지|세트)/i.test(
        text
      ) ||
      candidates.length < 2
    ) {
      candidates.push(text);
    }
    if (candidates.length >= 8) break;
  }
  return uniqueStrings(candidates, 8);
}

export function extractProductSummaryFromHtml(
  url: string,
  html: string,
  discovered?: DiscoveredProductLink
): StoreProductSummary {
  const product = productJsonLd(html);
  const offers = firstRecord(product.offers);
  const salePrice =
    numberFromUnknown(offers.price) ||
    numberFromUnknown(offers.lowPrice) ||
    numberFromUnknown(offers.highPrice) ||
    fallbackPrice(html);
  const originalPrice = fallbackOriginalPrice(html, salePrice);
  const discountRate = discountRateFromPrices(originalPrice, salePrice);
  const reviews = reviewSignals(product, html);
  const name =
    stringValue(product.name) ||
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    titleContent(html) ||
    discovered?.label ||
    "상품명 확인 필요";
  const availability = stringValue(offers.availability);
  const pageSignals = cleanText(html.slice(0, 600_000), 60_000);
  const jsonImages = arrayImageValues(product.image, url);
  const images = uniqueStrings([...jsonImages, ...extractImageUrls(html, url, 24)], 24);
  const category =
    normalizeCategoryName(stringValue(product.category)) ||
    breadcrumbCategory(html) ||
    discovered?.category;
  const productSpecificSoldOut =
    /outofstock/i.test(availability) || /품절된\s*상품|현재\s*품절|sold\s*out/i.test(pageSignals);
  const isSetProduct = /세트|묶음|패키지|\d+\s*(?:개|팩|입|종)\s*(?:구성|세트)?/i.test(
    `${name} ${stringValue(product.description)}`
  );

  return {
    id: stableId("product", new URL(url).toString()),
    name: cleanText(name, 140),
    url: new URL(url).toString(),
    category,
    imageUrl: images[0],
    originalPrice,
    salePrice,
    discountRate,
    reviewCount: reviews.reviewCount,
    rating: reviews.rating,
    isBest: Boolean(discovered?.isBest),
    isNew: Boolean(discovered?.isNew),
    isDiscounted: Boolean(discountRate || discovered?.isDiscounted),
    isSoldOut: productSpecificSoldOut,
    isSetProduct,
    freeShipping: /무료\s*배송|배송비\s*0\s*원/i.test(pageSignals),
    discoveredFrom: uniqueStrings(discovered?.discoveredFrom || [], 12),
  };
}

export function extractProductDetailFromHtml(
  url: string,
  html: string,
  summary: StoreProductSummary,
  shouldAnalyzeReviews: boolean
): ProductDetailAnalysis {
  const product = productJsonLd(html);
  const description =
    stringValue(product.description) ||
    metaContent(html, "og:description") ||
    metaContent(html, "description");
  const specifications = extractSpecifications(html);
  const imageUrls = uniqueStrings(
    [...arrayImageValues(product.image, url), ...extractImageUrls(html, url, 40)],
    40
  );
  const detailImageUrls = imageUrls.filter((image) => image !== summary.imageUrl).slice(0, 24);
  const reviews = reviewSignals(product, html);
  const reviewAnalysis = shouldAnalyzeReviews
    ? analyzeReviewTexts({
        reviewTexts: reviews.reviewTexts,
        reviewCount: summary.reviewCount || reviews.reviewCount,
        averageRating: summary.rating || reviews.rating,
      })
    : undefined;
  const uspCandidates = extractUspCandidates(html, description, specifications);
  const pageText = cleanText(html, 100_000);
  const detailPageQuality = analyzeDetailPageQuality({
    product: summary,
    description,
    uspCandidates,
    imageUrls,
    detailImageUrls,
    specifications,
    reviewAnalysis,
    pageText,
  });
  return {
    product: { ...summary, imageUrl: summary.imageUrl || imageUrls[0] },
    description,
    uspCandidates,
    specifications,
    imageUrls,
    detailImageUrls,
    reviewAnalysis,
    detailPageQuality,
  };
}
