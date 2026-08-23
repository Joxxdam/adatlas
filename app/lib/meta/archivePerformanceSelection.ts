import type { CreativeArchiveEntry } from "../creative-archive/types";
import type { MetaCreativeDraft, PerformanceTestType } from "./types";

const hookCodePattern = /^H0[1-6]$/;

export type ArchivePerformanceSelection = {
  entries: CreativeArchiveEntry[];
  valid: boolean;
  message: string;
  testType: PerformanceTestType;
  hookOnlyEligible: boolean;
};

function identity(entry: CreativeArchiveEntry, field: "advertiser" | "product") {
  if (field === "advertiser") {
    return String(entry.advertiserId || entry.advertiserName)
      .trim()
      .toLowerCase();
  }
  return String(entry.productId || entry.productName)
    .trim()
    .toLowerCase();
}

export function isArchivePerformanceEligible(entry: CreativeArchiveEntry) {
  return Boolean(entry.id && entry.assetCode && entry.imageUrl && hookCodePattern.test(String(entry.hookCode).toUpperCase()));
}

export function prepareArchivePerformanceSelection(input: CreativeArchiveEntry[]): ArchivePerformanceSelection {
  const entries = input
    .filter(isArchivePerformanceEligible)
    .slice(0, 6)
    .sort((left, right) => left.hookCode.localeCompare(right.hookCode));
  const base = entries[0];
  const sameAdvertiser = Boolean(base && entries.every((entry) => identity(entry, "advertiser") === identity(base, "advertiser")));
  const sameProduct = Boolean(base && entries.every((entry) => identity(entry, "product") === identity(base, "product")));
  const uniqueHooks = new Set(entries.map((entry) => entry.hookCode.toUpperCase())).size === entries.length;
  const templateIds = new Set(entries.map((entry) => String(entry.templateId || "").trim()).filter(Boolean));
  const visualDirections = new Set(entries.map((entry) => String(entry.visualDirection || "").trim()).filter(Boolean));
  const hookOnlyEligible = entries.length >= 2 && templateIds.size === 1 && visualDirections.size === 1 && entries.every((entry) => Boolean(entry.templateId && entry.visualDirection));
  const testType: PerformanceTestType = hookOnlyEligible ? "hook-only" : "creative-combination";

  if (!entries.length) {
    return {
      entries,
      valid: false,
      message: "소재코드와 H01~H06이 발급된 완성 이미지를 선택해 주세요.",
      testType,
      hookOnlyEligible,
    };
  }
  if (entries.length < 2) {
    return {
      entries,
      valid: false,
      message: "성과를 비교하려면 같은 상품의 소재를 2장 이상 선택해 주세요.",
      testType,
      hookOnlyEligible,
    };
  }
  if (!sameAdvertiser || !sameProduct) {
    return {
      entries,
      valid: false,
      message: "한 번의 테스트에는 같은 광고주·같은 상품 소재만 선택할 수 있습니다.",
      testType,
      hookOnlyEligible,
    };
  }
  if (!uniqueHooks) {
    return {
      entries,
      valid: false,
      message: "같은 후킹 코드가 중복되었습니다. H01~H06을 한 장씩 선택해 주세요.",
      testType,
      hookOnlyEligible,
    };
  }
  return {
    entries,
    valid: true,
    message: hookOnlyEligible ? "동일한 디자인 조건이 확인되어 후킹 문구 차이를 비교할 수 있습니다." : "장면·레이아웃이 서로 달라 후킹 단독 효과가 아닌 전체 소재 조합 성과로 비교합니다.",
    testType,
    hookOnlyEligible,
  };
}

export function archiveEntriesToMetaDrafts(entries: CreativeArchiveEntry[], landingUrl: string): MetaCreativeDraft[] {
  return prepareArchivePerformanceSelection(entries).entries.map((entry) => {
    const hookCode = entry.hookCode.toUpperCase() as MetaCreativeDraft["hookCode"];
    const materialCode = String(entry.assetCode);
    return {
      hookCode,
      materialCode,
      mediaPath: entry.imageUrl,
      mediaType: "image",
      mediaRatio: "1:1",
      primaryText: [entry.headline, entry.subCopy].filter(Boolean).join("\n"),
      headline: entry.headline,
      description: entry.subCopy || entry.mainMessage,
      landingUrl,
      utm: entry.utmContent || `utm_source=meta&utm_medium=paid_social&utm_campaign=adatlas_archive&utm_content=${encodeURIComponent(materialCode)}`,
      approved: true,
    };
  });
}
