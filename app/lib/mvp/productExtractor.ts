export type ProductInfo = {
  productName: string;
  price: string;
  description: string;
  imageUrl?: string;
};

function metaContent(html: string, key: string) {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, "i");
  return pattern.exec(html)?.[1]?.replace(/&amp;/g, "&").trim() ?? "";
}

export async function extractProductInfo(websiteUrl: string): Promise<ProductInfo> {
  const response = await fetch(websiteUrl, {
    headers: {
      "User-Agent": "AdAtlasBot/0.1 (+local MVP ad generator)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await response.text();
  const title = metaContent(html, "og:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "상품명";
  const description = metaContent(html, "og:description") || metaContent(html, "description") || "상품 상세 설명을 추출하지 못했습니다.";
  const imageUrl = metaContent(html, "og:image");
  const price = metaContent(html, "product:price:amount") || metaContent(html, "og:price:amount") || "";

  return {
    productName: title.replace(/\s+/g, " ").slice(0, 80),
    price,
    description: description.replace(/\s+/g, " ").slice(0, 180),
    imageUrl,
  };
}
