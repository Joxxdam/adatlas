"use client";

import type { ProductInfoForPrompt } from "./types";

const productAnalysisStorageKeyPrefix = "adatlas-product-analysis:";
const productAnalysisStorageVersion = "product-analysis-v2-product-source-safety";

export type StoredProductAnalysis = {
  productInfo: ProductInfoForPrompt;
  selectedAdvertiserName: string;
  generationPlanConfirmed: boolean;
  savedAt: string;
};

type StoredProductAnalysisRecord = StoredProductAnalysis & {
  version: string;
};

function normalizeStoredProductUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    url.hash = "";
    return url.toString();
  } catch {
    return trimmed;
  }
}

function productAnalysisStorageKey(productUrl: string) {
  return `${productAnalysisStorageKeyPrefix}${encodeURIComponent(normalizeStoredProductUrl(productUrl))}`;
}

export function readStoredProductAnalysis(productUrl: string): StoredProductAnalysis | null {
  if (typeof window === "undefined" || !productUrl.trim()) return null;
  try {
    const raw = window.localStorage.getItem(productAnalysisStorageKey(productUrl));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredProductAnalysisRecord>;
    if (parsed.version !== productAnalysisStorageVersion || !parsed.productInfo?.productName || normalizeStoredProductUrl(parsed.productInfo.landingUrl || "") !== normalizeStoredProductUrl(productUrl)) {
      return null;
    }
    return {
      productInfo: parsed.productInfo,
      selectedAdvertiserName: parsed.selectedAdvertiserName || "",
      generationPlanConfirmed: Boolean(parsed.generationPlanConfirmed),
      savedAt: parsed.savedAt || "",
    };
  } catch {
    return null;
  }
}

export function writeStoredProductAnalysis(productUrl: string, analysis: StoredProductAnalysis) {
  const record: StoredProductAnalysisRecord = {
    ...analysis,
    version: productAnalysisStorageVersion,
  };
  window.localStorage.setItem(productAnalysisStorageKey(productUrl), JSON.stringify(record));
}
