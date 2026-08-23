import type { ProductInfoForPrompt } from "../mvp/types.ts";

function slug(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function resolveAdvertiserIdentity(product: ProductInfoForPrompt) {
  const explicit = product.creativeContext?.advertiserId?.trim();
  let domain = "";
  try {
    domain = new URL(product.landingUrl || "").hostname.replace(/^www\./, "").toLowerCase();
  } catch {}
  const name = product.advertiserName?.trim() || product.brandName?.trim() || domain || "unknown-advertiser";
  return { id: slug(explicit || domain || name) || "unknown-advertiser", name, domain };
}
