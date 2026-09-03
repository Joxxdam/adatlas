import type { ProductImageCandidate } from "./types";
import { inferProductDetailOcrEvidenceRoles } from "./productDetailOcrSelection";
import { isMalformedProductSignal, isPriceOnlyCreativeSignal, isPromotionalProductSignal, isUnsafeProductCreativeSignal, isVagueStandaloneSensoryClaim } from "../creative-generation/productSignalHygiene";
import { absoluteUrl, currentProductSummaryText, decodeHtml, metaContent } from "./productHtmlSignals.server";
import { isPrivateHostname } from "./productPageResponse.server";

function imageFromSrcset(value: string, baseUrl: string) {
  const first =
    value
      .split(",")
      .map((item) => item.trim().split(/\s+/)[0])
      .find(Boolean) || "";
  return absoluteUrl(first, baseUrl);
}

function looksLikeUsableProductImage(value: string) {
  const lower = value.toLowerCase();
  if (!/^https?:\/\//.test(lower)) return false;
  if (lower.startsWith("data:")) return false;
  if (/(sprite|favicon|logo|icon|blank|placeholder|loading|tracking|pixel|badge|btn|button|coupon|event|header|footer|share|kakao|talk|qr|app|ad_|ads?\/|noimage|salelabel|main_floting|main_info|floating|whiteclose|floating_zoom|commonimg|reward|insertreview|qnaregist|alarm_customer|getstockchild)/.test(lower)) return false;
  if (/\.(svg)(?:[?#].*)?$/.test(lower)) return false;
  return /\.(jpg|jpeg|png|webp|avif|gif)(?:[?#].*)?$/.test(lower) || /image|img|product|detail|thumb|thumfull|thumbpc|photo|cdn|upload|editor|contents?\//.test(lower);
}

function textContextFromHtml(value: string) {
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function isRecommendationContext(context: string) {
  return /(오늘의\s*추천상품|추천상품|관련상품|최근\s*본\s*상품|함께\s*구매|다른\s*고객|추천\s*상품|best\s*item|related\s*products?|recommend(?:ed|ation)?|recently\s*viewed)/i.test(context);
}

function isDetailContext(context: string) {
  return /(상세\s*정보|상세정보|상품\s*정보|상품정보|판매\s*공지|구매\s*후기|실제|조리컷|상세컷|제품\s*상세|product\s*detail|detail\s*view|goods\s*view)/i.test(context);
}

const maxGalleryImages = 80;
const maxDetailImages = 60;

const blockedImageKeywordPattern = /(logo|icon|ico|favicon|sprite|btn|button|arrow|close|kakao|naver|facebook|instagram|youtube|share|sns|review-star|star|badge|footer|header|common|loading|blank|spacer|noimage|no-image|coupon|app|qr|cs|delivery-icon|profile|avatar|reward|insertreview|qna|alarm_customer|stockchild)/i;
const recommendationKeywordPattern = /(recommend|related|bestitem|best-item|recent|today|newarrival|new-arrival|other|also|ranking|popular|viewed|오늘의\s*추천|추천\s*상품|최근\s*본\s*상품|관련\s*상품|베스트\s*상품|인기\s*상품)/i;
const readableRecommendationPattern = /(오늘의\s*추천상품|오늘의\s*추천|추천\s*상품|관련\s*상품|최근\s*본\s*상품|함께\s*구매|많이\s*본\s*상품|베스트\s*상품|인기\s*상품|다른\s*고객|recommend(?:ed|ation)?|related\s*products?|recently\s*viewed|best\s*item|popular\s*item)/i;
const textHeavyKeywordPattern = /(notice|guide|info|description|desc|delivery|return|exchange|refund|event|coupon|banner|benefit|membership|review|qna|faq|공지|안내|배송|교환|반품|환불|이벤트|쿠폰|혜택|리뷰|후기|문의)/i;
const detailKeywordPattern = /(goods|detail|product|item|upload|editor|contents?|image|goodsimg|view|viewarea|detailview|userfiles|thumfull|thumbpc|상세|상품|제품|본문|설명|실제|조리|구성)/i;
const cacheParamPattern = /^(w|width|h|height|q|quality|format|resize|cache|t|v|ver|_t|thumb)$/i;

function toAbsoluteImageUrl(src: string, baseUrl: string): string | null {
  const decoded = decodeHtml(String(src || "").trim());
  if (!decoded || /^(data|blob|javascript|file):/i.test(decoded)) return null;

  try {
    const resolved = new URL(decoded, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    if (isPrivateHostname(resolved.hostname)) return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function normalizeImageUrlForDedup(value: string) {
  try {
    const parsed = new URL(value);
    parsed.protocol = "https:";
    const params = Array.from(parsed.searchParams.entries());
    parsed.search = "";
    for (const [key, paramValue] of params) {
      if (!cacheParamPattern.test(key)) parsed.searchParams.append(key, paramValue);
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return value.replace(/[?#].*$/, "").replace(/^http:/, "https:");
  }
}

function mergeImageUrls(values: string[]) {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const value of values) {
    if (!value || !looksLikeUsableProductImage(value)) continue;
    const key = normalizeImageUrlForDedup(value);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }

  return merged;
}

function isRecommendedThumbnailUrl(value: string) {
  return /\/data\/goods\/[^?]+\/small\/thum2\//i.test(value);
}

function selectMainProductImage(candidates: ProductImageCandidate[], galleryImages: string[], fallbackMainImage: string, preferFilteredGallery = false) {
  const preferredCandidate = candidates.find((candidate) => !isRecommendedThumbnailUrl(candidate.url) && !/\/(?:data\/reviewimg|review)\//i.test(candidate.url));
  const preferredGalleryImage = galleryImages.find((image) => !isRecommendedThumbnailUrl(image) && !/\/(?:data\/reviewimg|review)\//i.test(image));

  return (preferFilteredGallery ? preferredGalleryImage : preferredCandidate?.url) || (preferFilteredGallery ? preferredCandidate?.url : preferredGalleryImage) || candidates[0]?.url || galleryImages[0] || fallbackMainImage;
}

function getTagAttribute(tag: string, name: string) {
  const pattern = new RegExp(`\\s${name}=["']([^"']*)["']`, "i");
  return decodeHtml(tag.match(pattern)?.[1] || "");
}

function bestSrcsetImage(value: string, baseUrl: string) {
  const candidates = value
    .split(",")
    .map((item) => {
      const parts = item.trim().split(/\s+/);
      const url = toAbsoluteImageUrl(parts[0] || "", baseUrl);
      const width = Number((parts[1] || "").replace(/[^\d]/g, ""));
      return url ? { url, width } : null;
    })
    .filter((item): item is { url: string; width: number } => Boolean(item));

  return candidates.sort((a, b) => b.width - a.width)[0]?.url || "";
}

function imageExtensionPenalty(url: string) {
  const lower = url.toLowerCase().split("?")[0];
  if (!/\.(jpe?g|png|webp|avif|gif)$/.test(lower) && !/(image|img|photo|thumb|thumfull|thumbpc|upload|editor|contents?\/)/i.test(lower)) return -100;
  if (/\.(svg|ico|webmanifest)$/.test(lower)) return -100;
  if (/\.gif$/.test(lower)) return -12;
  if (/\.(jpe?g|png|webp|avif)$/.test(lower)) return 6;
  return 0;
}

function classifyProductType(text: string) {
  const normalized = text.toLowerCase();
  const groups = [
    {
      type: "meat",
      keywords: ["고기", "한우", "소고기", "등심", "갈비", "스테이크", "정육", "beef", "meat"],
    },
    {
      type: "fruit",
      keywords: ["과일", "복숭아", "사과", "배", "샤인머스캣", "귤", "감귤", "망고", "딸기", "fruit"],
    },
    { type: "kimchi-side", keywords: ["김치", "반찬", "볶음", "절임", "side dish"] },
    { type: "seafood", keywords: ["수산", "생선", "새우", "오징어", "전복", "굴비", "seafood"] },
    { type: "snack", keywords: ["간식", "쿠키", "비스킷", "디저트", "빵", "snack"] },
    { type: "health", keywords: ["건강", "홍삼", "비타민", "영양제", "health"] },
    { type: "living", keywords: ["생활", "주방", "리빙", "가전", "living"] },
  ];
  return (
    groups.find((group) => group.keywords.some((keyword) => normalized.includes(keyword))) || {
      type: "general",
      keywords: [],
    }
  );
}

function scoreEnhancedImageCandidate(params: { url: string; source: ProductImageCandidate["type"]; context?: string; order: number; alt?: string; width?: number; height?: number }) {
  const text = `${params.url} ${params.context || ""} ${params.alt || ""}`.toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  if (params.source === "main") {
    score += 80;
    reasons.push("meta/jsonld main image");
  }
  if (params.source === "detail") {
    score += 48;
    reasons.push("detail context");
  }
  if (params.source === "content") {
    score += 30;
    reasons.push("content image");
  }
  if (detailKeywordPattern.test(text)) {
    score += 30;
    reasons.push("product/detail keyword");
  }
  if (/\/userfiles\/[^?]+\/(?:thumfull|thumbpc|thumb)\//i.test(params.url)) {
    score += 34;
    reasons.push("detail-page userfiles image");
  }
  if (params.width && params.height) {
    if (params.width >= 300 && params.height >= 300) score += 12;
    if (params.width < 140 || params.height < 140) score -= 50;
    const ratio = Math.max(params.width, params.height) / Math.max(1, Math.min(params.width, params.height));
    if (ratio > 4) score -= 30;
  }
  score += imageExtensionPenalty(params.url);

  if (blockedImageKeywordPattern.test(text)) {
    score -= 80;
    reasons.push("blocked ui/logo keyword");
  }
  if (recommendationKeywordPattern.test(text) || readableRecommendationPattern.test(text)) {
    score -= 42;
    reasons.push("recommendation/related context");
  }
  if (textHeavyKeywordPattern.test(text) && !/\/userfiles\/[^?]+\/(?:thumfull|thumbpc|thumb)\//i.test(params.url)) {
    score -= 22;
    reasons.push("text-heavy/info keyword");
  }
  if (/\/data\/goods\/[^?]+\/small\/thum2\//i.test(params.url)) {
    score -= params.source === "main" ? 18 : 58;
    reasons.push("small recommended thumbnail path");
  }
  if (/\/data\/reviewimg\//i.test(params.url)) {
    score -= 72;
    reasons.push("review image path");
  }

  score -= Math.min(params.order, 1000) / 1000;
  return { score, reason: reasons.join(", ") };
}

function pushCandidate(
  list: ProductImageCandidate[],
  input: {
    url?: string | null;
    type: ProductImageCandidate["type"];
    context?: string;
    order: number;
    alt?: string;
    width?: number;
    height?: number;
  },
  baseUrl: string
) {
  const url = input.url?.startsWith("http") ? input.url : toAbsoluteImageUrl(input.url || "", baseUrl);
  if (!url) return;
  const { score, reason } = scoreEnhancedImageCandidate({ ...input, url, source: input.type });
  if (score < -20) return;
  list.push({
    url,
    type: input.type,
    score,
    reason,
    alt: input.alt,
    context: input.context?.replace(/\s+/g, " ").trim().slice(0, 2400),
    width: input.width,
    height: input.height,
    pageOrder: input.order,
    evidenceRoles: input.type === "main" ? ["identity"] : inferProductDetailOcrEvidenceRoles(`${input.alt || ""} ${input.context || ""}`),
    evidenceScope: input.type === "main" ? "structured-main" : input.type === "detail" || input.type === "content" ? "product-detail" : "gallery",
  });
}

function extractEnhancedImageCandidates(html: string, baseUrl: string, seedImages: string[] = []) {
  const candidates: ProductImageCandidate[] = [];
  seedImages.filter(Boolean).forEach((url, index) => pushCandidate(candidates, { url, type: "main", order: index }, baseUrl));

  const metaImages = [metaContent(html, "og:image"), metaContent(html, "og:image:secure_url"), metaContent(html, "twitter:image"), metaContent(html, "twitter:image:src"), metaContent(html, "image")];
  metaImages.filter(Boolean).forEach((url, index) => pushCandidate(candidates, { url, type: "main", order: 20 + index }, baseUrl));

  const backgroundPattern = /url\((["']?)([^"')]+)\1\)/gi;
  for (const match of html.matchAll(backgroundPattern)) {
    const index = match.index ?? 0;
    const context = textContextFromHtml(html.slice(Math.max(0, index - 600), Math.min(html.length, index + 600)));
    const type: ProductImageCandidate["type"] = isProductDetailContext(context) || detailKeywordPattern.test(context) ? "detail" : "content";
    pushCandidate(candidates, { url: match[2], type, context, order: index }, baseUrl);
  }

  const imgPattern = /<img\b[^>]*>/gi;
  const attrNames = ["src", "data-src", "data-original", "data-lazy", "data-lazy-src", "data-url", "data-image", "data-img", "data-zoom-image", "data-full"];
  for (const match of html.matchAll(imgPattern)) {
    const tag = match[0];
    const index = match.index ?? 0;
    const alt = getTagAttribute(tag, "alt") || getTagAttribute(tag, "title");
    const classContext = `${getTagAttribute(tag, "class")} ${getTagAttribute(tag, "id")}`;
    const nearbyText = textContextFromHtml(html.slice(Math.max(0, index - 900), Math.min(html.length, index + 900)));
    const context = `${alt} ${classContext} ${nearbyText}`;
    const type: ProductImageCandidate["type"] = isProductDetailContext(context) || detailKeywordPattern.test(`${classContext} ${tag}`) ? "detail" : "gallery";
    const width = Number(getTagAttribute(tag, "width")) || undefined;
    const height = Number(getTagAttribute(tag, "height")) || undefined;

    for (const attrName of attrNames) {
      pushCandidate(candidates, { url: getTagAttribute(tag, attrName), type, context, order: index, alt, width, height }, baseUrl);
    }
    const srcset = getTagAttribute(tag, "srcset") || getTagAttribute(tag, "data-srcset");
    if (srcset) {
      pushCandidate(
        candidates,
        {
          url: bestSrcsetImage(srcset, baseUrl),
          type,
          context: `${context} srcset-large`,
          order: index,
          alt,
          width,
          height,
        },
        baseUrl
      );
    }
  }

  const byUrl = new Map<string, ProductImageCandidate>();
  for (const candidate of candidates) {
    if (!looksLikeUsableProductImage(candidate.url)) continue;
    const key = normalizeImageUrlForDedup(candidate.url);
    const existing = byUrl.get(key);
    if (!existing || candidate.score > existing.score) byUrl.set(key, candidate);
  }

  return Array.from(byUrl.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 40);
}

function productImageCandidateScore(value: string, context = "") {
  const text = `${value} ${context}`.toLowerCase();
  let score = 0;
  if (/(product|goods|item|detail|thumb|thumbnail|photo|gallery|prd|prod|contents?|view|viewarea|detailview)/.test(text)) score += 2;
  if (/(상품|제품|상세|상세정보|상품정보|대표|썸네일|포토|사진|갤러리|원본|고기|한우|소고기|스테이크|등심|갈비|내장|곱창|육즙|조리컷|실제|구이|구성)/.test(text)) score += 3;
  if (/\/userfiles\/[^?]+\/thumfull\//.test(text)) score += 18;
  if (/\/userfiles\/[^?]+\/thumbpc\//.test(text)) score += 10;
  if (/\/userfiles\/[^?]+\/thumb\//.test(text)) score += 8;
  if (/\/data\/reviewimg\//.test(text)) score -= 10;
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
  const starts = [...html.matchAll(/(?:상세\s*정보|상세정보|상품\s*정보|상품정보|제품\s*상세|product\s*detail|detail\s*view|goods\s*view|goodsdetail|detailarea|detailimg|prd_detail)/gi)].map((match) => match.index ?? 0);
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

const productUspTextPattern = /(원산지|국내산|한우|등급|부위|등심|안심|채끝|갈비|마블링|선별|숙성|냉장|냉동|산지|직송|구성|중량|용량|식감|육즙|풍미|고소|부드|신선|원재료|함량|무첨가|저자극|향|세정|쿨링|보습|선물|캠핑|가족|실속|프리미엄|특마블|도매팩|사과|청사과|아오리|과일|제철|수확|한정|아삭|새콤달콤|청량|과즙|품종)/i;
const productUspBoilerplatePattern = /(로그인|회원가입|장바구니|마이페이지|고객센터|상품문의|구매후기|리뷰쓰기|교환|반품|환불|배송안내|개인정보|이용약관|추천상품|관련상품|최근 본 상품|전체\s*리뷰|리뷰\s*목록|step\s*\d+|구성\s*선택|copyright|all rights reserved)/i;
function isNoisyProductSignal(value: string) {
  return isUnsafeProductCreativeSignal(value) || isMalformedProductSignal(value) || /[ㄱ-ㅎㅏ-ㅣ]|너무[ㅜㅠㅋㅎ]*\s*좋|중요부위|샴푸\s*너무|리뷰.*리뷰.*리뷰/i.test(value);
}

function productDetailText(html: string) {
  const ranges = detailHtmlRanges(html);
  const chunks = ranges.length ? ranges.slice(0, 3).map(([start, end]) => html.slice(start, Math.min(end, start + 180_000))) : [html.slice(0, 350_000)];

  return chunks
    .join(" ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:nav|footer|form)[^>]*>[\s\S]*?<\/(?:nav|footer|form)>/gi, " ")
    .replace(/<(?:br|p|li|h[1-6]|tr|td|div|section)[^>]*>/gi, " · ")
    .replace(/\s(?:alt|title)=["']([^"']+)["']/gi, " · $1 · ")
    .replace(/<[^>]+>/g, " ");
}

function extractProductUspDescription(html: string, baseDescription: string, productName: string) {
  const summary = currentProductSummaryText(html);
  // 상단 요약이 존재하더라도 이미지 중심 상세페이지의 본문·alt 근거를 버리지
  // 않습니다. 요약은 상품명·가격뿐인 경우가 많아 이것만 쓰면 OCR의 사실 상한도
  // 빈약해지고, 결과적으로 6장 문구가 같은 일반론으로 수렴합니다.
  const source = [baseDescription, summary, productDetailText(html)].filter(Boolean).join(" · ");
  const genericNameTokens = new Set(["국내산", "상품", "제품", "만든", "진짜", "세트", "팩", "박스", "행사상품"]);
  const productNameTokens = Array.from(productName.matchAll(/[0-9a-z가-힣]+/gi))
    .map((match) => match[0].toLowerCase())
    .filter((token) => token.length >= 2 && !genericNameTokens.has(token) && !/^\d+(?:kg|g|ml|l|팩|개)?$/i.test(token));
  const candidates = source
    .split(/\s*[·•|]\s*|[.!?]\s+/)
    .map(decodeHtml)
    .filter((value) => {
      const length = [...value.replace(/\s+/g, "")].length;
      const normalized = value.toLowerCase();
      const matchesCurrentProduct = !productNameTokens.length || productNameTokens.some((token) => normalized.includes(token)) || productUspTextPattern.test(value);
      return length >= 5 && length <= 120 && matchesCurrentProduct && !productUspBoilerplatePattern.test(value) && !isNoisyProductSignal(value) && !isPriceOnlyCreativeSignal(value) && !/^(상품|제품|상세|정보|설명|홈)$/.test(value);
    })
    .map((value, index) => {
      let score = index === 0 && baseDescription ? 20 : 0;
      if (productUspTextPattern.test(value)) score += 10;
      if (/\d/.test(value)) score += 2;
      if (productName && value.includes(productName)) score += 3;
      score += productNameTokens.filter((token) => value.toLowerCase().includes(token)).length * 5;
      return { value, score, index };
    })
    .sort((a, b) => (a.score === b.score ? a.index - b.index : b.score - a.score));
  const selected: string[] = [];
  const keys = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.value.replace(/[^0-9a-z가-힣]/gi, "").toLowerCase();
    if (!key || keys.has(key)) continue;
    keys.add(key);
    selected.push(candidate.value);
    if (selected.length >= 12) break;
  }
  return selected.join(" · ") || baseDescription;
}

function selectMainBenefit(benefits: string[], description: string, productName: string) {
  const candidates = [...benefits, ...description.split(/\s*[·•|]\s*/)]
    .map((value) => decodeHtml(value).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value) => value !== productName)
    .filter((value) => !isVagueStandaloneSensoryClaim(value))
    .filter((value) => !isPriceOnlyCreativeSignal(value) && !isPromotionalProductSignal(value))
    .filter((value) => !/(택배사|배송비|포인트\s*지급|회원|로그인|쿠폰)/i.test(value) && !isNoisyProductSignal(value));
  const ranked = candidates
    .map((value, index) => {
      let score = 0;
      if (/(아삭|새콤달콤|청량|식감|풍미|신선|부드|고소|향|사용감)/i.test(value)) score += 40;
      if (/(제철|여름|한정|수확|산지|직송)/i.test(value)) score += 28;
      if (/\d[\d,.]*\s*(?:kg|g|ml|l|개|팩|병|원|%)/i.test(value)) score += 18;
      if (/(특가|마진\s*없이|구성|실속)/i.test(value)) score += 12;
      if (/(?:^|\s)1등(?:\s|$)|특가.*특가|★|!!/i.test(value)) score -= 72;
      if ([...value.replace(/\s+/g, "")].length > 48) score -= 24;
      score += Math.max(0, 18 - Math.abs([...value].length - 24));
      return { value, score, index };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);
  return ranked[0]?.value || candidates[0] || productName;
}

function extractStructuredProductSignals(description: string) {
  const candidates = description
    .split(/\s*[·•|]\s*|[.!?]\s+/)
    .map((value) => decodeHtml(value).replace(/\s+/g, " ").trim())
    .filter((value) => value.length >= 4 && value.length <= 120 && !productUspBoilerplatePattern.test(value) && !isNoisyProductSignal(value));
  const verifiedBenefits = candidates
    .filter((value) => productUspTextPattern.test(value))
    .filter((value) => !isPriceOnlyCreativeSignal(value) && !isPromotionalProductSignal(value) && !isMalformedProductSignal(value))
    .filter((value) => !/&#\d+;|(?:^|\s)1등(?:\s|$)/i.test(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 12);
  const ingredientPattern = /(원재료|원료|성분|함유|추출물|민트|티트리|레몬|라임|코코넛|시어|과즙|국내산|원산지)/i;
  const ingredients = candidates
    .filter((value) => ingredientPattern.test(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 8);
  return { verifiedBenefits, ingredients };
}

function collectGalleryImages(html: string, baseUrl: string, seedImages: string[]) {
  const detailRanges = detailHtmlRanges(html);
  const candidates: { image: string; score: number; order: number; inDetail: boolean }[] = [...seedImages, absoluteUrl(metaContent(html, "og:image"), baseUrl), absoluteUrl(metaContent(html, "twitter:image"), baseUrl)].filter(Boolean).map((image, index) => ({
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
    if (readableRecommendationPattern.test(context)) continue;
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
      const score = productImageCandidateScore(image, context) + (inDetail ? 12 : 0) + (dimensions.length ? 1 : 0);
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


export {
  maxGalleryImages,
  maxDetailImages,
  normalizeImageUrlForDedup,
  mergeImageUrls,
  isRecommendedThumbnailUrl,
  selectMainProductImage,
  bestSrcsetImage,
  looksLikeUsableProductImage,
  getTagAttribute,
  textContextFromHtml,
  classifyProductType,
  extractEnhancedImageCandidates,
  extractProductUspDescription,
  selectMainBenefit,
  extractStructuredProductSignals,
  collectGalleryImages,
};
