import type { AutoProductionProductCandidate } from "./types";

const optionNoise = /(?:\[[^\]]*\]|\([^)]*(?:옵션|선택|증정|한정|특가|무료배송)[^)]*\)|\b(?:option|size|color)\b)/giu;
const quantityNoise = /(?:\d+(?:\.\d+)?\s*(?:kg|g|mg|l|ml|㎏|㎖|팩|pack|개|입|봉|병|박스|box|세트|set|인분)|\d+\s*[x×]\s*\d+|\d+\s*\+\s*\d+)/giu;
const salesNoise = /(?:한정판매|기간한정|특가|할인|무료배송|증정|프리미엄|선물용|가정용|대용량|소용량|구성|세트|묶음|골라담기)/giu;

export function canonicalProductUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return value.trim().replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase();
  }
}

export function normalizedProductFamilyName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(optionNoise, " ")
    .replace(quantityNoise, " ")
    .replace(salesNoise, " ")
    .replace(/[★☆♥♡!@#$%^&*_+=|~`'"“”‘’.,:;/?<>·ㆍ-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stableImageSimilarity(candidate: Pick<AutoProductionProductCandidate, "productInfo">) {
  return (candidate.productInfo.sourceImageCandidates || [])
    .map((image) => image.perceptualHash || image.contentHash || "")
    .find(Boolean) || "";
}

export function productFamilyKey(candidate: Pick<AutoProductionProductCandidate, "advertiserId" | "productName" | "productUrl" | "category" | "productInfo">) {
  const familyName = normalizedProductFamilyName(candidate.productName);
  const canonical = canonicalProductUrl(candidate.productUrl);
  const pathHint = canonical.replace(/^https?:\/\/[^/]+/i, "").replace(/\d+/g, "").replace(/[^a-z가-힣]+/gi, "-").replace(/^-+|-+$/g, "");
  const imageHint = stableImageSimilarity(candidate);
  const identity = familyName.length >= 2 ? familyName : pathHint || imageHint || canonical;
  return [candidate.advertiserId, normalizedProductFamilyName(candidate.category), identity].join(":");
}

export function candidateIdentityKeys(candidate: AutoProductionProductCandidate) {
  return Array.from(new Set([
    `id:${candidate.id}`,
    candidate.externalId ? `external:${candidate.externalId}` : "",
    candidate.productCode ? `code:${candidate.productCode}` : "",
    candidate.sku ? `sku:${candidate.sku}` : "",
    `url:${candidate.canonicalProductUrl || canonicalProductUrl(candidate.productUrl)}`,
    `family:${candidate.productFamilyKey || productFamilyKey(candidate)}`,
  ].filter(Boolean)));
}
