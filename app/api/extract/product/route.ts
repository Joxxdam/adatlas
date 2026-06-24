import { NextResponse } from "next/server";
import { ExtractedProductInfo } from "../../../lib/mvp/types";

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
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

function extractPrice(html: string) {
  const metaPrice =
    metaContent(html, "product:price:amount") ||
    metaContent(html, "og:price:amount") ||
    metaContent(html, "twitter:data1");
  if (metaPrice) return metaPrice;

  const jsonLdPrice = html.match(/"price"\s*:\s*"?([^",}\]]+)"?/i)?.[1];
  return jsonLdPrice ? decodeHtml(jsonLdPrice) : "";
}

function extractCategory(html: string) {
  return (
    metaContent(html, "product:category") ||
    metaContent(html, "article:section") ||
    html.match(/"category"\s*:\s*"?([^",}\]]+)"?/i)?.[1] ||
    ""
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const productUrl = String(body.productUrl || "").trim();

    if (!productUrl) {
      return NextResponse.json({ ok: false, error: "productUrl이 필요합니다." }, { status: 400 });
    }

    let url: URL;
    try {
      url = new URL(productUrl);
    } catch {
      return NextResponse.json({ ok: false, error: "올바른 상품 URL을 입력해주세요." }, { status: 400 });
    }

    if (!["http:", "https:"].includes(url.protocol)) {
      return NextResponse.json({ ok: false, error: "http 또는 https URL만 사용할 수 있습니다." }, { status: 400 });
    }

    const response = await fetch(url.toString(), {
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; AdAtlasProductExtractor/1.0)",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json({ ok: false, error: `상품 페이지 접속 실패: HTTP ${response.status}` }, { status: 502 });
    }

    const html = await response.text();
    const productInfo: ExtractedProductInfo = {
      productName: metaContent(html, "og:title") || metaContent(html, "twitter:title") || titleContent(html),
      category: extractCategory(html),
      price: extractPrice(html),
      discountInfo: "",
      mainImage: absoluteUrl(metaContent(html, "og:image") || metaContent(html, "twitter:image"), url.toString()),
      description: metaContent(html, "og:description") || metaContent(html, "description") || metaContent(html, "twitter:description"),
      landingUrl: url.toString(),
    };

    return NextResponse.json({ ok: true, productInfo });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "상품 정보 추출 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
