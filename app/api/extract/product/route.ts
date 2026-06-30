import { NextResponse } from "next/server";
import sharp from "sharp";
import { ExtractedProductInfo, SourceImageCandidate } from "../../../lib/mvp/types";

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }

  return "";
}

function titleContent(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1]) : "";
}

function absoluteUrl(value: string, baseUrl: string) {
  if (!value) return "";
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function arrayValue<T>(value: T | T[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function stringValue(value: unknown) {
  if (typeof value === "string" || typeof value === "number") return decodeHtml(String(value));
  return "";
}

function imageValues(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(imageValues);
  if (typeof value === "string" || typeof value === "number") return [stringValue(value)];
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return [stringValue(object.url), stringValue(object.contentUrl)].filter(Boolean);
  }
  return [];
}

function numberValue(value: string) {
  const normalized = value.replace(/[^\d.]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatPrice(value: string) {
  const numeric = numberValue(value);
  if (!numeric) return decodeHtml(value);
  return `${Math.round(numeric).toLocaleString("ko-KR")}원`;
}

function firstMatch(html: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function priceSearchValues(price: string) {
  const numeric = Math.round(numberValue(price));
  if (!numeric) return [];
  return Array.from(new Set([String(numeric), numeric.toLocaleString("ko-KR")]));
}

function windowsAroundPrice(html: string, price: string) {
  const windows: string[] = [];
  for (const value of priceSearchValues(price)) {
    const pattern = new RegExp(escapeRegex(value), "g");
    for (const match of html.matchAll(pattern)) {
      const index = match.index ?? 0;
      windows.push(html.slice(Math.max(0, index - 700), Math.min(html.length, index + 700)));
      if (windows.length >= 8) return windows;
    }
  }
  return windows;
}

function validDiscountRate(value: string) {
  const rate = Number(value.replace(/[^\d]/g, ""));
  return Number.isFinite(rate) && rate > 0 && rate < 90 ? rate : 0;
}

function discountFromPrices(original: number, sale: number) {
  if (!original || !sale || original <= sale) return 0;
  const rate = Math.round(((original - sale) / original) * 100);
  return rate > 0 && rate < 90 ? rate : 0;
}

function collectJsonLdNodes(value: unknown): Record<string, unknown>[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(collectJsonLdNodes);
  if (typeof value !== "object") return [];

  const object = value as Record<string, unknown>;
  const graph = object["@graph"];
  const graphNodes = Array.isArray(graph) ? graph.flatMap(collectJsonLdNodes) : [];
  return [object, ...graphNodes];
}

function isProductNode(node: Record<string, unknown>) {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((item) => String(item).toLowerCase().includes("product"));
}

function extractJsonLd(html: string, baseUrl: string) {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  const nodes: Record<string, unknown>[] = [];

  for (const script of scripts) {
    const raw = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    if (!raw) continue;

    try {
      nodes.push(...collectJsonLdNodes(JSON.parse(raw)));
    } catch {
      continue;
    }
  }

  const product = nodes.find(isProductNode) ?? nodes[0] ?? {};
  const offers = arrayValue(product.offers as Record<string, unknown> | Record<string, unknown>[] | undefined) ?? {};
  const images = imageValues(product.image).map((image) => absoluteUrl(image, baseUrl)).filter(Boolean);

  return {
    name: stringValue(product.name),
    description: stringValue(product.description),
    image: images[0] || "",
    images,
    price:
      stringValue((offers as Record<string, unknown>).price) ||
      stringValue((offers as Record<string, unknown>).lowPrice) ||
      stringValue((offers as Record<string, unknown>).highPrice),
    category: stringValue(product.category),
  };
}

function extractPrice(html: string, jsonLdPrice: string) {
  const raw =
    metaContent(html, "product:price:amount") ||
    metaContent(html, "product:sale_price:amount") ||
    metaContent(html, "og:price:amount") ||
    metaContent(html, "twitter:data1") ||
    jsonLdPrice ||
    firstMatch(html, [
      /itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
      /itemprop=["']price["'][^>]+value=["']([^"']+)["']/i,
      /["'](?:salePrice|discountPrice|finalPrice|price|goodsPrice|sellPrice|sale_price)["']\s*:\s*["']?([\d,.]+)["']?/i,
      /(?:판매가|할인가|상품가|가격)[^0-9]{0,30}([\d,]+)\s*원/i,
      /([\d,]+)\s*원/i,
    ]);

  return raw ? formatPrice(raw) : "";
}

function extractDiscountInfo(html: string, price: string) {
  for (const window of windowsAroundPrice(html, price)) {
    const nearbyRate = validDiscountRate(firstMatch(window, [
      /(?:할인율|할인|SALE|sale|dc|discount)[^0-9]{0,40}(\d{1,2})\s*%/i,
      /(\d{1,2})\s*%\s*(?:할인|SALE|sale)/i,
      /(\d{1,2})\s*%/i,
    ]));
    if (nearbyRate) return `${nearbyRate}% 할인`;
  }

  const detailWindows = [...html.matchAll(/(?:상세\s*정보|상세정보|상품\s*정보|상품정보|제품\s*상세|product\s*detail|goods\s*view)/gi)]
    .map((match) => {
      const index = match.index ?? 0;
      return html.slice(index, Math.min(html.length, index + 5000));
    });

  for (const window of detailWindows) {
    const detailRate = validDiscountRate(firstMatch(window, [
      /(?:할인율|할인|SALE|sale|dc|discount)[^0-9]{0,40}(\d{1,2})\s*%/i,
      /(\d{1,2})\s*%\s*(?:할인|SALE|sale)/i,
      /(\d{1,2})\s*%/i,
    ]));
    if (detailRate) return `${detailRate}% 할인`;
  }

  return "";
}

function extractCategory(html: string, jsonLdCategory: string) {
  return (
    metaContent(html, "product:category") ||
    metaContent(html, "article:section") ||
    jsonLdCategory ||
    ""
  );
}

function imageFromSrcset(value: string, baseUrl: string) {
  const first = value.split(",").map((item) => item.trim().split(/\s+/)[0]).find(Boolean) || "";
  return absoluteUrl(first, baseUrl);
}

function looksLikeUsableProductImage(value: string) {
  const lower = value.toLowerCase();
  if (!/^https?:\/\//.test(lower)) return false;
  if (lower.startsWith("data:")) return false;
  if (/(sprite|favicon|logo|icon|blank|placeholder|loading|tracking|pixel|badge|btn|button|coupon|event|banner|share|kakao|talk|qr|app|ad_|ads?\/|noimage|salelabel|main_floting|main_info|floating|whiteclose|floating_zoom|contents\/images|commonimg)/.test(lower)) return false;
  if (/\.(svg)(?:[?#].*)?$/.test(lower)) return false;
  return /\.(jpg|jpeg|png|webp|gif)(?:[?#].*)?$/.test(lower) || /image|goods|product|detail|thumb|photo|cdn|shop|item/.test(lower);
}

function imageCandidateScore(value: string, context = "") {
  const text = `${value} ${context}`.toLowerCase();
  let score = 0;
  if (/(product|goods|item|detail|thumb|thumbnail|photo|gallery|prd|prod|contents?|view|viewarea|detailview)/.test(text)) score += 2;
  if (/(상품|제품|상세|상세정보|상품정보|대표|썸네일|포토|사진|갤러리|원본|고기|식품|구성|조리컷|실제)/.test(text)) score += 2;
  if (/(main|large|big|origin|original)/.test(text)) score += 1;
  if (/(banner|event|coupon|promo|promotion|logo|icon|badge|button|btn|sprite|delivery|review-star|recommend|related|recent|bestitem)/.test(text)) score -= 6;
  if (/(배너|이벤트|쿠폰|기획전|프로모션|로고|아이콘|배송|혜택|버튼|오늘의\s*추천상품|추천상품|관련상품|최근\s*본\s*상품|함께\s*구매|다른\s*고객)/.test(text)) score -= 8;
  return score;
}

function textContextFromHtml(value: string) {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

function isRecommendationContext(context: string) {
  return /(오늘의\s*추천상품|추천상품|관련상품|최근\s*본\s*상품|함께\s*구매|다른\s*고객|추천\s*상품|best\s*item|related\s*products?|recommend(?:ed|ation)?|recently\s*viewed)/i.test(context);
}

function isDetailContext(context: string) {
  return /(상세\s*정보|상세정보|상품\s*정보|상품정보|판매\s*공지|구매\s*후기|실제|조리컷|상세컷|제품\s*상세|product\s*detail|detail\s*view|goods\s*view)/i.test(context);
}

const maxGalleryImages = 30;

function productImageCandidateScore(value: string, context = "") {
  const text = `${value} ${context}`.toLowerCase();
  let score = 0;
  if (/(product|goods|item|detail|thumb|thumbnail|photo|gallery|prd|prod|contents?|view|viewarea|detailview)/.test(text)) score += 2;
  if (/(상품|제품|상세|상세정보|상품정보|대표|썸네일|포토|사진|갤러리|원본|고기|한우|소고기|스테이크|등심|갈비|내장|곱창|육즙|조리컷|실제|구이|구성)/.test(text)) score += 3;
  if (/\/userfiles\/[^?]+\/thumfull\//.test(text)) score += 18;
  if (/\/userfiles\/[^?]+\/thumbpc\//.test(text)) score += 10;
  if (/\/data\/goods\/[^?]+\/small\/thum2\//.test(text)) score -= 9;
  if (/(main|large|big|origin|original)/.test(text)) score += 1;
  if (/(banner|event|coupon|promo|promotion|logo|icon|badge|button|btn|sprite|delivery|review-star|recommend|related|recent|bestitem|share|kakao|qr)/.test(text)) score -= 7;
  if (/(배너|이벤트|쿠폰|기획전|프로모션|로고|아이콘|배송|혜택|버튼|공유|카카오|앱\s*다운로드|qr|오늘의\s*추천상품|추천상품|관련상품|최근\s*본\s*상품|함께\s*구매|다른\s*고객|best\s*item|related|recommend|recently\s*viewed)/.test(text)) score -= 12;
  return score;
}

function isProductRecommendationContext(context: string) {
  return /(오늘의\s*추천상품|추천상품|관련상품|최근\s*본\s*상품|함께\s*구매|다른\s*고객|많이\s*본\s*상품|베스트\s*상품|인기\s*상품|best\s*item|related\s*products?|recommend(?:ed|ation)?|recently\s*viewed)/i.test(context);
}

function isProductDetailContext(context: string) {
  return /(상세\s*정보|상세정보|상품\s*정보|상품정보|제품\s*상세|상세컷|상세이미지|조리컷|실제|구이|육즙|소내장탕|상품설명|product\s*detail|detail\s*view|goods\s*view|goodsdetail|detailarea|detailimg|prd_detail)/i.test(context);
}

function detailHtmlRanges(html: string) {
  const starts = [
    ...html.matchAll(/(?:상세\s*정보|상세정보|상품\s*정보|상품정보|제품\s*상세|product\s*detail|detail\s*view|goods\s*view|goodsdetail|detailarea|detailimg|prd_detail)/gi),
  ].map((match) => match.index ?? 0);
  const endPattern = /(?:오늘의\s*추천상품|추천상품|관련상품|최근\s*본\s*상품|함께\s*구매|많이\s*본\s*상품|베스트\s*상품|footer|recommend|related|recently\s*viewed)/gi;
  const ranges: Array<[number, number]> = [];

  for (const start of starts) {
    const tail = html.slice(start);
    const endMatch = tail.match(endPattern);
    const end = endMatch?.index ? start + endMatch.index : Math.min(html.length, start + 500_000);
    ranges.push([start, Math.max(start + 1, end)]);
  }

  return ranges;
}

function indexInRanges(index: number, ranges: Array<[number, number]>) {
  return ranges.some(([start, end]) => index >= start && index <= end);
}

function collectGalleryImages(html: string, baseUrl: string, seedImages: string[]) {
  const detailRanges = detailHtmlRanges(html);
  const candidates: { image: string; score: number; order: number; inDetail: boolean }[] = [
    ...seedImages,
    absoluteUrl(metaContent(html, "og:image"), baseUrl),
    absoluteUrl(metaContent(html, "twitter:image"), baseUrl),
  ].filter(Boolean).map((image, index) => ({
    image,
    score: productImageCandidateScore(image) - 1,
    order: 100_000 + index,
    inDetail: false,
  }));
  const imgPattern = /<img\b[^>]*>/gi;
  const srcPattern = /\s(?:src|data-src|data-original|data-lazy|data-image|data-url)=["']([^"']+)["']/i;
  const srcsetPattern = /\s(?:srcset|data-srcset)=["']([^"']+)["']/i;
  const dimensionPattern = /\s(?:width|height)=["']?(\d{2,5})["']?/gi;
  const contextPattern = /\s(?:class|id|alt|title)=["']([^"']+)["']/gi;
  const seen = new Set<string>();

  for (const match of html.matchAll(imgPattern)) {
    const tag = match[0];
    const index = match.index ?? 0;
    const nearbyText = textContextFromHtml(html.slice(Math.max(0, index - 900), Math.min(html.length, index + 900)));
    const context = `${[...tag.matchAll(contextPattern)].map((item) => item[1]).join(" ")} ${nearbyText}`;
    const inDetail = indexInRanges(index, detailRanges) || isProductDetailContext(context) || isDetailContext(context);
    if (!inDetail && (isProductRecommendationContext(context) || isRecommendationContext(context))) continue;
    if (productImageCandidateScore("", context) <= -4) continue;

    const dimensions = [...tag.matchAll(dimensionPattern)].map((item) => Number(item[1])).filter(Boolean);
    if (dimensions.length && Math.max(...dimensions) < 180) continue;
    if (dimensions.length >= 2) {
      const ratio = Math.max(...dimensions) / Math.max(1, Math.min(...dimensions));
      if (ratio > 2.4) continue;
    }

    const src = tag.match(srcPattern)?.[1];
    const srcset = tag.match(srcsetPattern)?.[1];
    const images = [absoluteUrl(src || "", baseUrl), srcset ? imageFromSrcset(srcset, baseUrl) : ""].filter(Boolean);
    for (const image of images) {
      const score =
        productImageCandidateScore(image, context) +
        (inDetail ? 12 : 0) +
        (dimensions.length ? 1 : 0);
      if (score >= 1 || dimensions.some((size) => size >= 300)) {
        candidates.push({ image, score, order: index, inDetail });
      }
    }
  }

  return candidates
    .sort((a, b) => {
      if (a.inDetail !== b.inDetail) return a.inDetail ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      return a.order - b.order;
    })
    .map((candidate) => decodeHtml(candidate.image).trim())
    .filter(looksLikeUsableProductImage)
    .filter((image) => {
      const key = image.replace(/([?&])(width|height|w|h|quality|q|format|auto)=[^&]+/gi, "$1");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxGalleryImages);
}

async function remoteImageMetadata(imageUrl: string) {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; AdAtlasProductExtractor/1.0)",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !contentType.startsWith("image/")) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) return null;
    const { data, info } = await sharp(buffer)
      .resize(96, 96, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let meatPixels = 0;
    let whitePixels = 0;
    let darkPixels = 0;
    const totalPixels = Math.max(1, info.width * info.height);

    for (let index = 0; index < data.length; index += 3) {
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const saturation = max - min;
      if (red > 70 && saturation > 20 && red > green * 1.02 && red > blue * 1.02) meatPixels += 1;
      if (red > 220 && green > 220 && blue > 220) whitePixels += 1;
      if (red < 55 && green < 55 && blue < 55) darkPixels += 1;
    }

    return {
      width: metadata.width,
      height: metadata.height,
      meatRatio: meatPixels / totalPixels,
      whiteRatio: whitePixels / totalPixels,
      darkRatio: darkPixels / totalPixels,
    };
  } catch {
    return null;
  }
}

function meatPhotoScore(imageUrl: string, metadata: { width: number; height: number; meatRatio: number; whiteRatio: number; darkRatio: number }) {
  const lower = imageUrl.toLowerCase();
  const { width, height, meatRatio, whiteRatio, darkRatio } = metadata;
  const ratio = height / Math.max(1, width);

  if (width < 220 || height < 220) return -100;
  if (ratio > 2.15) return -100;
  if (ratio < 0.38) return -100;
  if (meatRatio < 0.08) return -100;
  if (whiteRatio > 0.58 && meatRatio < 0.2) return -100;
  if (whiteRatio > 0.46 && meatRatio < 0.26) return -100;
  if (ratio > 1.35 && whiteRatio > 0.38 && meatRatio < 0.34) return -100;

  let score = 0;
  if (/\/userfiles\/[^?]+\/thumfull\//.test(lower)) score += 8;
  if (/\/userfiles\/[^?]+\/thumbpc\//.test(lower)) score += 7;
  if (/\/data\/goods\/[^?]+\/small\/thum2\//.test(lower)) score -= 6;
  if (/(갈비|등심|한우|고기|소고기|스테이크|meat|beef)/i.test(decodeURIComponent(imageUrl))) score += 4;
  if (width >= 500 && height >= 500) score += 3;
  if (ratio >= 0.55 && ratio <= 1.65) score += 5;
  score += meatRatio * 24;
  score -= whiteRatio * 10;
  score -= darkRatio * 3;

  return score;
}

async function filterProductPhotoImages(images: string[]) {
  const scored: { image: string; score: number; order: number }[] = [];

  for (const [order, image] of images.slice(0, 40).entries()) {
    const metadata = await remoteImageMetadata(image);
    if (!metadata) continue;
    const score = meatPhotoScore(image, metadata);
    if (score <= -50) continue;
    scored.push({ image, score, order });
  }

  const filtered = scored
    .sort((a, b) => (a.score === b.score ? a.order - b.order : b.score - a.score))
    .map((item) => item.image);

  const detailProductPhotos = filtered.filter((image) => /\/userfiles\/[^?]+\/(?:thumfull|thumbpc)\//i.test(image));
  const finalImages = detailProductPhotos.length >= 4 ? detailProductPhotos : filtered;

  return finalImages.length ? finalImages.slice(0, maxGalleryImages) : images;
}

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

    if (!["http:", "https:"].includes(url.protocol)) {
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

    const html = (await response.text()).slice(0, 2_000_000);
    const jsonLd = extractJsonLd(html, url.toString());
    const price = extractPrice(html, jsonLd.price);
    const fallbackMainImage = jsonLd.image || absoluteUrl(metaContent(html, "og:image") || metaContent(html, "twitter:image"), url.toString());
    const rawGalleryImages = collectGalleryImages(html, url.toString(), [fallbackMainImage, ...(jsonLd.images ?? [])]);
    const galleryImages = await filterProductPhotoImages(rawGalleryImages);
    const mainImage = galleryImages[0] || rawGalleryImages[0] || fallbackMainImage;
    const createdAt = new Date().toISOString();
    const detailImages = galleryImages.filter((image) => image && image !== mainImage).slice(0, 30);
    const sourceImageCandidates: SourceImageCandidate[] = [];
    if (mainImage) {
      sourceImageCandidates.push({
        id: "hero-001",
        type: "hero",
        imagePath: mainImage,
        originalUrl: mainImage,
        label: "대표 이미지",
        selected: true,
        createdAt,
      });
    }
    sourceImageCandidates.push(
      ...detailImages.map((imagePath, index): SourceImageCandidate => ({
        id: `detail-${String(index + 1).padStart(3, "0")}`,
        type: "detail",
        imagePath,
        originalUrl: imagePath,
        label: `상세 이미지 ${index + 1}`,
        selected: false,
        createdAt,
      })),
    );
    const productInfo: ExtractedProductInfo = {
      productName: jsonLd.name || metaContent(html, "og:title") || metaContent(html, "twitter:title") || titleContent(html),
      category: extractCategory(html, jsonLd.category),
      price,
      discountInfo: extractDiscountInfo(html, price),
      mainImage,
      galleryImages,
      description: jsonLd.description || metaContent(html, "og:description") || metaContent(html, "description") || metaContent(html, "twitter:description"),
      landingUrl: url.toString(),
      heroImage: mainImage,
      detailImages,
      sourceImageCandidates,
    };

    return NextResponse.json({
      ok: true,
      success: true,
      productInfo,
      productName: productInfo.productName,
      price: productInfo.price,
      heroImage: mainImage,
      detailImages,
      sourceImageCandidates,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Product extraction failed." },
      { status: 500 },
    );
  }
}
