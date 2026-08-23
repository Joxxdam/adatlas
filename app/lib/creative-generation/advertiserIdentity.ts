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

const canonicalAdvertiserByDomain: Record<string, string> = {
  "kookdae.co.kr": "국대한우",
  "koreakoreanbeef.com": "대한한우",
  "fightingfarm.com": "힘내라농가",
  "originalsource.co.kr": "오리지널소스",
};

const canonicalAdvertiserById: Record<string, string> = {
  "kookdae-hanwoo": "국대한우",
  "daehan-hanwoo": "대한한우",
  "himnaera-farm": "힘내라농가",
  "original-source": "오리지널소스",
};

function domainFrom(value: string | undefined) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function canonicalAdvertiserDisplayName(input: { advertiserId?: string; advertiserName?: string; brandName?: string; landingUrl?: string }) {
  const advertiserId = String(input.advertiserId || "").trim().toLowerCase();
  const landingDomain = domainFrom(input.landingUrl);
  const advertiserDomain = domainFrom(input.advertiserName);
  const brandDomain = domainFrom(input.brandName);
  const canonical = canonicalAdvertiserByDomain[landingDomain] || canonicalAdvertiserByDomain[advertiserDomain] || canonicalAdvertiserByDomain[brandDomain] || canonicalAdvertiserById[advertiserId];
  return canonical || input.advertiserName?.trim() || input.brandName?.trim() || landingDomain || "광고주 미지정";
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
