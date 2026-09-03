function countHangul(value: string) {
  return (value.match(/[가-힣]/g) ?? []).length;
}

function repairMojibake(value: string) {
  if (!/[\u0080-\u00ff]/.test(value)) return value;

  try {
    const repaired = Buffer.from(value, "latin1").toString("utf8");
    return countHangul(repaired) > countHangul(value) ? repaired : value;
  } catch {
    return value;
  }
}

function decodeHtml(value: string) {
  const decoded = value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return repairMojibake(decoded);
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"), new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i")];

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

function invalidProductPageMessage(html: string, url: URL) {
  if (/상품이\s*삭제되었거나|잘못된\s*상품코드|document\.location=['"]\/['"]/i.test(html)) {
    return "상품이 삭제되었거나 잘못된 상품코드입니다. 실제 상품 상세페이지 URL을 다시 확인해주세요.";
  }

  if (/kookdae\.co\.kr$/i.test(url.hostname) && !/\/Goods\/Detail\//i.test(url.pathname)) {
    return "국대한우 상품은 /Goods/Detail/... 형태의 상품 상세페이지 URL을 입력해주세요.";
  }

  return "";
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

function currentProductSummaryHtml(html: string) {
  const anchors = [/<div[^>]+class=["'][^"']*\binfo-wrapper\b[^"']*\bwrap_info\b[^"']*["'][^>]*>/i, /<div[^>]+class=["'][^"']*\bdetail-heading\b[^"']*["'][^>]*>/i, /<section[^>]+(?:id|class)=["'][^"']*(?:product|goods)[^"']*(?:summary|info|detail)[^"']*["'][^>]*>/i];
  const match = anchors.map((pattern) => html.match(pattern)).find(Boolean);
  if (!match || match.index === undefined) return "";
  const start = match.index;
  const tail = html.slice(start, Math.min(html.length, start + 90_000));
  const end = tail.search(/(?:<!--\s*\/\/\s*info-wrapper\s*-->|구매후기가\s*증명|오늘의\s*추천상품|관련\s*상품|recently\s*viewed)/i);
  return tail.slice(0, end > 0 ? end : tail.length);
}

function currentProductSummaryText(html: string) {
  const summary = currentProductSummaryHtml(html);
  if (!summary) return "";
  return decodeHtml(
    summary
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(?:br|p|li|h[1-6]|tr|td|div|section|span|text)[^>]*>/gi, " · ")
      .replace(/<[^>]+>/g, " ")
  );
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
    const raw = script
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();
    if (!raw) continue;

    try {
      nodes.push(...collectJsonLdNodes(JSON.parse(raw)));
    } catch {
      continue;
    }
  }

  const product = nodes.find(isProductNode) ?? nodes[0] ?? {};
  const offers = arrayValue(product.offers as Record<string, unknown> | Record<string, unknown>[] | undefined) ?? {};
  const images = imageValues(product.image)
    .map((image) => absoluteUrl(image, baseUrl))
    .filter(Boolean);

  return {
    name: stringValue(product.name),
    description: stringValue(product.description),
    image: images[0] || "",
    images,
    price: stringValue((offers as Record<string, unknown>).price) || stringValue((offers as Record<string, unknown>).lowPrice) || stringValue((offers as Record<string, unknown>).highPrice),
    brandName: stringValue((product.brand as Record<string, unknown> | undefined)?.name) || stringValue(product.brand),
    category: stringValue(product.category),
  };
}

function extractPrice(html: string, jsonLdPrice: string) {
  const raw = metaContent(html, "product:price:amount") || metaContent(html, "product:sale_price:amount") || metaContent(html, "og:price:amount") || metaContent(html, "twitter:data1") || jsonLdPrice || firstMatch(html, [/itemprop=["']price["'][^>]+content=["']([^"']+)["']/i, /itemprop=["']price["'][^>]+value=["']([^"']+)["']/i, /["'](?:salePrice|discountPrice|finalPrice|price|goodsPrice|sellPrice|sale_price)["']\s*:\s*["']?([\d,.]+)["']?/i, /(?:판매가|할인가|상품가|가격)[^0-9]{0,30}([\d,]+)\s*원/i, /([\d,]+)\s*원/i]);

  return raw ? formatPrice(raw) : "";
}

function extractOriginalPrice(html: string, salePrice: string) {
  const saleNumeric = numberValue(salePrice);
  const productSummary = currentProductSummaryHtml(html);
  const raw = metaContent(html, "product:original_price:amount") || metaContent(html, "product:retail_price:amount") || firstMatch(productSummary, [/class=["'][^"']*(?:dc-price|org-price|original-price|retail-price)[^"']*["'][^>]*>[\s\S]{0,160}?([\d,.]+)\s*원/i, /(?:기존가|정상가|소비자가|시중가)[^0-9]{0,60}([\d,]+)\s*원/i]) || firstMatch(html, [/(?:originalPrice|consumerPrice|marketPrice|listPrice|retailPrice|oldPrice|originPrice)["']?\s*[:=]\s*["']?([\d,.]+)/i, /(?:기존가|정상가|소비자가|시중가|원가)[^0-9]{0,30}([\d,]+)\s*원/i]);
  const formatted = raw ? formatPrice(raw) : "";
  if (!formatted) return "";
  const originalNumeric = numberValue(formatted);
  return originalNumeric && saleNumeric && originalNumeric <= saleNumeric ? "" : formatted;
}

function extractDiscountInfo(html: string, price: string, originalPrice = "") {
  const calculatedRate = discountFromPrices(numberValue(originalPrice), numberValue(price));
  if (calculatedRate) return `${calculatedRate}% 할인`;

  const productSummary = currentProductSummaryHtml(html);
  const summaryRate = validDiscountRate(firstMatch(productSummary, [/class=["'][^"']*(?:discount|dc-rate)[^"']*["'][^>]*>[\s\S]{0,80}?(\d{1,2})\s*(?:<[^>]+>\s*)*%/i, /(?:할인율|할인)[^0-9]{0,40}(\d{1,2})\s*%/i]));
  if (summaryRate) return `${summaryRate}% 할인`;

  for (const window of windowsAroundPrice(html, price)) {
    if (/포인트\s*지급|적립|APP\s*구매/i.test(window)) continue;
    const nearbyRate = validDiscountRate(firstMatch(window, [/(?:할인율|할인|SALE|sale|dc|discount)[^0-9]{0,40}(\d{1,2})\s*%/i, /(\d{1,2})\s*%\s*(?:할인|SALE|sale)/i, /(\d{1,2})\s*%/i]));
    if (nearbyRate) return `${nearbyRate}% 할인`;
  }

  const detailWindows = [...html.matchAll(/(?:상세\s*정보|상세정보|상품\s*정보|상품정보|제품\s*상세|product\s*detail|goods\s*view)/gi)].map((match) => {
    const index = match.index ?? 0;
    return html.slice(index, Math.min(html.length, index + 5000));
  });

  for (const window of detailWindows) {
    const detailRate = validDiscountRate(firstMatch(window, [/(?:할인율|할인|SALE|sale|dc|discount)[^0-9]{0,40}(\d{1,2})\s*%/i, /(\d{1,2})\s*%\s*(?:할인|SALE|sale)/i, /(\d{1,2})\s*%/i]));
    if (detailRate) return `${detailRate}% 할인`;
  }

  return "";
}

function extractCategory(html: string, jsonLdCategory: string) {
  return metaContent(html, "product:category") || metaContent(html, "article:section") || jsonLdCategory || "";
}

function normalizeProductCategory(rawCategory: string, productContext: string) {
  const context = `${rawCategory} ${productContext}`.toLowerCase();
  if (/뷰티|화장품|스킨|로션|크림|세럼|클렌징|샤워\s*젤|샤워젤|바디\s*워시|바디워시|퍼스널\s*케어|멘톨|쿨링|beauty|cosmetic|shower\s*gel|body\s*wash|personal\s*care/.test(context)) {
    return "뷰티/스킨케어";
  }
  if (/건강기능|영양제|비타민|프로바이오틱스|supplement|wellness/.test(context)) {
    return "건강기능식품";
  }
  if (/식품|음식|육류|한우|정육|소고기|돼지고기|과일|채소|농산|축산|사과|청사과|아오리|배|복숭아|자두|포도|수박|참외|딸기|감귤|한라봉|토마토|감자|고구마|옥수수|버섯|무화과|곶감|말랭이|반건조|건조과일|간식|스낵|과자|디저트|빵|떡|견과|김치|반찬|수산|해산물|생선|food|beef|meat|apple|fruit|produce|snack|dessert/.test(context)) {
    return "식품/선물";
  }
  if (/패션|의류|신발|가방|fashion|apparel/.test(context)) return "패션/의류";
  if (/인테리어|가구|침구|리빙|interior|furniture/.test(context)) return "인테리어/리빙";
  if (/생활|주방|욕실|청소|반려|육아|living|household/.test(context)) return "생활용품";
  if (/디지털|가전|전자|앱|digital|electronic|device/.test(context)) return "디지털/앱";
  return rawCategory || "기타";
}


export {
  decodeHtml,
  metaContent,
  titleContent,
  invalidProductPageMessage,
  absoluteUrl,
  numberValue,
  currentProductSummaryText,
  extractJsonLd,
  extractPrice,
  extractOriginalPrice,
  extractDiscountInfo,
  extractCategory,
  normalizeProductCategory,
};

