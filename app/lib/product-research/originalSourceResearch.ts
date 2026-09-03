import originalSourceResearchData from "../../../data/original-source-vendor-research.json" with { type: "json" };
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ExtractedProductInfo, ProductInfoForPrompt } from "../mvp/types";
import { isShippingCreativeSignal, isUnsafeProductCreativeSignal } from "../creative-generation/productSignalHygiene.ts";
import type { VendorProductResearchContext, VendorResearchCopyExample, VendorResearchFact } from "./types";

type ResearchProduct = {
  id: string;
  productIds: string[];
  aliases: string[];
  mainBenefit: string;
  ingredients: string[];
  targetCustomer: string;
  facts: VendorResearchFact[];
  copyExamples?: VendorResearchCopyExample[];
  researchCautions: string[];
  sourceDocument: string;
};

type ResearchLibrary = {
  version?: number;
  sourceType: "vendor-provided-research";
  sourceLabel: string;
  extractedAt: string;
  products: ResearchProduct[];
};

const bundledResearchLibrary = originalSourceResearchData as ResearchLibrary;
const researchFilePath = path.resolve(process.cwd(), "data", "original-source-vendor-research.json");

function researchLibraryForRequest() {
  try {
    // 상품 분석마다 파일을 다시 읽습니다. 파일이 작고 호출 빈도가 낮아 캐시 이득보다
    // 장시간 실행 중인 수동·자동 서버가 이전 조사본을 계속 쓰는 위험이 더 큽니다.
    const raw = readFileSync(researchFilePath, "utf8");
    const library = JSON.parse(raw) as ResearchLibrary;
    if (!Array.isArray(library.products) || !library.products.length) throw new Error("조사 상품이 없습니다.");
    return {
      hash: createHash("sha256").update(raw).digest("hex"),
      library,
    };
  } catch {
    const raw = JSON.stringify(bundledResearchLibrary);
    return {
      hash: createHash("sha256").update(raw).digest("hex"),
      library: bundledResearchLibrary,
    };
  }
}

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

type ResearchApplicableProduct = ExtractedProductInfo | ProductInfoForPrompt;

function productDescription(value: ResearchApplicableProduct) {
  return value.extractedDescription || ("description" in value ? value.description : "") || "";
}

function isOriginalSourceProduct(value: Pick<ResearchApplicableProduct, "productName" | "brandName">, productUrl: string) {
  try {
    if (/originalsource\.co\.kr$/i.test(new URL(productUrl).hostname)) return true;
  } catch {
    // 상품명·브랜드명 매칭으로 계속 확인한다.
  }
  return /오리지널\s*소스|original\s*source/i.test(`${value.brandName || ""} ${value.productName || ""}`);
}

function matchResearchProduct(value: ResearchApplicableProduct, productUrl: string) {
  if (!isOriginalSourceProduct(value, productUrl)) return null;
  const researchLibrary = researchLibraryForRequest().library;
  const urlProductId = productIdFromUrl(productUrl);
  if (urlProductId) {
    const byId = researchLibrary.products.find((product) => product.productIds.includes(urlProductId));
    if (byId) return { product: byId, products: [byId], reason: `상세 URL 상품번호 ${urlProductId} 일치`, selectionPack: false };
  }

  const haystack = normalized(`${value.productName} ${value.brandName || ""} ${productUrl}`);
  const candidates = researchLibrary.products
    .map((product) => ({
      product,
      alias: [...product.aliases].sort((left, right) => normalized(right).length - normalized(left).length).find((alias) => haystack.includes(normalized(alias))),
    }))
    .filter((candidate): candidate is { product: ResearchProduct; alias: string } => Boolean(candidate.alias))
    .sort((left, right) => normalized(right.alias).length - normalized(left.alias).length);
  if (candidates[0]) return { product: candidates[0].product, products: [candidates[0].product], reason: `상품명 별칭 '${candidates[0].alias}' 일치`, selectionPack: false };
  const selectionPack = /골라\s*담|골라담기|컴플리트\s*팩|향\s*선택/u.test(`${value.productName} ${productDescription(value)}`);
  return selectionPack
    ? { product: undefined, products: researchLibrary.products, reason: "오리지널소스 골라담기 상품명 일치", selectionPack: true }
    : null;
}

function selectionPackResearch(products: ResearchProduct[]) {
  const selected = [
    ["mint-tea-tree", "mint-7927", "민트&티트리 선택지는 250ml 한 통에 민트 잎 7,927장 분량을 담았다고 소개됨"],
    ["lemon-tea-tree", "lemon-ten-lemons", "레몬&티트리 선택지는 250ml 한 병에 시칠리아 레몬 10개 분량을 담았다고 소개됨"],
    ["coconut-shea-butter", "coconut-origin-coconut", "코코넛&시어버터 선택지는 아시아의 뜨거운 태양 아래 7,872시간 동안 자란 코코넛으로 소개됨"],
    ["zingy-lime", "lime-slices", "징기 라임 선택지의 패키지 ‘40’은 라임 40개가 아니라 40개의 리얼 라임 조각을 뜻한다고 정리됨"],
    ["rhubarb-raspberry", "rhubarb-extracts", "루바브&라즈베리 선택지는 루바브 줄기 추출물과 라즈베리 과일 추출물을 담은 제품으로 소개됨"],
  ] as const;
  const facts = selected.flatMap(([productId, factId, value]) => {
    const fact = products.find((product) => product.id === productId)?.facts.find((candidate) => candidate.id === factId);
    return fact ? [{ ...fact, id: `pack-${fact.id}`, value }] : [];
  });
  return {
    facts,
    copyExamples: [
      { angle: "서로 다른 원료 숫자", headline: "민트 7,927장부터 시칠리아 레몬 10개까지", support: "향 이름보다 원료 이야기가 먼저 보이는 5종 골라담기", factIds: ["pack-mint-7927", "pack-lemon-ten-lemons"] },
      { angle: "기분별 선택", headline: "오늘은 포근한 코코넛, 내일은 짜릿한 라임", support: "7,872시간의 코코넛부터 40개의 리얼 라임 조각까지", factIds: ["pack-coconut-origin-coconut", "pack-lime-slices"] },
      { angle: "낯선 원료", headline: "늘 같은 향 말고, 낯선 루바브까지", support: "다섯 향마다 다른 원료 포인트를 골라 쓰는 샤워", factIds: ["pack-rhubarb-extracts"] },
    ] satisfies VendorResearchCopyExample[],
  };
}

function selectionPackCopyExamples(value: ResearchApplicableProduct): VendorResearchCopyExample[] {
  const count = value.productName.match(/(\d+)\s*종/u)?.[1];
  const countLabel = count ? `${count}종 ` : "";
  return [
    { angle: "향 선택", headline: `${countLabel}취향대로 골라 담는 샤워 타임`, support: "오늘 기분에 맞는 향으로 골라보세요", factIds: [] },
    { angle: "선택 고민", headline: "한 가지 향만 고르기 아쉬웠다면", support: `${countLabel}골라담기로 욕실 취향 완성`, factIds: [] },
    { angle: "일상 루틴", headline: "그날 기분 따라 달라지는 샤워 루틴", support: `${countLabel}원하는 향을 골라 담아보세요`, factIds: [] },
  ];
}

export function applyOriginalSourceVendorResearch(value: ExtractedProductInfo, productUrl: string): ExtractedProductInfo;
export function applyOriginalSourceVendorResearch(value: ProductInfoForPrompt, productUrl: string): ProductInfoForPrompt;
export function applyOriginalSourceVendorResearch(value: ResearchApplicableProduct, productUrl: string): ResearchApplicableProduct {
  const matched = matchResearchProduct(value, productUrl);
  if (!matched) return value;
  const loaded = researchLibraryForRequest();
  const primary = matched.product;
  const packResearch = matched.selectionPack ? selectionPackResearch(matched.products) : undefined;
  const facts = (primary ? primary.facts : packResearch?.facts || []).filter((fact) => fact.copyEligibility !== "blocked" && fact.copyEligibility !== "researchOnly");
  const headlineFacts = facts.filter((fact) => fact.copyEligibility === "headlineEligible").map((fact) => fact.value);
  const proofFacts = facts.filter((fact) => fact.copyEligibility === "proofOnly").map((fact) => fact.value);
  const cleanIncoming = (values: Array<string | undefined>) => values.filter((item): item is string => Boolean(item && !isUnsafeProductCreativeSignal(item) && !isShippingCreativeSignal(item)));
  const verifiedBenefits = compact([primary?.mainBenefit, ...headlineFacts, ...proofFacts, ...cleanIncoming(value.verifiedBenefits || [])], 16);
  const ingredients = compact([...(primary?.ingredients || []), ...cleanIncoming(value.ingredients || [])], 12);
  const description = compact([...cleanIncoming([productDescription(value)]), primary?.mainBenefit, ...headlineFacts, ...proofFacts], 12).join(" · ");
  const vendorResearch: VendorProductResearchContext = {
    sourceType: loaded.library.sourceType,
    sourceLabel: loaded.library.sourceLabel,
    researchProductId: primary?.id || "original-source-selection-pack",
    sourceDocument: primary?.sourceDocument || "오리지널소스 5개 상품 제공 조사 시트",
    extractedAt: loaded.library.extractedAt,
    researchVersion: loaded.library.version,
    researchHash: loaded.hash,
    matchReason: matched.reason,
    facts,
    adCopyExamples: primary?.copyExamples || packResearch?.copyExamples || selectionPackCopyExamples(value),
    memberResearchProductIds: matched.selectionPack ? matched.products.map((product) => product.id) : undefined,
    // 사용자가 제공한 5개 조사 시트는 오리지널소스에 한해 허용 근거다.
    // 과거 검토 목록은 추적용으로만 보존하고 ProductTruth 차단에는 넘기지 않는다.
    blockedClaims: [],
    allowSheetClaimsInCopy: true,
    researchCautions: primary?.researchCautions || [],
  };

  return {
    ...value,
    category: !value.category || /^(?:기타|생활용품)$/u.test(value.category) ? "화장품" : value.category,
    mainBenefit: primary?.mainBenefit || value.mainBenefit || "",
    targetCustomer: primary?.targetCustomer || value.targetCustomer || "",
    description,
    extractedDescription: description,
    verifiedBenefits,
    ingredients,
    vendorResearch,
  };
}

export function matchOriginalSourceVendorResearch(value: Pick<ExtractedProductInfo, "productName" | "brandName">, productUrl: string) {
  return matchResearchProduct({ ...value, category: "", price: "", discountInfo: "", mainBenefit: "", targetCustomer: "", landingUrl: productUrl, productImagePath: "", backgroundImagePath: "" }, productUrl);
}
