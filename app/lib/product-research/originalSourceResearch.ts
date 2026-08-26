import originalSourceResearchData from "../../../data/original-source-vendor-research.json" with { type: "json" };
import type { ExtractedProductInfo } from "../mvp/types";
import type { VendorProductResearchContext, VendorResearchFact } from "./types";

type ResearchProduct = {
  id: string;
  productIds: string[];
  aliases: string[];
  mainBenefit: string;
  ingredients: string[];
  targetCustomer: string;
  facts: VendorResearchFact[];
  blockedClaims: string[];
  sourceDocument: string;
};

type ResearchLibrary = {
  sourceType: "vendor-provided-research";
  sourceLabel: string;
  extractedAt: string;
  products: ResearchProduct[];
};

const researchLibrary = originalSourceResearchData as ResearchLibrary;

function compact(values: Array<string | undefined>, limit = 20) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw || "").replace(/\s+/g, " ").trim();
    const key = value.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
}

function normalized(value: string) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

function productIdFromUrl(value: string) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/product\/[^/]+\/(\d+)(?:\/|$)/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function isOriginalSourceProduct(value: ExtractedProductInfo, productUrl: string) {
  try {
    if (/originalsource\.co\.kr$/i.test(new URL(productUrl).hostname)) return true;
  } catch {
    // 상품명·브랜드명 매칭으로 계속 확인한다.
  }
  return /오리지널\s*소스|original\s*source/i.test(`${value.brandName || ""} ${value.productName || ""}`);
}

function matchResearchProduct(value: ExtractedProductInfo, productUrl: string) {
  if (!isOriginalSourceProduct(value, productUrl)) return null;
  const urlProductId = productIdFromUrl(productUrl);
  if (urlProductId) {
    const byId = researchLibrary.products.find((product) => product.productIds.includes(urlProductId));
    if (byId) return { product: byId, reason: `상세 URL 상품번호 ${urlProductId} 일치` };
  }

  const haystack = normalized(`${value.productName} ${value.brandName || ""} ${productUrl}`);
  const candidates = researchLibrary.products
    .map((product) => ({
      product,
      alias: [...product.aliases].sort((left, right) => normalized(right).length - normalized(left).length).find((alias) => haystack.includes(normalized(alias))),
    }))
    .filter((candidate): candidate is { product: ResearchProduct; alias: string } => Boolean(candidate.alias))
    .sort((left, right) => normalized(right.alias).length - normalized(left.alias).length);
  return candidates[0] ? { product: candidates[0].product, reason: `상품명 별칭 '${candidates[0].alias}' 일치` } : null;
}

export function applyOriginalSourceVendorResearch(value: ExtractedProductInfo, productUrl: string): ExtractedProductInfo {
  const matched = matchResearchProduct(value, productUrl);
  if (!matched) return value;

  const facts = matched.product.facts.filter((fact) => fact.copyEligibility !== "blocked");
  const headlineFacts = facts.filter((fact) => fact.copyEligibility === "headlineEligible").map((fact) => fact.value);
  const proofFacts = facts.filter((fact) => fact.copyEligibility === "proofOnly").map((fact) => fact.value);
  const verifiedBenefits = compact([matched.product.mainBenefit, ...headlineFacts, ...proofFacts, ...(value.verifiedBenefits || [])], 16);
  const ingredients = compact([...matched.product.ingredients, ...(value.ingredients || [])], 12);
  const description = compact([value.extractedDescription || value.description, matched.product.mainBenefit, ...headlineFacts, ...proofFacts], 12).join(" · ");
  const vendorResearch: VendorProductResearchContext = {
    sourceType: researchLibrary.sourceType,
    sourceLabel: researchLibrary.sourceLabel,
    researchProductId: matched.product.id,
    sourceDocument: matched.product.sourceDocument,
    extractedAt: researchLibrary.extractedAt,
    matchReason: matched.reason,
    facts: matched.product.facts,
    blockedClaims: matched.product.blockedClaims,
  };

  return {
    ...value,
    mainBenefit: matched.product.mainBenefit,
    targetCustomer: matched.product.targetCustomer,
    description,
    extractedDescription: description,
    verifiedBenefits,
    ingredients,
    vendorResearch,
  };
}

export function matchOriginalSourceVendorResearch(value: Pick<ExtractedProductInfo, "productName" | "brandName">, productUrl: string) {
  return matchResearchProduct(value as ExtractedProductInfo, productUrl);
}
