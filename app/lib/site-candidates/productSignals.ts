import {
  cleanText,
  extractJsonLdNodes,
  firstRecord,
  jsonLdTypeIncludes,
  metaContent,
  stringValue,
  uniqueStrings,
} from "../store-analysis/htmlUtils.ts";
import type { ProductDetailAnalysis, StoreProductSummary } from "../store-analysis/types";
import type { SiteEvidenceField, SiteEvidenceState, SiteProductRecord } from "./types";

function visibleBlocks(html: string) {
  const blocks: string[] = [];
  for (const match of html.matchAll(
    /<(?:h1|h2|h3|h4|p|li|dt|dd|th|td|strong|em|button|label|span)[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|h4|p|li|dt|dd|th|td|strong|em|button|label|span)>/gi
  )) {
    const text = cleanText(match[1], 220);
    if (text.length >= 2 && text.length <= 220) blocks.push(text);
    if (blocks.length >= 700) break;
  }
  return uniqueStrings(blocks, 700);
}

function matchingBlocks(blocks: string[], pattern: RegExp, limit = 5) {
  return uniqueStrings(
    blocks.filter((block) => pattern.test(block)),
    limit
  );
}

function firstMatching(blocks: string[], pattern: RegExp) {
  return matchingBlocks(blocks, pattern, 1)[0];
}

function evidence(
  key: string,
  label: string,
  state: SiteEvidenceState,
  value: SiteEvidenceField["value"],
  source: SiteEvidenceField["source"],
  note?: string
): SiteEvidenceField {
  return { key, label, state, value, source, note };
}

function stateForValue(value: unknown, emptyState: SiteEvidenceState = "unavailable") {
  if (Array.isArray(value)) return value.length ? "present" : emptyState;
  if (typeof value === "boolean") return value ? "present" : "absent";
  return value === undefined || value === null || value === "" ? emptyState : "present";
}

function isUsefulProductImage(url: string) {
  if (!url || /\.(?:gif|svg)(?:[?#]|$)/i.test(url)) return false;
  return !/(?:^|[\/_-])(?:icon|ico|ic|btn|button|sprite|loading|spinner|arrow|count[-_](?:up|down)|price[-_]delete|pay[-_]point|under19|lock)(?:[\/_\-.]|$)/i.test(
    url
  );
}

function isConcreteBenefit(value: string | undefined) {
  if (!value || /{#|-->|배너매니저|현재\s*진행\s*이벤트|종료된\s*이벤트/i.test(value)) {
    return false;
  }
  return /\d|무료\s*배송|첫\s*구매|신규\s*회원|증정|사은품|적립|할인/i.test(value);
}

function isUsefulUsp(value: string) {
  if (value.length < 8 || value.length > 180) return false;
  return !/{#|-->|STEP\s*\d|로그인|회원가입|상품문의|구매후기|배송비\s*$|혜택\s*현재|성인인증/i.test(
    value
  );
}

function productJsonLd(html: string) {
  return extractJsonLdNodes(html).find((node) => jsonLdTypeIncludes(node, "product"));
}

function explicitStockState(
  html: string,
  summary: StoreProductSummary,
  hasPurchaseButton: boolean
) {
  const product = productJsonLd(html);
  const availability = stringValue(firstRecord(product?.offers).availability);
  if (/outofstock|soldout|discontinued/i.test(availability)) return "sold-out" as const;
  if (/instock|limitedavailability|preorder/i.test(availability)) return "in-stock" as const;

  // 쇼핑몰 공통 푸터나 추천 상품에 있는 "품절" 문구는 현재 상품의 상태가 아니다.
  // 구조화 데이터 또는 현재 상품의 비활성 구매 컨트롤처럼 범위가 명확한 근거만 사용한다.
  const explicitSoldOutControl = new RegExp(
    String.raw`<(?:button|a|input|select)[^>]{0,500}(?:disabled|aria-disabled=["']?true|class=["'][^"']*(?:sold[-_ ]?out|out[-_ ]?of[-_ ]?stock)[^"']*)[^>]{0,500}(?:품절|판매\s*(?:종료|중지)|구매\s*불가|sold\s*out|out\s*of\s*stock)?`,
    "i"
  ).test(html);
  const explicitAvailabilityMeta =
    /<meta\b[^>]*(?:property|name)=["'](?:product:)?availability["'][^>]*content=["'](?:out\s*of\s*stock|sold\s*out)["']/i.test(
      html
    ) ||
    /<meta\b[^>]*content=["'](?:out\s*of\s*stock|sold\s*out)["'][^>]*(?:property|name)=["'](?:product:)?availability["']/i.test(
      html
    );

  if (explicitSoldOutControl || explicitAvailabilityMeta) return "sold-out" as const;
  if (hasPurchaseButton) return "in-stock" as const;

  // 기존 요약기의 전역 텍스트 판정은 참고만 한다. 명시적 컨트롤이 없으면
  // 판매 불가로 단정하지 않아 관련 상품/정책 문구의 오탐을 막는다.
  if (summary.isSoldOut) return "unavailable" as const;
  return "unavailable" as const;
}

function extractOptionNames(html: string) {
  const values: string[] = [];
  for (const match of html.matchAll(/<option\b[^>]*>([\s\S]*?)<\/option>/gi)) {
    const text = cleanText(match[1], 80);
    if (!text || /선택|옵션|필수|choose|select/i.test(text)) continue;
    values.push(text);
    if (values.length >= 12) break;
  }
  return uniqueStrings(values, 12);
}

function extractSpecificationValues(
  specifications: Record<string, string>,
  keyPattern: RegExp,
  limit = 6
) {
  return uniqueStrings(
    Object.entries(specifications)
      .filter(([key]) => keyPattern.test(key))
      .map(([key, value]) => `${key}: ${value}`),
    limit
  );
}

function reviewPhrases(detail: ProductDetailAnalysis) {
  const review = detail.reviewAnalysis;
  if (!review) return [];
  return uniqueStrings(
    [...review.repeatedBenefits, ...review.purchaseSituations, ...review.copyUsableInsights].map(
      (value) =>
        value
          .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "")
          .replace(/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/g, "")
          .trim()
    ),
    8
  );
}

export function extractSiteProductRecord(params: {
  html: string;
  summary: StoreProductSummary;
  detail: ProductDetailAnalysis;
  brandName?: string;
  analyzedAt?: string;
}): SiteProductRecord {
  const { html, summary, detail } = params;
  const blocks = visibleBlocks(html);
  const text = blocks.join(" ");
  const productNode = productJsonLd(html);
  const source: SiteEvidenceField["source"] = productNode ? "json-ld" : "page-html";
  const images = uniqueStrings(
    [summary.imageUrl, ...detail.imageUrls, ...detail.detailImageUrls],
    30
  ).filter(isUsefulProductImage);
  const uspCandidates = uniqueStrings(detail.uspCandidates.filter(isUsefulUsp), 8);
  const coupon = firstMatching(
    blocks,
    /(?:첫\s*구매|신규\s*회원|\d[\d,.]*\s*(?:원|%|만원))[^.]{0,80}(?:쿠폰|coupon)|(?:쿠폰|coupon)[^.]{0,80}(?:\d[\d,.]*\s*(?:원|%|만원)|첫\s*구매|신규\s*회원)/i
  );
  const shippingInfo = firstMatching(
    blocks,
    /무료\s*배송|배송비\s*[:：]?\s*[\d,]+\s*원|\d[\d,.]*\s*원\s*이상\s*무료|도서산간[^.]{0,60}|당일\s*배송|새벽\s*배송|익일\s*배송/i
  );
  const productContext = uniqueStrings(
    [
      summary.name,
      detail.description,
      ...uspCandidates,
      ...Object.values(detail.specifications),
      ...extractOptionNames(html),
    ],
    40
  );
  const setComposition = firstMatching(
    productContext,
    /(?:\d+\s*(?:개|팩|입|종|세트)|\d+\s*\+\s*\d+|(?:세트|묶음|패키지)\s*(?:구성|상품)|\d+종\s*구성)[^.]{0,100}/i
  );
  const giftBenefit = firstMatching(
    blocks,
    /(?:증정|사은품|gift)[^.]{0,80}(?:\d|구매|제공|랜덤)|(?:\d|구매)[^.]{0,80}(?:증정|사은품)/i
  );
  const membershipBenefit = firstMatching(
    blocks,
    /(?:회원가입|신규\s*회원|멤버십|등급별|회원\s*할인)[^.]{0,80}(?:\d[\d,.]*\s*(?:원|%|만원)|적립|할인|쿠폰)/i
  );
  const benefitBlocks = uniqueStrings(
    [
      coupon,
      shippingInfo,
      setComposition,
      giftBenefit,
      membershipBenefit,
      summary.discountRate ? `${summary.discountRate}% 할인` : undefined,
    ].filter((value): value is string => isConcreteBenefit(value)),
    10
  );
  const ingredientValues = extractSpecificationValues(
    detail.specifications,
    /성분|원재료|원료|함량|영양/i
  );
  const ingredients = uniqueStrings(
    [
      ...ingredientValues,
      ...matchingBlocks(blocks, /(?:주요\s*)?성분|원재료|원료|함유|무첨가/i, 5),
    ],
    8
  );
  const origin =
    extractSpecificationValues(detail.specifications, /원산지|제조국|산지/i, 1)[0] ||
    firstMatching(blocks, /원산지|국내산|국산|제조국|산지\s*직송/i);
  const certifications = uniqueStrings(
    [
      ...extractSpecificationValues(detail.specifications, /인증|특허|수상|시험|검사/i),
      ...matchingBlocks(
        blocks,
        /HACCP|해썹|PETA|비건\s*(?:인증|&)|유기농\s*인증|ISO\s*\d+|KC\s*인증|특허\s*(?:등록|제?\s*\d)|시험\s*완료|검사\s*완료|이력제/i,
        6
      ),
    ].filter((value) => !/성인인증|본인인증|휴대폰\s*인증/i.test(value)),
    8
  );
  const usageContexts = uniqueStrings(
    matchingBlocks(
      productContext,
      /운동\s*후|출근\s*전|퇴근\s*후|캠핑|여행|휴가|선물|명절|입학|결혼식|육아|간식|아침|저녁|야외\s*활동|홈케어/i,
      8
    ),
    8
  );
  const targetSignals = uniqueStrings(
    matchingBlocks(
      productContext,
      /남성|여성|키즈|어린이|아이|부모님|직장인|운동인|캠퍼|민감성|건성|지성|초보|가족|반려/i,
      8
    ),
    8
  );
  const badges = uniqueStrings(
    [
      summary.isBest ? "베스트" : undefined,
      summary.isNew ? "신상품" : undefined,
      summary.isDiscounted ? "할인" : undefined,
      ...matchingBlocks(blocks, /^(?:BEST|NEW|베스트|인기|추천|신상품|신제품|한정|특가)$/i, 5),
    ],
    8
  );
  const promotionEndsAt = firstMatching(
    blocks,
    /(?:행사|할인|프로모션|쿠폰)[^.]{0,120}(?:\d{1,2}[./-]\d{1,2}|오늘까지|이번\s*주|마감\s*(?:예정|임박)?)/i
  );
  const purchaseButton =
    /(?:구매하기|바로\s*구매|주문하기|장바구니(?:에)?\s*(?:담기|추가(?:하기)?)|buy\s*now|add\s*to\s*cart)/i.test(
      text
    );
  const stockStatus = explicitStockState(html, summary, purchaseButton);
  const reviewInsights = reviewPhrases(detail);
  const productName = summary.name || metaContent(html, "og:title") || "상품명 확인 필요";
  const brandName =
    stringValue(firstRecord(productNode?.brand).name) || params.brandName || undefined;
  const description = detail.description || metaContent(html, "og:description") || undefined;
  const evidenceFields: SiteEvidenceField[] = [
    evidence("product-name", "상품명", stateForValue(productName), productName, source),
    evidence("description", "상품 설명", stateForValue(description), description, source),
    evidence("price", "판매가", stateForValue(summary.salePrice), summary.salePrice, source),
    evidence(
      "regular-price",
      "정상가",
      stateForValue(summary.originalPrice),
      summary.originalPrice,
      source
    ),
    evidence(
      "reviews",
      "리뷰·평점",
      stateForValue(summary.reviewCount || summary.rating || reviewInsights),
      summary.reviewCount || summary.rating || reviewInsights,
      source,
      !summary.reviewCount && !summary.rating
        ? "리뷰가 0개인 것이 아니라 공개 페이지에서 확인하지 못했습니다."
        : undefined
    ),
    evidence("images", "상품 이미지", images.length ? "present" : "absent", images, "page-html"),
    evidence(
      "purchase-button",
      "구매 버튼",
      purchaseButton ? "present" : "absent",
      purchaseButton,
      "page-html"
    ),
    evidence(
      "stock",
      "판매 상태",
      stockStatus === "unavailable" ? "unavailable" : "present",
      stockStatus,
      source
    ),
    evidence("benefits", "가격·혜택", stateForValue(benefitBlocks), benefitBlocks, "page-html"),
    evidence("usp", "USP", stateForValue(uspCandidates), uspCandidates, "derived"),
    evidence("origin", "원산지·제조국", stateForValue(origin), origin, "page-html"),
    evidence(
      "certifications",
      "인증·시험 근거",
      stateForValue(certifications),
      certifications,
      "page-html"
    ),
    evidence("shipping", "배송 안내", stateForValue(shippingInfo), shippingInfo, "page-html"),
  ];

  return {
    id: summary.id,
    productName,
    brandName,
    category: summary.category,
    productUrl: summary.url,
    representativeImage: images[0],
    additionalImages: images.slice(1),
    regularPrice: summary.originalPrice,
    salePrice: summary.salePrice,
    discountRate: summary.discountRate,
    benefits: benefitBlocks,
    coupon,
    freeShipping: Boolean(shippingInfo && /무료\s*배송/.test(shippingInfo)),
    setComposition,
    giftBenefit,
    membershipBenefit,
    stockStatus,
    options: extractOptionNames(html),
    description,
    uspCandidates,
    ingredients,
    origin,
    certifications,
    reviewCount: summary.reviewCount,
    rating: summary.rating,
    extractedReviewPhrases: reviewInsights,
    badges,
    promotionEndsAt,
    hasPurchaseButton: purchaseButton,
    shippingInfo,
    usageContexts,
    targetSignals,
    discoveredFrom: summary.discoveredFrom || [],
    analyzedAt: params.analyzedAt || new Date().toISOString(),
    evidence: evidenceFields,
  };
}
